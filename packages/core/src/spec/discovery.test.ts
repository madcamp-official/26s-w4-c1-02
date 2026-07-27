// 발견 모드 — 스키마가 아직 없을 때의 컴파일 출력 (기획서 9-1②④)
//
// 여기서 지키려는 계약은 두 줄이다:
//   1. `columns` 하나가 **표 구성**과 **뽑는 방법** 둘로 정확히 쪼개진다
//   2. 쪼갠 뒤에는 기존 `validateSpec` 관문을 그대로 통과한다 —
//      발견 경로에만 있는 구멍(호스트 이탈 · 경로 문법 · 모르는 op)이 생기면 안 된다

import { describe, expect, it } from 'vitest'

import { buildDiscoveryResponseSchema, MAX_DISCOVERED_COLUMNS, parseDiscoveryOutput } from './json-schema'

const HOST = 'www.k-startup.go.kr'

/** json 모드 정상 출력 한 벌 */
function jsonOutput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    spec_version: 1,
    fetch: { mode: 'json', url: 'https://www.k-startup.go.kr/api/pbanc/list?page={page}', method: 'GET' },
    list: '$.data.items[*]',
    dedupe_key: '$.pbancSn',
    columns: [
      { key: 'title', label: '사업명', type: 'text', required: true, path: '$.pbancNm' },
      {
        key: 'deadline',
        label: '마감일',
        type: 'date',
        path: '$.reqstEndDe',
        transform: [{ op: 'date_parse', formats: ['YYYYMMDD'] }],
      },
      { key: 'amount', label: '지원금액', type: 'money', path: '$.sportAmount' },
    ],
    pagination: { kind: 'page_param', param: 'page', start: 1, max_pages: 3 },
    ...overrides,
  }
}

describe('buildDiscoveryResponseSchema', () => {
  it('스키마 없이도 만들어진다 — 이게 발견 모드의 존재 이유다', () => {
    const s = buildDiscoveryResponseSchema()
    expect(s.properties?.['columns']).toBeDefined()
    // 기존 경로와 달리 `fields` 객체가 아니라 `columns` 배열이다
    expect(s.properties?.['fields']).toBeUndefined()
    expect(s.required).toContain('columns')
  })

  it('칸 수에 상한이 걸려 있다 (보장선 B3 — 사람이 편집할 수 있는 표)', () => {
    const columns = buildDiscoveryResponseSchema().properties?.['columns']
    expect(columns?.maxItems).toBe(MAX_DISCOVERED_COLUMNS)
  })
})

describe('parseDiscoveryOutput — 쪼개기', () => {
  it('columns 를 표 구성과 뽑는 방법 둘로 쪼갠다', () => {
    const r = parseDiscoveryOutput(jsonOutput(), { host: HOST })
    expect(r.ok).toBe(true)
    if (!r.ok) return

    // ① 표 구성
    expect(r.schema.map((f) => f.key)).toEqual(['title', 'deadline', 'amount'])
    expect(r.schema[0]).toMatchObject({ key: 'title', label: '사업명', type: 'text', required: true })
    // enum 이 아닌 칸은 mapping·value_labels 가 null 이어야 한다 (types/collection 의 refine)
    expect(r.schema[1]).toMatchObject({ mapping: null, value_labels: null })

    // ② 뽑는 방법
    expect(r.spec.fields['title']).toMatchObject({ path: '$.pbancNm', type: 'text' })
    expect(r.spec.fields['deadline']?.transform).toEqual([{ op: 'date_parse', formats: ['YYYYMMDD'] }])
    expect(r.spec.list).toBe('$.data.items[*]')
    expect(r.spec.dedupe_key).toBe('$.pbancSn')
  })

  it('칸의 순서가 보존된다 — 표의 열 순서가 된다', () => {
    const r = parseDiscoveryOutput(jsonOutput(), { host: HOST })
    if (!r.ok) throw new Error('should parse')
    expect(r.schema.map((f) => f.label)).toEqual(['사업명', '마감일', '지원금액'])
  })

  it('문자열로 와도 되고 ```json 울타리도 벗긴다', () => {
    const raw = '```json\n' + JSON.stringify(jsonOutput()) + '\n```'
    expect(parseDiscoveryOutput(raw, { host: HOST }).ok).toBe(true)
  })

  it('html 모드는 css 경로로 쪼개진다', () => {
    const out = {
      spec_version: 1,
      fetch: { mode: 'html', url: 'https://www.k-startup.go.kr/list?p={page}' },
      list: 'css:.contest-list > li',
      columns: [
        { key: 'title', label: '제목', type: 'text', path: 'css:.tit' },
        { key: 'link', label: '원문 보기', type: 'link', path: 'css:a@href', transform: [{ op: 'absolute_url' }] },
      ],
      pagination: { kind: 'none' },
    }
    const r = parseDiscoveryOutput(out, { host: HOST })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.spec.fetch.mode).toBe('html')
    expect(r.spec.fields['link']?.path).toBe('css:a@href')
  })
})

describe('parseDiscoveryOutput — 관문이 발견 경로에도 그대로 걸린다', () => {
  it('다른 호스트로 나가는 스펙을 거절한다 (SSRF·엉뚱한 사이트 방어)', () => {
    const r = parseDiscoveryOutput(
      jsonOutput({ fetch: { mode: 'json', url: 'https://evil.example.com/api', method: 'GET' } }),
      { host: HOST },
    )
    expect(r.ok).toBe(false)
  })

  it('사설망 주소를 거절한다', () => {
    const r = parseDiscoveryOutput(
      jsonOutput({ fetch: { mode: 'json', url: 'http://127.0.0.1/api', method: 'GET' } }),
      { host: '127.0.0.1' },
    )
    expect(r.ok).toBe(false)
  })

  it('모르는 변환 연산자를 거절한다 (닫힌 집합 · ADR A2)', () => {
    const r = parseDiscoveryOutput(
      jsonOutput({
        columns: [{ key: 'title', label: '제목', type: 'text', path: '$.a', transform: [{ op: 'custom', code: 'x' }] }],
      }),
      { host: HOST },
    )
    expect(r.ok).toBe(false)
  })

  it('json 모드에 css 경로를 섞으면 거절한다', () => {
    const r = parseDiscoveryOutput(
      jsonOutput({ columns: [{ key: 'title', label: '제목', type: 'text', path: 'css:.tit' }] }),
      { host: HOST },
    )
    expect(r.ok).toBe(false)
  })

  it('페이지 상한을 넘기면 거절한다 (ADR A12)', () => {
    const r = parseDiscoveryOutput(
      jsonOutput({ pagination: { kind: 'page_param', param: 'page', start: 1, max_pages: 50 } }),
      { host: HOST },
    )
    expect(r.ok).toBe(false)
  })
})

describe('parseDiscoveryOutput — 표로 성립하는가', () => {
  it('칸 이름이 중복되면 거절한다', () => {
    const r = parseDiscoveryOutput(
      jsonOutput({
        columns: [
          { key: 'title', label: '제목', type: 'text', path: '$.a' },
          { key: 'title', label: '제목2', type: 'text', path: '$.b' },
        ],
      }),
      { host: HOST },
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.join()).toContain('중복')
  })

  it('식별자로 못 쓰는 칸 이름을 거절한다', () => {
    for (const key of ['마감일', 'Title', '1st', 'a-b', '']) {
      const r = parseDiscoveryOutput(
        jsonOutput({ columns: [{ key, label: '아무거나', type: 'text', path: '$.a' }] }),
        { host: HOST },
      )
      expect(r.ok, `key=${key}`).toBe(false)
    }
  })

  it('칸이 하나도 없으면 거절한다 — 빈 표를 주지 않는다 (보장선 B3)', () => {
    expect(parseDiscoveryOutput(jsonOutput({ columns: [] }), { host: HOST }).ok).toBe(false)
  })

  it('label 이 비면 key 로 채운다 — 빈 열 이름을 화면에 내보내지 않는다', () => {
    const r = parseDiscoveryOutput(
      jsonOutput({ columns: [{ key: 'title', label: '   ', type: 'text', path: '$.a' }] }),
      { host: HOST },
    )
    if (!r.ok) throw new Error('should parse')
    expect(r.schema[0]?.label).toBe('title')
  })

  it('required 를 안 주면 false 다', () => {
    const r = parseDiscoveryOutput(
      jsonOutput({ columns: [{ key: 'title', label: '제목', type: 'text', path: '$.a' }] }),
      { host: HOST },
    )
    if (!r.ok) throw new Error('should parse')
    expect(r.schema[0]?.required).toBe(false)
  })

  it('JSON 이 아니면 재생성 프롬프트에 쓸 문장을 돌려준다', () => {
    const r = parseDiscoveryOutput('설명을 곁들인 답변입니다', { host: HOST })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors[0]).toContain('JSON')
  })
})
