// money 파서 테스트 — 기획서 14장 "정규화 파서와 변환 연산자는 테스트를 먼저 쓴다"
//
// 케이스는 지원사업 목록의 금액 칸에서 실제로 보이는 표기다.
// 여기서 제일 위험한 실수는 단위 승수를 빠뜨리는 것이다 —
// `100,000천원`(=1억) 과 `100,000원` 이 같은 값이 되면 정렬이 통째로 거짓말을 한다.

import { describe, expect, it } from 'vitest'
import { parseMoney } from './money'

function amount(raw: unknown): number | null {
  const r = parseMoney(raw)
  if (!r.ok) throw new Error(`파싱 실패: ${r.reason}`)
  return r.value.amount
}

describe('parseMoney — 한국 단위 승수', () => {
  it.each([
    ['최대 100,000천원', 100_000_000],
    ['1억 5천만원', 150_000_000],
    ['5,000만원', 50_000_000],
    ['30억', 3_000_000_000],
    ['1,000,000원', 1_000_000],
    ['3천만원', 30_000_000],
    ['천만원', 10_000_000],
    ['1조', 1_000_000_000_000],
    ['2억원', 200_000_000],
    ['500만원', 5_000_000],
    ['50천원', 50_000],
  ])('%s → %i', (raw, expected) => {
    expect(amount(raw)).toBe(expected)
  })

  it('1억 5천만 = 150000000 — 단위는 곱셈이 아니라 자릿수 그룹이다', () => {
    expect(amount('1억 5천만')).toBe(150_000_000)
    expect(amount('1억 5천만')).not.toBe(1 * 1e8 * 5 * 1e3 * 1e4)
  })

  it('100,000천원 과 100,000원 은 다른 값이다', () => {
    expect(amount('100,000천원')).toBe(100_000_000)
    expect(amount('100,000원')).toBe(100_000)
  })
})

describe('parseMoney — 통화', () => {
  it('원 표기는 KRW', () => {
    expect(parseMoney('1,000,000원')).toEqual({ ok: true, value: { amount: 1_000_000, currency: 'KRW' } })
  })

  it('USD 10,000', () => {
    expect(parseMoney('USD 10,000')).toEqual({ ok: true, value: { amount: 10_000, currency: 'USD' } })
  })

  it('$5,000 — 기호도 USD', () => {
    const r = parseMoney('$5,000')
    expect(r.ok && r.value.currency).toBe('USD')
  })

  it('한국 단위만 있어도 KRW 로 본다', () => {
    const r = parseMoney('30억')
    expect(r.ok && r.value.currency).toBe('KRW')
  })

  it('통화 표시가 전혀 없으면 null — 없는 정보를 지어내지 않는다', () => {
    const r = parseMoney('1500')
    expect(r.ok && r.value.currency).toBeNull()
    expect(r.ok && r.value.amount).toBe(1500)
  })
})

describe('parseMoney — 금액이 아닌 표기', () => {
  it('무료 → 0 (정렬에서 가장 싼 것으로 잡혀야 한다)', () => {
    expect(parseMoney('무료')).toEqual({ ok: true, value: { amount: 0, currency: 'KRW', note: '무료' } })
  })

  it('참가비 없음 → 0', () => {
    const r = parseMoney('참가비 없음')
    expect(r.ok && r.value.amount).toBe(0)
  })

  it('협의 → amount null 이지만 실패가 아니다', () => {
    const r = parseMoney('협의')
    expect(r.ok).toBe(true)
    expect(r.ok && r.value.amount).toBeNull()
    expect(r.ok && r.value.note).toBe('협의')
  })

  it.each(['별도 협의', '추후공지', '미정'])('%s → amount null · ok', (raw) => {
    const r = parseMoney(raw)
    expect(r.ok).toBe(true)
    expect(r.ok && r.value.amount).toBeNull()
  })

  it('0원 은 무료 키워드를 안 거쳐도 0 이 된다', () => {
    expect(amount('0원')).toBe(0)
  })
})

describe('parseMoney — 수식어와 범위', () => {
  it('최대 → note 로 남는다. 버리지 않는다', () => {
    const r = parseMoney('최대 5,000만원')
    expect(r.ok && r.value).toEqual({ amount: 50_000_000, currency: 'KRW', note: '최대' })
  })

  it('이내', () => {
    const r = parseMoney('5,000만원 이내')
    expect(r.ok && r.value.note).toBe('이내')
  })

  it('범위는 상한을 쓴다 — 목록에서 궁금한 값은 "얼마까지"다', () => {
    const r = parseMoney('1,000만원 ~ 3,000만원')
    expect(r.ok && r.value.amount).toBe(30_000_000)
    expect(r.ok && r.value.note).toBe('범위')
  })

  it('총 사업비 2억원', () => {
    const r = parseMoney('총 사업비 2억원')
    expect(r.ok && r.value.amount).toBe(200_000_000)
    expect(r.ok && r.value.note).toBe('총')
  })
})

describe('parseMoney — 문자열이 아닌 원값', () => {
  it('숫자는 그대로', () => {
    expect(parseMoney(30_000_000)).toEqual({ ok: true, value: { amount: 30_000_000, currency: null } })
  })

  it('0 도 값이다', () => {
    expect(parseMoney(0)).toEqual({ ok: true, value: { amount: 0, currency: null } })
  })

  it('HTML 엔티티가 섞여도 읽는다', () => {
    expect(amount('최대&nbsp;5,000만원')).toBe(50_000_000)
  })
})

describe('parseMoney — 실패는 값으로 돌린다 (throw 금지)', () => {
  it.each([null, undefined, '', '   ', '해당없음', {}, Number.NaN])('%p → ok:false', (raw) => {
    const r = parseMoney(raw)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason.length > 0).toBe(true)
  })
})
