// 정기 수집 한 바퀴 (기획서 9-3 ①② · 원칙 ④⑤)
//
// ── 이 파일은 흐름도 그 자체다 ──────────────────────────────────────────
//
//   어댑터 로드 → fetch(mode별) → core 해석기 → core 드리프트 검증
//     ├─ 통과   → items UPSERT (신규/변경 판정) → 뷰 평가 큐
//     └─ 드리프트 → 이 소스만 격리 → heal 큐
//
// 판단 로직을 여기에 쓰지 않는 것이 요점이다. 임계값도 문구도 전부 core 에 있고
// 이 파일은 **순서만** 안다. 그래야 화면 미리보기와 정기 수집이 같은 판정을 낸다.
//
// 예외를 던지지 않는 규칙: 소스 하나가 죽어도 나머지는 계속 돈다 (원칙 ④).
// 던져야 할 것은 "재시도하면 될 것" 뿐이고, 그건 BullMQ 가 맡는다.

import { computeBaseline, evaluateReport, verdictToRunStatus } from '@endpointer/core/validate'
import type { AdapterSpec } from '@endpointer/core/spec'

import {
  existingItemKeys,
  finishRun,
  loadSourceContext,
  markSourceRun,
  recentValidationReports,
  setSourceStatus,
  startRun,
  upsertItems,
} from '../db'
import { runAdapter } from '../fetchers'
import { childLogger } from '../logger'
import { enqueueEvaluate, enqueueHeal, type CollectJobData } from '../queues'

export interface CollectJobResult {
  /** 실제로 수집을 돌렸는지. 일시정지·미컴파일 소스는 false */
  ran: boolean
  items_found: number
  items_new: number
  items_changed: number
  status: 'ok' | 'drift' | 'failed' | 'skipped'
  /** 사용자에게 보여줄 한 줄. 정상이면 null (보장선 B4) */
  summary: string | null
}

const SKIPPED = (summary: string | null): CollectJobResult => ({
  ran: false,
  items_found: 0,
  items_new: 0,
  items_changed: 0,
  status: 'skipped',
  summary,
})

export async function runCollectJob(data: CollectJobData): Promise<CollectJobResult> {
  const log = childLogger({ job: 'collect', host: data.host, source_id: data.source_id })

  // ── 어댑터 로드 ──────────────────────────────────────────────────────
  const ctx = await loadSourceContext(data.source_id)
  if (ctx === null) {
    // 소스가 지워졌는데 스케줄만 남은 경우 (컬렉션 삭제는 화면 쪽 SQL 이라 스케줄을 모른다).
    // 부팅 동기화만 기다리면 재시작 없는 프로덕션에선 고아 스케줄이 매일 영원히 헛돈다 —
    // 그래서 여기서 스스로 뗀다. loadSourceContext 의 null 은 "행이 없다" 일 때뿐이라
    // (DB 장애는 throw → BullMQ 재시도) 산 소스를 잘못 뗄 일은 없다.
    log.warn('없는 사이트에 대한 수집 요청 — 스케줄을 떼고 건너뜁니다')
    const { unscheduleSource } = await import('../queues')
    await unscheduleSource(data.source_id).catch(() => {})
    return SKIPPED(null)
  }

  const { source, collection, adapter } = ctx

  if (source.status === 'paused') {
    log.debug('일시정지된 사이트 — 건너뜁니다')
    return SKIPPED(null)
  }

  if (adapter === null) {
    // 아직 이 사이트를 읽는 방법이 없다. 최초 컴파일은 컬렉션 생성 흐름(9-1②)의 일이고
    // 정기 수집이 대신 해주지 않는다 — 사용자가 후보를 확인하는 단계를 건너뛰게 되기 때문이다.
    log.warn('아직 읽는 방법이 정해지지 않은 사이트 — 건너뜁니다')
    return SKIPPED('이 사이트는 아직 읽을 준비가 끝나지 않았어요.')
  }

  const spec = adapter.spec_json as AdapterSpec
  const runId = await startRun({ source_id: source.id, adapter_id: adapter.id })

  // ── EXECUTE — fetch(mode별) → core 해석기 ────────────────────────────
  const run = await runAdapter({ spec, schema: collection.schema_json })

  // ── VALIDATE — 스키마가 곧 검증기 (원칙 ⑤) ──────────────────────────
  //
  // 기준선은 **최근 성공 수집** 에서만 만든다. 없으면(첫 수집) 판정하지 않는다 —
  // 비교 대상 없는 판정은 전부 오탐이다 (core/validate/baseline.ts).
  const baseline = computeBaseline(await recentValidationReports(source.id))
  const drift = evaluateReport(run.report, baseline, collection.schema_json)

  await markSourceRun(source.id, drift.verdict === 'ok')

  // ── 드리프트 · 실패 ──────────────────────────────────────────────────
  if (drift.verdict !== 'ok') {
    // 이 소스만 격리한다. 나머지 소스는 계속 정상 응답하고, 이 소스도
    // **마지막 성공 데이터를 계속 서빙한다** (원칙 ④ — 지우지 않는다).
    await setSourceStatus(source.id, 'healing')
    if (runId !== null) {
      await finishRun(runId, {
        status: verdictToRunStatus(drift.verdict),
        items_found: run.items.length,
        items_new: 0,
        validation_json: run.report,
        error_summary: drift.summary,
      })
      await enqueueHeal({
        source_id: source.id,
        collection_id: collection.id,
        run_id: runId,
        attempt: 1,
      })
    }
    log.warn({ verdict: drift.verdict, signals: drift.signals.map((s) => s.kind) }, '드리프트 감지')
    return {
      ran: true,
      items_found: run.items.length,
      items_new: 0,
      items_changed: 0,
      status: drift.verdict,
      summary: drift.summary,
    }
  }

  // ── UPSERT — 신규/변경 판정 (ADR A13) ────────────────────────────────
  const upsert = await upsertItems({
    collection_id: collection.id,
    source_id: source.id,
    items: run.items,
  })

  // 고쳐진 뒤 처음 통과한 수집이면 상태를 되돌린다.
  if (source.status !== 'ok') await setSourceStatus(source.id, 'ok')

  if (runId !== null) {
    await finishRun(runId, {
      status: source.status === 'healing' ? 'healed' : 'ok',
      items_found: run.items.length,
      items_new: upsert.newItemIds.length,
      validation_json: run.report,
      error_summary: null,
    })
  }

  // ── 뷰 평가 (A34) — 새 데이터가 들어왔으니 enter 를 잡는다 ───────────
  // (07-30 개편) 전건 구독 발송은 없어졌다 — 알림은 "알림 켠 뷰"의 enter 로만 나가고,
  // 받을 주소(체크된 것 전부)는 evaluate-views 가 컬렉션에서 읽는다.
  // 여기서 직접 부르지 않고 **큐로 민다** (enqueueEvaluate 머리말) — 같은 컬렉션의
  // 소스 둘이 동시에 수집을 마치면 평가가 겹쳐 돌아 같은 enter 가 두 번 잡혔다.
  // 큐 등록이 죽어도 수집은 성공이다 — 다음 평가(자정)가 따라잡는다 (원칙 ④).
  try {
    await enqueueEvaluate(collection.id)
  } catch (e) {
    log.error({ err: e }, '수집 후 뷰 평가를 큐에 넣지 못했다 — 다음 평가(자정)가 따라잡는다')
  }

  log.info(
    { items: run.items.length, new: upsert.newItemIds.length, changed: upsert.changedItemIds.length },
    '수집 완료',
  )

  return {
    ran: true,
    items_found: run.items.length,
    items_new: upsert.newItemIds.length,
    items_changed: upsert.changedItemIds.length,
    status: 'ok',
    summary: null,
  }
}

/**
 * 치유가 승격된 직후 "정말 고쳐졌는지" 를 다시 재는 데 쓴다 (9-3③).
 * heal.ts 가 부른다 — 수집과 같은 경로를 타야 판정이 같다.
 */
export async function knownItemKeys(sourceId: string): Promise<string[]> {
  return existingItemKeys(sourceId)
}
