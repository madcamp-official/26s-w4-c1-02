// 어댑터 스펙 해석기 — 스펙 + 응답 → 아이템 배열 (기획서 9-1③ · 11장 · 원칙 ②)
//
// ── 이 파일이 지키는 세 가지 ────────────────────────────────────────────
// 1. **순수 함수다.** 네트워크를 타지 않는다. fetch 는 호출자(worker)의 몫이고
//    해석기는 받은 payload 만 읽는다. 그래야 테스트가 되고, 화면 미리보기가 같은 코드를 쓴다.
// 2. **부분 성공이 1급이다** (원칙 ④). 필드 하나가 안 뽑혀도 행은 살아남고,
//    행 하나가 깨져도 나머지 행은 나간다. 실패는 fieldStats 에 숫자로 남는다.
// 3. **provenance 를 같이 낸다.** 스펙에 이미 경로가 있으므로 저장 비용이 거의 없고,
//    이게 원문 대조 기능의 실체다 (기획서 10장).

import type { NormalizeContext } from '../normalize'
import { normalizeValue, toJsonValue } from '../normalize'
import type { CollectionSchemaJson, FieldDef } from '../types/collection'
import type { ItemData, ItemProvenance, ItemRaw, ItemValue } from '../types/item'
import type { FieldValidation } from '../types/run'
import type { HtmlAdapter } from './paths'
import { evaluateCssPath, evaluateJsonPath, PathSyntaxError, selectCssNodes } from './paths'
import type { AdapterSpec } from './spec'
import type { TransformContext } from './transform'
import { runTransformPipeline } from './transform'

// ── 입출력 ─────────────────────────────────────────────────────────────

export interface InterpretContext {
  /** html · browser 모드에서 필수. core 는 cheerio 를 모른다 (paths.ts 주석 참조) */
  html?: HtmlAdapter
  /** `absolute_url` 의 기준. 기본값은 spec.fetch.url */
  baseUrl?: string
  /** `date_parse` 의 기본 타임존 */
  timezone?: string
  /** 컬렉션 스키마 — enum 의 `mapping` 에 쓴다 */
  schema?: CollectionSchemaJson
  /** 기준일 — `D-7` 같은 상대 날짜 표기를 푸는 기준. 기본 호출 시각 */
  now?: Date
}

/** external_key 가 어디서 나왔는지 — 신규 판정의 신뢰도를 화면에서 판단할 근거 (ADR A13) */
export type ExternalKeyOrigin = 'dedupe_key' | 'title_hash' | 'row_hash'

export interface InterpretedItem {
  /** 소스 내 고유 식별자. `UNIQUE (source_id, external_key)` 에 그대로 들어간다 */
  external_key: string
  external_key_origin: ExternalKeyOrigin
  /** 정규화된 값 — `items.data_json` */
  data: ItemData
  /**
   * 원문 조각 — `items.raw_json`.
   * `_row` 는 이 행의 원본(json 모드는 객체, html·browser 모드는 HTML 조각),
   * `_fields` 는 변환 전 필드별 원값이다. 화면에서 값에 마우스를 올리면
   * provenance 경로를 `_row` 에 다시 적용해 보여줄 수 있다.
   */
  raw: ItemRaw
  /** 필드별 원본 경로 — `items.provenance_json` */
  provenance: ItemProvenance
}

export interface InterpretResult {
  items: InterpretedItem[]
  /**
   * 필드별 null 비율·타입 실패율. **드리프트 검증기가 이걸 먹는다** (원칙 ⑤).
   * `runs.validation_json.fields` 와 같은 형태다.
   */
  fieldStats: Record<string, FieldValidation>
  /** 사람이 읽을 수 있는 경고. 내부 용어 금지 (보장선 B4) */
  warnings: string[]
}

// ── 본체 ───────────────────────────────────────────────────────────────

/**
 * 스펙대로 payload 를 읽어 아이템 배열을 만든다.
 *
 * @param payload json 모드면 파싱된 JSON, html·browser 모드면 HTML 문자열
 */
export function interpretSpec(spec: AdapterSpec, payload: unknown, ctx: InterpretContext = {}): InterpretResult {
  const warnings: string[] = []
  const mode = spec.fetch.mode
  const isJson = mode === 'json'

  const baseUrl = ctx.baseUrl ?? spec.fetch.url.replace('{page}', '1')
  const now = ctx.now ?? new Date()
  const transformCtx: TransformContext = { baseUrl, now }
  if (ctx.timezone !== undefined) transformCtx.timezone = ctx.timezone

  const fieldKeys = Object.keys(spec.fields)
  const accumulators = new Map<string, FieldAccumulator>(fieldKeys.map((k) => [k, newAccumulator()]))
  const schemaByKey = new Map<string, FieldDef>((ctx.schema ?? []).map((f) => [f.key, f]))

  const rows = extractRows(spec, payload, ctx, warnings)
  const items: InterpretedItem[] = []
  const seen = new Set<string>()

  for (const row of rows) {
    const data: ItemData = {}
    const provenance: ItemProvenance = {}
    const rawFields: Record<string, unknown> = {}

    for (const key of fieldKeys) {
      const field = spec.fields[key]
      if (field === undefined) continue
      const acc = accumulators.get(key)

      provenance[key] = field.path

      // 1. 경로 평가
      let rawValue: unknown
      try {
        rawValue = readPath(row, field.path, isJson, ctx)
      } catch (e) {
        rawValue = undefined
        if (e instanceof PathSyntaxError) pushWarningOnce(warnings, e.message)
      }
      rawFields[key] = rawValue ?? null

      // 2. 변환 파이프라인 (닫힌 집합)
      const piped = runTransformPipeline(rawValue, field.transform, transformCtx)

      // 3. 타입 정규화 — normalize/ 의 파서가 유일한 구현이다
      let value: ItemValue = null
      let failure: string | null = null

      if (!piped.ok) {
        failure = piped.error
      } else if (piped.value === null || piped.value === undefined || piped.value === '') {
        // 값이 없는 것은 실패가 아니다. `상시` 처럼 가리킬 날짜가 없는 경우도 여기로 온다
        value = null
      } else {
        const def = schemaByKey.get(key)
        const nctx: NormalizeContext = { now, baseUrl }
        if (ctx.timezone !== undefined) nctx.timezone = ctx.timezone
        if (def?.mapping) nctx.mapping = def.mapping
        const result = normalizeValue(field.type, piped.value, nctx)
        value = toJsonValue(result)
        if (!result.ok) failure = result.reason
      }

      data[key] = value
      if (acc) {
        acc.total += 1
        if (value === null) acc.nullCount += 1
        const hadRaw = rawValue !== undefined && rawValue !== null && rawValue !== ''
        if (failure !== null && hadRaw) {
          acc.typeFailCount += 1
          if (acc.samples.length < 5) acc.samples.push(truncate(stringify(rawValue) ?? failure))
        }
      }
    }

    const key = buildExternalKey(spec, row, data, isJson, ctx)
    if (seen.has(key.external_key)) continue // 같은 페이지 안의 중복은 여기서 걷어낸다
    seen.add(key.external_key)

    items.push({
      external_key: key.external_key,
      external_key_origin: key.origin,
      data,
      raw: { _row: row, _fields: rawFields },
      provenance,
    })
  }

  if (rows.length === 0) {
    warnings.push('목록에서 항목을 하나도 찾지 못했습니다')
  }

  return { items, fieldStats: finalizeStats(accumulators), warnings }
}

// ── 행 뽑기 ────────────────────────────────────────────────────────────

/**
 * json 모드는 값 배열, html·browser 모드는 행 HTML 조각 배열을 돌려준다.
 * 어느 쪽이든 이후 필드 평가는 "행 안에서" 이뤄진다.
 */
function extractRows(spec: AdapterSpec, payload: unknown, ctx: InterpretContext, warnings: string[]): unknown[] {
  if (spec.fetch.mode === 'json') {
    let rows: unknown[]
    try {
      rows = evaluateJsonPath(payload, spec.list)
    } catch (e) {
      warnings.push(e instanceof Error ? e.message : String(e))
      return []
    }
    // `$.data.items` 처럼 `[*]` 없이 배열 자체가 걸린 경우 한 겹 편다
    const only = rows.length === 1 ? rows[0] : undefined
    if (only !== undefined && Array.isArray(only)) return only
    return rows
  }

  if (typeof payload !== 'string') {
    warnings.push('페이지 내용을 읽지 못했습니다')
    return []
  }
  if (!ctx.html) {
    warnings.push('페이지 내용을 읽는 방법이 아직 연결되지 않았습니다')
    return []
  }
  try {
    return selectCssNodes(payload, spec.list, ctx.html).map((node) => node.html())
  } catch (e) {
    warnings.push(e instanceof Error ? e.message : String(e))
    return []
  }
}

/** 행 하나에서 경로 하나를 읽는다. 여러 개가 걸리면 배열로 준다 (`join` 이 받는다) */
function readPath(row: unknown, path: string, isJson: boolean, ctx: InterpretContext): unknown {
  if (isJson) {
    const matches = evaluateJsonPath(row, path)
    if (matches.length === 0) return undefined
    return matches.length === 1 ? matches[0] : matches
  }
  if (typeof row !== 'string' || !ctx.html) return undefined
  const values = evaluateCssPath(row, path, ctx.html)
  if (values.length === 0) return undefined
  return values.length === 1 ? values[0] : values
}

// ── 보조 ───────────────────────────────────────────────────────────────

function stringify(value: unknown): string | null {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null
  if (typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    const parts = value.map((v) => stringify(v)).filter((v): v is string => v !== null && v.length > 0)
    return parts.length === 0 ? null : parts.join(' ')
  }
  return null
}

// ── external_key ───────────────────────────────────────────────────────

/**
 * `dedupe_key` 가 있으면 그것으로, 없거나 못 뽑으면 **정규화된 title 의 해시로 폴백**한다
 * (기획서 10장 "몇 가지 판단" · ADR A13). title 도 없으면 행 전체 해시.
 *
 * 해시는 node:crypto 없이 순수 함수로 만든다 — core 는 브라우저에서도 돌아야 한다.
 */
function buildExternalKey(
  spec: AdapterSpec,
  row: unknown,
  data: ItemData,
  isJson: boolean,
  ctx: InterpretContext,
): { external_key: string; origin: ExternalKeyOrigin } {
  if (spec.dedupe_key !== undefined) {
    let raw: unknown
    try {
      raw = readPath(row, spec.dedupe_key, isJson, ctx)
    } catch {
      raw = undefined
    }
    const text = stringify(raw)
    if (text !== null && text.length > 0) {
      return { external_key: text, origin: 'dedupe_key' }
    }
  }

  const title = data['title']
  if (typeof title === 'string' && title.trim().length > 0) {
    return { external_key: `t_${hashString(normalizeForHash(title))}`, origin: 'title_hash' }
  }

  return { external_key: `r_${hashString(stableStringify(data))}`, origin: 'row_hash' }
}

/** 해시 전 정규화 — 공백·대소문자 차이로 같은 항목이 매번 새 항목이 되면 구독이 스팸이 된다 */
export function normalizeForHash(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * FNV-1a 를 두 번 돌려 이어붙인 64비트급 해시 (base36).
 * 암호학적 용도가 아니다 — 소스 안에서만 유일하면 된다.
 */
export function hashString(input: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0
  }
  return `${h1.toString(36)}${h2.toString(36).padStart(7, '0')}`
}

/** 키 순서에 흔들리지 않는 직렬화 — content_hash 계산에도 쓸 수 있다 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

// ── 필드 통계 ──────────────────────────────────────────────────────────

interface FieldAccumulator {
  total: number
  nullCount: number
  typeFailCount: number
  samples: string[]
}

function newAccumulator(): FieldAccumulator {
  return { total: 0, nullCount: 0, typeFailCount: 0, samples: [] }
}

function finalizeStats(accumulators: Map<string, FieldAccumulator>): Record<string, FieldValidation> {
  const out: Record<string, FieldValidation> = {}
  for (const [key, acc] of accumulators) {
    const denom = acc.total === 0 ? 1 : acc.total
    out[key] = {
      null_ratio: round3(acc.nullCount / denom),
      type_fail_ratio: round3(acc.typeFailCount / denom),
      samples: acc.samples,
    }
  }
  return out
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

function truncate(text: string, max = 60): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

function pushWarningOnce(warnings: string[], message: string): void {
  if (!warnings.includes(message)) warnings.push(message)
}
