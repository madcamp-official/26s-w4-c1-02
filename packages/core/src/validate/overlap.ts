// 겹침률 — 같은 질문의 두 가지 형태
//
// ① `overlapRatio(prev, candidate)`        기획서 9-3③ 치유 승격의 마지막 관문.
//    "재컴파일한 후보가 **엉뚱한 목록**을 잡은 건 아닌가."
//    검증만 통과하면 승격시키면 안 된다. 사이드바 메뉴 12개를 잡아도 null 비율은 0% 다.
//    직전 성공 목록과 겹치는지를 봐야 "같은 목록"임이 증명된다.
//
// ② `textOverlapRatio(pageText, values)`   기획서 9-1 probe 의 후보 순위 판정.
//    "페이지에 눈으로 보이는 텍스트와 후보 데이터의 값이 얼마나 겹치는가.
//     '이게 그 목록이 맞다'를 이 겹침률로 판정한다."
//    (기획서 15장 첫 번째 리스크 "임의 URL의 성공률"의 유일한 대응책이다.)
//
// 둘 다 "이게 그 목록이 맞나"를 묻는다. 비교 대상만 다르다 — ①은 과거의 목록, ②는 페이지의 눈에 보이는 글자.

import { DRIFT_THRESHOLDS, type DriftThresholds, resolveThresholds } from './drift'

/** 문자열 키 그 자체이거나, 키를 뽑아낼 수 있는 아이템 객체 */
export type OverlapItem = string | Record<string, unknown>

/**
 * 아이템의 신원으로 쓸 키 후보. 앞에 있을수록 안정적이다.
 * `external_key` 는 기획서 10장의 신규 판정 기준 그 자체다.
 */
const IDENTITY_KEYS = ['external_key', 'dedupe_key', 'link', 'url', 'href', 'title', 'name'] as const

/**
 * 직전 성공 목록과 후보 목록의 겹침률 (0~1).
 *
 * 분모는 **직전 목록**이다. "예전에 있던 것들이 새 후보에도 여전히 보이는가"를 묻는 것이라
 * 후보가 아이템을 더 많이 뽑았다고 점수가 깎이면 안 된다 (새 공고가 올라오는 건 정상이다).
 *
 * 직전 목록이 비어 있으면 잴 것이 없으므로 0 을 돌려준다.
 * 이 경우 관문 자체를 건너뛰어야 하므로 판정에는 `passesHealGate` 를 쓴다.
 */
export function overlapRatio(
  prevItems: readonly OverlapItem[],
  candidateItems: readonly OverlapItem[],
): number {
  const prevRaw = rawIdentities(prevItems)
  if (prevRaw.length === 0) return 0
  const candidateRaw = rawIdentities(candidateItems)
  if (candidateRaw.length === 0) return 0

  // 어느 쿼리 파라미터가 신원인지는 **두 목록을 함께 보고 한 번** 정한다 —
  // 목록마다 따로 정하면 같은 주소가 서로 다르게 정규화되어 겹침이 0 이 된다.
  const keep = combinedIdentityParams(prevRaw, candidateRaw)
  const prev = new Set(prevRaw.map((r) => normalizeIdentity(r, keep)))
  const candidate = new Set(candidateRaw.map((r) => normalizeIdentity(r, keep)))

  let hit = 0
  for (const key of prev) if (candidate.has(key)) hit += 1
  return hit / prev.size
}

/**
 * 치유 승격 관문 (기획서 9-3③). 검증 통과 **다음**에 물어보는 마지막 질문.
 *
 * 직전 목록이 비어 있으면(첫 수집이었거나 직전에 0개였음) 겹침을 잴 수 없으므로
 * 이 관문으로는 막지 않는다. 없는 근거로 승격을 막으면 자가 치유가 영원히 안 돈다.
 */
export function passesHealGate(
  prevItems: readonly OverlapItem[],
  candidateItems: readonly OverlapItem[],
  overrides?: Partial<DriftThresholds>,
): boolean {
  if (rawIdentities(prevItems).length === 0) return true
  const t = overrides ? resolveThresholds(overrides) : DRIFT_THRESHOLDS
  return overlapRatio(prevItems, candidateItems) >= t.minHealOverlapRatio
}

/**
 * probe 후보 순위 판정 (기획서 9-1). 후보 데이터의 값들 중 몇 %가
 * 페이지에서 눈에 보이는 텍스트에도 실제로 나타나는가 (0~1).
 *
 * 높을수록 "화면에 보이는 그 목록"일 가능성이 크다. 반대로 겹침률이 0 에 가까우면
 * 내부 설정 객체나 추적용 배열을 잡은 것이다.
 *
 * 비교는 공백을 모두 지우고 소문자로 맞춘 뒤 한다 — 한국어 사이트는 렌더링과 원본의
 * 띄어쓰기가 자주 다르다. 링크·이미지 경로처럼 화면에 안 보이는 값은 애초에 세지 않는다.
 */
export function textOverlapRatio(pageText: string, candidateValues: readonly unknown[]): number {
  const haystack = squash(pageText)
  if (haystack.length === 0) return 0

  const values = collectComparableValues(candidateValues)
  if (values.length === 0) return 0

  let hit = 0
  for (const value of values) if (appearsIn(haystack, value)) hit += 1
  return hit / values.length
}

/**
 * 중첩된 후보 데이터에서 화면 텍스트와 견줄 만한 값만 평평하게 꺼낸다.
 * probe 가 후보 배열을 통째로 넘겨도 되게 하기 위한 것이다.
 */
export function collectComparableValues(input: unknown, limit = 500): string[] {
  const out: string[] = []
  const walk = (node: unknown, depth: number): void => {
    if (out.length >= limit || depth > 6) return
    if (typeof node === 'string') {
      if (isComparable(node)) out.push(node)
      return
    }
    if (typeof node === 'number' || typeof node === 'bigint') {
      out.push(String(node))
      return
    }
    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth + 1)
      return
    }
    if (node !== null && typeof node === 'object') {
      for (const child of Object.values(node as Record<string, unknown>)) walk(child, depth + 1)
    }
  }
  walk(input, 0)
  return out
}

// ── 내부 ───────────────────────────────────────────────────────────────

/** 목록에서 (정규화 전) 신원 문자열들을 뽑는다 */
function rawIdentities(items: readonly OverlapItem[]): string[] {
  const out: string[] = []
  for (const item of items) {
    const id = rawIdentityOf(item)
    if (id !== null) out.push(id)
  }
  return out
}

function rawIdentityOf(item: OverlapItem): string | null {
  if (typeof item === 'string') return item
  if (item === null || typeof item !== 'object') return null

  for (const key of IDENTITY_KEYS) {
    const value = item[key]
    if (typeof value === 'string' && value.trim() !== '') return value
    if (typeof value === 'number') return String(value)
  }

  // 아이템 안에 data_json 이 한 겹 들어 있는 형태(DB 행)도 받아준다
  const nested = item['data_json']
  if (nested !== null && typeof nested === 'object' && !Array.isArray(nested)) {
    return rawIdentityOf(nested as Record<string, unknown>)
  }

  // 마지막 폴백 — 원시값들을 키 순서로 이어붙인 지문 (기획서 10장 "정규화된 title 해시" 와 같은 취지)
  const parts: string[] = []
  for (const key of Object.keys(item).sort()) {
    const value = item[key]
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      parts.push(`${key}=${String(value)}`)
    }
  }
  return parts.length > 0 ? parts.join('|') : null
}

/** 아이템에서 비교용 신원 문자열을 뽑는다. 못 뽑으면 null */
export function identityOf(item: OverlapItem, keepParams?: ReadonlySet<string>): string | null {
  const raw = rawIdentityOf(item)
  return raw === null ? null : normalizeIdentity(raw, keepParams)
}

// ── 신원 정규화 — 어느 쿼리 파라미터가 신원인가 ─────────────────────────
//
// 여기 걸린 긴장이 §5-1 결함의 원인이었다:
//   쿼리를 다 떼면  → 항목 id 가 쿼리에 있는 사이트(한국 공공 목록 대부분)에서
//                     **모든 신원이 하나로 뭉개져** 관문이 항상 통과한다 (no-op)
//   쿼리를 다 두면  → 세션·목록 상태 파라미터 때문에 같은 공고가 매번 달라 보여
//                     겹침이 0 이 되고 멀쩡한 치유 후보가 떨어진다 (기획서 15장)
//
// 답은 fetchers/stabilize-keys.ts 와 같은 원리다 — **행들이 답이다**:
//   한 목록 안에서 행마다 값이 다른 파라미터(pbancSn 15/15) = 신원 → 남긴다
//   한 목록 안에서 값이 거의 같은 파라미터(jsessionid·cpage) = 상태 → 뗀다
// 세션 값은 한 번의 수집 안에서는 상수라서, 목록 "안"의 분포가 정확히 갈라준다.
// 목록이 3개 미만이면 분포가 없으므로 판단하지 않고 옛 동작(전부 뗌)으로 물러난다.

/** 한 목록 안에서 이 비율 이상 행마다 값이 다르면 신원 파라미터다 (stabilize-keys 와 동일) */
const IDENTITY_PARAM_RATIO = 0.7

/** 이보다 주소가 적으면 분포가 없다 — 판단하지 않는다 */
const MIN_URLS_FOR_SIGNAL = 3

interface ParsedIdentityUrl {
  /** host(소문자)+path, 상대 주소면 path 만 */
  base: string
  params: [string, string][]
}

function parseIdentityUrl(raw: string): ParsedIdentityUrl | null {
  const t = raw.trim()
  const absolute = /^https?:\/\//i.test(t)
  // 우리 external_key 는 상대 주소(`/view.do?pblancId=…`)인 경우가 많다 — 절대만 보면 놓친다
  if (!absolute && !t.startsWith('/')) return null
  try {
    const url = new URL(t, 'http://relative.invalid')
    const base = `${absolute ? url.host.toLowerCase() : ''}${url.pathname.replace(/\/+$/, '')}`
    return { base, params: [...url.searchParams.entries()] }
  } catch {
    return null
  }
}

/** 한 목록의 신원 파라미터 집합. 분포가 없으면(주소 3개 미만) null */
function identityParamsOf(raws: readonly string[]): Set<string> | null {
  const parsed = raws.map(parseIdentityUrl).filter((p): p is ParsedIdentityUrl => p !== null)
  if (parsed.length < MIN_URLS_FOR_SIGNAL) return null

  const valuesByParam = new Map<string, Set<string>>()
  for (const p of parsed) {
    for (const [name, value] of p.params) {
      const set = valuesByParam.get(name) ?? new Set<string>()
      set.add(value)
      valuesByParam.set(name, set)
    }
  }

  const keep = new Set<string>()
  for (const [name, values] of valuesByParam) {
    if (values.size >= parsed.length * IDENTITY_PARAM_RATIO) keep.add(name)
  }
  return keep
}

/**
 * 두 목록의 신원 파라미터를 합친다. 둘 다 분포가 없으면 undefined —
 * 그때 normalizeIdentity 는 옛 동작(쿼리 전부 뗌)으로 물러난다.
 */
function combinedIdentityParams(
  a: readonly string[],
  b: readonly string[],
): ReadonlySet<string> | undefined {
  const ka = identityParamsOf(a)
  const kb = identityParamsOf(b)
  if (ka === null && kb === null) return undefined
  return new Set([...(ka ?? []), ...(kb ?? [])])
}

/**
 * 신원 정규화. `keepParams` 에 든 쿼리 파라미터만 남기고(이름순) 나머지는 뗀다.
 * 집합 없이 부르면 옛 동작 그대로 쿼리를 전부 뗀다 — 겹침 계산(overlapRatio)은
 * 항상 집합 수준에서 keepParams 를 계산해 넘긴다. 홀로 부르는 쪽이 이 함수만으로
 * "신원이 보존된다"고 가정하면 안 된다.
 */
export function normalizeIdentity(raw: string, keepParams?: ReadonlySet<string>): string {
  const parsed = parseIdentityUrl(raw)
  if (parsed === null) return raw.trim().toLowerCase().replace(/\s+/g, ' ')

  if (keepParams === undefined || keepParams.size === 0) return parsed.base
  const kept = parsed.params.filter(([name]) => keepParams.has(name))
  if (kept.length === 0) return parsed.base
  kept.sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
  return `${parsed.base}?${kept.map(([n, v]) => `${n}=${v}`).join('&')}`
}

/** 공백 전부 제거 + 소문자 */
function squash(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '')
}

/** 화면 텍스트와 견줄 가치가 있는 값인가 */
function isComparable(value: string): boolean {
  const t = value.trim()
  if (t.length < 2 || t.length > 200) return false
  // URL·경로·데이터 URI 는 화면에 글자로 나오지 않는다. 세면 분모만 커진다
  if (/^(https?:|\/\/|\/[a-z0-9._-]*\/|data:|javascript:)/i.test(t)) return false
  return true
}

/** 값이 페이지 텍스트에 나타나는가. 긴 값은 토큰 다수결로 본다 */
function appearsIn(haystack: string, value: string): boolean {
  const needle = squash(value)
  if (needle.length === 0) return false
  if (haystack.includes(needle)) return true

  // 긴 문장은 사이트가 말줄임(…)이나 태그로 잘라 보여주는 일이 많다.
  // 통째로는 안 걸려도 토큰 대부분이 보이면 같은 값으로 친다.
  const tokens = value
    .split(/\s+/)
    .map(squash)
    .filter((t) => t.length >= 2)
  if (tokens.length < 3) return false

  let hit = 0
  for (const token of tokens) if (haystack.includes(token)) hit += 1
  return hit / tokens.length >= 0.7
}
