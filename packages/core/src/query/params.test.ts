// 파라미터 파싱은 DB 없이 순수하게 검증된다. 기획서 12장 표의 회귀 테스트다.

import { describe, expect, it } from 'vitest'

import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '../types/api'
import type { FieldDef } from '../types/collection'
import {
  decodeCursor,
  encodeCursor,
  normalizeDateValue,
  normalizeEnumValue,
  normalizeNumberValue,
  parseCollectionQuery,
  toCollectionFilter,
} from './params'

/** G0 계약 (4) 의 시드 스키마와 같은 6개 */
const FIELDS: FieldDef[] = [
  { key: 'title', label: '사업명', type: 'text', required: true, mapping: null },
  { key: 'organization', label: '주관기관', type: 'text', required: false, mapping: null },
  { key: 'deadline', label: '마감일', type: 'date', required: false, mapping: null },
  { key: 'amount', label: '지원금', type: 'money', required: false, mapping: null },
  {
    key: 'category',
    label: '분야',
    type: 'enum',
    required: false,
    mapping: { 'R&D': 'rnd', 기술개발: 'rnd', 창업: 'startup' },
  },
  { key: 'link', label: '원문', type: 'link', required: true, mapping: null },
]

const parse = (qs: string) => parseCollectionQuery(qs, FIELDS)

describe('필드 필터', () => {
  it('스키마 필드 키가 그대로 파라미터가 된다', () => {
    const { query, warnings } = parse('category=rnd&organization=창업진흥원')
    expect(query.eq).toEqual({ category: 'rnd', organization: '창업진흥원' })
    expect(warnings).toEqual([])
  })

  it('money 필드는 숫자로, 콤마는 무시한다', () => {
    const { query } = parse('amount=100,000,000')
    expect(query.eq['amount']).toBe(100_000_000)
  })

  it('enum 은 원문 표기로 물어봐도 정규화된 값으로 바꿔준다', () => {
    expect(parse('category=기술개발').query.eq['category']).toBe('rnd')
    expect(parse('category=rnd').query.eq['category']).toBe('rnd')
  })

  it('빈 값은 조건 없음으로 본다', () => {
    const { query, warnings } = parse('organization=')
    expect(query.eq).toEqual({})
    expect(warnings).toEqual([])
  })
})

describe('범위 조건', () => {
  it('date · money 에는 걸린다', () => {
    const { query, warnings } = parse('deadline_gte=2026-08-01&amount_lte=100000000')
    expect(query.gte).toEqual({ deadline: '2026-08-01' })
    expect(query.lte).toEqual({ amount: 100_000_000 })
    expect(warnings).toEqual([])
  })

  it('text 필드에는 못 건다 — 조용히 무시하지 않고 경고를 남긴다', () => {
    const { query, warnings } = parse('title_gte=가')
    expect(query.gte).toEqual({})
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('사업명')
  })

  it('enum · link 도 범위 대상이 아니다', () => {
    expect(parse('category_gte=rnd').warnings).toHaveLength(1)
    expect(parse('link_lte=https://a').warnings).toHaveLength(1)
  })

  it('달력에 없는 날짜는 거부한다', () => {
    const { query, warnings } = parse('deadline_gte=2026-02-31')
    expect(query.gte).toEqual({})
    expect(warnings[0]).toContain('2026-02-31')
  })

  it('숫자가 아닌 금액은 거부한다', () => {
    const { query, warnings } = parse('amount_lte=많이')
    expect(query.lte).toEqual({})
    expect(warnings).toHaveLength(1)
  })
})

describe('모르는 조건', () => {
  it('오타를 조용히 삼키지 않는다', () => {
    const { query, warnings } = parse('categry=rnd')
    expect(query.eq).toEqual({})
    expect(warnings[0]).toContain('categry')
  })

  it('없는 필드의 범위 조건도 경고 대상이다', () => {
    expect(parse('budget_gte=100').warnings[0]).toContain('budget_gte')
  })

  it('경고 문구에 내부 명사를 쓰지 않는다 (보장선 B2)', () => {
    const { warnings } = parse('categry=rnd&title_gte=가&sort=nope&limit=hi')
    const banned = ['어댑터', '스펙', '드리프트', '파서', 'probe', '컴파일', '필드', 'SQL']
    for (const w of warnings) {
      for (const term of banned) expect(w).not.toContain(term)
    }
  })
})

describe('정렬', () => {
  it('오름차순과 내림차순', () => {
    expect(parse('sort=deadline').query.sort).toBe('deadline')
    expect(parse('sort=-amount').query.sort).toBe('-amount')
  })

  it('스키마에 없는 기준은 기본 순서로 떨어지고 경고가 남는다', () => {
    const { query, warnings } = parse('sort=-nope')
    expect(query.sort).toBeUndefined()
    expect(warnings).toHaveLength(1)
  })

  it('first_seen_at · last_seen_at 은 스키마에 없어도 허용된다', () => {
    expect(parse('sort=-first_seen_at').query.sort).toBe('-first_seen_at')
    expect(parse('sort=last_seen_at').warnings).toEqual([])
  })
})

describe('페이지', () => {
  it('기본값', () => {
    const { query } = parse('')
    expect(query.limit).toBe(DEFAULT_PAGE_LIMIT)
    expect(query.cursor).toBeNull()
  })

  it('상한을 넘으면 상한으로 맞추고 알려준다', () => {
    const { query, warnings } = parse(`limit=${MAX_PAGE_LIMIT + 1}`)
    expect(query.limit).toBe(MAX_PAGE_LIMIT)
    expect(warnings).toHaveLength(1)
  })

  it('숫자가 아니면 기본값으로 떨어진다', () => {
    const { query, warnings } = parse('limit=hi')
    expect(query.limit).toBe(DEFAULT_PAGE_LIMIT)
    expect(warnings).toHaveLength(1)
  })

  it('0 이하는 1로 맞춘다', () => {
    expect(parse('limit=0').query.limit).toBe(1)
  })

  it('깨진 커서는 처음부터 — throw 하지 않는다', () => {
    const { query, warnings } = parse('cursor=!!!not-base64!!!')
    expect(query.cursor).toBeNull()
    expect(warnings).toHaveLength(1)
  })
})

describe('검색 · 출처 · 신규 · 원문', () => {
  it('q · source · since · include', () => {
    const { query, warnings } = parse(
      'q=창업&source=k-startup.go.kr&since=2026-07-20&include=provenance',
    )
    expect(query.q).toBe('창업')
    expect(query.source).toBe('k-startup.go.kr')
    expect(query.since).toBe('2026-07-20')
    expect(query.include).toEqual(['provenance'])
    expect(warnings).toEqual([])
  })

  it('시각까지 준 since 는 ISO 로 정규화된다', () => {
    expect(parse('since=2026-07-20T09:00:00Z').query.since).toBe('2026-07-20T09:00:00.000Z')
  })

  it('못 읽는 since 는 버리고 알려준다', () => {
    const { query, warnings } = parse('since=어제')
    expect(query.since).toBeUndefined()
    expect(warnings).toHaveLength(1)
  })

  it('모르는 include 값은 경고', () => {
    const { query, warnings } = parse('include=provenance,secrets')
    expect(query.include).toEqual(['provenance'])
    expect(warnings[0]).toContain('secrets')
  })
})

describe('입력 형태', () => {
  it('URLSearchParams · 문자열 · 객체를 모두 받는다', () => {
    const expected = { category: 'rnd' }
    expect(parseCollectionQuery('category=rnd', FIELDS).query.eq).toEqual(expected)
    expect(parseCollectionQuery(new URLSearchParams('category=rnd'), FIELDS).query.eq).toEqual(
      expected,
    )
    expect(parseCollectionQuery({ category: 'rnd' }, FIELDS).query.eq).toEqual(expected)
    expect(parseCollectionQuery({ category: undefined }, FIELDS).query.eq).toEqual({})
  })

  it('같은 조건이 여러 번이면 첫 번째만 쓴다', () => {
    const { query, warnings } = parse('category=rnd&category=startup')
    expect(query.eq['category']).toBe('rnd')
    expect(warnings).toHaveLength(1)
  })

  it('어떤 입력에도 throw 하지 않는다', () => {
    const nasty = "q=%27%29%3B+DROP+TABLE+items%3B--&sort=--&limit=&deadline_gte=';--"
    expect(() => parseCollectionQuery(nasty, FIELDS)).not.toThrow()
    expect(() => parseCollectionQuery('', [])).not.toThrow()
  })
})

describe('커서 왕복', () => {
  it('문자열 정렬값', () => {
    const c = encodeCursor({ s: '2026-08-01', id: 'a1b2' })
    expect(decodeCursor(c)).toEqual({ v: 1, s: '2026-08-01', id: 'a1b2' })
  })

  it('숫자 정렬값', () => {
    const c = encodeCursor({ s: 100_000_000, id: 'x' })
    expect(decodeCursor(c)).toEqual({ v: 1, s: 100_000_000, id: 'x' })
  })

  it('정렬값이 비어 있는 행', () => {
    expect(decodeCursor(encodeCursor({ s: null, id: 'x' }))).toEqual({ v: 1, s: null, id: 'x' })
  })

  it('한글이 섞여도 깨지지 않는다', () => {
    const c = encodeCursor({ s: '창업진흥원', id: 'ㄱ' })
    expect(decodeCursor(c)?.s).toBe('창업진흥원')
  })

  it('URL 에 그대로 실을 수 있다 (base64url · 패딩 없음)', () => {
    for (let i = 0; i < 40; i += 1) {
      const c = encodeCursor({ s: `값${i}`, id: `id-${i}` })
      expect(c).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(encodeURIComponent(c)).toBe(c)
    }
  })

  it('못 읽는 커서는 전부 null', () => {
    expect(decodeCursor(null)).toBeNull()
    expect(decodeCursor('')).toBeNull()
    expect(decodeCursor('!!!')).toBeNull()
    expect(decodeCursor(btoa('not json'))).toBeNull()
    expect(decodeCursor(btoa(JSON.stringify({ v: 2, s: 1, id: 'x' })))).toBeNull()
    expect(decodeCursor(btoa(JSON.stringify({ v: 1, s: 1 })))).toBeNull()
    expect(decodeCursor(btoa(JSON.stringify({ v: 1, s: {}, id: 'x' })))).toBeNull()
  })

  it('파싱을 통과한 커서는 그대로 살아남는다', () => {
    const c = encodeCursor({ s: '2026-08-01', id: 'a1b2' })
    expect(parse(`cursor=${c}`).query.cursor).toBe(c)
  })
})

describe('값 정규화', () => {
  it('날짜', () => {
    expect(normalizeDateValue('2026-08-01')).toBe('2026-08-01')
    expect(normalizeDateValue(' 2026-08-01T09:00:00Z ')).toBe('2026-08-01')
    expect(normalizeDateValue('2026-13-01')).toBeNull()
    expect(normalizeDateValue('2026/08/01')).toBeNull()
  })

  it('숫자', () => {
    expect(normalizeNumberValue('1,000')).toBe(1000)
    expect(normalizeNumberValue('-3.5')).toBe(-3.5)
    expect(normalizeNumberValue('Infinity')).toBeNull()
    expect(normalizeNumberValue('')).toBeNull()
  })

  it('enum 매핑', () => {
    expect(normalizeEnumValue('R&D', { 'R&D': 'rnd' })).toBe('rnd')
    expect(normalizeEnumValue('rnd', { 'R&D': 'rnd' })).toBe('rnd')
    expect(normalizeEnumValue('etc', { 'R&D': 'rnd' })).toBe('etc')
    expect(normalizeEnumValue('x', null)).toBe('x')
  })
})

describe('구독 조건으로 넘기기', () => {
  it('페이지네이션을 뺀 조건만 남는다 (기획서 10장 filter_json)', () => {
    const { query } = parse('category=rnd&limit=10&cursor=&include=provenance&q=창업')
    const filter = toCollectionFilter(query)
    expect(filter).not.toHaveProperty('limit')
    expect(filter).not.toHaveProperty('cursor')
    expect(filter).not.toHaveProperty('include')
    expect(filter.eq).toEqual({ category: 'rnd' })
    expect(filter.q).toBe('창업')
  })
})
