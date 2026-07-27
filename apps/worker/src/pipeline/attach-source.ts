// 두 번째 사이트를 이미 있는 표에 붙인다 (기획서 9-2 · 기능 ② — 제품의 정체성)
//
//   [두 번째 URL] → ①PROBE → ②MATCH → ③EXECUTE → [같은 표에 두 출처]
//
// ── 이 파일이 왜 사수 대상인가 ──────────────────────────────────────────
// 기획서 5장: "여기서 사용자가 할 일이 많아지면 아무도 두 번째 소스를 붙이지 않고,
// 그러면 이 제품을 쓸 이유가 사라진다." 첫 사이트만 붙이는 도구는 널려 있다.
//
// 그래서 이 파일의 성패는 **`missing` 이 얼마나 자주 비는가** 하나로 정해진다.
// 다섯 칸 중 넷을 사용자에게 물어보면 손으로 하는 게 빠르다.
//
// ── `missing` 은 실패가 아니라 기능이다 ─────────────────────────────────
// 못 찾은 칸을 억지로 채우면 표가 조용히 틀린다. 못 찾았다고 말하고 **값을 붙여넣게** 한다.
// 붙여넣은 값은 `resolveByPastedValue` 가 역추적한다 — LLM 없이, 결정론적으로 (보장선 B1).
// 사용자는 셀렉터를 입력하지 않는다. 값을 붙여넣을 뿐이다.
//
// ── 첫 사이트와 다른 점 ─────────────────────────────────────────────────
// `create-collection.ts` 는 표의 칸을 **정하고**, 여기는 이미 정해진 칸에 **맞춘다.**
// 그래서 스키마가 입력이고, LLM 에게 "이 칸에 해당하는 값을 찾아라, 없으면 없다고 하라" 고 시킨다.
// 페이지네이션은 추론하지 않는다 — 두 번째 사이트는 1페이지만 붙이고 시작한다 (TODO(G3)).
//
// 이 파일도 `create-collection.ts` 처럼 **DB 를 모른다.** 저장은 `persist.ts` 몫이다.

import type { CollectionSchemaJson } from '@endpointer/core'
import type { AdapterSpec, InterpretedItem } from '@endpointer/core/spec'
import { validateSpec } from '@endpointer/core/spec'

import { matchFields, traceValue, type FieldMatch, type TraceHit } from '../compile'
import { getConfig } from '../config'
import { runAdapter } from '../fetchers'
import { childLogger } from '../logger'
import { probe } from '../probe'
import type { ProbePath, RankedCandidate } from '../probe/types'
import { applyTransformDrop, dropColumns, planRepair } from './repair-empty'
import { verifyLinkField } from './verify-link'

const log = childLogger({ mod: 'attach' })

export interface AttachSourceInput {
  /** 예산 계정에 쓰인다 */
  collection_id: string
  /** 붙일 표의 칸들. **이게 이 파이프라인의 목표다** */
  schema: CollectionSchemaJson
  /** 이미 표에 들어 있는 항목 표본 — "이 칸에는 이런 값" 의 실례 */
  existingSample: readonly unknown[]
  /** 사용자가 붙여넣은 두 번째 주소 */
  url: string
  /**
   * 사용자가 값을 붙여넣어 확정된 경로들 (칸 키 → 경로).
   * 2차 호출 때 넘긴다. `resolveByPastedValue` 가 만든 것을 그대로 넣는다.
   */
  resolved?: Record<string, string>
  skipBrowser?: boolean
  skipDom?: boolean
  minConfidence?: number
  now?: Date
}

/** 어느 칸을 어떻게 찾았는지 — 화면이 "자동으로 찾았어요 / 물어볼게요" 를 가르는 재료 */
export interface AttachedField {
  key: string
  label: string
  path: string
  /** 자동으로 찾았는지, 사용자가 붙여넣은 값으로 찾았는지 */
  origin: 'matched' | 'pasted'
  confidence: number
  why: string | null
  /** 실제로 뽑힌 값 몇 개 — 사용자가 눈으로 맞는지 본다 (보장선 B3) */
  samples: string[]
}

export type AttachSourceOutcome =
  | {
      ok: true
      url: string
      final_url: string
      host: string
      spec: AdapterSpec
      items: InterpretedItem[]
      report: import('@endpointer/core').ValidationReport
      /** 붙은 칸들 */
      attached: AttachedField[]
      /**
       * 아직 못 찾은 칸. **비어 있으면 바로 합류할 수 있다.**
       * 비어 있지 않으면 화면이 이 칸만 물어본다 (보장선 B1).
       */
      missing: { key: string; label: string }[]
      probe_path: ProbePath | null
      duration_ms: number
      warnings: string[]
    }
  | {
      ok: false
      url: string
      stage: 'url' | 'probe' | 'match' | 'execute'
      /** 화면에 그대로 나갈 수 있는 문구 (보장선 B2 · B4) */
      message: string
      errors: string[]
      /** probe 까지는 됐는데 매핑에서 막힌 경우, 물어볼 칸 목록은 줄 수 있다 */
      missing: { key: string; label: string }[]
    }

const MESSAGES = {
  no_list:
    '이 페이지에서 목록을 찾지 못했어요. 여러 항목이 줄지어 나오는 페이지의 주소를 붙여넣어 주세요.',
  no_match: '이 사이트의 값을 표의 칸에 맞추지 못했어요. 값을 직접 알려주시면 붙일 수 있어요.',
  empty: '목록을 찾았는데 항목을 하나도 읽어내지 못했어요. 다른 페이지 주소로 다시 시도해 주세요.',
  no_field: '표의 칸 중 하나도 이 사이트에서 찾지 못했어요. 다른 페이지 주소로 다시 시도해 주세요.',
} as const

export async function attachSourceToCollection(input: AttachSourceInput): Promise<AttachSourceOutcome> {
  const startedAt = Date.now()
  const now = input.now ?? new Date()
  const labelOf = (key: string): string => input.schema.find((f) => f.key === key)?.label ?? key
  const asMissing = (keys: readonly string[]): { key: string; label: string }[] =>
    keys.map((key) => ({ key, label: labelOf(key) }))

  // ── ① PROBE — 첫 사이트와 완전히 같은 경로다 ────────────────────────
  const probed = await probe(input.url, {
    skipBrowser: input.skipBrowser ?? false,
    skipDom: input.skipDom ?? false,
  })
  if (!probed.ok || probed.best === null) {
    return { ok: false, url: input.url, stage: 'probe', message: MESSAGES.no_list, errors: probed.warnings, missing: [] }
  }
  const candidate = probed.best

  // ── ② MATCH — 기존 칸에 맞춘다 ──────────────────────────────────────
  const matched = await matchFields({
    collection_id: input.collection_id,
    schema: input.schema,
    existingSample: [...input.existingSample],
    candidate,
    url: probed.final_url,
    ...(input.minConfidence !== undefined ? { minConfidence: input.minConfidence } : {}),
  })
  if (!matched.ok) {
    // 매핑이 통째로 실패해도 **물어볼 칸 목록은 줄 수 있다.** 사용자는 여기서 멈추지 않아도 된다.
    return {
      ok: false,
      url: input.url,
      stage: 'match',
      message: matched.message,
      errors: [matched.reason],
      missing: asMissing(input.schema.map((f) => f.key)),
    }
  }

  // 사용자가 붙여넣어 확정한 경로를 얹는다. **자동 매핑보다 세다** — 사람이 직접 가리킨 값이다.
  interface Placed {
    path: string
    transform?: unknown[]
    origin: AttachedField['origin']
    confidence: number
    why: string | null
  }
  const paths = new Map<string, Placed>()
  for (const [key, m] of Object.entries(matched.result.matched)) {
    paths.set(key, {
      path: m.path,
      ...(m.transform !== undefined ? { transform: m.transform } : {}),
      origin: 'matched',
      confidence: m.confidence,
      why: m.why,
    })
  }
  for (const [key, path] of Object.entries(input.resolved ?? {})) {
    if (path.trim() === '') continue
    // 사용자가 가리킨 자리다. 변환은 얹지 않는다 — 붙여넣은 값 그대로가 정답이다.
    paths.set(key, { path, origin: 'pasted', confidence: 1, why: '붙여넣은 값이 있는 자리' })
  }

  const stillMissing = input.schema.map((f) => f.key).filter((key) => !paths.has(key))
  if (paths.size === 0) {
    return { ok: false, url: input.url, stage: 'match', message: MESSAGES.no_field, errors: [], missing: asMissing(stillMissing) }
  }

  // ── 스펙 조립 → **기존 관문에 그대로 통과시킨다** ────────────────────
  // 접합 경로 전용 검사를 새로 만들지 않는다. 만드는 순간 이쪽에만 있는 구멍이 생긴다.
  const draft: Record<string, unknown> = {
    spec_version: 1,
    fetch: { mode: candidate.fetch_mode, url: candidate.fetch_url },
    list: matched.result.list,
    ...(matched.result.dedupe_key !== null ? { dedupe_key: matched.result.dedupe_key } : {}),
    fields: Object.fromEntries(
      [...paths].map(([key, p]) => [
        key,
        {
          path: p.path,
          type: input.schema.find((f) => f.key === key)?.type ?? 'text',
          // 연산자 집합 검사는 바로 아래 validateSpec 이 한다 (ADR A2)
          ...(p.transform !== undefined ? { transform: p.transform } : {}),
        },
      ]),
    ),
    pagination: { kind: 'none' },
  }
  // **찾은 칸만 담은 스키마로 검증한다.** 전체 스키마로 검증하면 필수 칸을 하나라도
  // 못 찾았을 때 스펙이 통째로 거절되고, 그러면 미리보기조차 못 보여준다 —
  // 그런데 못 찾은 칸을 물어보는 것이 이 기능의 핵심이다. 이 스펙이 실제로 내놓는 것은
  // 여기 담긴 칸들뿐이고, 나머지는 `missing` 으로 나가 사용자에게 물어본다.
  // (실제로 wevity 를 붙일 때 등록일 하나 때문에 전부 막혔다)
  const validated = validateSpec(draft, {
    host: probed.host,
    schema: input.schema.filter((f) => paths.has(f.key)),
    allowPrivateHosts: getConfig().allowPrivateHosts,
  })
  if (!validated.ok) {
    return { ok: false, url: input.url, stage: 'match', message: MESSAGES.no_match, errors: validated.errors, missing: asMissing(stillMissing) }
  }

  // ── ③ EXECUTE — 실제로 뽑아본다. 안 되는 매핑을 저장하지 않는다 ─────
  let spec = validated.spec
  let executed = await runAdapter({ spec, schema: input.schema, now, maxPages: 1 })
  if (executed.items.length === 0) {
    return {
      ok: false,
      url: input.url,
      stage: 'execute',
      message: MESSAGES.empty,
      errors: [executed.failure, ...executed.warnings].filter((e): e is string => e !== null),
      missing: asMissing(stillMissing),
    }
  }

  // ── ③-b 항상 비는 칸은 여기서도 고친다 (repair-empty.ts) ────────────
  // 다만 **칸을 빼지 않는다.** 표의 칸은 첫 사이트가 정한 것이고 두 번째 사이트 사정으로
  // 지울 수 없다. 못 채운 칸은 지우는 게 아니라 `missing` 으로 되돌려 물어본다.
  const plan = planRepair(spec, executed.items)
  if (plan.drop_transform.length > 0) {
    spec = applyTransformDrop(spec, plan.drop_transform)
    const retried = await runAdapter({ spec, schema: input.schema, now, maxPages: 1 })
    if (retried.items.length > 0) executed = retried
  }
  const warningsOut: string[] = []
  const afterRetry = planRepair(spec, executed.items)
  const stillEmpty = [...afterRetry.drop_column, ...afterRetry.drop_transform]

  // ── ③-c 링크는 열어서 확인한다 (verify-link.ts) ─────────────────────
  // 지어낸 주소 틀은 여기까지 전부 통과한다 — 값이 다 차 있고 항목마다 다르기 때문이다.
  // 사용자가 눌러 보고 알게 두면 그건 우리가 한 거짓말이다.
  const badLinks: string[] = []
  for (const field of input.schema) {
    if (field.type !== 'link' || !paths.has(field.key) || stillEmpty.includes(field.key)) continue
    const verdict = await verifyLinkField(executed.items, input.schema, field.key)
    if (verdict.ok) continue
    badLinks.push(field.key)
    warningsOut.push(`${field.label} 을 자동으로 만들지 못했어요. 값을 알려주시면 붙일 수 있어요.`)
  }

  // **빼는 것은 여기 한 번뿐이다.** 예전에 `missing` 에만 넣고 스펙·항목에서 안 빼서,
  // "이 칸은 못 만들었어요" 라고 말해 놓고 그 값을 그대로 저장한 적이 있다.
  // 말한 것과 저장하는 것이 다르면 그게 제일 나쁜 거짓말이다.
  const remove = [...new Set([...stillEmpty, ...badLinks])]
  if (remove.length > 0) {
    // `input.schema` 는 그대로 둔다 — 표의 칸 구성은 첫 사이트가 정한 것이고
    // 두 번째 사이트 사정으로 지울 수 없다. 스펙·항목·보고서에서만 뺀다.
    const trimmed = dropColumns(spec, input.schema, executed.items, executed.report, remove)
    spec = trimmed.spec
    executed = { ...executed, items: trimmed.items, report: trimmed.report }
    for (const key of trimmed.dropped) paths.delete(key)
  }

  const missing = [...stillMissing, ...remove].filter((k, i, a) => a.indexOf(k) === i && !paths.has(k))

  const attached: AttachedField[] = [...paths].map(([key, p]) => ({
    key,
    label: labelOf(key),
    path: p.path,
    origin: p.origin,
    confidence: p.confidence,
    why: p.why,
    samples: sampleValues(executed.items, key),
  }))

  log.info(
    { host: probed.host, attached: attached.length, missing: missing.length, items: executed.items.length },
    missing.length === 0 ? '전부 찾아서 붙였다' : '일부 칸은 물어봐야 한다',
  )

  return {
    ok: true,
    url: input.url,
    final_url: probed.final_url,
    host: probed.host,
    spec,
    items: executed.items,
    report: executed.report,
    attached,
    missing: asMissing(missing),
    probe_path: probed.probe_path,
    duration_ms: Date.now() - startedAt,
    warnings: [...warningsOut, ...executed.warnings],
  }
}

// ── 붙여넣은 값 역추적 (보장선 B1) ─────────────────────────────────────

export interface ResolveInput {
  url: string
  /** 어느 칸을 채우려는지 */
  key: string
  /** 사용자가 그 사이트에서 복사해 붙여넣은 값 */
  value: string
  skipBrowser?: boolean
  skipDom?: boolean
}

export type ResolveOutcome =
  | { ok: true; key: string; path: string; found: string; coverage: number; alternatives: TraceHit[] }
  | { ok: false; key: string; message: string }

/**
 * 붙여넣은 값이 어느 자리에 있는지 찾는다. **LLM 을 부르지 않는다** (trace-value.ts 머리말).
 *
 * 상태를 들지 않는다 — probe 를 다시 돌린다. 페이지는 캐시에서 나오므로 거의 공짜이고,
 * 대신 화면이 후보 데이터를 들고 다니거나 서버가 세션을 갖지 않아도 된다.
 */
export async function resolveByPastedValue(input: ResolveInput): Promise<ResolveOutcome> {
  if (input.value.trim().length < 2) {
    return { ok: false, key: input.key, message: '값을 조금 더 길게 붙여넣어 주세요.' }
  }

  const probed = await probe(input.url, {
    skipBrowser: input.skipBrowser ?? false,
    skipDom: input.skipDom ?? false,
  })
  if (!probed.ok || probed.best === null) {
    return { ok: false, key: input.key, message: MESSAGES.no_list }
  }

  const hits = traceValue({
    mode: probed.best.fetch_mode,
    rows: rowsForTrace(probed.best),
    needle: input.value,
  })
  const best = hits[0]
  if (best === undefined) {
    return {
      ok: false,
      key: input.key,
      // 왜 못 찾았는지 추측하지 않는다. 다음에 할 일만 말한다.
      message: '붙여넣은 값을 이 사이트에서 찾지 못했어요. 목록에 보이는 값을 그대로 복사해 주세요.',
    }
  }

  log.info({ key: input.key, path: best.path, coverage: best.coverage }, '붙여넣은 값으로 자리를 찾았다')
  return { ok: true, key: input.key, path: best.path, found: best.found, coverage: best.coverage, alternatives: hits.slice(1) }
}

// ── 거들 ───────────────────────────────────────────────────────────────

/**
 * 역추적에 넣을 원소들.
 * html·browser 후보는 `rows` 가 **화면 글자**라서 경로를 만들 수 없다 — 태그가 있는
 * `row_html` 을 써야 한다 (probe/types.ts 의 rows 주석).
 */
function rowsForTrace(candidate: RankedCandidate): readonly unknown[] {
  if (candidate.fetch_mode === 'json') return candidate.rows
  return candidate.row_html ?? candidate.rows
}

function sampleValues(items: readonly InterpretedItem[], key: string): string[] {
  const out: string[] = []
  for (const item of items) {
    const value = item.data[key]
    if (value === null || value === undefined) continue
    const text = String(value).trim()
    if (text === '' || out.includes(text)) continue
    out.push(text.length > 60 ? `${text.slice(0, 60)}…` : text)
    if (out.length >= 3) break
  }
  return out
}

export type { FieldMatch }
