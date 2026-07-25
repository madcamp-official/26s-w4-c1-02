// link 정규화 — 상대경로를 절대 URL 로, 추적 파라미터는 버린다
//
// 추적 파라미터를 지우는 건 미관 문제가 아니다. `utm_*` 가 붙어 있으면 같은 공고가
// 유입 경로마다 다른 링크를 갖게 되고, dedupe_key 를 링크로 잡은 소스에서
// 매 수집이 전부 신규가 되어 구독이 스팸이 된다 (기획서 15장 external_key 리스크).

import type { ParseResult } from './result'
import { EMPTY_REASON, fail, ok } from './result'
import { cleanText, coerceToString } from './text'

export interface LinkParseOptions {
  /** 상대경로를 붙일 기준 주소. 보통 소스의 fetch.url */
  baseUrl?: string
}

/** 값이 아니라 유입 경로를 기록하는 파라미터들 */
const TRACKING_PARAM_PATTERNS: RegExp[] = [
  /^utm_/i,
  /^(fbclid|gclid|dclid|gbraid|wbraid|msclkid|yclid|ttclid|igshid|twclid)$/i,
  /^(mc_cid|mc_eid|_hsenc|_hsmi|vero_id|oly_enc_id|oly_anon_id)$/i,
  /^(spm|scm|from_source|share_source)$/i,
]

/** 링크 필드가 실제로 가리켜도 되는 것은 웹 문서뿐이다 */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

function isTrackingParam(key: string): boolean {
  return TRACKING_PARAM_PATTERNS.some((p) => p.test(key))
}

function stripTracking(url: URL): void {
  const doomed = [...url.searchParams.keys()].filter(isTrackingParam)
  for (const key of doomed) url.searchParams.delete(key)
}

/**
 * link 타입 정규화.
 *
 * - `//example.com/x` (프로토콜 없는 주소)는 기준 주소의 프로토콜을, 기준이 없으면 https 를 쓴다
 * - `/notice/1` `./1` `../1` 은 기준 주소에 붙인다. 기준이 없으면 실패다 — 절반짜리 링크를 내보내지 않는다
 * - `javascript:` `data:` 같은 것은 링크가 아니다. 실패로 돌린다
 */
export function parseLink(raw: unknown, options: LinkParseOptions = {}): ParseResult<string> {
  // 엔티티 디코드(`&amp;` → `&`)가 필요하다. 공백은 URL 에 있을 수 없으니 통째로 턴다
  const text = cleanText(coerceToString(raw)).replace(/\s+/g, '')
  if (text === '') return fail(EMPTY_REASON)

  const base = options.baseUrl?.trim()
  let candidate = text

  if (candidate.startsWith('//')) {
    let protocol = 'https:'
    if (base) {
      try {
        protocol = new URL(base).protocol
      } catch {
        protocol = 'https:'
      }
    }
    candidate = `${protocol}${candidate}`
  }

  let url: URL
  try {
    url = base ? new URL(candidate, base) : new URL(candidate)
  } catch {
    return base
      ? fail('주소 형식이 올바르지 않습니다')
      : fail('기준 주소가 없어 절대 주소로 바꿀 수 없습니다')
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return fail('지원하지 않는 주소 형식입니다')

  stripTracking(url)
  return ok(url.toString())
}
