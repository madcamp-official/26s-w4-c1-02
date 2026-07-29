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
  /** 카드에 그릴 사이트 호스트들 (등록 순) */
  hosts: string[]
  /** 다시 맞추는 중인 사이트 수 */
  healing_count: number
  /** 확인이 필요한 사이트 수 */
  attention_count: number
  /** 최근 3일 새 항목 수 */
  new_count: number
  /** 이번 달 자동 복구 횟수 */
  healed_count: number
  /** 마지막으로 성공한 수집 시각 */
  last_ok_at: Date | null
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
  updated_at: Date | string
  item_count: number
  site_count: number
  hosts: string[] | null
  healing_count: number
  attention_count: number
  new_count: number
  healed_count: number
  last_ok_at: Date | string | null
}

interface RawSiteRow {
  id: string
  host: string
  entry_url: string
  status: string
  fetch_mode: string
  last_run_at: Date | string | null
  last_ok_at: Date | string | null
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

/**
 * postgres.js 는 timestamptz 를 Date 가 아니라 **문자열**로 돌려준다 (기본 파서 없음).
 * 화면이 Intl 로 포맷하다 죽지 않게 여기서 한 번 Date 로 굳힌다. 이상한 값은 null.
 */
export function asDate(value: Date | string | null): Date | null {
  if (value === null) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

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
    // 카드 하나에 필요한 숫자들을 서브쿼리로 한 번에 (목록 20개 규모라 N+1 걱정 없음)
    const summaryColumns = sql`
      c.id, c.slug, c.name, c.schema_version, c.visibility, c.updated_at,
      (select count(*)::int from items i where i.collection_id = c.id) as item_count,
      (select count(*)::int from sources s where s.collection_id = c.id) as site_count,
      (select coalesce(array_agg(s.host order by s.created_at), '{}')
         from sources s where s.collection_id = c.id) as hosts,
      (select count(*)::int from sources s
         where s.collection_id = c.id and s.status = 'healing') as healing_count,
      (select count(*)::int from sources s
         where s.collection_id = c.id and s.status = 'needs_attention') as attention_count,
      (select count(*)::int from items i
         where i.collection_id = c.id and i.first_seen_at >= now() - interval '3 days') as new_count,
      (select count(*)::int from runs r join sources s on s.id = r.source_id
         where s.collection_id = c.id and r.status = 'healed'
           and r.started_at >= (date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')) as healed_count,
      (select max(s.last_ok_at) from sources s where s.collection_id = c.id) as last_ok_at
    `
    const rows = ownerId
      ? await sql<RawSummaryRow[]>`
          select ${summaryColumns}
          from collections c
          where c.owner_id = ${ownerId}
          order by c.updated_at desc
        `
      : await sql<RawSummaryRow[]>`
          select ${summaryColumns}
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
      updated_at: asDate(row.updated_at) ?? new Date(0),
      item_count: Number(row.item_count),
      site_count: Number(row.site_count),
      hosts: row.hosts ?? [],
      healing_count: Number(row.healing_count),
      attention_count: Number(row.attention_count),
      new_count: Number(row.new_count),
      healed_count: Number(row.healed_count),
      last_ok_at: asDate(row.last_ok_at),
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
      last_run_at: asDate(row.last_run_at),
      last_ok_at: asDate(row.last_ok_at),
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
        and r.started_at >= (date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')
    `
    return Number(rows[0]?.n ?? 0)
  })
}

/** 표에 담긴 전체 항목 수 (히어로 밴드 지표) */
export async function countCollectionItems(collectionId: string): Promise<Loaded<number>> {
  return safeQuery(async (core) => {
    const rows = await core.queryClient<RawCountRow[]>`
      select count(*)::int as n from items where collection_id = ${collectionId}
    `
    return Number(rows[0]?.n ?? 0)
  })
}

/** 사이트별 항목 수 (대시보드의 연결 카드 — 어느 출처가 얼마나 채웠는지) */
export async function countItemsByHost(
  collectionId: string,
): Promise<Loaded<Record<string, number>>> {
  return safeQuery(async (core) => {
    const rows = await core.queryClient<{ host: string; n: number }[]>`
      select s.host, count(i.id)::int as n
      from sources s
      left join items i on i.source_id = s.id
      where s.collection_id = ${collectionId}
      group by s.host
    `
    const byHost: Record<string, number> = {}
    for (const row of rows) byHost[row.host] = Number(row.n)
    return byHost
  })
}

/** 상단 상태 줄의 재료 (델타 4-3 — "살아있다"는 인상은 기능보다 먼저) */
export interface CollectionStatusLine {
  /** 마지막으로 성공한 수집. null 이면 아직 받아온 적 없음 */
  last_ok_at: Date | null
  /** 최근 3일 새 항목 수 */
  new_count: number
  /** 마감(첫 날짜 필드)이 7일 이내인 항목 수. 날짜 필드가 없으면 null */
  closing_count: number | null
}

export async function collectionStatusLine(
  collection: Pick<CollectionRecord, 'id' | 'schema_json'>,
): Promise<Loaded<CollectionStatusLine>> {
  const dateField = collection.schema_json.find((f) => f.type === 'date') ?? null
  return safeQuery(async (core) => {
    const sql = core.queryClient
    const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10)
    const week = new Date(Date.now() + (9 + 7 * 24) * 3_600_000).toISOString().slice(0, 10)

    const rows = await sql<{ last_ok_at: Date | string | null; new_count: number }[]>`
      select
        (select max(s.last_ok_at) from sources s where s.collection_id = ${collection.id}) as last_ok_at,
        (select count(*)::int from items i
           where i.collection_id = ${collection.id}
             and i.first_seen_at >= now() - interval '3 days') as new_count
    `
    let closing: number | null = null
    if (dateField !== null) {
      // 정규화된 YYYY-MM-DD 는 사전순 비교가 곧 시간순 비교다 (core query/build 와 같은 전제)
      const closingRows = await sql<{ n: number }[]>`
        select count(*)::int as n from items
        where collection_id = ${collection.id}
          and data_json ->> ${dateField.key} >= ${today}
          and data_json ->> ${dateField.key} <= ${week}
      `
      closing = Number(closingRows[0]?.n ?? 0)
    }
    return {
      last_ok_at: asDate(rows[0]?.last_ok_at ?? null),
      new_count: Number(rows[0]?.new_count ?? 0),
      closing_count: closing,
    }
  })
}

/**
 * 랜딩의 예시 컬렉션 (델타 5-5 — 빈 화면 금지, 강점을 전달하는 장치).
 * 공개 범위가 private 이 아닌 것만 — 로그인 없이 열어보게 하는 카드다.
 */
export async function listExampleCollections(limit = 3): Promise<Loaded<CollectionSummary[]>> {
  return safeQuery(async (core) => {
    const sql = core.queryClient
    const rows = await sql<RawSummaryRow[]>`
      select c.id, c.slug, c.name, c.schema_version, c.visibility, c.updated_at,
        (select count(*)::int from items i where i.collection_id = c.id) as item_count,
        (select count(*)::int from sources s where s.collection_id = c.id) as site_count,
        (select coalesce(array_agg(s.host order by s.created_at), '{}')
           from sources s where s.collection_id = c.id) as hosts,
        0 as healing_count, 0 as attention_count, 0 as new_count, 0 as healed_count,
        null as last_ok_at
      from collections c
      where c.visibility in ('unlisted', 'public')
        and exists (select 1 from items i where i.collection_id = c.id)
      order by c.updated_at desc
      limit ${limit}
    `
    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      schema_version: row.schema_version,
      visibility: asVisibility(row.visibility),
      updated_at: asDate(row.updated_at) ?? new Date(0),
      item_count: Number(row.item_count),
      site_count: Number(row.site_count),
      hosts: row.hosts ?? [],
      healing_count: 0,
      attention_count: 0,
      new_count: 0,
      healed_count: 0,
      last_ok_at: null,
    }))
  })
}

/** 이름 변경 (컬렉션 관리 — web 단독 쓰기 경로) */
export async function renameCollection(id: string, name: string): Promise<Loaded<null>> {
  return safeQuery(async (core) => {
    await core.queryClient`
      update collections set name = ${name}, updated_at = now() where id = ${id}
    `
    return null
  })
}

/** 공개범위 변경 — API 인증 방식도 이 값을 따라간다 (기획서 12장) */
export async function updateCollectionVisibility(
  id: string,
  visibility: Visibility,
): Promise<Loaded<null>> {
  return safeQuery(async (core) => {
    await core.queryClient`
      update collections set visibility = ${visibility}, updated_at = now() where id = ${id}
    `
    return null
  })
}

/** 삭제. 사이트·항목·수집 기록·구독이 전부 같이 지워진다 (FK cascade) */
export async function deleteCollection(id: string): Promise<Loaded<null>> {
  return safeQuery(async (core) => {
    await core.queryClient`delete from collections where id = ${id}`
    return null
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
