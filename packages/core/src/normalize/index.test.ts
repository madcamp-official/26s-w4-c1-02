// 디스패처 테스트 — 해석기가 실제로 부르는 진입점 (기획서 9-1⑤)
//
// 시드 컬렉션 `contest` 의 6개 필드를 그대로 쓴다.
// 두 소스의 지저분한 원값이 같은 형식으로 수렴하는지가 이 파일의 전부다.

import type { FieldType } from '../types/collection'
import { describe, expect, it } from 'vitest'
import type { NormalizeContext } from './index'
import { normalizeRecord, normalizeValue, toJsonValue } from './index'

const NOW = new Date('2026-07-26T09:00:00+09:00')

const CATEGORY_MAPPING: Record<string, string> = { 기술개발: 'rnd', 'R&D': 'rnd' }

const CTX: NormalizeContext = {
  now: NOW,
  baseUrl: 'https://www.bizinfo.go.kr/web/lay1/bbs/list.do',
  mapping: CATEGORY_MAPPING,
}

/** 시드 컬렉션 `contest` 의 스키마 (G0 계약 (4)) */
const FIELDS: ReadonlyArray<{ key: string; type: FieldType; mapping?: Record<string, string> | null }> = [
  { key: 'title', type: 'text' },
  { key: 'organization', type: 'text' },
  { key: 'deadline', type: 'date' },
  { key: 'amount', type: 'money' },
  { key: 'category', type: 'enum', mapping: CATEGORY_MAPPING },
  { key: 'link', type: 'link' },
]

describe('normalizeValue — 타입별 분기', () => {
  it('text', () => {
    expect(normalizeValue('text', '  청년  창업&amp;도전 ', CTX)).toEqual({
      ok: true,
      type: 'text',
      value: '청년 창업&도전',
    })
  })

  it('date', () => {
    expect(normalizeValue('date', '~2026-08-21', CTX)).toEqual({
      ok: true,
      type: 'date',
      value: { iso: '2026-08-21', kind: 'exact' },
    })
  })

  it('money', () => {
    expect(normalizeValue('money', '최대 100,000천원', CTX)).toEqual({
      ok: true,
      type: 'money',
      value: { amount: 100_000_000, currency: 'KRW', note: '최대' },
    })
  })

  it('number', () => {
    expect(normalizeValue('number', '20명', CTX)).toEqual({ ok: true, type: 'number', value: 20 })
  })

  it('link — ctx.baseUrl 로 절대 주소를 만든다', () => {
    expect(normalizeValue('link', '/web/detail.do?id=7', CTX)).toEqual({
      ok: true,
      type: 'link',
      value: 'https://www.bizinfo.go.kr/web/detail.do?id=7',
    })
  })

  it('enum — ctx.mapping 을 쓴다', () => {
    expect(normalizeValue('enum', 'R&D', CTX)).toEqual({
      ok: true,
      type: 'enum',
      value: { value: 'rnd', unmapped: false },
    })
  })

  it('ctx.formats 는 date 파서로 넘어간다', () => {
    const r = normalizeValue('date', '14/08/2026', { ...CTX, formats: ['DD/MM/YYYY'] })
    expect(r.ok && r.type === 'date' && r.value.iso).toBe('2026-08-14')
  })

  it('ctx.timezone 도 넘어간다', () => {
    const r = normalizeValue('date', '2026-08-14 18:00', { ...CTX, timezone: 'UTC' })
    expect(r.ok && r.type === 'date' && r.value.iso).toBe('2026-08-14T18:00:00Z')
  })
})

describe('normalizeValue — 실패는 값으로 (throw 금지)', () => {
  it.each<FieldType>(['text', 'date', 'money', 'number', 'link', 'enum'])(
    '%s 타입에 null 을 줘도 throw 하지 않는다',
    (type) => {
      const r = normalizeValue(type, null, CTX)
      expect(r.ok).toBe(false)
      expect(r.ok === false && r.type).toBe(type)
      expect(r.ok === false && r.reason.length > 0).toBe(true)
    },
  )

  it.each<FieldType>(['text', 'date', 'money', 'number', 'link', 'enum'])(
    '%s 타입에 객체를 줘도 throw 하지 않는다',
    (type) => {
      expect(() => normalizeValue(type, { nope: 1 }, CTX)).not.toThrow()
      expect(normalizeValue(type, { nope: 1 }, CTX).ok).toBe(false)
    },
  )
})

describe('toJsonValue — data_json 에 들어갈 스칼라', () => {
  it('date 는 iso 만 남는다', () => {
    expect(toJsonValue(normalizeValue('date', '2026.08.14 18:00', CTX))).toBe('2026-08-14T18:00:00+09:00')
  })

  it('rolling 은 null 이다 (실패가 아니라 마감이 없는 것)', () => {
    const r = normalizeValue('date', '상시모집', CTX)
    expect(r.ok).toBe(true)
    expect(toJsonValue(r)).toBeNull()
  })

  it('money 는 amount 만 남는다', () => {
    expect(toJsonValue(normalizeValue('money', '1억 5천만원', CTX))).toBe(150_000_000)
  })

  it('enum 은 매핑된 값만 남는다', () => {
    expect(toJsonValue(normalizeValue('enum', '기술개발', CTX))).toBe('rnd')
  })

  it('실패는 null', () => {
    expect(toJsonValue(normalizeValue('date', '공고 참조', CTX))).toBeNull()
  })
})

describe('normalizeRecord — 두 소스가 같은 형식으로 수렴한다', () => {
  const fromKstartup = {
    title: 'AI 창업기업 기술개발 지원',
    organization: '중소벤처기업부',
    deadline: '20260814',
    amount: '100,000천원',
    category: '기술개발',
    link: 'https://www.k-startup.go.kr/web/detail?sn=1&utm_source=naver',
  }

  const fromBizinfo = {
    title: 'AI&nbsp;창업기업 기술개발 지원',
    organization: '  중소벤처기업부 ',
    deadline: '2026.08.14',
    amount: '최대 1억원',
    category: 'R&D',
    link: '/web/detail.do?sn=1',
  }

  it('k-startup 쪽', () => {
    const { data, failures } = normalizeRecord(FIELDS, fromKstartup, CTX)
    expect(failures).toEqual({})
    expect(data).toEqual({
      title: 'AI 창업기업 기술개발 지원',
      organization: '중소벤처기업부',
      deadline: '2026-08-14',
      amount: 100_000_000,
      category: 'rnd',
      link: 'https://www.k-startup.go.kr/web/detail?sn=1',
    })
  })

  it('bizinfo 쪽 — 표기가 달라도 날짜·금액·분류가 같은 값이 된다', () => {
    const a = normalizeRecord(FIELDS, fromKstartup, CTX).data
    const b = normalizeRecord(FIELDS, fromBizinfo, CTX).data
    expect(b['deadline']).toBe(a['deadline'])
    expect(b['amount']).toBe(a['amount'])
    expect(b['category']).toBe(a['category'])
    expect(b['title']).toBe(a['title'])
    expect(b['organization']).toBe(a['organization'])
  })

  it('필드별 mapping 이 ctx.mapping 을 덮어쓴다', () => {
    const fields = [{ key: 'category', type: 'enum' as const, mapping: { 기술개발: 'tech' } }]
    const { data } = normalizeRecord(fields, { category: '기술개발' }, CTX)
    expect(data['category']).toBe('tech')
  })

  it('부분 실패는 전체를 죽이지 않는다 (원칙 ④ 부분 성공)', () => {
    const { data, failures } = normalizeRecord(FIELDS, { ...fromKstartup, deadline: '공고 참조' }, CTX)
    expect(data['title']).toBe('AI 창업기업 기술개발 지원')
    expect(data['deadline']).toBeNull()
    expect(Object.keys(failures)).toEqual(['deadline'])
  })

  it('값이 통째로 없어도 throw 하지 않고 실패 사유만 모인다', () => {
    const { data, failures } = normalizeRecord(FIELDS, {}, CTX)
    expect(Object.values(data).every((v) => v === null)).toBe(true)
    expect(Object.keys(failures).sort()).toEqual(
      ['amount', 'category', 'deadline', 'link', 'organization', 'title'].sort(),
    )
  })
})
