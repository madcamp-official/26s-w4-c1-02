// 공개 API 응답 계약 — 기획서 7장④ · 12장 · 트랙 계약 #3
// 이 형태는 트랙 A·B 가 공유한다. 혼자 바꾸면 상대 트랙이 조용히 깨진다.
//
// 경로: `GET /api/v1/{slug}` (배포 시 Caddy 가 api.example.com/* 로 붙인다)

import { z } from 'zod'
import type { FieldDef } from './collection'
import type { ItemProvenance, ItemRaw, ItemValue } from './item'
import { SourceStatusSchema, type SourceStatus } from './source'

/** 기본 페이지 크기와 상한 (기획서 12장 `?limit=`) */
export const DEFAULT_PAGE_LIMIT = 50
export const MAX_PAGE_LIMIT = 200

/** 응답 아이템에 붙는 메타 키 — 스키마 필드 키와 섞이지 않게 `_` 접두사를 쓴다 */
export interface ApiItemMeta {
  /** 출처 호스트명 */
  _source: string
  /** ISO 8601. 신규 판정 기준 (`?since=`) */
  _first_seen_at: string
  /** link 타입 필드가 있으면 그 값, 없으면 null */
  _link: string | null
  /** `?include=provenance` 일 때만 */
  _provenance?: ItemProvenance
  /** `?include=provenance` 일 때만 — 원문 대조용 원본 조각 */
  _raw?: ItemRaw
}

/** data_json 이 펼쳐진 형태 + 메타. 나머지 키는 컬렉션 스키마의 필드 키다 */
export type ApiItem = { [key: string]: ItemValue | ItemProvenance | ItemRaw | undefined } & ApiItemMeta

/**
 * 소스별 상태. 부분 성공이 1급 시민이다 (원칙 ④ · ADR A4).
 * `sources` 는 옵션이 아니라 **항상 포함된다.**
 */
export const SourceSummarySchema = z.object({
  status: SourceStatusSchema,
  /** 이번 응답에 이 소스가 기여한 아이템 수 */
  items: z.number().int().min(0),
  /** `healing` 일 때 마지막 성공 데이터의 나이. 예 "6h" */
  age: z.string().optional(),
  last_ok_at: z.string().nullable().optional(),
})

export interface SourceSummary {
  status: SourceStatus
  items: number
  age?: string
  last_ok_at?: string | null
}

/** `GET /api/v1/{slug}` 응답. G0 계약 (2) */
export interface CollectionResponse {
  items: ApiItem[]
  /** 키는 호스트명 */
  sources: Record<string, SourceSummary>
  schema_version: number
  page: { limit: number; next_cursor: string | null }
}

/** 실패도 사람 말로 낸다. HTTP 코드·스택 트레이스를 노출하지 않는다 (보장선 B4) */
export interface ApiErrorResponse {
  error: {
    /** 한국어 상태 문구 */
    message: string
    /** 클라이언트 분기용 기계 코드. 화면에 그대로 띄우지 않는다 */
    code: ApiErrorCode
  }
}

export const API_ERROR_CODES = ['not_found', 'unauthorized', 'bad_request', 'unavailable'] as const
export type ApiErrorCode = (typeof API_ERROR_CODES)[number]

// ── 쿼리 파라미터 (기획서 12장 표) ─────────────────────────────────────

export const SORT_PATTERN = /^-?[a-z][a-z0-9_]*$/

/**
 * 파싱된 쿼리. 구독의 `filter_json` 도 같은 형태를 저장한다
 * (표에서 건 필터 그대로 — 기획서 10장 `subscriptions.filter_json`).
 */
export const CollectionQuerySchema = z.object({
  /** 필드 완전일치. 예) `?category=rnd` */
  eq: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  /** date·number·money 타입에만. 예) `?deadline_gte=2026-08-01` */
  gte: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
  /** date·number·money 타입에만. 예) `?amount_lte=100000000` */
  lte: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
  /** text 타입 필드 전체 대상 검색 */
  q: z.string().optional(),
  /** 출처 호스트명 */
  source: z.string().optional(),
  /** `first_seen_at` 기준. ISO 날짜 */
  since: z.string().optional(),
  /** `deadline` / `-amount` — `-` 가 내림차순 */
  sort: z.string().regex(SORT_PATTERN).optional(),
  limit: z.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  cursor: z.string().nullable().default(null),
  /** `?include=provenance` */
  include: z.array(z.enum(['provenance'])).default([]),
})

export type CollectionQuery = z.infer<typeof CollectionQuerySchema>
/** 구독 조건 — 페이지네이션을 뺀 필터 부분만 저장한다 */
export type CollectionFilter = Omit<CollectionQuery, 'limit' | 'cursor' | 'include'>

// ── MCP 도구 응답 (기획서 12장) ────────────────────────────────────────

/** `get_schema` */
export interface SchemaResponse {
  slug: string
  name: string
  schema_version: number
  fields: FieldDef[]
}

/** `get_sources_status` — 원칙 ④ 가 MCP 에서도 노출되는 지점 */
export interface SourcesStatusResponse {
  sources: Record<string, SourceSummary>
}
