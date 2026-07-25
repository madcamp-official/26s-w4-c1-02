// 어댑터 스펙 — LLM 이 만드는 것은 코드가 아니라 이 JSON 이다 (기획서 11장 · 원칙 ② · ADR A2)
//
// 이 스키마가 단일 출처다. 세 곳이 같은 정의를 본다:
//   1. `packages/core` 의 해석기 (스펙을 읽어 실행)
//   2. 검증기 (실행 전 형태 검사 — 기획서 11장 "스펙 검증")
//   3. Gemini 구조화 출력(`responseSchema`) 프롬프트
//
// ── 경로 문법 ──────────────────────────────────────────────────────────
//   JSONPath : `$.` 로 시작한다.        예) `$.data.items[*]`, `$.pbancSn`
//   CSS      : `css:` 접두사를 붙인다.  예) `css:.contest-list > li`
//   속성 추출: CSS 뒤에 `@속성`.        예) `css:a@href`
// fetch.mode 가 json 이면 모든 경로가 JSONPath, html·browser 면 모든 경로가 CSS 여야 한다.

import { z } from 'zod'
import { FieldTypeSchema, FIELD_KEY_PATTERN } from '../types/collection'
import { TransformPipelineSchema } from './ops'

/** 현재 스펙 버전. 구조가 바뀌면 올린다 */
export const CURRENT_SPEC_VERSION = 1

/** 페이지네이션 상한 (ADR A12 — 5일 범위에서 무한 크롤 금지) */
export const MAX_PAGES = 3

// ── 경로 문법 ──────────────────────────────────────────────────────────

/** `$` 또는 `$.`/`$[` 로 시작하는 JSONPath */
export const JSONPATH_PATTERN = /^\$(?:$|[.[])/
/** `css:선택자` 뒤에 선택적으로 `@속성` */
export const CSS_PATH_PATTERN = /^css:\s*(?<selector>[^@]+?)\s*(?:@(?<attr>[A-Za-z_:][-A-Za-z0-9_:.]*))?$/

export function isJsonPath(path: string): boolean {
  return JSONPATH_PATTERN.test(path)
}

export function isCssPath(path: string): boolean {
  return CSS_PATH_PATTERN.test(path)
}

/** `css:a@href` → `{ selector: 'a', attr: 'href' }`. CSS 경로가 아니면 null */
export function parseCssPath(path: string): { selector: string; attr: string | null } | null {
  const m = CSS_PATH_PATTERN.exec(path)
  const selector = m?.groups?.['selector']
  if (!selector) return null
  return { selector, attr: m?.groups?.['attr'] ?? null }
}

/** JSONPath 이거나 CSS 경로. 어느 쪽이어야 하는지는 fetch.mode 가 정한다 */
export const PathSchema = z
  .string()
  .min(1)
  .refine((p) => isJsonPath(p) || isCssPath(p), {
    message: "경로는 '$.' 로 시작하는 JSONPath 이거나 'css:' 로 시작하는 CSS 선택자여야 합니다",
  })

const HttpUrlSchema = z
  .string()
  .min(1)
  .refine((u) => /^https?:\/\//.test(u), { message: 'URL 은 http:// 또는 https:// 로 시작해야 합니다' })

// ── fetch (mode 판별 유니온) ───────────────────────────────────────────

/** 내부 JSON 엔드포인트를 찾은 경우 (원칙 ③ — 가장 안정적인 경로) */
export const JsonFetchSpecSchema = z.strictObject({
  mode: z.literal('json'),
  /** `{page}` 자리표시자를 쓸 수 있다 */
  url: HttpUrlSchema,
  method: z.enum(['GET', 'POST']).default('GET'),
  headers: z.record(z.string(), z.string()).default({}),
})

/** HTML 폴백 */
export const HtmlFetchSpecSchema = z.strictObject({
  mode: z.literal('html'),
  url: HttpUrlSchema,
})

/** Playwright 로 열고 `wait_for` 후 DOM 을 잡는다 */
export const BrowserFetchSpecSchema = z.strictObject({
  mode: z.literal('browser'),
  url: HttpUrlSchema,
  /** `networkidle` 이거나 기다릴 CSS 선택자 (`css:` 접두사 포함) */
  wait_for: z
    .union([z.literal('networkidle'), z.string().refine(isCssPath, { message: "선택자는 'css:' 로 시작해야 합니다" })])
    .default('networkidle'),
})

export const FetchSpecSchema = z.discriminatedUnion('mode', [
  JsonFetchSpecSchema,
  HtmlFetchSpecSchema,
  BrowserFetchSpecSchema,
])

export type FetchSpec = z.infer<typeof FetchSpecSchema>
export type JsonFetchSpec = z.infer<typeof JsonFetchSpecSchema>
export type HtmlFetchSpec = z.infer<typeof HtmlFetchSpecSchema>
export type BrowserFetchSpec = z.infer<typeof BrowserFetchSpecSchema>

// ── pagination (kind 판별 유니온) ──────────────────────────────────────

export const PAGINATION_KINDS = ['page_param', 'next_link', 'scroll', 'none'] as const
export type PaginationKind = (typeof PAGINATION_KINDS)[number]
export const PaginationKindSchema = z.enum(PAGINATION_KINDS)

/** 상한은 ADR A12 로 고정. LLM 이 더 큰 값을 내면 파싱 단계에서 거부된다 */
const MaxPagesSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_PAGES, `한 번에 ${MAX_PAGES}페이지를 넘겨 읽지 않습니다`)
  .default(MAX_PAGES)

/** `?page=1` 처럼 쿼리 파라미터로 페이지를 넘긴다. fetch.url 에 `{page}` 가 있어야 한다 */
export const PageParamPaginationSchema = z.strictObject({
  kind: z.literal('page_param'),
  param: z.string().min(1),
  start: z.number().int().min(0).default(1),
  max_pages: MaxPagesSchema,
})

/** 다음 페이지 링크를 경로로 집는다 */
export const NextLinkPaginationSchema = z.strictObject({
  kind: z.literal('next_link'),
  path: PathSchema,
  max_pages: MaxPagesSchema,
})

/** 무한 스크롤 — browser 모드에서만 의미가 있다 */
export const ScrollPaginationSchema = z.strictObject({
  kind: z.literal('scroll'),
  times: z.number().int().min(1).max(MAX_PAGES).default(MAX_PAGES),
})

/** 한 페이지가 전부 */
export const NonePaginationSchema = z.strictObject({ kind: z.literal('none') })

export const PaginationSpecSchema = z.discriminatedUnion('kind', [
  PageParamPaginationSchema,
  NextLinkPaginationSchema,
  ScrollPaginationSchema,
  NonePaginationSchema,
])

export type PaginationSpec = z.infer<typeof PaginationSpecSchema>

// ── 필드 ───────────────────────────────────────────────────────────────

export const FieldSpecSchema = z.strictObject({
  /** JSONPath 또는 CSS 경로. fetch.mode 와 문법이 맞아야 한다 */
  path: PathSchema,
  type: FieldTypeSchema,
  /** 위에서부터 순서대로 적용되는 변환 파이프라인 (닫힌 집합) */
  transform: TransformPipelineSchema.optional(),
})

export type FieldSpec = z.infer<typeof FieldSpecSchema>

// ── 어댑터 스펙 ────────────────────────────────────────────────────────

const AdapterSpecObjectSchema = z.strictObject({
  spec_version: z.number().int().min(1).default(CURRENT_SPEC_VERSION),
  fetch: FetchSpecSchema,
  /** 목록 하나하나를 집는 경로. 예) `$.data.items[*]`, `css:.contest-list > li` */
  list: PathSchema,
  /**
   * 소스 안에서 안정적인 고유 키 (ADR A13).
   * 못 고르면 생략한다 — 해석기가 정규화된 title 해시로 폴백한다 (기획서 10장).
   */
  dedupe_key: PathSchema.optional(),
  /** 키는 컬렉션 스키마의 필드 키와 같다 */
  fields: z.record(z.string().regex(FIELD_KEY_PATTERN), FieldSpecSchema),
  pagination: PaginationSpecSchema.default({ kind: 'none' }),
})

/**
 * 실행 전 형태 검사를 통과한 어댑터 스펙 (기획서 11장 "스펙 검증").
 * 프롬프트 신뢰가 아니라 계약 검사다.
 */
export const AdapterSpecSchema = AdapterSpecObjectSchema.superRefine((spec, ctx) => {
  const mode = spec.fetch.mode
  const wantsJsonPath = mode === 'json'
  const expected = wantsJsonPath ? "JSONPath('$.' 로 시작)" : "CSS 경로('css:' 로 시작)"
  const ok = wantsJsonPath ? isJsonPath : isCssPath

  const check = (path: string, at: (string | number)[]): void => {
    if (!ok(path)) {
      ctx.addIssue({
        code: 'custom',
        path: at,
        message: `${mode} 모드에서는 경로가 ${expected} 여야 합니다`,
      })
    }
  }

  check(spec.list, ['list'])
  if (spec.dedupe_key !== undefined) check(spec.dedupe_key, ['dedupe_key'])
  for (const [key, field] of Object.entries(spec.fields)) {
    check(field.path, ['fields', key, 'path'])
  }
  if (spec.pagination.kind === 'next_link') {
    check(spec.pagination.path, ['pagination', 'path'])
  }

  if (Object.keys(spec.fields).length === 0) {
    ctx.addIssue({ code: 'custom', path: ['fields'], message: '필드가 하나도 없습니다' })
  }

  // page_param 은 URL 에 자리표시자가 있어야 실제로 페이지가 넘어간다
  if (spec.pagination.kind === 'page_param' && !spec.fetch.url.includes('{page}')) {
    ctx.addIssue({
      code: 'custom',
      path: ['fetch', 'url'],
      message: 'page_param 페이지네이션을 쓰려면 URL 에 {page} 자리표시자가 있어야 합니다',
    })
  }

  // 무한 스크롤은 브라우저를 띄워야만 가능하다
  if (spec.pagination.kind === 'scroll' && mode !== 'browser') {
    ctx.addIssue({
      code: 'custom',
      path: ['pagination', 'kind'],
      message: 'scroll 페이지네이션은 browser 모드에서만 쓸 수 있습니다',
    })
  }
})

export type AdapterSpec = z.infer<typeof AdapterSpecSchema>
/** 파싱 전 형태 (기본값이 아직 안 채워진 상태) — LLM 출력·저장된 JSON 을 받을 때 쓴다 */
export type AdapterSpecInput = z.input<typeof AdapterSpecSchema>

/**
 * `fetch.url` 의 호스트가 사용자가 준 호스트와 같은지 (기획서 11장 스펙 검증 첫 항목).
 * LLM 이 엉뚱한 사이트로 나가는 것을 막는다.
 */
export function specTargetsHost(spec: AdapterSpec, host: string): boolean {
  try {
    const actual = new URL(spec.fetch.url.replace('{page}', '1')).hostname.toLowerCase()
    const expected = host.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    return actual === expected || actual.endsWith(`.${expected}`) || expected.endsWith(`.${actual}`)
  } catch {
    return false
  }
}
