// 해석기 테스트 — 기획서 11장의 JSON 모드·HTML 모드 예시를 그대로 픽스처로 쓴다
//
// 기획서에 적힌 스펙이 기획서에 적힌 대로 해석되는지가 이 파일의 전부다.
// HTML 평가는 주입점(HtmlAdapter)으로 들어오므로 여기서는 가짜 구현을 넣는다.
// 그 가짜가 성립한다는 것 자체가 "core 는 cheerio 를 몰라도 된다"의 증명이다.

import { describe, expect, it } from 'vitest'
import type { CollectionSchemaJson } from '../types/collection'
import { CollectionSchemaJsonSchema } from '../types/collection'
import type { HtmlAdapter, HtmlNode } from './paths'
import type { AdapterSpec } from './spec'
import { AdapterSpecSchema } from './spec'
import { hashString, interpretSpec, normalizeForHash, stableStringify } from './interpret'

/** 모든 테스트의 기준일. 2026-07-26(일) 09:00 KST */
const NOW = new Date('2026-07-26T09:00:00+09:00')

function spec(raw: unknown): AdapterSpec {
  return AdapterSpecSchema.parse(raw)
}

// ── 가짜 HtmlAdapter ───────────────────────────────────────────────────
//
// 실제 구현은 worker 가 cheerio 로, web 미리보기가 cheerio 또는 DOMParser 로 넣는다.
// 테스트는 트리를 JSON 으로 직렬화해 두고 아주 작은 선택자 매처를 돌린다.
// 지원하는 문법: 태그 · `.class` · `#id` · 자손(공백) · 자식(`>`).

interface FakeEl {
  tag: string
  classes?: string[]
  attrs?: Record<string, string>
  text?: string
  children?: FakeEl[]
}

interface Compound {
  tag: string | null
  classes: string[]
  id: string | null
}

interface SelectorPart {
  /** 앞 부분과의 관계. 첫 부분은 'root' */
  combinator: 'root' | 'descendant' | 'child'
  compound: Compound
}

function parseCompound(token: string): Compound {
  const compound: Compound = { tag: null, classes: [], id: null }
  for (const m of token.matchAll(/([.#]?)([\p{L}\p{N}_-]+)/gu)) {
    const mark = m[1] ?? ''
    const name = m[2] ?? ''
    if (mark === '.') compound.classes.push(name)
    else if (mark === '#') compound.id = name
    else compound.tag = name
  }
  return compound
}

function parseSelector(selector: string): SelectorPart[] {
  const tokens = selector.trim().split(/\s+/).filter((t) => t !== '')
  const parts: SelectorPart[] = []
  let pending: 'root' | 'descendant' | 'child' = 'root'
  for (const token of tokens) {
    if (token === '>') {
      pending = 'child'
      continue
    }
    parts.push({ combinator: pending, compound: parseCompound(token) })
    pending = 'descendant'
  }
  return parts
}

function matchesCompound(el: FakeEl, compound: Compound): boolean {
  if (compound.tag !== null && el.tag !== compound.tag) return false
  if (compound.id !== null && el.attrs?.['id'] !== compound.id) return false
  const classes = el.classes ?? []
  return compound.classes.every((c) => classes.includes(c))
}

function matchesPath(path: FakeEl[], parts: SelectorPart[]): boolean {
  const step = (ni: number, pi: number): boolean => {
    const part = parts[pi]
    const el = path[ni]
    if (part === undefined) return true
    if (el === undefined) return false
    if (!matchesCompound(el, part.compound)) return false
    if (pi === 0) return true
    if (part.combinator === 'child') return step(ni - 1, pi - 1)
    for (let k = ni - 1; k >= 0; k--) {
      if (step(k, pi - 1)) return true
    }
    return false
  }
  return step(path.length - 1, parts.length - 1)
}

function walk(el: FakeEl, path: FakeEl[], visit: (el: FakeEl, path: FakeEl[]) => void): void {
  const here = [...path, el]
  visit(el, here)
  for (const child of el.children ?? []) walk(child, here, visit)
}

function textOf(el: FakeEl): string {
  const parts: string[] = []
  if (el.text !== undefined) parts.push(el.text)
  for (const child of el.children ?? []) parts.push(textOf(child))
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

function toNode(el: FakeEl): HtmlNode {
  return {
    text: () => textOf(el),
    attr: (name: string) => el.attrs?.[name],
    html: () => JSON.stringify(el),
  }
}

const fakeHtml: HtmlAdapter = {
  select(html, selector) {
    let root: FakeEl
    try {
      root = JSON.parse(html) as FakeEl
    } catch {
      return []
    }
    const parts = parseSelector(selector)
    if (parts.length === 0) return []
    const found: HtmlNode[] = []
    walk(root, [], (el, path) => {
      if (matchesPath(path, parts)) found.push(toNode(el))
    })
    return found
  },
}

// ── 기획서 11장 JSON 모드 예시 ─────────────────────────────────────────

const JSON_SPEC = spec({
  spec_version: 1,
  fetch: {
    mode: 'json',
    url: 'https://www.k-startup.go.kr/api/pbanc/list?page={page}&size=50',
    method: 'GET',
    headers: { Accept: 'application/json' },
  },
  list: '$.data.items[*]',
  dedupe_key: '$.pbancSn',
  fields: {
    title: { path: '$.pbancNm', type: 'text' },
    organization: { path: '$.jrsdInsttNm', type: 'text' },
    deadline: {
      path: '$.reqstEndDe',
      type: 'date',
      transform: [{ op: 'date_parse', formats: ['YYYYMMDD', 'YYYY.MM.DD'] }],
    },
    amount: {
      path: '$.sportAmount',
      type: 'money',
      transform: [
        { op: 'regex_extract', pattern: '[\\d,]+' },
        { op: 'number_parse' },
        { op: 'multiply', by: 1000 },
      ],
    },
    link: {
      path: '$.pbancSn',
      type: 'link',
      transform: [{ op: 'template', value: 'https://www.k-startup.go.kr/web/contents/detail?sn={value}' }],
    },
  },
  pagination: { kind: 'page_param', param: 'page', start: 1, max_pages: 3 },
})

const JSON_PAYLOAD = {
  data: {
    items: [
      {
        pbancSn: 174233,
        pbancNm: '2026년 초기창업패키지 창업기업 모집공고',
        jrsdInsttNm: '중소벤처기업부',
        reqstEndDe: '20260814',
        sportAmount: '최대 100,000천원',
      },
      {
        pbancSn: 174290,
        pbancNm: '2026년 청년창업사관학교 15기 모집',
        jrsdInsttNm: '중소벤처기업부',
        reqstEndDe: '2026.09.03',
        sportAmount: '최대 50,000천원',
      },
    ],
    total: 2,
  },
}

describe('interpretSpec — JSON 모드 (기획서 11장 예시 그대로)', () => {
  const result = interpretSpec(JSON_SPEC, JSON_PAYLOAD, { now: NOW })

  it('list 경로로 행을 두 개 뽑는다', () => {
    expect(result.items).toHaveLength(2)
  })

  it('text 필드', () => {
    expect(result.items[0]?.data['title']).toBe('2026년 초기창업패키지 창업기업 모집공고')
    expect(result.items[0]?.data['organization']).toBe('중소벤처기업부')
  })

  it('date 필드 — 두 소스가 달라도 같은 형식으로 들어간다', () => {
    expect(result.items[0]?.data['deadline']).toBe('2026-08-14')
    expect(result.items[1]?.data['deadline']).toBe('2026-09-03')
  })

  it('money 필드 — 천원 단위 승수가 적용된다', () => {
    expect(result.items[0]?.data['amount']).toBe(100_000_000)
    expect(result.items[1]?.data['amount']).toBe(50_000_000)
  })

  it('link 필드 — template 으로 조립한 절대 URL', () => {
    expect(result.items[0]?.data['link']).toBe('https://www.k-startup.go.kr/web/contents/detail?sn=174233')
  })

  it('dedupe_key 로 external_key 를 만든다', () => {
    expect(result.items[0]?.external_key).toBe('174233')
    expect(result.items[0]?.external_key_origin).toBe('dedupe_key')
  })

  it('provenance — 어느 경로에서 왔는지 같이 낸다 (원문 대조)', () => {
    expect(result.items[0]?.provenance).toEqual({
      title: '$.pbancNm',
      organization: '$.jrsdInsttNm',
      deadline: '$.reqstEndDe',
      amount: '$.sportAmount',
      link: '$.pbancSn',
    })
  })

  it('raw — 행 원본과 변환 전 원값을 보존한다', () => {
    const raw = result.items[0]?.raw
    expect(raw?.['_row']).toEqual(JSON_PAYLOAD.data.items[0])
    expect((raw?.['_fields'] as Record<string, unknown>)['amount']).toBe('최대 100,000천원')
  })

  it('fieldStats — 다 뽑혔으면 null 비율도 실패율도 0', () => {
    for (const key of ['title', 'organization', 'deadline', 'amount', 'link']) {
      expect(result.fieldStats[key]).toEqual({ null_ratio: 0, type_fail_ratio: 0, samples: [] })
    }
  })

  it('네트워크를 타지 않는다 — 같은 입력이면 항상 같은 출력', () => {
    const again = interpretSpec(JSON_SPEC, JSON_PAYLOAD, { now: NOW })
    expect(stableStringify(again.items)).toBe(stableStringify(result.items))
  })

  it('[*] 없이 배열 자체가 걸려도 한 겹 편다', () => {
    const flat = spec({ ...rawJsonSpec(), list: '$.data.items' })
    expect(interpretSpec(flat, JSON_PAYLOAD, { now: NOW }).items).toHaveLength(2)
  })

  it('목록을 못 찾으면 아이템 0 개 + 사람이 읽을 수 있는 경고', () => {
    const wrong = spec({ ...rawJsonSpec(), list: '$.data.nothing[*]' })
    const out = interpretSpec(wrong, JSON_PAYLOAD, { now: NOW })
    expect(out.items).toHaveLength(0)
    expect(out.warnings).toContain('목록에서 항목을 하나도 찾지 못했습니다')
  })
})

/** 위 스펙의 원본 JSON (일부만 바꿔 다시 파싱하기 위한 것) */
function rawJsonSpec(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(JSON_SPEC)) as Record<string, unknown>
}

// ── 기획서 11장 HTML 모드 예시 ─────────────────────────────────────────

const HTML_SPEC = spec({
  spec_version: 1,
  fetch: { mode: 'html', url: 'https://thinkcontest.com/contest/list?p={page}' },
  list: 'css:.contest-list > li',
  dedupe_key: 'css:a@href',
  fields: {
    title: { path: 'css:.tit', type: 'text' },
    deadline: {
      path: 'css:.date',
      type: 'date',
      transform: [{ op: 'regex_extract', pattern: '\\d{4}[.-]\\d{2}[.-]\\d{2}' }, { op: 'date_parse' }],
    },
    link: { path: 'css:a@href', type: 'link', transform: [{ op: 'absolute_url' }] },
  },
  pagination: { kind: 'next_link', path: 'css:a.next@href', max_pages: 3 },
})

function contestRow(id: string, title: string, date: string): FakeEl {
  return {
    tag: 'li',
    children: [
      { tag: 'a', attrs: { href: `/contest/${id}` }, children: [{ tag: 'span', classes: ['tit'], text: title }] },
      { tag: 'span', classes: ['date'], text: `~ ${date} 마감` },
    ],
  }
}

const HTML_PAYLOAD = JSON.stringify({
  tag: 'div',
  children: [
    {
      tag: 'ul',
      classes: ['contest-list'],
      children: [
        contestRow('1024', '제12회 대학생 소셜벤처 아이디어 공모전', '2026.08.21'),
        contestRow('1025', '2026 스마트제조 혁신 아이디어 챌린지', '2026.09.10'),
      ],
    },
    { tag: 'a', classes: ['next'], attrs: { href: '/contest/list?p=2' }, text: '다음' },
  ],
} satisfies FakeEl)

describe('interpretSpec — HTML 모드 (기획서 11장 예시 그대로)', () => {
  const result = interpretSpec(HTML_SPEC, HTML_PAYLOAD, { now: NOW, html: fakeHtml })

  it('list 선택자로 행을 두 개 뽑는다', () => {
    expect(result.items).toHaveLength(2)
  })

  it('필드는 행 안에서 다시 평가된다 — 1번 행의 제목이 2번 행에 새지 않는다', () => {
    expect(result.items[0]?.data['title']).toBe('제12회 대학생 소셜벤처 아이디어 공모전')
    expect(result.items[1]?.data['title']).toBe('2026 스마트제조 혁신 아이디어 챌린지')
  })

  it('date — JSON 모드와 같은 형식으로 들어간다', () => {
    expect(result.items[0]?.data['deadline']).toBe('2026-08-21')
    expect(result.items[1]?.data['deadline']).toBe('2026-09-10')
  })

  it('link — absolute_url 이 fetch.url 을 기준으로 절대 주소를 만든다', () => {
    expect(result.items[0]?.data['link']).toBe('https://thinkcontest.com/contest/1024')
  })

  it('dedupe_key 는 변환 전 원값(href)을 쓴다', () => {
    expect(result.items[0]?.external_key).toBe('/contest/1024')
    expect(result.items[0]?.external_key_origin).toBe('dedupe_key')
  })

  it('raw._row 는 행 HTML 조각이다 (원문 대조)', () => {
    expect(typeof result.items[0]?.raw['_row']).toBe('string')
  })

  it('HtmlAdapter 를 안 주면 던지지 않고 상태 문구로 말한다 (보장선 B4)', () => {
    const out = interpretSpec(HTML_SPEC, HTML_PAYLOAD, { now: NOW })
    expect(out.items).toHaveLength(0)
    expect(out.warnings.join(' ')).toContain('페이지 내용을 읽는 방법')
  })

  it('payload 가 문자열이 아니면 상태 문구', () => {
    const out = interpretSpec(HTML_SPEC, { not: 'html' }, { now: NOW, html: fakeHtml })
    expect(out.items).toHaveLength(0)
    expect(out.warnings.join(' ')).toContain('페이지 내용을 읽지 못했습니다')
  })
})

// ── external_key 폴백 (ADR A13 · 기획서 10장) ──────────────────────────

describe('external_key 폴백', () => {
  const base = {
    spec_version: 1,
    fetch: { mode: 'json', url: 'https://example.com/api' },
    list: '$.items[*]',
    fields: { title: { path: '$.name', type: 'text' } },
  }

  it('dedupe_key 가 없으면 정규화된 title 의 해시를 쓴다', () => {
    const out = interpretSpec(spec(base), { items: [{ name: '공모전 가' }] }, { now: NOW })
    expect(out.items[0]?.external_key_origin).toBe('title_hash')
    expect(out.items[0]?.external_key).toBe(`t_${hashString('공모전 가')}`)
  })

  it('공백·대소문자 차이로 같은 항목이 새 항목이 되면 안 된다', () => {
    const a = interpretSpec(spec(base), { items: [{ name: 'Contest  A' }] }, { now: NOW })
    const b = interpretSpec(spec(base), { items: [{ name: ' contest a ' }] }, { now: NOW })
    expect(a.items[0]?.external_key).toBe(b.items[0]?.external_key)
  })

  it('dedupe_key 가 있어도 값이 비면 title 해시로 내려간다', () => {
    const withKey = spec({ ...base, dedupe_key: '$.id' })
    const out = interpretSpec(withKey, { items: [{ name: '공모전 가' }] }, { now: NOW })
    expect(out.items[0]?.external_key_origin).toBe('title_hash')
  })

  it('title 도 없으면 행 해시', () => {
    const noTitle = spec({
      ...base,
      fields: { organization: { path: '$.org', type: 'text' } },
    })
    const out = interpretSpec(noTitle, { items: [{ org: '중소벤처기업부' }] }, { now: NOW })
    expect(out.items[0]?.external_key_origin).toBe('row_hash')
    expect(out.items[0]?.external_key.startsWith('r_')).toBe(true)
  })

  it('같은 페이지 안의 중복 행은 한 번만 나온다', () => {
    const out = interpretSpec(
      spec({ ...base, dedupe_key: '$.id' }),
      { items: [{ id: 'A', name: '가' }, { id: 'A', name: '가' }, { id: 'B', name: '나' }] },
      { now: NOW },
    )
    expect(out.items.map((i) => i.external_key)).toEqual(['A', 'B'])
  })

  it('hashString 은 순수 함수다 — node:crypto 를 쓰지 않는다', () => {
    expect(hashString('가')).toBe(hashString('가'))
    expect(hashString('가')).not.toBe(hashString('나'))
    expect(hashString('')).toMatch(/^[0-9a-z]+$/)
  })

  it('normalizeForHash 는 공백을 접고 소문자로 내린다', () => {
    expect(normalizeForHash('  Hello   World ')).toBe('hello world')
  })

  it('stableStringify 는 키 순서에 흔들리지 않는다', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }))
  })
})

// ── fieldStats — 드리프트 검증기의 입력 (원칙 ⑤) ───────────────────────

describe('fieldStats', () => {
  const statSpec = spec({
    spec_version: 1,
    fetch: { mode: 'json', url: 'https://example.com/api' },
    list: '$.items[*]',
    dedupe_key: '$.id',
    fields: {
      title: { path: '$.name', type: 'text' },
      count: { path: '$.count', type: 'number' },
    },
  })

  const payload = {
    items: [
      { id: '1', name: '가', count: 10 },
      { id: '2', count: 20 }, // title 없음 → null
      { id: '3', name: '다', count: '가나다' }, // 숫자로 못 읽음 → 타입 실패
      { id: '4', name: '라', count: 40 },
    ],
  }

  const out = interpretSpec(statSpec, payload, { now: NOW })

  it('null 비율', () => {
    expect(out.fieldStats['title']?.null_ratio).toBe(0.25)
  })

  it('타입 파싱 실패율 — 원값이 있었는데 못 읽은 것만 센다', () => {
    expect(out.fieldStats['count']?.type_fail_ratio).toBe(0.25)
    expect(out.fieldStats['count']?.null_ratio).toBe(0.25)
  })

  it('실패한 원값 예시를 남긴다 (치유 프롬프트가 먹는다)', () => {
    expect(out.fieldStats['count']?.samples).toContain('가나다')
  })

  it('값이 없어서 null 인 것은 타입 실패로 세지 않는다', () => {
    expect(out.fieldStats['title']?.type_fail_ratio).toBe(0)
  })

  it('행이 깨져도 나머지 행은 나간다 (원칙 ④)', () => {
    expect(out.items).toHaveLength(4)
    expect(out.items[2]?.data['count']).toBeNull()
    expect(out.items[2]?.data['title']).toBe('다')
  })
})

// ── enum mapping — 컬렉션 스키마를 주면 정규화까지 간다 ────────────────

describe('컬렉션 스키마 연결', () => {
  const schema: CollectionSchemaJson = CollectionSchemaJsonSchema.parse([
    { key: 'title', label: '공고명', type: 'text', required: true },
    { key: 'category', label: '분야', type: 'enum', mapping: { 기술개발: 'rnd', 'R&D': 'rnd' }, value_labels: null },
  ])

  const catSpec = spec({
    spec_version: 1,
    fetch: { mode: 'json', url: 'https://example.com/api' },
    list: '$.items[*]',
    fields: {
      title: { path: '$.name', type: 'text' },
      category: { path: '$.cat', type: 'enum' },
    },
  })

  it('enum 은 컬렉션 필드의 mapping 으로 묶인다', () => {
    const out = interpretSpec(catSpec, { items: [{ name: '가', cat: '기술개발' }] }, { now: NOW, schema })
    expect(out.items[0]?.data['category']).toBe('rnd')
  })

  it('mapping 을 안 주면 원값을 남긴다 — 버리지 않는다', () => {
    const out = interpretSpec(catSpec, { items: [{ name: '가', cat: '기술개발' }] }, { now: NOW })
    expect(out.items[0]?.data['category']).toBe('기술개발')
  })
})
