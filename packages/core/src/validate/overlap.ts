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
  const prev = identitySet(prevItems)
  if (prev.size === 0) return 0
  const candidate = identitySet(candidateItems)
  if (candidate.size === 0) return 0

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
  if (identitySet(prevItems).size === 0) return true
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

function identitySet(items: readonly OverlapItem[]): Set<string> {
  const set = new Set<string>()
  for (const item of items) {
    const id = identityOf(item)
    if (id !== null) set.add(id)
  }
  return set
}

/** 아이템에서 비교용 신원 문자열을 뽑는다. 못 뽑으면 null */
export function identityOf(item: OverlapItem): string | null {
  if (typeof item === 'string') return normalizeIdentity(item)
  if (item === null || typeof item !== 'object') return null

  for (const key of IDENTITY_KEYS) {
    const value = item[key]
    if (typeof value === 'string' && value.trim() !== '') return normalizeIdentity(value)
    if (typeof value === 'number') return String(value)
  }

  // 아이템 안에 data_json 이 한 겹 들어 있는 형태(DB 행)도 받아준다
  const nested = item['data_json']
  if (nested !== null && typeof nested === 'object' && !Array.isArray(nested)) {
    return identityOf(nested as Record<string, unknown>)
  }

  // 마지막 폴백 — 원시값들을 키 순서로 이어붙인 지문 (기획서 10장 "정규화된 title 해시" 와 같은 취지)
  const parts: string[] = []
  for (const key of Object.keys(item).sort()) {
    const value = item[key]
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      parts.push(`${key}=${String(value)}`)
    }
  }
  return parts.length > 0 ? normalizeIdentity(parts.join('|')) : null
}

/**
 * 신원 정규화. 링크라면 쿼리스트링과 프래그먼트를 떼어낸다 —
 * 기획서 15장 "`external_key` 불안정" 리스크가 정확히 이것이다.
 * 매 수집마다 붙는 세션 파라미터 때문에 같은 공고가 매번 다른 것으로 보이면
 * 겹침률이 0 이 되어 멀쩡한 치유 후보를 떨어뜨린다.
 */
export function normalizeIdentity(raw: string): string {
  const trimmed = raw.trim()
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      return `${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, '')}`
    } catch {
      // URL 파싱이 안 되면 문자열로 취급한다
    }
  }
  return trimmed.toLowerCase().replace(/\s+/g, ' ')
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
