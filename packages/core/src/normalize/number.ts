// number 정규화 — 콤마·단위·꼬리표를 털어낸 숫자
//
// 한국 단위 승수(십·백·천·만·억·조) 해석기가 여기 산다. money 파서도 이걸 그대로 쓴다.
// 단위가 곱셈이 아니라 **자릿수 그룹**이라는 점이 핵심이다: `5천만` 은 5×1000×10000 이 아니라
// (5×1000)×10000 = 5,000만 = 5e7 이다. 그래서 만·억·조를 만나면 그때까지 쌓인 값을 통째로 곱해 확정한다.

import type { ParseResult } from './result'
import { EMPTY_REASON, fail, ok } from './result'
import { cleanText, coerceToString } from './text'

/** 자릿수 그룹을 끊는 큰 단위 */
const BIG_UNITS: Record<string, number> = {
  만: 1e4,
  억: 1e8,
  조: 1e12,
}

/** 그룹 안에서 누적되는 작은 단위 */
const SMALL_UNITS: Record<string, number> = {
  십: 10,
  백: 100,
  천: 1000,
}

export const KOREAN_UNIT_PATTERN = /[십백천만억조]/
const NUMERAL_TOKEN_PATTERN = /(?<num>\d[\d,]*(?:\.\d+)?)|(?<unit>[십백천만억조])/g

/**
 * 금액이 아닌 붙은 수사 — 연도·회차·수량. 큰수 해석 **전에** 지운다.
 * 실측 (day2 §8 후보 → 확인): '제2회 1억원' 이 2+1 로 합산돼 **3억**이 됐고,
 * '5천만원(2026년 기준)' 은 꼬리의 연도가 더해져 50,002,026 이 됐다.
 */
const COUNTER_NOISE_PATTERN = /\d[\d,]*\s*(?:년도|년|월|일|회차|회|차|기|명|건|개|호)/g

/**
 * `1억 5천만` → 150000000, `100,000천` → 100000000, `천만` → 10000000.
 * 숫자도 단위도 없으면 null.
 */
export function parseKoreanNumeral(input: string): number | null {
  const cleaned = input.replace(COUNTER_NOISE_PATTERN, ' ')

  let total = 0
  let section = 0
  let pending: number | null = null
  let sawAnything = false

  NUMERAL_TOKEN_PATTERN.lastIndex = 0
  for (const match of cleaned.matchAll(NUMERAL_TOKEN_PATTERN)) {
    const num = match.groups?.['num']
    const unit = match.groups?.['unit']

    if (num !== undefined) {
      const parsed = Number.parseFloat(num.replace(/,/g, ''))
      if (!Number.isFinite(parsed)) return null
      // 단위 없이 숫자가 연달아 나오면 **앞의 것을 버린다** — 더하면 위 실측처럼
      // 잡숫자가 금액에 섞인다. 수사는 위에서 지워지지만 못 지운 것도 금액은 아니다.
      pending = parsed
      sawAnything = true
      continue
    }

    if (unit === undefined) continue
    sawAnything = true
    const big = BIG_UNITS[unit]
    if (big !== undefined) {
      const group = section + (pending ?? 0)
      total += (group === 0 ? 1 : group) * big
      section = 0
      pending = null
      continue
    }
    const small = SMALL_UNITS[unit]
    if (small !== undefined) {
      section += (pending ?? 1) * small
      pending = null
    }
  }

  if (!sawAnything) return null
  const value = total + section + (pending ?? 0)
  return Number.isFinite(value) ? value : null
}

/** 부호를 포함한 첫 번째 숫자 */
const PLAIN_NUMBER_PATTERN = /[-+]?\d+(?:\.\d+)?/

/**
 * number 타입 정규화.
 * 퍼센트·건·명 같은 꼬리표는 버리고 숫자만 남긴다. 단위가 섞이면 승수를 적용한다.
 */
export function parseNumber(raw: unknown): ParseResult<number> {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? ok(raw) : fail('숫자로 읽을 수 없습니다')
  }
  if (typeof raw === 'bigint') return ok(Number(raw))

  const text = cleanText(coerceToString(raw))
  if (text === '') return fail(EMPTY_REASON)

  if (KOREAN_UNIT_PATTERN.test(text)) {
    const value = parseKoreanNumeral(text)
    if (value !== null) return ok(value)
  }

  const compacted = text.replace(/,/g, '')
  const m = PLAIN_NUMBER_PATTERN.exec(compacted)
  if (!m) return fail('숫자로 읽을 수 없습니다')
  const value = Number.parseFloat(m[0])
  return Number.isFinite(value) ? ok(value) : fail('숫자로 읽을 수 없습니다')
}
