// {today} 자리표시자 치환 회귀 테스트 (날짜 파라미터 API 지원 — 메가박스·상영시간표)
//
// 핵심 불변식 셋:
//  1. {today} 는 YYYYMMDD, {today_iso} 는 YYYY-MM-DD 로 바뀐다
//  2. 기준은 KST 다 (UTC 자정 넘어가는 시각에 날짜가 하루 어긋나면 마감이 어긋난다)
//  3. 자리표시자가 없으면 원문 그대로 (부작용 없음)

import { describe, expect, it } from 'vitest'

import { applyDatePlaceholders } from './index'

describe('applyDatePlaceholders', () => {
  // 2026-07-29 12:00 KST = 2026-07-29 03:00 UTC
  const noon = new Date('2026-07-29T03:00:00Z')

  it('{today} 를 YYYYMMDD 로 바꾼다', () => {
    expect(applyDatePlaceholders('{"playDe":"{today}"}', noon)).toBe('{"playDe":"20260729"}')
  })

  it('{today_iso} 를 YYYY-MM-DD 로 바꾼다', () => {
    expect(applyDatePlaceholders('?date={today_iso}', noon)).toBe('?date=2026-07-29')
  })

  it('한 문자열에 여러 번 나와도 전부 바꾼다', () => {
    expect(applyDatePlaceholders('{today}-{today}', noon)).toBe('20260729-20260729')
  })

  it('둘을 섞어도 각각 맞게 바꾼다', () => {
    expect(applyDatePlaceholders('{today} / {today_iso}', noon)).toBe('20260729 / 2026-07-29')
  })

  it('자리표시자가 없으면 원문 그대로다 (부작용 없음)', () => {
    const s = '{"theaterCd":"A420","list":[1,2,3]}'
    expect(applyDatePlaceholders(s, noon)).toBe(s)
  })

  it('KST 기준이다 — UTC 로는 아직 어제인 이른 시각도 오늘로 친다', () => {
    // 2026-07-29 01:00 KST = 2026-07-28 16:00 UTC. UTC 로 읽으면 28일이지만 KST 로는 29일
    const earlyKst = new Date('2026-07-28T16:00:00Z')
    expect(applyDatePlaceholders('{today}', earlyKst)).toBe('20260729')
  })

  it('KST 기준이다 — UTC 로는 이미 다음날인 늦은 시각도 오늘로 친다', () => {
    // 2026-07-29 23:00 KST = 2026-07-29 14:00 UTC (아직 29일). 경계 반대편 확인:
    // 2026-07-30 06:00 KST = 2026-07-29 21:00 UTC → KST 로는 30일
    const lateUtc = new Date('2026-07-29T21:00:00Z')
    expect(applyDatePlaceholders('{today_iso}', lateUtc)).toBe('2026-07-30')
  })

  it('월·연 경계를 넘긴다 (kstToday 재사용의 이점)', () => {
    // 2026-12-31 20:00 KST = 2026-12-31 11:00 UTC
    const yearEnd = new Date('2026-12-31T11:00:00Z')
    expect(applyDatePlaceholders('{today}', yearEnd)).toBe('20261231')
  })
})
