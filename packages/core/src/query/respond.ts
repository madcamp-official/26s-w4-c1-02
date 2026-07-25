// 응답 조립 — G0 계약 (2) · 기획서 7장④ · 12장
//
// 여기가 "부분 성공이 1급 시민이다" 가 코드가 되는 지점이다.
// **`sources` 는 언제나 들어간다.** 아이템이 0건이어도, 필터로 전부 걸러졌어도,
// 소스가 전부 깨져 있어도 소스별 상태는 나온다. 빼먹으면 계약 위반이다.
//
// 이 파일은 web 의 `GET /api/v1/{slug}` 와 mcp 의 `list_items` 가 공유한다.

import { eq, sql } from 'drizzle-orm'

import type { Db } from '../db/client'
import { items, sources } from '../db/schema'
import type { ApiItem, CollectionQuery, CollectionResponse, SourceSummary } from '../types/api'
import type { CollectionSchemaJson, FieldDef } from '../types/collection'
import type { ItemData, ItemProvenance, ItemRaw, ItemValue } from '../types/item'
import type { SourceStatus } from '../types/source'
import { planItemsQuery, sortValueOf, type ResolvedSort } from './build'
import { encodeCursor } from './params'

// ── 순수 조각들 (DB 없이 테스트된다) ─────────────────────────────────────

/**
 * "마지막으로 성공한 게 얼마나 오래됐나". 기획서 예시가 `"6h"` 라 같은 표기를 쓴다.
 * 화면 문구가 아니라 API 값이므로 짧은 기계 표기로 둔다.
 */
export function formatAge(from: Date, now: Date = new Date()): string {
  const ms = Math.max(0, now.getTime() - from.getTime())
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

/** `?source=k-startup.go.kr` 매칭. 대소문자와 `www.` 는 무시한다 */
export function hostMatches(host: string, wanted: string): boolean {
  const norm = (h: string) => h.trim().toLowerCase().replace(/^www\./, '')
  return norm(host) === norm(wanted)
}

/** 같은 호스트에 소스가 둘 이상이면 "가장 손이 필요한" 상태를 대표로 올린다 */
const STATUS_SEVERITY: Record<SourceStatus, number> = {
  ok: 0,
  paused: 1,
  healing: 2,
  needs_attention: 3,
}

export interface SourceStateLike {
  id: string
  host: string
  status: SourceStatus
  last_ok_at: Date | null
}

/**
 * 소스별 상태 블록. **아이템이 0건이어도 소스는 전부 나온다** (원칙 ④).
 * `items` 는 이번 조건에 걸린 전체 개수다 — 페이지 단위가 아니라 필터 단위여야
 * 페이지를 넘겨도 숫자가 흔들리지 않는다.
 */
export function summarizeSources(
  sourceRows: readonly SourceStateLike[],
  countsBySourceId: ReadonlyMap<string, number>,
  now: Date = new Date(),
): Record<string, SourceSummary> {
  const out: Record<string, SourceSummary> = {}

  for (const row of sourceRows) {
    const count = countsBySourceId.get(row.id) ?? 0
    const existing = out[row.host]

    if (!existing) {
      out[row.host] = {
        status: row.status,
        items: count,
        last_ok_at: row.last_ok_at ? row.last_ok_at.toISOString() : null,
      }
    } else {
      existing.items += count
      if (STATUS_SEVERITY[row.status] > STATUS_SEVERITY[existing.status]) {
        existing.status = row.status
      }
      const prev = existing.last_ok_at ? new Date(existing.last_ok_at).getTime() : -Infinity
      if (row.last_ok_at && row.last_ok_at.getTime() > prev) {
        existing.last_ok_at = row.last_ok_at.toISOString()
      }
    }
  }

  // healing 은 "지금 고치는 중이고 그동안 마지막 성공 데이터를 계속 낸다" 는 뜻이다.
  // 그 데이터가 얼마나 묵었는지 같이 주지 않으면 사용자가 판단할 수 없다.
  for (const summary of Object.values(out)) {
    if (summary.status === 'healing' && summary.last_ok_at) {
      summary.age = formatAge(new Date(summary.last_ok_at), now)
    }
  }

  return out
}

export interface ItemRowLike {
  id: string
  source_id: string
  data_json: ItemData
  raw_json: ItemRaw | null
  provenance_json: ItemProvenance | null
  first_seen_at: Date
}

/** link 타입 필드의 값. 원문으로 가는 길은 어떤 표면에서도 한 번에 잡혀야 한다 */
export function linkOf(data: ItemData, fields: readonly FieldDef[]): string | null {
  const linkField = fields.find((f) => f.type === 'link')
  const candidate = linkField ? data[linkField.key] : data['link']
  return typeof candidate === 'string' && candidate !== '' ? candidate : null
}

/**
 * data_json 을 펼치고 메타를 얹는다.
 *
 * 두 가지 판단:
 *  - 스키마에 있는 항목만 내보낸다. 스키마가 곧 계약이므로(원칙 ⑤) 옛 수집이 남긴
 *    유령 키가 응답에 새어 나가면 안 된다. 값이 없는 항목은 null 로 자리를 채워
 *    응답 모양이 행마다 달라지지 않게 한다.
 *  - 메타 키는 `_` 로 시작한다. 필드 키는 `^[a-z][a-z0-9_]*$` 라 `_` 로 시작할 수 없으므로
 *    (types/collection.ts FIELD_KEY_PATTERN) 충돌이 구조적으로 불가능하다.
 */
export function toApiItem(
  row: ItemRowLike,
  opts: { host: string; fields: readonly FieldDef[]; includeProvenance: boolean },
): ApiItem {
  const out: Record<string, ItemValue | ItemProvenance | ItemRaw | undefined> = {}
  for (const field of opts.fields) {
    out[field.key] = row.data_json[field.key] ?? null
  }
  out['_source'] = opts.host
  out['_first_seen_at'] = row.first_seen_at.toISOString()
  out['_link'] = linkOf(row.data_json, opts.fields)
  if (opts.includeProvenance) {
    // 원문 대조 — 경로(provenance)만 있으면 화면이 raw 에서 값을 못 꺼낸다. 둘 다 준다
    out['_provenance'] = row.provenance_json ?? {}
    out['_raw'] = row.raw_json ?? {}
  }
  // 메타 키를 위에서 전부 채웠다. 인덱스 시그니처만으로는 TS 가 그걸 증명하지 못한다
  return out as unknown as ApiItem
}

/** 다음 페이지가 있으면 마지막 행으로 커서를 만든다. 없으면 null */
export function nextCursorFrom(
  lastRow:
    | {
        id: string
        data_json: ItemData
        first_seen_at: Date
        last_seen_at: Date
      }
    | undefined,
  sort: ResolvedSort,
  hasMore: boolean,
): string | null {
  if (!hasMore || !lastRow) return null
  return encodeCursor({ s: sortValueOf(lastRow, sort), id: lastRow.id })
}

// ── 조립 ─────────────────────────────────────────────────────────────────

/** 응답을 만드는 데 실제로 필요한 컬렉션 정보만 (행 전체를 받아도 된다) */
export interface CollectionLike {
  id: string
  schema_json: CollectionSchemaJson
  schema_version: number
}

/**
 * `GET /api/v1/{slug}` 와 MCP `list_items` 의 공통 본문.
 * 쿼리는 parseCollectionQuery 가 이미 스키마로 검증한 것이어야 한다.
 */
export async function buildCollectionResponse(
  db: Db,
  collection: CollectionLike,
  query: CollectionQuery,
): Promise<CollectionResponse> {
  const now = new Date()
  const fields = collection.schema_json

  // 1. 소스는 아이템과 무관하게 항상 전부 읽는다. sources 블록이 조건부가 되면 안 된다
  const sourceRows = await db
    .select({
      id: sources.id,
      host: sources.host,
      status: sources.status,
      last_ok_at: sources.last_ok_at,
    })
    .from(sources)
    .where(eq(sources.collection_id, collection.id))

  // 2. `?source=` 를 실제 소스 id 로 푼다. 못 찾으면 빈 배열 → 아이템 0건, 상태는 그대로 노출
  const sourceIds = query.source
    ? sourceRows.filter((s) => hostMatches(s.host, query.source as string)).map((s) => s.id)
    : null

  const plan = planItemsQuery(query, { collectionId: collection.id, fields, sourceIds })

  // 3. 페이지 + 1 을 읽어 다음 페이지 유무를 알아낸다
  const rows = await db
    .select({
      id: items.id,
      source_id: items.source_id,
      data_json: items.data_json,
      raw_json: items.raw_json,
      provenance_json: items.provenance_json,
      first_seen_at: items.first_seen_at,
      last_seen_at: items.last_seen_at,
    })
    .from(items)
    .where(plan.pageWhere)
    .orderBy(...plan.orderBy)
    .limit(plan.fetchLimit)

  const hasMore = rows.length > plan.limit
  const pageRows = hasMore ? rows.slice(0, plan.limit) : rows

  // 4. 소스별 개수는 페이지가 아니라 조건 전체 기준 (커서는 빼고 센다)
  const counts = await db
    .select({ source_id: items.source_id, n: sql<number>`count(*)::int` })
    .from(items)
    .where(plan.where)
    .groupBy(items.source_id)

  const countsBySourceId = new Map<string, number>(counts.map((c) => [c.source_id, Number(c.n)]))
  const hostBySourceId = new Map<string, string>(sourceRows.map((s) => [s.id, s.host]))

  const includeProvenance = query.include.includes('provenance')

  return {
    items: pageRows.map((row) =>
      toApiItem(row, {
        host: hostBySourceId.get(row.source_id) ?? '',
        fields,
        includeProvenance,
      }),
    ),
    sources: summarizeSources(sourceRows, countsBySourceId, now),
    schema_version: collection.schema_version,
    page: {
      limit: plan.limit,
      next_cursor: nextCursorFrom(pageRows[pageRows.length - 1], plan.sort, hasMore),
    },
  }
}
