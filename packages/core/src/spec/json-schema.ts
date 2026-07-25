// 어댑터 스펙의 JSON Schema — Gemini 구조화 출력용 (기획서 14장 · 원칙 ②)
//
// > 어댑터 스펙의 JSON Schema 를 먼저 확정하고 그것을 프롬프트에 넣는다.
// > 스펙 타입이 코드·프롬프트·검증의 단일 출처가 된다.
//
// 이 파일이 그 문장을 구현한다. 출처는 언제나 spec.ts 의 zod 스키마다.
//
// ── Gemini responseSchema 가 못 먹는 것 ─────────────────────────────────
// Gemini 의 Schema 는 OpenAPI 3.0 부분집합이다. 다음을 지원하지 않는다:
//   `$ref` · `$defs` · `oneOf` · `allOf` · `const` · `additionalProperties` · `propertyNames`
// 그런데 zod → JSON Schema 변환은 판별 유니온을 `oneOf` + `const` 로,
// `z.record` 를 `additionalProperties` 로 낸다. 그대로는 못 쓴다.
//
// 그래서 두 갈래를 둔다:
//   1. `toGeminiSchema()`  — 일반 JSON Schema 를 Gemini 형태로 평탄화 (기계적 변환)
//   2. `buildAdapterSpecResponseSchema()` — 손으로 축약한 스펙 스키마 (실제로 보내는 것)
//
// 2번이 1번으로 안 되는 이유는 `fields` · `headers` · `map.mapping` 이 전부 `record` 라서다.
// 키 집합이 열려 있는 객체를 Gemini 스키마로 쓸 방법이 없다. 대신 `fields` 는
// **컬렉션 스키마의 필드 키를 그대로 properties 로 펼친다.** 우리는 그 키를 이미 알고 있고,
// 그러면 LLM 이 없는 필드를 지어낼 여지도 같이 사라진다.
//
// 손으로 축약했으므로 spec.ts 와 어긋날 수 있다. 그 위험은 두 곳에서 막는다:
//   - `parseGeminiSpecOutput()` — 받은 출력을 **반드시** zod 로 다시 파싱해 검증한다
//   - json-schema.test.ts — 축약 스키마가 허용하는 예시가 zod 를 통과하는지 본다

import { z } from 'zod'
import type { CollectionSchemaJson } from '../types/collection'
import { TRANSFORM_OPS } from './ops'
import { AdapterSpecSchema, CURRENT_SPEC_VERSION, MAX_PAGES } from './spec'
import type { SpecValidationOptions, SpecValidationResult } from './validate'
import { validateSpec } from './validate'

// ── Gemini Schema 타입 ─────────────────────────────────────────────────

export type GeminiType = 'STRING' | 'NUMBER' | 'INTEGER' | 'BOOLEAN' | 'ARRAY' | 'OBJECT'

/** Gemini `responseSchema` 가 받는 형태 (OpenAPI 3.0 부분집합) */
export interface GeminiSchema {
  type?: GeminiType
  format?: string
  description?: string
  nullable?: boolean
  enum?: string[]
  items?: GeminiSchema
  properties?: Record<string, GeminiSchema>
  required?: string[]
  propertyOrdering?: string[]
  anyOf?: GeminiSchema[]
  minItems?: number
  maxItems?: number
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  pattern?: string
}

// ── 1. zod → JSON Schema (문서·다른 소비자용) ──────────────────────────

/**
 * spec.ts 의 zod 스키마를 표준 JSON Schema 로. 이건 **평탄화 전** 원본이다.
 * `oneOf` · `const` · `additionalProperties` 가 그대로 들어 있다.
 * @google/genai 의 `responseJsonSchema`(draft 2020-12 를 받는 쪽)에는 이걸 쓸 수 있다.
 */
export function adapterSpecJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(AdapterSpecSchema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>
}

// ── 2. 일반 JSON Schema → Gemini Schema (기계적 평탄화) ────────────────

const DROPPED_KEYWORDS = new Set([
  '$schema',
  '$id',
  '$defs',
  '$comment',
  'definitions',
  'additionalProperties',
  'unevaluatedProperties',
  'propertyNames',
  'patternProperties',
  'additionalItems',
  'not',
  'if',
  'then',
  'else',
  'dependentSchemas',
  'dependentRequired',
  'default',
  'examples',
  'readOnly',
  'writeOnly',
  'title',
])

/**
 * `$ref` 를 펼치고, Gemini 가 못 먹는 키워드를 떨어뜨리고, `oneOf` → `anyOf` · `const` → `enum` 으로.
 * 타입 이름은 대문자로 바꾼다 (`"string"` → `"STRING"`).
 */
export function toGeminiSchema(jsonSchema: unknown): GeminiSchema {
  const root = asRecord(jsonSchema) ?? {}
  const defs = { ...(asRecord(root['$defs']) ?? {}), ...(asRecord(root['definitions']) ?? {}) }
  return convert(root, defs, 0)
}

function convert(node: Record<string, unknown>, defs: Record<string, unknown>, depth: number): GeminiSchema {
  if (depth > 24) return { type: 'STRING' } // 순환 방어 — 스펙 스키마에는 없지만 방어는 싸다

  const ref = node['$ref']
  if (typeof ref === 'string') {
    const resolved = resolveRef(ref, defs)
    if (resolved) return convert(resolved, defs, depth + 1)
    return { type: 'STRING' }
  }

  // allOf 는 얕게 병합한다 (스펙 스키마에서는 refine 조합 때만 나온다)
  const allOf = node['allOf']
  if (Array.isArray(allOf)) {
    const merged: Record<string, unknown> = { ...node }
    delete merged['allOf']
    for (const part of allOf) {
      const rec = asRecord(part)
      if (rec) Object.assign(merged, rec)
    }
    return convert(merged, defs, depth + 1)
  }

  const out: GeminiSchema = {}

  // 타입
  const rawType = node['type']
  if (typeof rawType === 'string') {
    const t = geminiType(rawType)
    if (t) out.type = t
    if (rawType === 'null') out.nullable = true
  } else if (Array.isArray(rawType)) {
    const names = rawType.filter((t): t is string => typeof t === 'string')
    if (names.includes('null')) out.nullable = true
    const first = names.find((t) => t !== 'null')
    const t = first ? geminiType(first) : undefined
    if (t) out.type = t
  }

  // const → enum (Gemini 는 const 를 모른다)
  const constValue = node['const']
  if (constValue !== undefined) {
    out.type = 'STRING'
    out.enum = [String(constValue)]
  }

  const enumValues = node['enum']
  if (Array.isArray(enumValues)) {
    out.type = 'STRING'
    out.enum = enumValues.map((v) => String(v))
  }

  // 유니온 — oneOf 도 anyOf 로 접는다
  for (const key of ['anyOf', 'oneOf'] as const) {
    const branches = node[key]
    if (Array.isArray(branches)) {
      const converted = branches
        .map((b) => asRecord(b))
        .filter((b): b is Record<string, unknown> => b !== null)
        .filter((b) => b['type'] !== 'null')
        .map((b) => convert(b, defs, depth + 1))
      if (converted.length === 1) {
        const only = converted[0]
        if (only) Object.assign(out, only)
      } else if (converted.length > 1) {
        out.anyOf = converted
      }
      if (branches.some((b) => asRecord(b)?.['type'] === 'null')) out.nullable = true
    }
  }

  // 객체
  const properties = asRecord(node['properties'])
  if (properties) {
    const props: Record<string, GeminiSchema> = {}
    for (const [key, value] of Object.entries(properties)) {
      const rec = asRecord(value)
      if (rec) props[key] = convert(rec, defs, depth + 1)
    }
    out.properties = props
    out.propertyOrdering = Object.keys(props)
    if (!out.type) out.type = 'OBJECT'
  }
  const required = node['required']
  if (Array.isArray(required)) {
    const names = required.filter((r): r is string => typeof r === 'string')
    if (names.length > 0) out.required = names
  }

  // 배열
  const items = asRecord(node['items'])
  if (items) {
    out.items = convert(items, defs, depth + 1)
    if (!out.type) out.type = 'ARRAY'
  }

  // 그대로 넘기는 제약
  copyNumber(node, out, 'minItems')
  copyNumber(node, out, 'maxItems')
  copyNumber(node, out, 'minLength')
  copyNumber(node, out, 'maxLength')
  copyNumber(node, out, 'minimum')
  copyNumber(node, out, 'maximum')
  if (typeof node['exclusiveMinimum'] === 'number') out.minimum = node['exclusiveMinimum']
  if (typeof node['exclusiveMaximum'] === 'number') out.maximum = node['exclusiveMaximum']
  if (typeof node['pattern'] === 'string') out.pattern = node['pattern']
  if (typeof node['description'] === 'string') out.description = node['description']
  if (typeof node['format'] === 'string') out.format = node['format']

  // 남은 키워드는 조용히 버린다 (버려도 되는 것만 DROPPED_KEYWORDS 에 있다는 전제)
  void DROPPED_KEYWORDS

  return out
}

function geminiType(name: string): GeminiType | undefined {
  switch (name) {
    case 'string':
      return 'STRING'
    case 'number':
      return 'NUMBER'
    case 'integer':
      return 'INTEGER'
    case 'boolean':
      return 'BOOLEAN'
    case 'array':
      return 'ARRAY'
    case 'object':
      return 'OBJECT'
    default:
      return undefined
  }
}

function resolveRef(ref: string, defs: Record<string, unknown>): Record<string, unknown> | null {
  const m = /^#\/(?:\$defs|definitions)\/(.+)$/.exec(ref)
  const name = m?.[1]
  if (name === undefined) return null
  return asRecord(defs[name])
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function copyNumber(from: Record<string, unknown>, to: GeminiSchema, key: keyof GeminiSchema & string): void {
  const v = from[key]
  if (typeof v === 'number' && Number.isFinite(v)) {
    ;(to as Record<string, unknown>)[key] = v
  }
}

// ── 3. 손으로 축약한 responseSchema (실제로 보내는 것) ─────────────────

/**
 * Gemini responseSchema 에서 뺀 연산자.
 * `map` 의 `mapping` 은 키가 열린 record 라 Gemini 스키마로 표현할 수 없다.
 * enum 값 매핑은 어차피 컬렉션 필드의 `mapping` 으로 정규화 단계에서 처리되므로
 * 최초 컴파일 출력에서는 빠져도 손해가 없다. 사람이 손댄 스펙(origin `human`)이나
 * 치유가 만든 스펙에서는 여전히 쓸 수 있다 — zod 스키마에는 남아 있다.
 */
export const GEMINI_OMITTED_OPS = ['map'] as const

/** Gemini 스키마로 표현할 수 있는 헤더만. record 를 못 쓰므로 흔한 것만 열어둔다 */
export const GEMINI_ALLOWED_HEADERS = ['Accept', 'Content-Type', 'Referer', 'X-Requested-With'] as const

const S = (description: string, extra: Partial<GeminiSchema> = {}): GeminiSchema => ({
  type: 'STRING',
  description,
  ...extra,
})

function opSchema(
  name: string,
  description: string,
  properties: Record<string, GeminiSchema> = {},
  required: string[] = [],
): GeminiSchema {
  const props: Record<string, GeminiSchema> = {
    op: { type: 'STRING', enum: [name], description },
    ...properties,
  }
  return {
    type: 'OBJECT',
    description,
    properties: props,
    propertyOrdering: Object.keys(props),
    required: ['op', ...required],
  }
}

function transformOpSchemas(): GeminiSchema[] {
  return [
    opSchema('trim', '앞뒤 공백을 없앤다'),
    opSchema('collapse_space', '연속된 공백과 줄바꿈을 스페이스 하나로 접는다'),
    opSchema(
      'regex_extract',
      '정규식에 맞는 부분만 잘라낸다',
      {
        pattern: S('자바스크립트 정규식'),
        flags: S('정규식 플래그. 예: i, g'),
        group: { type: 'INTEGER', description: '캡처 그룹 번호. 0 이면 매치 전체', minimum: 0, maximum: 20 },
      },
      ['pattern'],
    ),
    opSchema(
      'replace',
      '정규식에 맞는 부분을 다른 문자열로 바꾼다',
      { pattern: S('자바스크립트 정규식'), replacement: S('바꿀 문자열'), flags: S('정규식 플래그') },
      ['pattern', 'replacement'],
    ),
    opSchema(
      'split',
      '구분자로 자른 뒤 n 번째 조각을 쓴다',
      { separator: S('구분자'), index: { type: 'INTEGER', description: '0 부터. 음수는 뒤에서부터' } },
      ['separator', 'index'],
    ),
    opSchema('date_parse', '날짜 문자열을 YYYY-MM-DD 로 바꾼다', {
      formats: {
        type: 'ARRAY',
        description: '시도할 포맷 후보. 예: ["YYYYMMDD", "YYYY.MM.DD"]',
        items: { type: 'STRING' },
        maxItems: 8,
      },
      timezone: S('IANA 타임존. 기본 Asia/Seoul'),
    }),
    opSchema('number_parse', '콤마와 단위를 없애고 숫자로 바꾼다'),
    opSchema(
      'multiply',
      '단위 승수를 곱한다. 천원이면 1000, 만원이면 10000, 억이면 100000000',
      { by: { type: 'NUMBER', description: '곱할 값' } },
      ['by'],
    ),
    opSchema('absolute_url', '상대 주소를 절대 주소로 바꾼다', {
      base: S('기준 주소. 없으면 fetch.url 을 기준으로 삼는다'),
    }),
    opSchema(
      'template',
      '{value} 자리에 값을 끼워 넣어 주소 등을 조립한다',
      { value: S('{value} 자리표시자를 반드시 포함해야 한다') },
      ['value'],
    ),
    opSchema('default', '앞 단계가 실패했거나 값이 비었을 때 쓸 기본값', { value: S('기본값') }, ['value']),
    opSchema('join', '값이 여러 개일 때 하나의 문자열로 이어붙인다', { separator: S('구분자. 기본 ", "') }),
  ]
}

function fieldSpecSchema(fieldType: string, label: string): GeminiSchema {
  const props: Record<string, GeminiSchema> = {
    path: S(`'${label}' 값이 있는 위치. json 모드면 $. 로 시작하는 JSONPath, 아니면 css: 로 시작하는 CSS 선택자`),
    type: { type: 'STRING', enum: [fieldType], description: '이 필드의 타입' },
    transform: {
      type: 'ARRAY',
      description: '위에서부터 순서대로 적용할 변환. 필요 없으면 비운다',
      items: { anyOf: transformOpSchemas() },
      maxItems: 8,
    },
  }
  return {
    type: 'OBJECT',
    description: `'${label}' 필드를 뽑는 방법`,
    properties: props,
    propertyOrdering: Object.keys(props),
    required: ['path', 'type'],
  }
}

function fetchSchemas(): GeminiSchema[] {
  const headerProps: Record<string, GeminiSchema> = {}
  for (const name of GEMINI_ALLOWED_HEADERS) headerProps[name] = S(`${name} 헤더 값`)

  const json: Record<string, GeminiSchema> = {
    mode: { type: 'STRING', enum: ['json'], description: '내부 JSON 엔드포인트를 찾은 경우' },
    url: S('요청할 주소. 페이지를 넘겨야 하면 {page} 자리표시자를 넣는다'),
    method: { type: 'STRING', enum: ['GET', 'POST'], description: 'HTTP 메서드' },
    headers: {
      type: 'OBJECT',
      description: '요청 헤더',
      properties: headerProps,
      propertyOrdering: Object.keys(headerProps),
    },
  }
  const html: Record<string, GeminiSchema> = {
    mode: { type: 'STRING', enum: ['html'], description: 'HTML 을 그대로 받아 파싱하는 경우' },
    url: S('요청할 주소. 페이지를 넘겨야 하면 {page} 자리표시자를 넣는다'),
  }
  const browser: Record<string, GeminiSchema> = {
    mode: { type: 'STRING', enum: ['browser'], description: '자바스크립트가 그려야 목록이 보이는 경우' },
    url: S('열어볼 주소'),
    wait_for: S("'networkidle' 이거나 기다릴 css: 선택자"),
  }

  return [
    { type: 'OBJECT', properties: json, propertyOrdering: Object.keys(json), required: ['mode', 'url'] },
    { type: 'OBJECT', properties: html, propertyOrdering: Object.keys(html), required: ['mode', 'url'] },
    { type: 'OBJECT', properties: browser, propertyOrdering: Object.keys(browser), required: ['mode', 'url'] },
  ]
}

function paginationSchemas(): GeminiSchema[] {
  const maxPages: GeminiSchema = {
    type: 'INTEGER',
    description: `읽을 페이지 수. ${MAX_PAGES} 이하`,
    minimum: 1,
    maximum: MAX_PAGES,
  }
  const pageParam: Record<string, GeminiSchema> = {
    kind: { type: 'STRING', enum: ['page_param'], description: '쿼리 파라미터로 페이지를 넘긴다' },
    param: S('페이지 번호 파라미터 이름'),
    start: { type: 'INTEGER', description: '첫 페이지 번호. 보통 1', minimum: 0 },
    max_pages: maxPages,
  }
  const nextLink: Record<string, GeminiSchema> = {
    kind: { type: 'STRING', enum: ['next_link'], description: '다음 페이지 링크를 따라간다' },
    path: S('다음 페이지 링크의 위치'),
    max_pages: maxPages,
  }
  const scroll: Record<string, GeminiSchema> = {
    kind: { type: 'STRING', enum: ['scroll'], description: '무한 스크롤. browser 모드에서만 쓴다' },
    times: { type: 'INTEGER', description: '스크롤 횟수', minimum: 1, maximum: MAX_PAGES },
  }
  const none: Record<string, GeminiSchema> = {
    kind: { type: 'STRING', enum: ['none'], description: '한 페이지가 전부다' },
  }

  return [
    { type: 'OBJECT', properties: pageParam, propertyOrdering: Object.keys(pageParam), required: ['kind', 'param'] },
    { type: 'OBJECT', properties: nextLink, propertyOrdering: Object.keys(nextLink), required: ['kind', 'path'] },
    { type: 'OBJECT', properties: scroll, propertyOrdering: Object.keys(scroll), required: ['kind'] },
    { type: 'OBJECT', properties: none, propertyOrdering: Object.keys(none), required: ['kind'] },
  ]
}

export interface ResponseSchemaOptions {
  /** 컬렉션 스키마. `fields` 를 이 키들로 펼친다 — LLM 이 없는 필드를 지어낼 여지를 없앤다 */
  schema: CollectionSchemaJson
}

/**
 * Gemini `responseSchema` 로 그대로 넘길 수 있는 스키마.
 * 컬렉션 스키마를 받아 `fields` 를 그 필드 키로 펼친다.
 */
export function buildAdapterSpecResponseSchema(opts: ResponseSchemaOptions): GeminiSchema {
  const fieldProps: Record<string, GeminiSchema> = {}
  const requiredFields: string[] = []
  for (const field of opts.schema) {
    fieldProps[field.key] = fieldSpecSchema(field.type, field.label)
    if (field.required) requiredFields.push(field.key)
  }

  const fields: GeminiSchema = {
    type: 'OBJECT',
    description: '표의 각 칸을 어디서 어떻게 뽑는지',
    properties: fieldProps,
    propertyOrdering: Object.keys(fieldProps),
    ...(requiredFields.length > 0 ? { required: requiredFields } : {}),
  }

  const props: Record<string, GeminiSchema> = {
    spec_version: { type: 'INTEGER', description: `항상 ${CURRENT_SPEC_VERSION}`, minimum: 1 },
    fetch: { description: '무엇을 어떻게 받아올지', anyOf: fetchSchemas() },
    list: S('항목 하나하나를 집는 위치. 예: $.data.items[*] 또는 css:.contest-list > li'),
    dedupe_key: S('항목의 고유 식별자 위치. 안정적인 것이 없으면 넣지 않는다'),
    fields,
    pagination: { description: '페이지를 어떻게 넘길지', anyOf: paginationSchemas() },
  }

  return {
    type: 'OBJECT',
    description: '목록 페이지에서 표를 뽑아내는 방법',
    properties: props,
    propertyOrdering: Object.keys(props),
    required: ['spec_version', 'fetch', 'list', 'fields', 'pagination'],
  }
}

// ── 4. 되돌아오는 길 — 반드시 zod 로 다시 검증한다 ─────────────────────

/**
 * Gemini 출력(문자열 또는 이미 파싱된 객체)을 스펙으로 확정한다.
 *
 * 축약 스키마는 참고일 뿐이고 **진짜 관문은 여기다.** 스펙 타입의 단일 출처는
 * 언제나 spec.ts 의 zod 스키마이며, 실패 문장은 그대로 재생성 프롬프트로 되돌아간다
 * (기획서 11장 "오류 내용을 붙여 재생성 1회").
 */
export function parseGeminiSpecOutput(raw: unknown, opts: SpecValidationOptions): SpecValidationResult {
  let input: unknown = raw
  if (typeof raw === 'string') {
    try {
      input = JSON.parse(stripCodeFence(raw))
    } catch {
      return { ok: false, errors: ['JSON 형식이 아닙니다. 설명 없이 JSON 객체 하나만 내주세요'] }
    }
  }
  return validateSpec(input, opts)
}

/** 모델이 ```json 울타리를 붙여 보내는 경우가 있다 */
function stripCodeFence(text: string): string {
  const trimmed = text.trim()
  const m = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/.exec(trimmed)
  return m?.[1] ?? trimmed
}

/** 프롬프트에 같이 넣을 연산자 목록 — ops.ts 의 닫힌 집합에서 그대로 온다 */
export const PROMPTABLE_TRANSFORM_OPS: readonly string[] = TRANSFORM_OPS.filter(
  (op) => !(GEMINI_OMITTED_OPS as readonly string[]).includes(op),
)
