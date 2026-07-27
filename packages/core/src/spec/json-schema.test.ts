// Gemini responseSchema 생성 테스트 (기획서 14장)
//
// > 어댑터 스펙의 JSON Schema 를 먼저 확정하고 그것을 프롬프트에 넣는다.
// > 스펙 타입이 코드·프롬프트·검증의 단일 출처가 된다.
//
// 손으로 축약한 스키마는 spec.ts 와 어긋날 수 있다. 그래서 여기서 두 가지를 본다:
//   1. 축약 스키마가 Gemini 제약(= $ref·oneOf·const·additionalProperties 없음)을 지키는가
//   2. 축약 스키마 모양대로 만든 출력이 zod 를 통과하는가 (= 어긋나지 않았는가)

import { describe, expect, it } from 'vitest'
import type { CollectionSchemaJson } from '../types/collection'
import { CollectionSchemaJsonSchema } from '../types/collection'
import type { GeminiSchema } from './json-schema'
import {
  adapterSpecJsonSchema,
  buildAdapterSpecResponseSchema,
  GEMINI_OMITTED_OPS,
  parseGeminiSpecOutput,
  PROMPTABLE_TRANSFORM_OPS,
  toGeminiSchema,
} from './json-schema'
import { TRANSFORM_OPS } from './ops'

/** G0 시드 컬렉션의 스키마 (브리프 계약 (4)) */
const SEED_SCHEMA: CollectionSchemaJson = CollectionSchemaJsonSchema.parse([
  { key: 'title', label: '공고명', type: 'text', required: true },
  { key: 'organization', label: '주관기관', type: 'text' },
  { key: 'deadline', label: '마감일', type: 'date' },
  { key: 'amount', label: '지원금', type: 'money' },
  { key: 'category', label: '분야', type: 'enum', mapping: { 기술개발: 'rnd' }, value_labels: null },
  { key: 'link', label: '원문 링크', type: 'link', required: true },
])

const HOST = 'k-startup.go.kr'

// ── 1. zod → JSON Schema ───────────────────────────────────────────────

describe('adapterSpecJsonSchema — 단일 출처는 언제나 spec.ts 의 zod 스키마', () => {
  const schema = adapterSpecJsonSchema()

  it('객체 스키마가 나온다', () => {
    expect(schema['type']).toBe('object')
    expect(schema['properties']).toBeTypeOf('object')
  })

  it('스펙의 최상위 키가 다 들어 있다', () => {
    const props = schema['properties'] as Record<string, unknown>
    for (const key of ['spec_version', 'fetch', 'list', 'dedupe_key', 'fields', 'pagination']) {
      expect(props[key]).toBeDefined()
    }
  })

  it('input 기준이므로 기본값이 있는 키는 필수가 아니다', () => {
    const required = (schema['required'] ?? []) as string[]
    expect(required).toContain('fetch')
    expect(required).toContain('list')
    expect(required).not.toContain('pagination')
  })
})

// ── 2. 기계적 평탄화 ───────────────────────────────────────────────────

describe('toGeminiSchema — Gemini 가 못 먹는 키워드를 평탄화한다', () => {
  it('타입 이름을 대문자로 바꾼다', () => {
    expect(toGeminiSchema({ type: 'string' })).toEqual({ type: 'STRING' })
    expect(toGeminiSchema({ type: 'integer' }).type).toBe('INTEGER')
  })

  it('$ref 를 $defs 에서 펼친다', () => {
    const out = toGeminiSchema({
      $defs: { Node: { type: 'string', description: '노드' } },
      type: 'object',
      properties: { a: { $ref: '#/$defs/Node' } },
    })
    expect(out.properties?.['a']).toEqual({ type: 'STRING', description: '노드' })
  })

  it('oneOf 를 anyOf 로 접는다', () => {
    const out = toGeminiSchema({ oneOf: [{ type: 'string' }, { type: 'number' }] })
    expect(out.anyOf).toHaveLength(2)
  })

  it('const 를 단일 값 enum 으로 바꾼다', () => {
    expect(toGeminiSchema({ const: 'json' })).toEqual({ type: 'STRING', enum: ['json'] })
  })

  it('additionalProperties 같은 키워드는 떨어뜨린다', () => {
    const out = toGeminiSchema({ type: 'object', additionalProperties: { type: 'string' } })
    expect(JSON.stringify(out)).not.toContain('additionalProperties')
  })

  it('nullable 유니온은 nullable 플래그로', () => {
    const out = toGeminiSchema({ anyOf: [{ type: 'string' }, { type: 'null' }] })
    expect(out.type).toBe('STRING')
    expect(out.nullable).toBe(true)
  })

  it('배열의 items 도 따라 내려간다', () => {
    const out = toGeminiSchema({ type: 'array', items: { type: 'string' }, maxItems: 8 })
    expect(out.items?.type).toBe('STRING')
    expect(out.maxItems).toBe(8)
  })

  it('실제 스펙 스키마를 넣어도 던지지 않는다', () => {
    expect(() => toGeminiSchema(adapterSpecJsonSchema())).not.toThrow()
  })
})

// ── 3. 실제로 보내는 축약 스키마 ───────────────────────────────────────

function walkSchema(schema: GeminiSchema, visit: (node: GeminiSchema) => void): void {
  visit(schema)
  for (const child of Object.values(schema.properties ?? {})) walkSchema(child, visit)
  for (const branch of schema.anyOf ?? []) walkSchema(branch, visit)
  if (schema.items) walkSchema(schema.items, visit)
}

describe('buildAdapterSpecResponseSchema', () => {
  const schema = buildAdapterSpecResponseSchema({ schema: SEED_SCHEMA })
  const serialized = JSON.stringify(schema)

  it('Gemini 가 못 먹는 키워드가 하나도 없다', () => {
    for (const keyword of ['$ref', '$defs', 'oneOf', 'allOf', '"const"', 'additionalProperties', 'propertyNames']) {
      expect(serialized).not.toContain(keyword)
    }
  })

  it('타입 이름은 전부 대문자다', () => {
    const allowed = new Set(['STRING', 'NUMBER', 'INTEGER', 'BOOLEAN', 'ARRAY', 'OBJECT'])
    walkSchema(schema, (node) => {
      if (node.type !== undefined) expect(allowed.has(node.type)).toBe(true)
    })
  })

  it('fields 를 컬렉션 스키마의 키로 펼친다 — LLM 이 없는 필드를 지어낼 여지를 없앤다', () => {
    const fields = schema.properties?.['fields']
    expect(Object.keys(fields?.properties ?? {})).toEqual([
      'title',
      'organization',
      'deadline',
      'amount',
      'category',
      'link',
    ])
  })

  it('required 필드만 required 로 올라간다', () => {
    expect(schema.properties?.['fields']?.required).toEqual(['title', 'link'])
  })

  it('필드의 type 은 컬렉션 스키마 값으로 고정된다', () => {
    expect(schema.properties?.['fields']?.properties?.['deadline']?.properties?.['type']?.enum).toEqual(['date'])
  })

  it('fetch 는 세 모드의 anyOf 다', () => {
    const modes = (schema.properties?.['fetch']?.anyOf ?? []).map((b) => b.properties?.['mode']?.enum?.[0])
    expect(modes).toEqual(['json', 'html', 'browser'])
  })

  it('pagination 은 네 종류의 anyOf 다', () => {
    const kinds = (schema.properties?.['pagination']?.anyOf ?? []).map((b) => b.properties?.['kind']?.enum?.[0])
    expect(kinds).toEqual(['page_param', 'next_link', 'scroll', 'none'])
  })

  it('max_pages 상한이 스키마에도 박혀 있다 (ADR A12)', () => {
    const pageParam = schema.properties?.['pagination']?.anyOf?.[0]
    expect(pageParam?.properties?.['max_pages']?.maximum).toBe(3)
  })

  it('변환 연산자 목록은 ops.ts 의 닫힌 집합에서 온다', () => {
    const transform = schema.properties?.['fields']?.properties?.['title']?.properties?.['transform']
    const names = (transform?.items?.anyOf ?? []).map((b) => b.properties?.['op']?.enum?.[0])
    expect(names).toEqual([...PROMPTABLE_TRANSFORM_OPS])
  })

  it('map 만 뺐고, 나머지 11종은 그대로다', () => {
    expect([...GEMINI_OMITTED_OPS]).toEqual(['map'])
    expect(PROMPTABLE_TRANSFORM_OPS).toHaveLength(TRANSFORM_OPS.length - 1)
    expect(PROMPTABLE_TRANSFORM_OPS).not.toContain('map')
  })

  it('스키마에 필드가 하나뿐이어도 만들어진다', () => {
    const one = CollectionSchemaJsonSchema.parse([{ key: 'title', label: '제목', type: 'text', required: true }])
    expect(buildAdapterSpecResponseSchema({ schema: one }).properties?.['fields']?.required).toEqual(['title'])
  })
})

// ── 4. 되돌아오는 길 — 진짜 관문은 zod 다 ──────────────────────────────

describe('parseGeminiSpecOutput', () => {
  const output = {
    spec_version: 1,
    fetch: {
      mode: 'json',
      url: 'https://www.k-startup.go.kr/api/pbanc/list?page={page}',
      method: 'GET',
      headers: { Accept: 'application/json' },
    },
    list: '$.data.items[*]',
    dedupe_key: '$.pbancSn',
    fields: {
      title: { path: '$.pbancNm', type: 'text', transform: [{ op: 'trim' }] },
      link: {
        path: '$.pbancSn',
        type: 'link',
        transform: [{ op: 'template', value: 'https://www.k-startup.go.kr/detail?sn={value}' }],
      },
    },
    pagination: { kind: 'page_param', param: 'page', start: 1, max_pages: 3 },
  }

  it('축약 스키마 모양대로 만든 출력이 zod 를 통과한다 (두 스키마가 안 어긋난다)', () => {
    const result = parseGeminiSpecOutput(output, { host: HOST })
    expect(result.ok).toBe(true)
  })

  it('객체를 그대로 줘도 되고 문자열로 줘도 된다', () => {
    expect(parseGeminiSpecOutput(JSON.stringify(output), { host: HOST }).ok).toBe(true)
  })

  it('```json 울타리를 벗겨낸다', () => {
    const fenced = '```json\n' + JSON.stringify(output) + '\n```'
    expect(parseGeminiSpecOutput(fenced, { host: HOST }).ok).toBe(true)
  })

  it('울타리에 언어 표시가 없어도 된다', () => {
    const fenced = '```\n' + JSON.stringify(output) + '\n```'
    expect(parseGeminiSpecOutput(fenced, { host: HOST }).ok).toBe(true)
  })

  it('JSON 이 아니면 재생성 프롬프트에 넣을 문장을 돌려준다', () => {
    const result = parseGeminiSpecOutput('죄송합니다. 이 페이지는 분석할 수 없습니다.', { host: HOST })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]).toContain('JSON')
  })

  it('스키마를 같이 주면 required 필드까지 본다', () => {
    const partial = { ...output, fields: { title: output.fields.title } }
    const result = parseGeminiSpecOutput(partial, { host: HOST, schema: SEED_SCHEMA })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toContain("'link'")
  })

  it('호스트가 다르면 여기서 끊긴다 (컴파일 출력도 계약 검사를 거친다)', () => {
    expect(parseGeminiSpecOutput(output, { host: 'bizinfo.go.kr' }).ok).toBe(false)
  })
})
