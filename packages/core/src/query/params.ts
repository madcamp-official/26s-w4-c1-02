// 컬렉션 쿼리 파라미터 파싱 — 기획서 12장 REST 계약의 단일 출처
//
// 왜 core 에 있나: web 의 `GET /api/v1/{slug}` 와 mcp 의 `list_items` 가 같은 코드를 써야
// 두 표면의 동작이 갈라지지 않는다. 파라미터 표를 두 번 구현하면 반드시 갈라진다.
//
// 두 가지 원칙:
//  1. **절대 throw 하지 않는다.** 이상한 조건은 버리고 경고로 모은다. 조건 하나가 틀렸다고
//     응답 전체가 죽으면 부분 성공(원칙 ④)이 아니다.
//  2. **조용히 무시하지 않는다.** 버린 조건은 전부 warnings 에 남긴다. 오타를 낸 사람이
//     "왜 필터가 안 먹지" 로 30분을 태우지 않게.
//
// 경고 문구는 사용자에게 그대로 보일 수 있으므로 한국어이고 내부 명사를 쓰지 않는다 (보장선 B2·B4).

import {
  CollectionQuerySchema,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  SORT_PATTERN,
  type CollectionQuery,
} from '../types/api'
import type { FieldDef, FieldType } from '../types/collection'

// ── 파라미터 이름 규약 ───────────────────────────────────────────────────

/** 스키마 필드 키로 쓸 수 없는(=제어용으로 예약된) 파라미터 이름 */
export const RESERVED_PARAMS = ['q', 'source', 'since', 'sort', 'limit', 'cursor', 'include'] as const

/** 범위 조건 접미사 — `?deadline_gte=…` · `?amount_lte=…` */
export const RANGE_SUFFIXES = ['_gte', '_lte'] as const
export type RangeSuffix = (typeof RANGE_SUFFIXES)[number]

/** 범위 비교가 말이 되는 타입만. 기획서 12장 "date/number/money 타입에만" */
export const RANGE_FIELD_TYPES: readonly FieldType[] = ['date', 'number', 'money']

/**
 * 스키마 필드가 아니지만 정렬 기준으로 허용하는 키.
 * `first_seen_at` 은 `?since=` 의 기준이기도 하다 (기획서 10장 `items.first_seen_at`).
 */
export const BUILTIN_SORT_KEYS = ['first_seen_at', 'last_seen_at'] as const
export type BuiltinSortKey = (typeof BUILTIN_SORT_KEYS)[number]

/** 정렬을 안 걸면 최근에 처음 발견된 것부터 */
export const DEFAULT_SORT_KEY: BuiltinSortKey = 'first_seen_at'
export const DEFAULT_SORT_DIRECTION = 'desc' as const

export function isBuiltinSortKey(key: string): key is BuiltinSortKey {
  return (BUILTIN_SORT_KEYS as readonly string[]).includes(key)
}

// ── 입력 ─────────────────────────────────────────────────────────────────

/** URLSearchParams · 쿼리 문자열 · Next 의 searchParams 객체를 전부 받는다 */
export type QueryParamsInput =
  | URLSearchParams
  | string
  | Readonly<Record<string, string | string[] | undefined>>

export interface ParsedCollectionQuery {
  query: CollectionQuery
  /** 버린 조건에 대한 한국어 설명. 비어 있으면 전부 이해했다는 뜻 */
  warnings: string[]
}

function toSearchParams(input: QueryParamsInput): URLSearchParams {
  if (input instanceof URLSearchParams) return input
  if (typeof input === 'string') return new URLSearchParams(input)
  const out = new URLSearchParams()
  for (const [name, value] of Object.entries(input)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const v of value) out.append(name, v)
    } else {
      out.append(name, value)
    }
  }
  return out
}

// ── 값 정규화 (순수 · 테스트 대상) ───────────────────────────────────────

/** `YYYY-MM-DD` 로 맞춘다. 달력에 없는 날짜(2026-02-31)는 거부 */
export function normalizeDateValue(raw: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim())
  if (!m) return null
  const [, y, mo, d] = m
  if (y === undefined || mo === undefined || d === undefined) return null
  const iso = `${y}-${mo}-${d}`
  const dt = new Date(`${iso}T00:00:00.000Z`)
  if (Number.isNaN(dt.getTime())) return null
  if (dt.toISOString().slice(0, 10) !== iso) return null
  return iso
}

/** `?since=` 용. 날짜만 오면 날짜 그대로, 시각까지 오면 ISO 문자열로 */
export function normalizeInstantValue(raw: string): string | null {
  const t = raw.trim()
  if (t === '') return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return normalizeDateValue(t)
  const dt = new Date(t)
  if (Number.isNaN(dt.getTime())) return null
  return dt.toISOString()
}

/** 콤마는 빼고 숫자로. money 는 원 단위 정수라 같은 규칙을 쓴다 */
export function normalizeNumberValue(raw: string): number | null {
  const t = raw.trim().replace(/,/g, '')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/**
 * enum 필드는 정규화된 값(`rnd`)으로 저장돼 있다. 사람이 원문 표기(`R&D`)로 물어볼 수 있으니
 * mapping 에 그 표기가 있으면 정규화된 값으로 바꿔준다. 이미 정규화된 값이면 그대로 둔다.
 */
export function normalizeEnumValue(raw: string, mapping: Record<string, string> | null): string {
  if (!mapping) return raw
  const values = new Set(Object.values(mapping))
  if (values.has(raw)) return raw
  return mapping[raw] ?? raw
}

// ── 커서 (순수 · 왕복 테스트 대상) ───────────────────────────────────────

/**
 * `(정렬값, id)` 복합 커서. id 를 같이 실어야 정렬값이 같은 행들 사이에서
 * 안정 정렬이 되고 페이지 경계에서 행이 새거나 겹치지 않는다.
 */
export interface CursorPayload {
  /** 커서 형식 버전. 형식을 바꾸면 올리고, 모르는 버전은 거부한다 */
  v: 1
  /** 정렬 기준 값. 정렬 기준이 비어 있는 행이면 null */
  s: string | number | null
  /** 마지막으로 내보낸 행의 id (동률 tie-break) */
  id: string
}

export const CURSOR_VERSION = 1 as const

function base64UrlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(text: string): string | null {
  try {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

export function encodeCursor(payload: Omit<CursorPayload, 'v'>): string {
  const full: CursorPayload = { v: CURSOR_VERSION, s: payload.s, id: payload.id }
  return base64UrlEncode(JSON.stringify(full))
}

/** 못 읽는 커서는 null. 남이 준 문자열이므로 여기서 throw 하면 안 된다 */
export function decodeCursor(raw: string | null | undefined): CursorPayload | null {
  if (!raw) return null
  const json = base64UrlDecode(raw)
  if (json === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const o = parsed as Record<string, unknown>
  if (o['v'] !== CURSOR_VERSION) return null
  if (typeof o['id'] !== 'string' || o['id'] === '') return null
  const s = o['s']
  if (s !== null && typeof s !== 'string' && typeof s !== 'number') return null
  return { v: CURSOR_VERSION, s, id: o['id'] }
}

// ── 파싱 ─────────────────────────────────────────────────────────────────

interface Accumulator {
  eq: Record<string, string | number | boolean>
  gte: Record<string, string | number>
  lte: Record<string, string | number>
  warnings: string[]
}

function coerceComparable(
  field: FieldDef,
  raw: string,
): { ok: true; value: string | number } | { ok: false } {
  switch (field.type) {
    case 'number':
    case 'money': {
      const n = normalizeNumberValue(raw)
      return n === null ? { ok: false } : { ok: true, value: n }
    }
    case 'date': {
      const d = normalizeDateValue(raw)
      return d === null ? { ok: false } : { ok: true, value: d }
    }
    case 'enum':
      return { ok: true, value: normalizeEnumValue(raw.trim(), field.mapping) }
    case 'text':
    case 'link':
      return { ok: true, value: raw.trim() }
    default:
      return { ok: true, value: raw.trim() }
  }
}

/**
 * URLSearchParams → 타입 안전한 CollectionQuery. 기획서 12장 표 전부.
 *
 * 검증 기준은 컬렉션 스키마(FieldDef[]) 다. 스키마에 없는 이름은 필터로 쓰지 않는다 —
 * 이 화이트리스트가 build.ts 의 SQL 안전성 근거이기도 하다.
 */
export function parseCollectionQuery(
  input: QueryParamsInput,
  fields: readonly FieldDef[],
): ParsedCollectionQuery {
  const search = toSearchParams(input)
  const byKey = new Map(fields.map((f) => [f.key, f]))
  const acc: Accumulator = { eq: {}, gte: {}, lte: {}, warnings: [] }
  const { warnings } = acc

  let q: string | undefined
  let source: string | undefined
  let since: string | undefined
  let sort: string | undefined
  let cursor: string | null = null
  let limit: number = DEFAULT_PAGE_LIMIT
  const include: 'provenance'[] = []

  const handled = new Set<string>()

  for (const name of search.keys()) {
    if (handled.has(name)) continue
    handled.add(name)

    const values = search.getAll(name)

    // `include` 만 값이 여러 개여도 말이 된다 (`?include=provenance,raw`)
    if (name === 'include') {
      for (const part of values.flatMap((v) => v.split(','))) {
        const token = part.trim()
        if (token === '') continue
        if (token === 'provenance') {
          if (!include.includes('provenance')) include.push('provenance')
        } else {
          warnings.push(`함께 담을 수 없는 항목이라 무시했습니다: ${token}`)
        }
      }
      continue
    }

    if (values.length > 1) {
      warnings.push(`같은 조건이 여러 번 있어 첫 번째만 적용했습니다: ${name}`)
    }
    const raw = values[0] ?? ''

    // 빈 값은 "조건 없음"으로 본다. 폼에서 비워두고 보내는 경우가 흔하다
    if (raw.trim() === '' && name !== 'q') continue

    switch (name) {
      case 'q': {
        const term = raw.trim()
        if (term !== '') q = term
        continue
      }
      case 'source': {
        source = raw.trim()
        continue
      }
      case 'since': {
        const at = normalizeInstantValue(raw)
        if (at === null) warnings.push(`날짜를 이해하지 못해 무시했습니다: since=${raw}`)
        else since = at
        continue
      }
      case 'sort': {
        const spec = raw.trim()
        if (!SORT_PATTERN.test(spec)) {
          warnings.push(`정렬 기준으로 쓸 수 없어 기본 순서로 보여줍니다: ${spec}`)
          continue
        }
        const key = spec.startsWith('-') ? spec.slice(1) : spec
        if (!byKey.has(key) && !isBuiltinSortKey(key)) {
          warnings.push(`정렬 기준으로 쓸 수 없어 기본 순서로 보여줍니다: ${key}`)
          continue
        }
        sort = spec
        continue
      }
      case 'limit': {
        const n = normalizeNumberValue(raw)
        if (n === null || !Number.isInteger(n)) {
          warnings.push(`개수를 이해하지 못해 ${DEFAULT_PAGE_LIMIT}개로 맞췄습니다: ${raw}`)
          continue
        }
        if (n < 1) {
          warnings.push('개수는 1개 이상이어야 해서 1개로 맞췄습니다')
          limit = 1
          continue
        }
        if (n > MAX_PAGE_LIMIT) {
          warnings.push(`한 번에 가져올 수 있는 최대 개수는 ${MAX_PAGE_LIMIT}개입니다`)
          limit = MAX_PAGE_LIMIT
          continue
        }
        limit = n
        continue
      }
      case 'cursor': {
        const decoded = decodeCursor(raw.trim())
        if (decoded === null) {
          warnings.push('이어보기 정보가 올바르지 않아 처음부터 보여줍니다')
          continue
        }
        cursor = raw.trim()
        continue
      }
      default:
        break
    }

    // 필드 완전일치가 먼저다. `x_gte` 라는 이름의 필드가 실제로 있을 수도 있다
    const exact = byKey.get(name)
    if (exact) {
      const coerced = coerceComparable(exact, raw)
      if (!coerced.ok) warnings.push(`값을 이해하지 못해 무시했습니다: ${name}=${raw}`)
      else acc.eq[name] = coerced.value
      continue
    }

    const suffix = RANGE_SUFFIXES.find((s) => name.endsWith(s))
    if (suffix) {
      const base = name.slice(0, -suffix.length)
      const field = byKey.get(base)
      if (!field) {
        warnings.push(`모르는 조건이라 무시했습니다: ${name}`)
        continue
      }
      if (!RANGE_FIELD_TYPES.includes(field.type)) {
        warnings.push(`범위 조건은 날짜·금액·숫자 항목에만 쓸 수 있습니다: ${field.label}`)
        continue
      }
      const coerced = coerceComparable(field, raw)
      if (!coerced.ok) {
        warnings.push(`값을 이해하지 못해 무시했습니다: ${name}=${raw}`)
        continue
      }
      if (suffix === '_gte') acc.gte[base] = coerced.value
      else acc.lte[base] = coerced.value
      continue
    }

    warnings.push(`모르는 조건이라 무시했습니다: ${name}`)
  }

  const candidate = {
    eq: acc.eq,
    gte: acc.gte,
    lte: acc.lte,
    q,
    source,
    since,
    sort,
    limit,
    cursor,
    include,
  }

  const result = CollectionQuerySchema.safeParse(candidate)
  if (result.success) return { query: result.data, warnings }

  // 여기까지 오면 위 검증에 구멍이 있다는 뜻이다. 응답을 죽이지 말고 조건 없이 보여준다.
  warnings.push('조건을 다 이해하지 못해 전체 목록을 보여줍니다')
  return { query: CollectionQuerySchema.parse({}), warnings }
}

/** 구독의 `filter_json` 처럼 페이지네이션을 뺀 조건만 필요할 때 (기획서 10장) */
export function toCollectionFilter(query: CollectionQuery): Omit<
  CollectionQuery,
  'limit' | 'cursor' | 'include'
> {
  const { limit: _limit, cursor: _cursor, include: _include, ...filter } = query
  return filter
}
