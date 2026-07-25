// 화면이 쓰는 조회 모음. 전부 lib/db.ts 의 safeQuery 를 거치므로 던지지 않는다.
//
// 왜 drizzle 대신 postgres.js 태그드 템플릿인가: apps/web 은 drizzle-orm 을 직접 의존하지
// 않는다(패키지 경계). core 가 내보내는 원시 클라이언트로 몇 줄만 읽으면 충분하고,
// 표 본문처럼 계약이 걸린 조회는 core 의 buildCollectionResponse 를 그대로 쓴다 —
// 화면과 공개 API 가 같은 코드로 돌아야 미리보기가 거짓말을 하지 않는다 (기획서 8장).

import {
  CollectionSchemaJsonSchema,
  type CollectionResponse,
  type CollectionSchemaJson,
  type FetchMode,
  type SourceStatus,
  type Visibility,
} from '@endpointer/core'
import { buildCollectionResponse, parseCollectionQuery } from '@endpointer/core/query'

import { safeQuery, type Loaded } from './db'

// ── 행 모양 ──────────────────────────────────────────────────────────────

export interface CollectionRecord {
  id: string
  owner_id: string
  slug: string
  name: string
  schema_json: CollectionSchemaJson
  schema_version: number
  visibility: Visibility
  api_key_hash: string | null
}

export interface CollectionSummary {
  id: string
  slug: string
  name: string
  schema_version: number
  visibility: Visibility
  updated_at: Date
  item_count: number
  site_count: number
}

/** 사용자에게는 "사이트" 다 (보장선 B2) */
export interface SiteRecord {
  id: string
  host: string
  entry_url: string
  status: SourceStatus
  fetch_mode: FetchMode
  last_run_at: Date | null
  last_ok_at: Date | null
}

interface RawCollectionRow {
  id: string
  owner_id: string
  slug: string
  name: string
  schema_json: unknown
  schema_version: number
  visibility: string
  api_key_hash: string | null
}

interface RawSummaryRow {
  id: string
  slug: string
  name: string
  schema_version: number
  visibility: string
  updated_at: Date
  item_count: number
  site_count: number
}

interface RawSiteRow {
  id: string
  host: string
  entry_url: string
  status: string
  fetch_mode: string
  last_run_at: Date | null
  last_ok_at: Date | null
}

interface RawCountRow {
  n: number
}

// ── 변환 ─────────────────────────────────────────────────────────────────

/**
 * schema_json 은 DB 에서 unknown 으로 온다. 스키마가 곧 계약이므로(원칙 ⑤)
 * 여기서 한 번 검증하고, 깨져 있으면 빈 배열로 낮춰 화면이 죽지 않게 한다.
 */
function toFields(value: unknown): CollectionSchemaJson {
  const parsed = CollectionSchemaJsonSchema.safeParse(value)
  return parsed.success ? parsed.data : []
}

const VISIBILITIES = new Set(['private', 'unlisted', 'public'])
const STATUSES = new Set(['ok', 'healing', 'needs_attention', 'paused'])
const MODES = new Set(['json', 'html', 'browser'])

const asVisibility = (v: string): Visibility => (VISIBILITIES.has(v) ? (v as Visibility) : 'private')
const asStatus = (v: string): SourceStatus => (STATUSES.has(v) ? (v as SourceStatus) : 'needs_attention')
const asMode = (v: string): FetchMode => (MODES.has(v) ? (v as FetchMode) : 'html')

// ── 조회 ─────────────────────────────────────────────────────────────────

/** 슬러그로 컬렉션 하나. 없으면 data 가 null (실패와 구분된다) */
export async function getCollectionBySlug(slug: string): Promise<Loaded<CollectionRecord | null>> {
  return safeQuery(async (core) => {
    const rows = await core.queryClient<RawCollectionRow[]>`
      select id, owner_id, slug, name, schema_json, schema_version, visibility, api_key_hash
      from collections
      where slug = ${slug}
      limit 1
    `
    const row = rows[0]
    if (!row) return null
    return {
      id: row.id,
      owner_id: row.owner_id,
      slug: row.slug,
      name: row.name,
      schema_json: toFields(row.schema_json),
      schema_version: row.schema_version,
      visibility: asVisibility(row.visibility),
      api_key_hash: row.api_key_hash,
    }
  })
}

/**
 * 목록. ownerId 가 있으면 그 사람 것만, 없으면 전부 —
 * 로그인 설정이 아직 없는 G0 에서 시드 내용을 볼 수 있게 하기 위한 데모 경로다.
 */
export async function listCollections(ownerId: string | null): Promise<Loaded<CollectionSummary[]>> {
  return safeQuery(async (core) => {
    const sql = core.queryClient
    const rows = ownerId
      ? await sql<RawSummaryRow[]>`
          select c.id, c.slug, c.name, c.schema_version, c.visibility, c.updated_at,
                 (select count(*)::int from items i where i.collection_id = c.id) as item_count,
                 (select count(*)::int from sources s where s.collection_id = c.id) as site_count
          from collections c
          where c.owner_id = ${ownerId}
          order by c.updated_at desc
        `
      : await sql<RawSummaryRow[]>`
          select c.id, c.slug, c.name, c.schema_version, c.visibility, c.updated_at,
                 (select count(*)::int from items i where i.collection_id = c.id) as item_count,
                 (select count(*)::int from sources s where s.collection_id = c.id) as site_count
          from collections c
          order by c.updated_at desc
          limit 20
        `
    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      schema_version: row.schema_version,
      visibility: asVisibility(row.visibility),
      updated_at: row.updated_at,
      item_count: Number(row.item_count),
      site_count: Number(row.site_count),
    }))
  })
}

/** 이 컬렉션이 보고 있는 사이트들 */
export async function listSites(collectionId: string): Promise<Loaded<SiteRecord[]>> {
  return safeQuery(async (core) => {
    const rows = await core.queryClient<RawSiteRow[]>`
      select id, host, entry_url, status, fetch_mode, last_run_at, last_ok_at
      from sources
      where collection_id = ${collectionId}
      order by created_at asc
    `
    return rows.map((row) => ({
      id: row.id,
      host: row.host,
      entry_url: row.entry_url,
      status: asStatus(row.status),
      fetch_mode: asMode(row.fetch_mode),
      last_run_at: row.last_run_at,
      last_ok_at: row.last_ok_at,
    }))
  })
}

/**
 * 이번 달에 스스로 고쳐낸 횟수 (기획서 5장④).
 * 조용히 고치면 사용자는 지켜보기를 믿지 못한다. 숫자로 쌓아 보여준다.
 */
export async function countHealedThisMonth(collectionId: string): Promise<Loaded<number>> {
  return safeQuery(async (core) => {
    const rows = await core.queryClient<RawCountRow[]>`
      select count(*)::int as n
      from runs r
      join sources s on s.id = r.source_id
      where s.collection_id = ${collectionId}
        and r.status = 'healed'
        and r.started_at >= date_trunc('month', now())
    `
    return Number(rows[0]?.n ?? 0)
  })
}

/**
 * 표 본문. **공개 API 와 같은 코드**를 쓴다 (core 의 buildCollectionResponse).
 * 화면이 따로 조회를 짜면 API 와 화면이 서서히 갈라진다.
 */
export async function fetchCollectionPage(
  collection: Pick<CollectionRecord, 'id' | 'schema_json' | 'schema_version'>,
  search: string,
): Promise<Loaded<CollectionResponse>> {
  return safeQuery(async (core) => {
    const { query } = parseCollectionQuery(search, collection.schema_json)
    return buildCollectionResponse(core.db, collection, query)
  })
}
