// number 파서 테스트 — 한국 단위 승수 해석기(money 도 이걸 쓴다)가 여기 걸려 있다

import { describe, expect, it } from 'vitest'
import { parseKoreanNumeral, parseNumber } from './number'

function n(raw: unknown): number {
  const r = parseNumber(raw)
  if (!r.ok) throw new Error(`파싱 실패: ${r.reason}`)
  return r.value
}

describe('parseKoreanNumeral', () => {
  it.each([
    ['1억 5천만', 150_000_000],
    ['100,000천', 100_000_000],
    ['천만', 10_000_000],
    ['5천', 5000],
    ['3만', 30_000],
    ['1억', 100_000_000],
    ['2조', 2_000_000_000_000],
    ['1억 2천 3백만', 123_000_000],
  ])('%s → %i', (raw, expected) => {
    expect(parseKoreanNumeral(raw)).toBe(expected)
  })

  it('숫자도 단위도 없으면 null', () => {
    expect(parseKoreanNumeral('없음')).toBeNull()
  })
})

describe('parseNumber', () => {
  it.each([
    ['1,234', 1234],
    ['0', 0],
    ['3건', 3],
    ['45.5%', 45.5],
    ['-5', -5],
    ['모집인원 20명', 20],
    ['10만', 100_000],
  ])('%s → %s', (raw, expected) => {
    expect(n(raw)).toBe(expected)
  })

  it('숫자 원값은 그대로', () => {
    expect(n(1234)).toBe(1234)
  })

  it('bigint 도 읽는다', () => {
    expect(n(9007199254740991n)).toBe(9_007_199_254_740_991)
  })

  it.each([null, undefined, '', '   ', '없음', {}, Number.NaN, Number.POSITIVE_INFINITY])(
    '%p → ok:false (throw 하지 않는다)',
    (raw) => {
      expect(parseNumber(raw).ok).toBe(false)
    },
  )
})
