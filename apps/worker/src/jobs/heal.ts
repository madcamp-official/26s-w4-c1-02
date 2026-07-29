// 자가 치유 (기획서 9-3③ · 기능 ④ · 15장)
//
//   격리 → 재컴파일 → 재검증 + 겹침률 → 승격 or needs_attention
//
// ── 세 가지가 이 파일의 전부다 ──────────────────────────────────────────
//
//  1. **격리가 먼저다.** 재컴파일보다 앞이다. 고치는 동안에도 이 소스는
//     마지막 성공 데이터를 계속 서빙하고, 나머지 소스는 아무 영향을 받지 않는다 (원칙 ④).
//
//  2. **승격 관문이 두 겹이다.** 검증(evaluateReport)을 통과해도 겹침률(passesHealGate)을
//     통과하지 못하면 올리지 않는다. 검증만 보면 "엉뚱한 목록을 아주 깔끔하게 뽑은" 스펙이
//     통과해 버린다 — 사이드바 메뉴 12개를 공고 12개로 착각하는 실패가 그것이다.
//
//  3. **못 고치는 것은 사고가 아니라 상태다.** 하루 상한을 넘겨도, 키가 없어도, 재컴파일이
//     실패해도 결과는 `needs_attention` 이다. 던지지 않는다 (보장선 B4 · 15장).
//
// 자동 복구를 로그로 쌓는 게 기능의 절반이다 — 승격은 반드시 `runs.status='healed'` 로 남는다.

import type { AdapterSpec } from '@endpointer/core/spec'
import {
  computeBaseline,
  evaluateReport,
  healPrompt,
  passesHealGate,
} from '@endpointer/core/validate'

import { recompileSpec } from '../compile'
import { getConfig } from '../config'
import {
  lastSeenItemKeys,
  finishRun,
  healAttemptsToday,
  insertCandidateAdapter,
  loadRun,
  loadSourceContext,
  promoteAdapter,
  recentValidationReports,
  setSourceStatus,
  startRun,
  upsertItems,
} from '../db'
import { runAdapter } from '../fetchers'
import { childLogger } from '../logger'
import { probe } from '../probe'
import type { HealJobData } from '../queues'

export type HealJobResult =
  | { outcome: 'healed'; adapter_version: number; items_found: number; overlap_ok: true }
  | { outcome: 'needs_attention'; reason: HealFailureReason; message: string }
  | { outcome: 'skipped'; message: string | null }

export type HealFailureReason =
  /** 오늘 상한을 다 썼다 (HEAL_MAX_ATTEMPTS_PER_DAY) */
  | 'budget'
  /** 페이지에서 목록 후보를 못 찾았다 */
  | 'no_candidate'
  /** 재컴파일이 실패했다 (키 없음 · 쿼터 · 검증 거절) */
  | 'compile_failed'
  /** 새 스펙으로도 제대로 안 뽑힌다 */
  | 'still_broken'
  /** 뽑히긴 하는데 직전 목록과 겹치지 않는다 = 엉뚱한 목록 */
  | 'wrong_list'

/**
 * 치유 probe 에서 브라우저 단계를 끌 것인가 (day2 §8 후보의 답).
 *
 * 예전엔 `mode !== 'browser'` 로 json 소스까지 껐는데, 네트워크 관찰(3단계)이
 * 브라우저에 붙어 있으므로 **내부 API 로 태어난 json 소스의 재발견 경로가 막혔다** —
 * API 경로가 바뀌어 깨진 소스를 정적 DOM 만으로 다시 찾을 수는 없다 (JS 렌더 목록이면 더더욱).
 * 정적 DOM 에서 태어난 html 소스만 싸게 간다. 치유는 하루 상한이 있어 브라우저 비용은 유한하다.
 */
export function healSkipsBrowser(mode: AdapterSpec['fetch']['mode']): boolean {
  return mode === 'html'
}

/** 사용자가 읽는 문구. 내부 명사 금지 (보장선 B2 · B4) — guardrails.test 가 검사한다 */
export const MESSAGES: Record<HealFailureReason, string> = {
  budget:
    '오늘은 이 사이트를 자동으로 고쳐보는 횟수를 다 썼어요. 마지막으로 받아둔 내용을 그대로 보여드리는 중이고, 내일 다시 시도합니다.',
  no_candidate: '이 사이트 구조가 바뀐 것 같아요. 목록을 찾지 못했습니다.',
  compile_failed: '이 사이트 구조가 바뀐 것 같아요. 자동으로 고쳐보려 했지만 아직 못 맞췄습니다.',
  still_broken: '이 사이트 구조가 바뀐 것 같아요. 새로 맞춰본 방법으로도 목록이 제대로 읽히지 않습니다.',
  wrong_list: '이 사이트에서 다른 목록을 잡은 것 같아 적용하지 않았어요. 마지막으로 받아둔 내용을 그대로 보여드립니다.',
}

export async function runHealJob(data: HealJobData): Promise<HealJobResult> {
  const cfg = getConfig()
  const log = childLogger({ job: 'heal', source_id: data.source_id, attempt: data.attempt })

  const ctx = await loadSourceContext(data.source_id)
  if (ctx === null) return { outcome: 'skipped', message: null }

  const { source, collection, adapter } = ctx
  if (source.status === 'paused') return { outcome: 'skipped', message: null }
  if (adapter === null) {
    // 고칠 대상이 없다. 최초 컴파일은 컬렉션 생성 흐름의 일이다 (9-1②).
    return { outcome: 'skipped', message: null }
  }

  // ── ① 격리 — 재컴파일보다 먼저다 ────────────────────────────────────
  await setSourceStatus(source.id, 'healing')

  // ── 치유 시도는 **결과와 무관하게** 수집 기록에 남는다 ───────────────
  // "복구를 로그로 쌓아 보여주는 것"까지가 기능 ④다 (CLAUDE.md 상위 제약 ②).
  // 성공(healed)만 남기고 실패를 조용히 삼키면, 사용자는 "왜 며칠째 그대로지"의
  // 답을 영원히 못 본다. 그래서 run 을 여기서 만들고 모든 종료 경로가 닫는다.
  const runId = await startRun({ source_id: source.id, adapter_id: adapter.id })

  // ── 하루 상한 (15장) — 초과는 정지가 아니라 상태다 ──────────────────
  const attemptsToday = await healAttemptsToday(source.id)
  if (attemptsToday > cfg.healMaxAttemptsPerDay) {
    return await giveUp(runId, source.id, 'budget', log)
  }

  const previousSpec = adapter.spec_json as AdapterSpec

  // ── 치유의 목표는 **원래 하던 일**이다 ───────────────────────────────
  // 이 소스가 애초에 못 찾아 "물어볼 칸"으로 남긴 필드(접합 9-2)를 치유가 갑자기
  // 발명하게 두면, LLM 이 지어낸 경로가 전부 null 을 내서 검증이 영원히 거절한다 —
  // wevity 의 posted_at 으로 실측했다 (null_ratio 1 → still_broken 무한 반복).
  // 그래서 재컴파일·검증 전부 **이전 스펙이 갖고 있던 칸**만으로 돈다.
  // 없는 칸을 채우는 것은 치유가 아니라 스키마 편집(델타 6)의 몫이다.
  const healSchema = collection.schema_json.filter((f) => f.key in previousSpec.fields)

  // ── ② 무엇이 깨졌는지를 문장으로 만든다 ─────────────────────────────
  //
  // 프롬프트에 "deadline 필드가 92% null 입니다. 이전 경로는 $.reqstEndDe" 를 넣는 그 부분이다.
  // 신호를 저장해 두지 않고 `runs.validation_json` 에서 다시 계산한다 — 판정 코드가 한 곳뿐이어야
  // 치유 프롬프트와 화면 문구가 갈라지지 않는다.
  const brokenSummary = await describeBreakage(data.run_id, source.id, healSchema, previousSpec)

  // ── ③ 페이지를 다시 본다 — 후보가 있어야 재컴파일할 수 있다 ─────────
  const probed = await probe(source.entry_url, {
    skipBrowser: healSkipsBrowser(previousSpec.fetch.mode),
  })
  if (probed.best === null) {
    return await giveUp(runId, source.id, 'no_candidate', log)
  }

  // ── ④ 재컴파일 (Gemini) ─────────────────────────────────────────────
  const compiled = await recompileSpec({
    url: source.entry_url,
    host: source.host,
    source_id: source.id,
    schema: healSchema,
    candidate: probed.best,
    pageText: probed.page.text,
    previousSpec,
    brokenSummary,
  })
  if (!compiled.ok) {
    log.warn({ reason: compiled.reason, errors: compiled.errors }, '재컴파일 실패')
    // 예산 소진은 다른 문구를 쓴다 — 사용자에게는 "내일 다시" 가 정확한 정보다.
    const reason: HealFailureReason = compiled.reason === 'budget_exhausted' ? 'budget' : 'compile_failed'
    return await giveUp(runId, source.id, reason, log, compiled.message)
  }

  // ── ⑤ candidate 로 추출 → 재검증 ────────────────────────────────────
  const trial = await runAdapter({ spec: compiled.spec, schema: healSchema })
  const baseline = computeBaseline(await recentValidationReports(source.id))
  const verdict = evaluateReport(trial.report, baseline, healSchema)

  if (verdict.verdict !== 'ok') {
    return await giveUp(runId, source.id, 'still_broken', log, undefined, {
      items_found: trial.items.length,
      report: trial.report,
    })
  }

  // ── ⑥ 겹침률 — 엉뚱한 목록을 잡았는지 (승격 관문 두 번째) ───────────
  // 비교 대상은 누적 전체가 아니라 **직전 성공 수집의 페이지** 다 (lastSeenItemKeys 머리말).
  // 누적으로 재면 옛 항목이 분모에 쌓여 정상 스펙이 wrong_list 로 영구 거부된다.
  const prevKeys = await lastSeenItemKeys(source.id)
  const newKeys = trial.items.map((i) => i.external_key)
  if (!passesHealGate(prevKeys, newKeys)) {
    return await giveUp(runId, source.id, 'wrong_list', log, undefined, {
      items_found: trial.items.length,
      report: trial.report,
    })
  }

  // ── ⑦ 승격 — 이전 버전은 남긴다 (롤백 가능) ────────────────────────
  const candidateRow = await insertCandidateAdapter({
    source_id: source.id,
    spec: compiled.spec,
    origin: 'heal',
    validation: trial.report,
  })
  if (candidateRow === null) {
    return await giveUp(runId, source.id, 'compile_failed', log, undefined, {
      items_found: trial.items.length,
      report: trial.report,
    })
  }
  await promoteAdapter(source.id, candidateRow.id)

  const upsert = await upsertItems({
    collection_id: collection.id,
    source_id: source.id,
    items: trial.items,
  })

  await setSourceStatus(source.id, 'ok')
  if (runId !== null) {
    await finishRun(runId, {
      status: 'healed',
      items_found: trial.items.length,
      items_new: upsert.newItemIds.length,
      validation_json: trial.report,
      // 실패가 아니라 복구다. 화면의 "이번 달 자동 복구 N회" 가 이 행을 센다.
      error_summary: null,
    })
  }

  log.info({ version: candidateRow.version, items: trial.items.length }, '자동 복구 성공')
  return {
    outcome: 'healed',
    adapter_version: candidateRow.version,
    items_found: trial.items.length,
    overlap_ok: true,
  }
}

// ── 도우미 ─────────────────────────────────────────────────────────────

/**
 * 못 고쳤다. **기록하고** 상태로 남기고 조용히 끝낸다 — 던지지 않는다 (보장선 B4).
 * 모든 실패 경로가 여기 하나를 지나므로 "치유 시도가 기록에 안 남는" 경로가 없다.
 *
 * run 상태는 둘로 가른다:
 *   · 이른 실패(상한·후보 없음·재컴파일 실패) → 'failed' — 시도조차 못 갔다
 *   · 늦은 실패(still_broken·wrong_list)       → 'drift'  — 여전히 표류 중이라는 뜻이고,
 *     하루 상한 카운터(healAttemptsToday)가 'drift' 를 세므로 바꾸면 상한이 무너진다
 */
async function giveUp(
  runId: string | null,
  sourceId: string,
  reason: HealFailureReason,
  log: ReturnType<typeof childLogger>,
  message?: string,
  trial?: { items_found: number; report: Parameters<typeof finishRun>[1]['validation_json'] },
): Promise<HealJobResult> {
  const summary = message ?? MESSAGES[reason]
  if (runId !== null) {
    const lateFailure = reason === 'still_broken' || reason === 'wrong_list'
    await finishRun(runId, {
      status: lateFailure ? 'drift' : 'failed',
      items_found: trial?.items_found ?? 0,
      items_new: 0,
      validation_json: trial?.report ?? null,
      error_summary: summary,
    })
  }
  await setSourceStatus(sourceId, 'needs_attention')
  log.warn({ reason }, '자동 복구 실패 — 사람이 봐야 합니다')
  return { outcome: 'needs_attention', reason, message: summary }
}

/**
 * 드리프트를 잡아낸 수집으로부터 "무엇이 깨졌는지" 를 Gemini 가 읽을 문장으로 만든다.
 * 신호를 못 만들면 (기록이 없거나 기준선이 없으면) 사람이 읽는 요약이라도 넘긴다.
 */
async function describeBreakage(
  runId: string,
  sourceId: string,
  schema: Parameters<typeof evaluateReport>[2],
  spec: AdapterSpec,
): Promise<string> {
  const run = await loadRun(runId)
  const report = run?.validation_json ?? null
  if (report === null) {
    return '이전 수집에서 목록을 가져오지 못했습니다. 원인은 기록에 남아 있지 않습니다.'
  }

  const baseline = computeBaseline(await recentValidationReports(sourceId))
  const drift = evaluateReport(report, baseline, schema)
  if (drift.signals.length === 0) {
    return run?.error_summary ?? drift.summary
  }
  return healPrompt(drift.signals, spec)
}
