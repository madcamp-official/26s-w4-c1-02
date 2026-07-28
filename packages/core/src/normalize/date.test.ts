// date 파서 테스트 — 기획서 14장 "정규화 파서와 변환 연산자는 테스트를 먼저 쓴다"
//
// 케이스는 한국 목록 사이트(k-startup · bizinfo · 씽굿 등)에서 실제로 보이는 표기를 모은 것이다.
// G1 probe 결과에서 새 표기가 나오면 여기에 줄을 추가하고 파서를 고친다. 순서를 바꾸지 마라.

import { describe, expect, it } from 'vitest'
import { compileDateFormat, lastDayOfMonth, parseDate } from './date'

/** 모든 테스트의 기준일. 2026-07-26(일) 09:00 KST */
const NOW = new Date('2026-07-26T09:00:00+09:00')

function iso(raw: unknown, formats?: string[]): string | null {
  const r = parseDate(raw, formats ? { now: NOW, formats } : { now: NOW })
  if (!r.ok) throw new Error(`파싱 실패: ${r.reason}`)
  return r.value.iso
}

function kind(raw: unknown): string {
  const r = parseDate(raw, { now: NOW })
  if (!r.ok) throw new Error(`파싱 실패: ${r.reason}`)
  return r.value.kind
}

describe('parseDate — 연도가 있는 표기', () => {
  it('2026.08.14 18:00 — 점 구분 + 시각', () => {
    expect(iso('2026.08.14 18:00')).toBe('2026-08-14T18:00:00+09:00')
  })

  it('2026-08-14 — 하이픈 구분', () => {
    expect(iso('2026-08-14')).toBe('2026-08-14')
  })

  it('2026/08/14 — 슬래시 구분', () => {
    expect(iso('2026/08/14')).toBe('2026-08-14')
  })

  it('20260814 — 구분자 없는 8자리', () => {
    expect(iso('20260814')).toBe('2026-08-14')
  })

  it('2026년 8월 14일 — 한글 표기', () => {
    expect(iso('2026년 8월 14일')).toBe('2026-08-14')
  })

  it('2026.8.14(목) — 한 자리 월일 + 요일 꼬리', () => {
    expect(iso('2026.8.14(목)')).toBe('2026-08-14')
  })

  it('2026.8.14(목) 18:00 — 요일 뒤의 시각도 붙인다', () => {
    expect(iso('2026.8.14(목) 18:00')).toBe('2026-08-14T18:00:00+09:00')
  })

  it('2026년 8월 — 일이 없으면 그 달의 말일', () => {
    expect(iso('2026년 8월')).toBe('2026-08-31')
  })

  it('2026년 2월 — 말일 계산이 달마다 다르다', () => {
    expect(iso('2026년 2월')).toBe('2026-02-28')
  })

  it('시각이 없으면 날짜만 낸다 — 없는 정밀도를 지어내지 않는다', () => {
    expect(iso('2026-08-14')).not.toContain('T')
  })
})

describe('parseDate — 마감 관용 표기', () => {
  it('~2026-08-21 — 앞에 붙은 물결', () => {
    expect(iso('~2026-08-21')).toBe('2026-08-21')
  })

  it('2026-08-14 ~ 2026-09-01 — 범위는 끝날짜', () => {
    expect(iso('2026-08-14 ~ 2026-09-01')).toBe('2026-09-01')
  })

  it('접수기간 2026.08.01 ~ 2026.08.31 18:00 — 범위 끝의 시각까지', () => {
    expect(iso('접수기간 2026.08.01 ~ 2026.08.31 18:00')).toBe('2026-08-31T18:00:00+09:00')
  })

  it('8월 14일까지 — 연도 없는 한글 표기', () => {
    expect(iso('8월 14일까지')).toBe('2026-08-14')
  })

  it('2026-08-14 마감 — 날짜가 있으면 마감 키워드보다 날짜가 이긴다', () => {
    expect(iso('2026-08-14 마감')).toBe('2026-08-14')
    expect(kind('2026-08-14 마감')).toBe('exact')
  })

  it('2026.08.14 18:00 까지', () => {
    expect(iso('2026.08.14 18:00 까지')).toBe('2026-08-14T18:00:00+09:00')
  })
})

describe('parseDate — 연도 없는 표기의 연도 추론 (가장 가까운 미래)', () => {
  it('08/14 — 아직 안 지났으면 올해', () => {
    expect(iso('08/14')).toBe('2026-08-14')
  })

  it('01/05 — 이미 지났으면 내년', () => {
    expect(iso('01/05')).toBe('2027-01-05')
  })

  it('07/26 — 기준일과 같은 날이면 올해로 본다', () => {
    expect(iso('07/26')).toBe('2026-07-26')
  })

  it('07/25 — 하루 지났으면 내년', () => {
    expect(iso('07/25')).toBe('2027-07-25')
  })

  it('02/29 — 그 해에 없는 날짜는 다음 윤년까지 민다', () => {
    expect(iso('02/29')).toBe('2028-02-29')
  })

  it('12.31 — 점 구분 연도 없는 표기', () => {
    expect(iso('12.31')).toBe('2026-12-31')
  })
})

describe('parseDate — 기준일 상대 표기', () => {
  it('D-7', () => {
    expect(iso('D-7')).toBe('2026-08-02')
    expect(kind('D-7')).toBe('relative')
  })

  it('D-1', () => {
    expect(iso('D-1')).toBe('2026-07-27')
  })

  it('D-30 — 달을 넘어간다', () => {
    expect(iso('D-30')).toBe('2026-08-25')
  })

  it('D-7일 — 뒤에 일이 붙어도 같다', () => {
    expect(iso('D-7일')).toBe('2026-08-02')
  })

  it('D-DAY', () => {
    expect(iso('D-DAY')).toBe('2026-07-26')
    expect(kind('D-DAY')).toBe('relative')
  })

  it('D-day — 소문자 표기', () => {
    expect(iso('D-day')).toBe('2026-07-26')
  })

  it('D+3 — 지난 날을 가리킨다', () => {
    expect(iso('D+3')).toBe('2026-07-23')
  })

  it('오늘 마감 — 마감 키워드보다 오늘이 이긴다', () => {
    expect(iso('오늘 마감')).toBe('2026-07-26')
    expect(kind('오늘 마감')).toBe('relative')
  })

  it('내일 마감', () => {
    expect(iso('내일 마감')).toBe('2026-07-27')
  })

  it('모레', () => {
    expect(iso('모레')).toBe('2026-07-28')
  })

  it('D-7 (2026.08.14) — 실제 날짜가 함께 있으면 그쪽을 쓴다', () => {
    expect(iso('D-7 (2026.08.14)')).toBe('2026-08-14')
    expect(kind('D-7 (2026.08.14)')).toBe('exact')
  })
})

describe('parseDate — 마감 없음 / 이미 끝남', () => {
  it.each(['상시', '상시모집', '상시 모집', '수시모집', '연중 수시', '예산 소진시까지'])(
    '%s → rolling (iso 없음)',
    (raw) => {
      const r = parseDate(raw, { now: NOW })
      expect(r.ok && r.value).toEqual({ iso: null, kind: 'rolling' })
    },
  )

  it.each(['마감', '접수마감', '접수 마감', '모집마감', '마감완료', '접수종료'])(
    '%s → closed (iso 없음)',
    (raw) => {
      const r = parseDate(raw, { now: NOW })
      expect(r.ok && r.value).toEqual({ iso: null, kind: 'closed' })
    },
  )

  // day1 §5-3 — 한국 목록에서 가장 흔한 배지 하나가 정반대로 저장되던 결함의 회귀 방어.
  // '마감임박'은 **아직 접수 중**이다. 끝났다고 말하면 사용자가 살아 있는 공고를 거른다.
  it.each(['마감임박', '마감 임박', '곧 마감', '마감 예정', '종료 임박'])(
    '%s → closed 가 아니다 (날짜를 모르는 것이지 끝난 게 아니다)',
    (raw) => {
      const r = parseDate(raw, { now: NOW })
      expect(r.ok && (r.value as { kind: string }).kind === 'closed').toBe(false)
    },
  )
})

describe('parseDate — 시각 표기', () => {
  it('18시', () => {
    expect(iso('2026-08-14 18시')).toBe('2026-08-14T18:00:00+09:00')
  })

  it('18시 30분', () => {
    expect(iso('2026-08-14 18시 30분')).toBe('2026-08-14T18:30:00+09:00')
  })

  it('09:05 — 앞자리 0 유지', () => {
    expect(iso('2026-08-14 09:05')).toBe('2026-08-14T09:05:00+09:00')
  })

  it('24:00 — 자정 마감 관용 표기는 그날의 끝으로', () => {
    expect(iso('2026-08-14 24:00')).toBe('2026-08-14T23:59:00+09:00')
  })

  it('날짜 뒤 숫자가 시각이 아니면 붙이지 않는다', () => {
    expect(iso('2026-08-14 3건')).toBe('2026-08-14')
  })
})

describe('parseDate — ISO 8601 타임스탬프 (day2 §7-5 · 시각 소실 수리)', () => {
  // probe 1·2순위가 인라인 JSON·네트워크 관찰이라 ISO 가 가장 흔한 입력이다.
  // 예전에는 T 구분자에서 시각 인식이 끊겨 셋 다 '2026-08-14' 로 뭉개졌다.

  it('18:00Z 는 KST 익일 03:00 이다 — 마감일이 하루 어긋나던 핵심 케이스', () => {
    expect(iso('2026-08-14T18:00:00Z')).toBe('2026-08-15T03:00:00+09:00')
  })

  it('이미 KST 오프셋이면 그대로', () => {
    expect(iso('2026-08-14T18:00:00+09:00')).toBe('2026-08-14T18:00:00+09:00')
  })

  it('콜론 없는 오프셋(+0900)도 읽는다', () => {
    expect(iso('2026-08-14T18:00:00+0900')).toBe('2026-08-14T18:00:00+09:00')
  })

  it('밀리초·초 생략 변형', () => {
    expect(iso('2026-08-14T18:00:00.123Z')).toBe('2026-08-15T03:00:00+09:00')
    expect(iso('2026-08-14T18:00Z')).toBe('2026-08-15T03:00:00+09:00')
  })

  it('같은 날에 남는 경우 — 00:30Z 는 09:30 KST', () => {
    expect(iso('2026-08-14T00:30:00Z')).toBe('2026-08-14T09:30:00+09:00')
  })

  it('오프셋 없는 T 구분자는 벽시계로 본다 (기존 공백 구분과 같은 규칙)', () => {
    expect(iso('2026-08-14T18:00:00')).toBe('2026-08-14T18:00:00+09:00')
  })

  it('시간 범위의 뒷부분(-19:00)을 오프셋으로 오독하지 않는다', () => {
    expect(iso('2026-08-14 18:00-19:00')).toBe('2026-08-14T18:00:00+09:00')
  })

  it('ISO 타임스탬프 범위도 끝을 취하고 변환한다 (규칙 3)', () => {
    expect(iso('2026-08-14T09:00:00Z ~ 2026-08-21T18:00:00Z')).toBe('2026-08-22T03:00:00+09:00')
  })

  it('출력 타임존이 UTC 면 KST 입력을 UTC 벽시계로 옮긴다', () => {
    const r = parseDate('2026-08-14T18:00:00+09:00', { now: NOW, timezone: 'UTC' })
    expect(r.ok && r.value.iso).toBe('2026-08-14T09:00:00Z')
  })
})

describe('parseDate — 포맷 후보 (스펙의 date_parse.formats)', () => {
  it('DD/MM/YYYY — 내장 규칙만으로는 못 읽는 순서를 포맷이 구해준다', () => {
    expect(iso('14/08/2026', ['DD/MM/YYYY'])).toBe('2026-08-14')
  })

  it('포맷이 없으면 같은 문자열이 실패한다 (14월이 되어 버린다)', () => {
    expect(parseDate('14/08/2026', { now: NOW }).ok).toBe(false)
  })

  it('YYYYMMDD', () => {
    expect(iso('20260814', ['YYYYMMDD'])).toBe('2026-08-14')
  })

  it('후보 여러 개 중 맞는 것을 고른다', () => {
    expect(iso('2026.08.14', ['YYYYMMDD', 'YYYY.MM.DD'])).toBe('2026-08-14')
  })

  it('포맷이 안 맞으면 실패시키지 않고 내장 규칙으로 넘어간다', () => {
    expect(iso('2026년 8월 14일', ['YYYYMMDD'])).toBe('2026-08-14')
  })

  it('YY 두 자리 연도는 2000년대로 본다', () => {
    expect(iso('260814', ['YYMMDD'])).toBe('2026-08-14')
  })

  it('시각 토큰 포함', () => {
    expect(iso('2026-08-14 18:00', ['YYYY-MM-DD HH:mm'])).toBe('2026-08-14T18:00:00+09:00')
  })

  it('compileDateFormat — 같은 토큰이 두 번이면 컴파일을 포기한다', () => {
    expect(compileDateFormat('MM/MM')).toBeNull()
  })
})

describe('parseDate — 타임존', () => {
  it('기본은 KST(+09:00)', () => {
    const r = parseDate('2026-08-14 18:00', { now: NOW })
    expect(r.ok && r.value.iso).toBe('2026-08-14T18:00:00+09:00')
  })

  it('UTC 를 주면 Z 로 낸다', () => {
    const r = parseDate('2026-08-14 18:00', { now: NOW, timezone: 'UTC' })
    expect(r.ok && r.value.iso).toBe('2026-08-14T18:00:00Z')
  })

  it('모르는 타임존은 KST 로 본다', () => {
    const r = parseDate('2026-08-14 18:00', { now: NOW, timezone: 'Mars/Olympus' })
    expect(r.ok && r.value.iso).toBe('2026-08-14T18:00:00+09:00')
  })
})

describe('parseDate — 문자열이 아닌 원값', () => {
  it('Date 객체', () => {
    expect(iso(new Date('2026-08-14T00:00:00+09:00'))).toBe('2026-08-14')
  })

  it('Date 객체 + 시각', () => {
    expect(iso(new Date('2026-08-14T18:00:00+09:00'))).toBe('2026-08-14T18:00:00+09:00')
  })

  it('숫자 20260814', () => {
    expect(iso(20260814)).toBe('2026-08-14')
  })

  it('문자열 배열은 이어 붙여서 본다 (HTML 텍스트 노드가 쪼개지는 경우)', () => {
    expect(iso(['2026.08.14', '18:00'])).toBe('2026-08-14T18:00:00+09:00')
  })
})

describe('parseDate — 실패는 값으로 돌린다 (throw 금지)', () => {
  it.each([null, undefined, '', '   ', '공고 참조', 'ㅁㄴㅇㄹ', {}, Number.NaN])(
    '%p → ok:false',
    (raw) => {
      const r = parseDate(raw, { now: NOW })
      expect(r.ok).toBe(false)
      expect(r.ok === false && r.reason.length > 0).toBe(true)
    },
  )

  it.each(['2026-13-40', '2026-02-30', '2026-02-29'])('%s → 값이 유효하지 않다', (raw) => {
    const r = parseDate(raw, { now: NOW })
    expect(r.ok).toBe(false)
  })

  it('2024-02-29 — 윤년은 통과한다', () => {
    expect(iso('2024-02-29')).toBe('2024-02-29')
  })

  it('기준일이 잘못돼도 throw 하지 않는다', () => {
    const r = parseDate('2026-08-14', { now: new Date('nope') })
    expect(r.ok).toBe(false)
  })
})

describe('lastDayOfMonth', () => {
  it.each([
    [2026, 1, 31],
    [2026, 2, 28],
    [2024, 2, 29],
    [2026, 4, 30],
    [2026, 12, 31],
  ])('%i년 %i월 = %i일', (y, m, expected) => {
    expect(lastDayOfMonth(y, m)).toBe(expected)
  })
})
