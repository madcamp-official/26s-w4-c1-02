// 응답 조립 중 DB 가 필요 없는 조각들. G0 계약 (2) 의 회귀 테스트다.

import { describe, expect, it } from 'vitest'

import type { FieldDef } from '../types/collection'
import { resolveSort, sortValueOf } from './build'
import {
  formatAge,
  hostMatches,
  linkOf,
  nextCursorFrom,
  summarizeSources,
  toApiItem,
  type ItemRowLike,
  type SourceStateLike,
} from './respond'
import { decodeCursor } from './params'

const FIELDS: FieldDef[] = [
  { key: 'title', label: '사업명', type: 'text', required: true, mapping: null },
  { key: 'deadline', label: '마감일', type: 'date', required: false, mapping: null },
  { key: 'amount', label: '지원금', type: 'money', required: false, mapping: null },
  { key: 'link', label: '원문', type: 'link', required: true, mapping: null },
]

const NOW = new Date('2026-07-26T12:00:00.000Z')

const row = (over: Partial<ItemRowLike> = {}): ItemRowLike => ({
  id: '11111111-1111-1111-1111-111111111111',
  source_id: 's1',
  data_json: {
    title: '창업도약패키지',
    deadline: '2026-08-21',
    amount: 100_000_000,
    link: 'https://k-startup.go.kr/1',
  },
  raw_json: { pbancNm: '창업도약패키지', reqstEndDe: '20260821' },
  provenance_json: { deadline: '$.reqstEndDe' },
  first_seen_at: new Date('2026-07-20T00:00:00.000Z'),
  ...over,
})

describe('formatAge', () => {
  it('기획서 예시대로 "6h" 꼴', () => {
    expect(formatAge(new Date('2026-07-26T06:00:00.000Z'), NOW)).toBe('6h')
  })

  it('한 시간 미만은 분, 이틀 넘으면 일', () => {
    expect(formatAge(new Date('2026-07-26T11:30:00.000Z'), NOW)).toBe('30m')
    expect(formatAge(new Date('2026-07-20T12:00:00.000Z'), NOW)).toBe('6d')
  })

  it('미래 시각이어도 음수가 나오지 않는다', () => {
    expect(formatAge(new Date('2026-07-27T00:00:00.000Z'), NOW)).toBe('0m')
  })
})

describe('sources 블록 — 원칙 ④', () => {
  const rows: SourceStateLike[] = [
    { id: 's1', host: 'k-startup.go.kr', status: 'ok', last_ok_at: NOW },
    {
      id: 's2',
      host: 'bizinfo.go.kr',
      status: 'healing',
      last_ok_at: new Date('2026-07-26T06:00:00.000Z'),
    },
    { id: 's3', host: 'thinkcontest.com', status: 'needs_attention', last_ok_at: null },
  ]

  it('아이템이 0건이어도 소스는 전부 나온다', () => {
    const out = summarizeSources(rows, new Map(), NOW)
    expect(Object.keys(out)).toEqual(['k-startup.go.kr', 'bizinfo.go.kr', 'thinkcontest.com'])
    expect(out['k-startup.go.kr']?.items).toBe(0)
  })

  it('healing 인 소스만 age 가 붙는다', () => {
    const out = summarizeSources(rows, new Map(), NOW)
    expect(out['bizinfo.go.kr']?.age).toBe('6h')
    expect(out['k-startup.go.kr']?.age).toBeUndefined()
    expect(out['thinkcontest.com']?.age).toBeUndefined()
  })

  it('last_ok_at 은 ISO 문자열 또는 null', () => {
    const out = summarizeSources(rows, new Map(), NOW)
    expect(out['k-startup.go.kr']?.last_ok_at).toBe(NOW.toISOString())
    expect(out['thinkcontest.com']?.last_ok_at).toBeNull()
  })

  it('개수는 소스 id 로 집계된다', () => {
    const out = summarizeSources(rows, new Map([['s1', 10]]), NOW)
    expect(out['k-startup.go.kr']?.items).toBe(10)
    expect(out['bizinfo.go.kr']?.items).toBe(0)
  })

  it('같은 호스트가 둘이면 개수는 합치고 상태는 나쁜 쪽을 올린다', () => {
    const dup: SourceStateLike[] = [
      { id: 'a', host: 'x.kr', status: 'ok', last_ok_at: NOW },
      { id: 'b', host: 'x.kr', status: 'needs_attention', last_ok_at: null },
    ]
    const out = summarizeSources(dup, new Map([['a', 3], ['b', 2]]), NOW)
    expect(Object.keys(out)).toEqual(['x.kr'])
    expect(out['x.kr']).toMatchObject({ status: 'needs_attention', items: 5 })
    expect(out['x.kr']?.last_ok_at).toBe(NOW.toISOString())
  })
})

describe('hostMatches', () => {
  it('대소문자와 www. 는 무시', () => {
    expect(hostMatches('k-startup.go.kr', 'K-Startup.go.kr')).toBe(true)
    expect(hostMatches('www.k-startup.go.kr', 'k-startup.go.kr')).toBe(true)
    expect(hostMatches('bizinfo.go.kr', 'k-startup.go.kr')).toBe(false)
  })
})

describe('toApiItem', () => {
  it('data_json 을 펼치고 메타를 얹는다', () => {
    const item = toApiItem(row(), {
      host: 'k-startup.go.kr',
      fields: FIELDS,
      includeProvenance: false,
    })
    expect(item['title']).toBe('창업도약패키지')
    expect(item['amount']).toBe(100_000_000)
    expect(item._source).toBe('k-startup.go.kr')
    expect(item._first_seen_at).toBe('2026-07-20T00:00:00.000Z')
    expect(item._link).toBe('https://k-startup.go.kr/1')
    expect(item._provenance).toBeUndefined()
    expect(item._raw).toBeUndefined()
  })

  it('?include=provenance 면 원문 조각까지', () => {
    const item = toApiItem(row(), {
      host: 'k-startup.go.kr',
      fields: FIELDS,
      includeProvenance: true,
    })
    expect(item._provenance).toEqual({ deadline: '$.reqstEndDe' })
    expect(item._raw).toEqual({ pbancNm: '창업도약패키지', reqstEndDe: '20260821' })
  })

  it('없는 값은 null 로 자리를 채워 응답 모양이 흔들리지 않는다', () => {
    const item = toApiItem(row({ data_json: { title: '이름만 있는 것' } }), {
      host: 'x',
      fields: FIELDS,
      includeProvenance: false,
    })
    expect(item['deadline']).toBeNull()
    expect(item['amount']).toBeNull()
    expect(item._link).toBeNull()
  })

  it('스키마에 없는 유령 키는 새어 나가지 않는다 (원칙 ⑤)', () => {
    const item = toApiItem(row({ data_json: { title: 'a', ghost: '옛 수집이 남긴 값' } }), {
      host: 'x',
      fields: FIELDS,
      includeProvenance: false,
    })
    expect(item).not.toHaveProperty('ghost')
  })

  it('link 타입 필드가 없으면 link 키를 본다', () => {
    expect(linkOf({ link: 'https://a' }, [])).toBe('https://a')
    expect(linkOf({}, FIELDS)).toBeNull()
  })
})

describe('다음 커서', () => {
  const sortRow = {
    id: '22222222-2222-2222-2222-222222222222',
    data_json: { deadline: '2026-08-21', amount: 100 } as Record<string, string | number>,
    first_seen_at: new Date('2026-07-20T00:00:00.000Z'),
    last_seen_at: NOW,
  }

  it('다음 페이지가 없으면 null', () => {
    const sort = resolveSort(undefined, FIELDS)
    expect(nextCursorFrom(sortRow, sort, false)).toBeNull()
    expect(nextCursorFrom(undefined, sort, true)).toBeNull()
  })

  it('기본 정렬은 first_seen_at 내림차순이고 커서에 그 값이 실린다', () => {
    const sort = resolveSort(undefined, FIELDS)
    expect(sort).toMatchObject({ key: 'first_seen_at', direction: 'desc', nullable: false })
    const cursor = nextCursorFrom(sortRow, sort, true)
    expect(decodeCursor(cursor)).toEqual({
      v: 1,
      s: '2026-07-20T00:00:00.000Z',
      id: sortRow.id,
    })
  })

  it('필드 정렬이면 그 필드 값이 실린다', () => {
    const sort = resolveSort('deadline', FIELDS)
    expect(sort).toMatchObject({ key: 'deadline', direction: 'asc', nullable: true })
    expect(decodeCursor(nextCursorFrom(sortRow, sort, true))?.s).toBe('2026-08-21')
  })

  it('정렬 기준 값이 비어 있으면 null 이 실린다', () => {
    const sort = resolveSort('-amount', FIELDS)
    const empty = { ...sortRow, data_json: {} }
    expect(sortValueOf(empty, sort)).toBeNull()
    expect(decodeCursor(nextCursorFrom(empty, sort, true))?.s).toBeNull()
  })

  it('모르는 정렬 기준은 기본값으로 떨어진다', () => {
    expect(resolveSort('nope', FIELDS).key).toBe('first_seen_at')
  })
})
