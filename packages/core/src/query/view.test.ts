// viewToQuery — 상대 표현이 "지금"의 절대 범위로 바뀌는 자리.
//
// 여기서 지키는 것 둘:
//   1. **KST 다.** UTC 저녁은 KST 다음 날이다 — 경계를 틀리면 D-7 알림이 하루 늦는다.
//   2. 조건들은 AND 라서 겹치는 범위는 **교집합**으로 좁혀진다.
//
// 2026-07-27 은 월요일이다 (아래 상수들의 근거).

import { describe, expect, it } from 'vitest'

import {
  kstRangeOf,
  kstToday,
  kstTodayPlus,
  msUntilNextKstMidnight,
  synthesizeViewZero,
  viewToQuery,
} from './view'

/** KST 정오 — 날짜 경계에서 멀어 안전한 기준 */
const NOON = new Date('2026-07-27T03:00:00Z')

describe('KST 달력', () => {
  it('UTC 저녁은 KST 다음 날이다 — 이 경계가 D-n 알림의 정확성이다', () => {
    expect(kstToday(new Date('2026-07-27T14:59:00Z'))).toBe('2026-07-27') // KST 23:59
    expect(kstToday(new Date('2026-07-27T15:00:00Z'))).toBe('2026-07-28') // KST 00:00
  })

  it('this_week 는 월요일부터 일요일 (달력 그대로)', () => {
    expect(kstRangeOf(NOON, 'this_week')).toEqual(['2026-07-27', '2026-08-02']) // 월요일 기준
    expect(kstRangeOf(new Date('2026-07-26T03:00:00Z'), 'this_week')).toEqual([
      '2026-07-20',
      '2026-07-26',
    ]) // 일요일은 그 주의 끝
  })

  it('this_month 는 1일부터 말일', () => {
    expect(kstRangeOf(NOON, 'this_month')).toEqual(['2026-07-01', '2026-07-31'])
    expect(kstRangeOf(new Date('2026-02-10T03:00:00Z'), 'this_month')).toEqual([
      '2026-02-01',
      '2026-02-28',
    ])
  })

  it('월말을 넘는 덧셈이 맞다', () => {
    expect(kstTodayPlus(NOON, 7)).toBe('2026-08-03')
    expect(kstTodayPlus(NOON, -30)).toBe('2026-06-27')
  })

  it('다음 KST 자정까지의 ms — 일일 평가 잡의 스케줄 재료', () => {
    // KST 23:59 → 1분
    expect(msUntilNextKstMidnight(new Date('2026-07-27T14:59:00Z'))).toBe(60_000)
  })
})

describe('viewToQuery', () => {
  it('d_within 은 [오늘, 오늘+n] — 지난 마감은 자연히 빠진다', () => {
    const q = viewToQuery({ where: [{ field: 'deadline', op: 'd_within', value: 7 }] }, NOON)
    expect(q.gte['deadline']).toBe('2026-07-27')
    expect(q.lte['deadline']).toBe('2026-08-03')
  })

  it('before/after 는 엄격 비교 — 오늘 "이전"에 오늘은 없다', () => {
    const q = viewToQuery(
      {
        where: [
          { field: 'deadline', op: 'after', value: 'today' },
          { field: 'posted_at', op: 'before', value: 'today' },
        ],
      },
      NOON,
    )
    expect(q.gte['deadline']).toBe('2026-07-28')
    expect(q.lte['posted_at']).toBe('2026-07-26')
  })

  it('겹치는 범위는 교집합으로 좁혀진다 — 조건은 AND 다', () => {
    // 이번 달(~07-31) ∩ 7일 이내(~08-03) = ~07-31 · 시작은 큰 쪽(07-27)
    const q = viewToQuery(
      {
        where: [
          { field: 'deadline', op: 'within', value: 'this_month' },
          { field: 'deadline', op: 'd_within', value: 7 },
        ],
      },
      NOON,
    )
    expect(q.gte['deadline']).toBe('2026-07-27')
    expect(q.lte['deadline']).toBe('2026-07-31')
  })

  it('enum·text·빈값 술어가 제자리로 간다', () => {
    const q = viewToQuery(
      {
        where: [
          { field: 'category', op: 'in', value: ['rnd', 'startup'] },
          { field: 'organization', op: 'not_contains', value: '협회' },
          { field: 'deadline', op: 'is_null' },
        ],
      },
      NOON,
    )
    expect(q.in['category']).toEqual(['rnd', 'startup'])
    expect(q.not_contains['organization']).toBe('협회')
    expect(q.is_null).toEqual(['deadline'])
  })

  it('정렬은 첫 항목만 쿼리에 실린다 (CollectionQuery 의 정렬이 하나라서)', () => {
    const q = viewToQuery(
      {
        where: [],
        sort: [
          { field: 'deadline', dir: 'asc' },
          { field: 'amount', dir: 'desc' },
        ],
      },
      NOON,
    )
    expect(q.sort).toBe('deadline')

    const desc = viewToQuery({ where: [], sort: [{ field: 'amount', dir: 'desc' }] }, NOON)
    expect(desc.sort).toBe('-amount')
  })

  it('조건 없는 뷰(#0)는 조건 없는 쿼리다', () => {
    const zero = synthesizeViewZero()
    const q = viewToQuery(zero, NOON)
    expect(q.eq).toEqual({})
    expect(q.gte).toEqual({})
    expect(q.is_null).toEqual([])
    expect(zero.slug).toBe('all')
    expect(zero.pinned).toBe(true)
  })
})
