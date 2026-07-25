// money 정규화 — 지원금·상금 표기를 원 단위 숫자로
//
// 목록 사이트의 금액 칸은 숫자가 아니라 문장이다:
//   `최대 100,000천원` · `1억 5천만원` · `무료` · `협의` · `USD 10,000`
// 숫자만 뽑고 나머지를 버리면 `100,000천원`(=1억) 과 `100,000원` 이 같은 값이 된다.
// 그래서 (1) 단위 승수를 반드시 적용하고 (2) 수식어는 버리지 않고 note 로 남긴다.

import type { ParseResult } from './result'
import { EMPTY_REASON, fail, ok } from './result'
import { KOREAN_UNIT_PATTERN, parseKoreanNumeral } from './number'
import { cleanText, coerceToString } from './text'

export const CURRENCIES = ['KRW', 'USD'] as const
export type Currency = (typeof CURRENCIES)[number]

export interface MoneyValue {
  /** 원 단위 실수. 금액을 특정할 수 없으면(협의·미정) null */
  amount: number | null
  /** 통화 표시가 전혀 없으면 null — 없는 정보를 KRW 로 지어내지 않는다 */
  currency: Currency | null
  /** `최대` `이내` `협의` 같은 수식어. 값 자체가 아니라 값에 붙은 조건이다 */
  note?: string
}

/**
 * 금액이 0 으로 확정되는 표기.
 * `0원` 을 넣지 않는 이유: `10,000원` 이 부분 일치로 잡혀 0 이 된다. 숫자 경로가 알아서 0 을 낸다.
 */
const FREE_KEYWORDS = ['무료', '참가비없음', '비용없음', '무상'] as const

/** 금액을 특정할 수 없는 표기 — amount 는 null 이고 실패가 아니다 */
const UNKNOWN_KEYWORDS = ['협의', '별도협의', '추후공지', '미정', '상이', '내부규정', '비공개'] as const

/** 값에 붙는 조건. 앞에 오는 순서대로 본다 */
const QUALIFIERS = ['최대', '최소', '최고', '최저', '총', '이내', '이상', '이하', '내외', '약', '한도', '까지'] as const

const USD_PATTERN = /USD|\$|달러|US\s*달러/i
const KRW_PATTERN = /원|KRW|₩/i

/** 범위 구분자. `1,000만원 ~ 3,000만원` 처럼 양쪽에 금액이 있는 경우만 쪼갠다 */
const RANGE_SPLIT_PATTERN = /\s*[~∼〜]\s*|\s+[-–—]\s+/

function compact(text: string): string {
  return text.replace(/[\s·・,()[\]{}]+/g, '')
}

/** 한 조각에서 숫자를 뽑는다. 단위가 있으면 승수를 적용한다 */
function amountOf(segment: string): number | null {
  if (!/\d/.test(segment)) {
    // 숫자 없이 단위만 있는 표기(`천만원`)도 값이다
    return KOREAN_UNIT_PATTERN.test(segment) ? parseKoreanNumeral(segment) : null
  }
  if (KOREAN_UNIT_PATTERN.test(segment)) return parseKoreanNumeral(segment)
  const m = /\d[\d,]*(?:\.\d+)?/.exec(segment)
  if (!m) return null
  const value = Number.parseFloat(m[0].replace(/,/g, ''))
  return Number.isFinite(value) ? value : null
}

/**
 * money 타입 정규화.
 *
 * - 단위 승수: 천=1e3 · 만=1e4 · 억=1e8 · 조=1e12. `1억 5천만원` = 150,000,000
 * - `무료` 는 amount 0 (정렬·필터에서 "가장 싼 것"으로 잡혀야 한다)
 * - `협의` 는 amount null + note. **실패가 아니다** — 실패로 세면 드리프트 경보가 헛울린다
 * - 범위(`1천만~3천만`)는 상한을 취하고 note 에 `범위` 를 남긴다
 */
export function parseMoney(raw: unknown): ParseResult<MoneyValue> {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? ok({ amount: raw, currency: null }) : fail('금액으로 읽을 수 없습니다')
  }

  const text = cleanText(coerceToString(raw))
  if (text === '') return fail(EMPTY_REASON)

  const packed = compact(text)
  const currency: Currency | null = USD_PATTERN.test(text)
    ? 'USD'
    : KRW_PATTERN.test(text) || KOREAN_UNIT_PATTERN.test(text)
      ? 'KRW'
      : null

  const freeHit = FREE_KEYWORDS.find((k) => packed.includes(k))
  if (freeHit !== undefined) return ok({ amount: 0, currency: currency ?? 'KRW', note: '무료' })

  const unknownHit = UNKNOWN_KEYWORDS.find((k) => packed.includes(k))
  const qualifier = QUALIFIERS.find((k) => packed.includes(k))

  const segments = text.split(RANGE_SPLIT_PATTERN).filter((s) => s.trim() !== '')
  const amounts = segments.map((s) => amountOf(s)).filter((v): v is number => v !== null)

  if (amounts.length === 0) {
    if (unknownHit !== undefined) return ok({ amount: null, currency: null, note: unknownHit })
    return fail('금액을 찾지 못했습니다')
  }

  // 범위면 상한을 쓴다 — "얼마까지 받을 수 있는가" 가 목록에서 궁금한 값이다
  const amount = Math.max(...amounts)
  const note = amounts.length > 1 ? (qualifier ?? '범위') : (qualifier ?? unknownHit)

  return note === undefined ? ok({ amount, currency }) : ok({ amount, currency, note })
}
