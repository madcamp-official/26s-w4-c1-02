// 값 붙여넣기로 깨진 칸 고치기 (보장선 B1 · 기능 ④의 마지막 한 걸음)
//
// 자가 치유가 두 번 다 실패하면 소스는 `needs_attention` 이 되고, 지금까지 화면은
// **거기서 끝났다** — "확인이 필요합니다" 라고 말할 뿐 사용자가 할 수 있는 일이 없었다.
// 기획서 9-3③ 의 흐름도가 약속한 것은 상태 표시(B4)까지였지만, B1 이 이미 답을 갖고 있다:
//
//   "못 찾은 필드는 **값을 붙여넣게** 하고 시스템이 역추적한다."
//
// 접합(9-2)에만 배선돼 있던 그 길을 **이미 붙어서 돌던 소스**에도 연다.
// 사용자는 목록에서 값 하나를 복사해 붙여넣을 뿐이고, 셀렉터는 여전히 시스템의 일이다.
//
// ── 승격 관문은 치유와 똑같다 ───────────────────────────────────────────
// 사용자가 값을 줬다고 해서 검증을 건너뛰지 않는다. 붙여넣은 값이 우연히 다른 자리에서도
// 발견될 수 있고, 그 자리가 목록 전체에서는 안 맞을 수 있다. 그래서 heal.ts 와 같은
// 두 겹(evaluateReport + passesHealGate)을 그대로 통과시킨다. 다른 점은 **경로를 LLM 이 아니라
// 사용자가 가리켰다는 것** 하나뿐이라, 어댑터 origin 은 'human' 으로 남는다.
//
// ── 고치는 것은 그 칸 하나뿐이다 ────────────────────────────────────────
// 스펙을 통째로 새로 만들지 않고 **지목된 필드의 path 만** 갈아끼운다. 타입·변환·목록 경로는
// 그대로 둔다 — 드리프트는 보통 칸 하나에서 나고, 나머지를 건드리면 멀쩡한 칸까지 위험해진다.

import type { AdapterSpec } from '@endpointer/core/spec'
import { validateSpec } from '@endpointer/core/spec'
import { computeBaseline, evaluateReport, passesHealGate } from '@endpointer/core/validate'

import { getConfig } from '../config'
import {
  finishRun,
  insertCandidateAdapter,
  lastSeenItemKeys,
  loadSourceContext,
  promoteAdapter,
  recentValidationReports,
  setSourceStatus,
  startRun,
  upsertItems,
} from '../db'
import { runAdapter } from '../fetchers'
import { childLogger } from '../logger'
import { resolveByPastedValue } from './attach-source'

const log = childLogger({ mod: 'repair' })

export interface RepairFieldInput {
  source_id: string
  /** 고칠 칸 (컬렉션 스키마의 키) */
  key: string
  /** 사용자가 목록에서 복사해 온 값 */
  value: string
}

export type RepairFieldOutcome =
  | {
      ok: true
      /** 승격된 새 어댑터 버전 */
      version: number
      items_found: number
      /** 그 값이 목록의 몇 %에서 발견됐는지 — 화면이 "N개 항목에서 찾았어요" 로 쓴다 */
      coverage: number
      label: string
    }
  | { ok: false; message: string; stage: string }

/**
 * 붙여넣은 값 하나로 칸 하나를 고친다.
 *
 * 실패는 전부 값으로 돌려준다 (보장선 B4) — 던지지 않는다. 화면은 그 문장을 그대로 쓴다.
 */
export async function repairFieldByPastedValue(input: RepairFieldInput): Promise<RepairFieldOutcome> {
  const ctx = await loadSourceContext(input.source_id)
  if (ctx === null) return { ok: false, message: '그 사이트를 찾지 못했어요.', stage: 'source' }

  const { source, collection, adapter } = ctx
  if (adapter === null) {
    return { ok: false, message: '이 사이트는 아직 가져오는 방법이 없어요.', stage: 'adapter' }
  }

  const field = collection.schema_json.find((f) => f.key === input.key)
  if (field === undefined) {
    return { ok: false, message: '그런 칸이 이 표에 없어요.', stage: 'field' }
  }

  // ── ① 붙여넣은 값이 어디에 있는지 역추적 (LLM 없음 — B1) ────────────
  const previousSpec = adapter.spec_json as AdapterSpec
  const resolved = await resolveByPastedValue({
    url: source.entry_url,
    key: input.key,
    value: input.value,
    // 원래 브라우저로 열던 사이트면 여기서도 브라우저를 쓴다 (안 그러면 목록이 안 그려진다)
    skipBrowser: previousSpec.fetch.mode !== 'browser',
  })
  if (!resolved.ok) return { ok: false, message: resolved.message, stage: 'trace' }

  // ── ② 그 칸의 경로만 갈아끼운다 ─────────────────────────────────────
  // 이미 있던 칸이면 타입·변환을 보존하고 path 만 바꾼다. 없던 칸(접합 때 못 찾아 비워둔 칸)이면
  // 타입만 얹어 새로 넣는다 — 변환은 얹지 않는다 (붙여넣은 값 그대로가 정답이다 · attach 와 같은 규율).
  const previousField = previousSpec.fields[input.key] as Record<string, unknown> | undefined
  const draft: Record<string, unknown> = {
    ...previousSpec,
    fields: {
      ...previousSpec.fields,
      [input.key]:
        previousField === undefined
          ? { path: resolved.path, type: field.type }
          : { ...previousField, path: resolved.path },
    },
  }

  // 스펙 검사는 기존 관문 그대로 (ADR A2 — 연산자 집합 밖은 여기서 걸린다)
  const validated = validateSpec(draft, {
    host: source.host,
    schema: collection.schema_json.filter((f) => f.key in (draft.fields as object)),
    allowPrivateHosts: getConfig().allowPrivateHosts,
  })
  if (!validated.ok) {
    log.warn({ key: input.key, errors: validated.errors }, '수리 스펙이 검사를 통과하지 못했다')
    return { ok: false, message: '이 값으로는 고치지 못했어요. 다른 값을 붙여넣어 보세요.', stage: 'spec' }
  }

  // ── ③ 실제로 뽑아본다 + 치유와 같은 두 겹 관문 ──────────────────────
  const runId = await startRun({ source_id: source.id, adapter_id: adapter.id })
  const trialSchema = collection.schema_json.filter((f) => f.key in validated.spec.fields)
  const trial = await runAdapter({ spec: validated.spec, schema: trialSchema })

  const baseline = computeBaseline(await recentValidationReports(source.id))
  const verdict = evaluateReport(trial.report, baseline, trialSchema)
  if (verdict.verdict !== 'ok') {
    await closeFailedRun(runId, trial.items.length, trial.report)
    return {
      ok: false,
      message: '이 값으로 고쳐봤지만 목록이 제대로 읽히지 않았어요. 목록에 보이는 값을 그대로 복사해 주세요.',
      stage: 'verify',
    }
  }

  // 엉뚱한 목록을 잡았는지 — 붙여넣기라도 이 관문은 면제되지 않는다 (heal.ts 머리말 2)
  const prevKeys = await lastSeenItemKeys(source.id)
  if (!passesHealGate(prevKeys, trial.items.map((i) => i.external_key))) {
    await closeFailedRun(runId, trial.items.length, trial.report)
    return {
      ok: false,
      message: '이 값으로 고치면 전혀 다른 목록을 가져오게 돼요. 지금 표에 있는 항목의 값을 붙여넣어 주세요.',
      stage: 'gate',
    }
  }

  // ── ④ 승격 — 이전 버전은 남긴다 (롤백 가능) ─────────────────────────
  const candidate = await insertCandidateAdapter({
    source_id: source.id,
    spec: validated.spec,
    // LLM 이 아니라 사람이 가리킨 경로다
    origin: 'human',
    validation: trial.report,
  })
  if (candidate === null) {
    await closeFailedRun(runId, trial.items.length, trial.report)
    return { ok: false, message: '고친 방법을 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.', stage: 'promote' }
  }
  await promoteAdapter(source.id, candidate.id)

  const upsert = await upsertItems({
    collection_id: collection.id,
    source_id: source.id,
    items: trial.items,
  })
  await setSourceStatus(source.id, 'ok')

  // 복구는 반드시 기록으로 남는다 — 화면의 "이번 달 자동 복구 N회" 가 이 행을 센다 (기능 ④의 절반)
  if (runId !== null) {
    await finishRun(runId, {
      status: 'healed',
      items_found: trial.items.length,
      items_new: upsert.newItemIds.length,
      validation_json: trial.report,
      error_summary: null,
    })
  }

  log.info(
    { host: source.host, key: input.key, path: resolved.path, version: candidate.version, items: trial.items.length },
    '붙여넣은 값으로 고쳤다',
  )
  return {
    ok: true,
    version: candidate.version,
    items_found: trial.items.length,
    coverage: resolved.coverage,
    label: field.label,
  }
}

/** 실패한 시도도 수집 기록에 남긴다 — 조용히 삼키면 "왜 그대로지" 의 답이 사라진다 */
async function closeFailedRun(
  runId: string | null,
  itemsFound: number,
  report: Awaited<ReturnType<typeof runAdapter>>['report'],
): Promise<void> {
  if (runId === null) return
  await finishRun(runId, {
    status: 'failed',
    items_found: itemsFound,
    items_new: 0,
    validation_json: report,
    error_summary: '붙여넣은 값으로 고치지 못했습니다.',
  })
}
