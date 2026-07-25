// SQL 조립은 DB 없이도 검증할 수 있다 — drizzle 의 방언으로 문자열과 파라미터를 뽑아 본다.
// 여기서 지키는 것은 두 가지다:
//   1. 사용자 입력이 SQL 문자열에 절대 섞이지 않는다 (전부 $n 바인딩)
//   2. 정렬·커서가 안정 정렬 규약(NULLS LAST + id tie-break)과 어긋나지 않는다

import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import { CollectionQuerySchema, type CollectionQuery } from '../types/api'
import type { FieldDef } from '../types/collection'
import {
  buildCursorWhere,
  buildOrderBy,
  escapeLikePattern,
  planItemsQuery,
  resolveSort,
} from './build'
import { encodeCursor, parseCollectionQuery } from './params'

const dialect = new PgDialect()
const render = (fragment: SQL) => dialect.sqlToQuery(fragment)

const FIELDS: FieldDef[] = [
  { key: 'title', label: '사업명', type: 'text', required: true, mapping: null },
  { key: 'organization', label: '주관기관', type: 'text', required: false, mapping: null },
  { key: 'deadline', label: '마감일', type: 'date', required: false, mapping: null },
  { key: 'amount', label: '지원금', type: 'money', required: false, mapping: null },
  { key: 'category', label: '분야', type: 'enum', required: false, mapping: { 'R&D': 'rnd' } },
  { key: 'link', label: '원문', type: 'link', required: true, mapping: null },
]

const COLLECTION_ID = '00000000-0000-0000-0000-0000000000c1'

function plan(qs: string, sourceIds: string[] | null = null) {
  const { query } = parseCollectionQuery(qs, FIELDS)
  return planItemsQuery(query, { collectionId: COLLECTION_ID, fields: FIELDS, sourceIds })
}

describe('SQL 안전성', () => {
  it('필드 키와 값이 전부 파라미터로 나간다', () => {
    const p = plan('category=rnd&deadline_gte=2026-08-01&amount_lte=100000000&q=창업')
    const { sql: text, params } = render(p.pageWhere)
    expect(text).not.toContain('rnd')
    expect(text).not.toContain('창업')
    expect(text).not.toContain('2026-08-01')
    expect(params).toContain('{"category":"rnd"}')
    expect(params).toContain('2026-08-01')
    expect(params).toContain('%창업%')
  })

  it('작은따옴표를 넣어도 문자열이 끊기지 않는다', () => {
    const evil = "'); drop table items; --"
    const p = plan(`title=${encodeURIComponent(evil)}&q=${encodeURIComponent(evil)}`)
    const { sql: text, params } = render(p.pageWhere)
    expect(text.toLowerCase()).not.toContain('drop table')
    expect(params.some((v) => typeof v === 'string' && v.includes('drop table'))).toBe(true)
  })

  it('스키마에 없는 이름은 조건이 되지 않는다', () => {
    const bare = render(plan('').where).sql
    const withJunk = render(plan('ghost=1&ghost_gte=1').where).sql
    expect(withJunk).toBe(bare)
  })

  it('ILIKE 메타문자를 죽인다', () => {
    expect(escapeLikePattern('100%_a\\b')).toBe('100\\%\\_a\\\\b')
    const { params } = render(plan('q=100%').pageWhere)
    expect(params).toContain('%100\\%%')
  })
})

describe('조건 조립', () => {
  it('컬렉션 조건은 언제나 들어간다', () => {
    expect(render(plan('').where).params).toContain(COLLECTION_ID)
  })

  it('완전일치는 GIN 인덱스를 타도록 JSONB 포함 연산자로 나간다', () => {
    const { sql: text, params } = render(plan('category=rnd').where)
    expect(text).toContain('@>')
    expect(params).toContain('{"category":"rnd"}')
  })

  it('money 범위는 숫자로 캐스팅해 비교한다', () => {
    const { sql: text, params } = render(plan('amount_gte=1000').where)
    expect(text).toContain('::numeric')
    expect(params).toContain(1000)
  })

  it('date 범위는 정규화된 YYYY-MM-DD 라 문자열 비교로 충분하다', () => {
    const { sql: text } = render(plan('deadline_lte=2026-08-01').where)
    expect(text).not.toContain('::date')
    expect(text).toContain('::text')
  })

  it('?source= 가 아무 출처와도 안 맞으면 결과가 0건이 된다', () => {
    expect(render(plan('', []).where).sql).toContain('false')
  })

  it('?since= 는 first_seen_at 기준이다', () => {
    const { sql: text, params } = render(plan('since=2026-07-20').where)
    expect(text).toContain('first_seen_at')
    expect(params).toContain('2026-07-20')
  })

  it('text 필드가 하나도 없으면 q 는 조건이 되지 않는다', () => {
    const onlyDate: FieldDef[] = [
      { key: 'deadline', label: '마감일', type: 'date', required: false, mapping: null },
    ]
    const { query } = parseCollectionQuery('q=창업', onlyDate)
    const p = planItemsQuery(query, { collectionId: COLLECTION_ID, fields: onlyDate })
    expect(render(p.where).sql).not.toContain('ilike')
  })
})

describe('정렬과 커서', () => {
  it('언제나 id 로 동률을 깬다 (안정 정렬)', () => {
    for (const spec of [undefined, 'deadline', '-amount', '-first_seen_at']) {
      const order = buildOrderBy(resolveSort(spec, FIELDS))
      expect(order).toHaveLength(2)
      expect(render(order[1]!).sql).toContain('"id" asc')
      expect(render(order[0]!).sql).toContain('nulls last')
    }
  })

  it('커서가 붙으면 where 가 늘어난다', () => {
    const cursor = encodeCursor({ s: '2026-08-01', id: '00000000-0000-0000-0000-00000000beef' })
    const p = plan(`sort=deadline&cursor=${cursor}`)
    expect(render(p.pageWhere).sql.length).toBeGreaterThan(render(p.where).sql.length)
  })

  it('오름차순 커서는 뒤쪽 + 동률-id + 빈 값 구간을 집는다', () => {
    const sort = resolveSort('deadline', FIELDS)
    const where = buildCursorWhere(sort, { v: 1, s: '2026-08-01', id: 'x' })
    const text = render(where!).sql
    expect(text).toContain('>')
    expect(text).toContain('is null')
  })

  it('내림차순 커서는 앞쪽을 집는다', () => {
    const sort = resolveSort('-deadline', FIELDS)
    const text = render(buildCursorWhere(sort, { v: 1, s: '2026-08-01', id: 'x' })!).sql
    expect(text).toContain('<')
  })

  it('빈 값 구간에 들어온 커서는 id 로만 이어간다', () => {
    const sort = resolveSort('deadline', FIELDS)
    const text = render(buildCursorWhere(sort, { v: 1, s: null, id: 'x' })!).sql
    expect(text).toContain('is null')
    expect(text).not.toContain('>=')
  })

  it('값이 비지 않는 기준인데 커서에 값이 없으면 커서를 버린다', () => {
    const sort = resolveSort('-first_seen_at', FIELDS)
    expect(buildCursorWhere(sort, { v: 1, s: null, id: 'x' })).toBeNull()
  })

  it('깨진 커서는 조건 없이 첫 페이지로 떨어진다', () => {
    const q: CollectionQuery = CollectionQuerySchema.parse({ cursor: 'garbage' })
    const p = planItemsQuery(q, { collectionId: COLLECTION_ID, fields: FIELDS })
    expect(render(p.pageWhere).sql).toBe(render(p.where).sql)
  })
})

describe('페이지', () => {
  it('다음 페이지 유무를 알려고 하나 더 읽는다', () => {
    const p = plan('limit=10')
    expect(p.limit).toBe(10)
    expect(p.fetchLimit).toBe(11)
  })
})
