// 뷰 — 저장·조회·요약 (뷰 계약 · A33~A35 · G3 트랙 B).
//
// 조건 해석은 언제나 core 의 viewToQuery 하나를 탄다 (네 출구 단일 진입 — A33).
// 여기서는 저장(views 테이블)과 화면용 요약(사람 문장)만 담당한다.

import {
  MAX_VIEWS_PER_COLLECTION,
  ViewConditionSchema,
  ViewDefinitionSchema,
  suggestViewSlug,
  validateViewDefinition,
  type CollectionResponse,
  type FieldDef,
  type ViewCondition,
  type ViewHealth,
  type ViewNotify,
  type ViewSort,
} from '@endpointer/core'
import { buildCollectionResponse, viewToQuery } from '@endpointer/core/query'

import { safeQuery, type Loaded } from './db'
import { asDate, type CollectionRecord } from './collections'

export interface ViewRecord {
  id: string
  slug: string
  name: string
  where: ViewCondition[]
  sort: ViewSort[]
  columns: string[] | null
  notify: ViewNotify | null
  pinned: boolean
  created_at: Date | null
  /** 저장하지 않는다 — 읽을 때 계산 (계약 §7 결정 ③) */
  health: ViewHealth
}

interface RawViewRow {
  id: string
  slug: string
  name: string
  where_json: unknown
  sort_json: unknown
  columns_json: unknown
  notify_json: unknown
  pinned: boolean
  created_at: Date | string | null
}

/** jsonb → ViewRecord. 모양이 깨졌거나 스키마와 안 맞으면 health 를 낮춘다 — 조용히 무시하지 않는다 */
function toRecord(row: RawViewRow, fields: readonly FieldDef[]): ViewRecord {
  const def = ViewDefinitionSchema.safeParse({
    name: row.name,
    where: row.where_json ?? [],
    sort: row.sort_json ?? [],
    columns: row.columns_json ?? null,
    notify: row.notify_json ?? null,
    pinned: row.pinned,
  })

  if (!def.success) {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      where: [],
      sort: [],
      columns: null,
      notify: null,
      pinned: row.pinned,
      created_at: asDate(row.created_at),
      health: 'broken',
    }
  }

  // v1 건강 판정: 참조 필드가 스키마에서 사라졌으면 broken.
  // warn(일부 소스에만 필드 없음)은 소스별 결손 데이터(델타 11-5)가 생기면 붙인다.
  const validation = validateViewDefinition(def.data, fields)
  return {
    id: row.id,
    slug: row.slug,
    name: def.data.name,
    where: def.data.where,
    sort: def.data.sort,
    columns: def.data.columns,
    notify: def.data.notify,
    pinned: def.data.pinned,
    created_at: asDate(row.created_at),
    health: validation.ok ? 'ok' : 'broken',
  }
}

/** 이 컬렉션의 저장된 뷰들 (고정 먼저, 만든 순) */
export async function listViews(
  collection: Pick<CollectionRecord, 'id' | 'schema_json'>,
): Promise<Loaded<ViewRecord[]>> {
  return safeQuery(async (core) => {
    const rows = await core.queryClient<RawViewRow[]>`
      select id, slug, name, where_json, sort_json, columns_json, notify_json, pinned, created_at
      from views
      where collection_id = ${collection.id}
      order by pinned desc, created_at asc
    `
    return rows.map((row) => toRecord(row, collection.schema_json))
  })
}

export async function getViewBySlug(
  collection: Pick<CollectionRecord, 'id' | 'schema_json'>,
  slug: string,
): Promise<Loaded<ViewRecord | null>> {
  return safeQuery(async (core) => {
    const rows = await core.queryClient<RawViewRow[]>`
      select id, slug, name, where_json, sort_json, columns_json, notify_json, pinned, created_at
      from views
      where collection_id = ${collection.id} and slug = ${slug}
      limit 1
    `
    const row = rows[0]
    return row === undefined ? null : toRecord(row, collection.schema_json)
  })
}

/**
 * 뷰 저장. zod(모양) → validateViewDefinition(스키마 대조) → 상한 → slug 순.
 * 상한은 서버가 거부한다 (계약 §5 — 화면 안내만으론 API 로 우회된다).
 */
export async function createView(
  collection: Pick<CollectionRecord, 'id' | 'schema_json'>,
  ownerId: string,
  input: { name: string; where: unknown; sort?: ViewSort[] },
): Promise<Loaded<{ slug: string } | { problem: string }>> {
  return safeQuery(async (core) => {
    const where = ViewConditionSchema.array().max(10).safeParse(input.where)
    if (!where.success) return { problem: '조건을 읽지 못했어요. 화면을 새로 고쳐 주세요.' }

    const def = ViewDefinitionSchema.parse({
      name: input.name,
      where: where.data,
      sort: input.sort ?? [],
    })
    const validation = validateViewDefinition(def, collection.schema_json)
    if (!validation.ok) return { problem: validation.errors[0] ?? '조건이 이 표와 맞지 않아요.' }

    const sql = core.queryClient
    const countRows = await sql<{ n: number }[]>`
      select count(*)::int as n from views where collection_id = ${collection.id}
    `
    if (Number(countRows[0]?.n ?? 0) >= MAX_VIEWS_PER_COLLECTION) {
      return {
        problem: `저장한 조건이 ${MAX_VIEWS_PER_COLLECTION}개예요. 안 쓰는 것을 지우고 다시 저장해 주세요 — 이만큼 쌓였다면 표를 나누는 편이 나을 수도 있어요.`,
      }
    }

    // slug: 라틴 문자가 안 남으면 view-N 순번 (계약 §1 ※ — MCP 도구명의 ASCII 제약)
    const base = suggestViewSlug(def.name) ?? `view-${Number(countRows[0]?.n ?? 0) + 1}`
    const taken = await sql<{ slug: string }[]>`
      select slug from views where collection_id = ${collection.id}
    `
    const existing = new Set(taken.map((t) => t.slug))
    let slug = base
    for (let i = 2; existing.has(slug); i += 1) slug = `${base}-${i}`

    await sql`
      insert into views (collection_id, slug, name, where_json, sort_json, owner_id, pinned)
      values (${collection.id}, ${slug}, ${def.name},
              ${JSON.stringify(def.where)}::jsonb, ${JSON.stringify(def.sort)}::jsonb,
              ${ownerId}, ${def.pinned})
    `
    return { slug }
  })
}

export async function deleteView(collectionId: string, viewId: string): Promise<Loaded<null>> {
  return safeQuery(async (core) => {
    await core.queryClient`
      delete from views where id = ${viewId} and collection_id = ${collectionId}
    `
    return null
  })
}

export async function setViewPinned(
  collectionId: string,
  viewId: string,
  pinned: boolean,
): Promise<Loaded<null>> {
  return safeQuery(async (core) => {
    await core.queryClient`
      update views set pinned = ${pinned}, updated_at = now()
      where id = ${viewId} and collection_id = ${collectionId}
    `
    return null
  })
}

/** 알림 채널 설정. channels 가 비면 알림을 끈다 (notify_json = null) */
export async function setViewNotify(
  collectionId: string,
  viewId: string,
  channels: string[],
): Promise<Loaded<null>> {
  return safeQuery(async (core) => {
    const notify = channels.length === 0 ? null : { on: 'enter' as const, channels }
    await core.queryClient`
      update views set notify_json = ${notify === null ? null : JSON.stringify(notify)}::jsonb,
                       updated_at = now()
      where id = ${viewId} and collection_id = ${collectionId}
    `
    return null
  })
}

/**
 * 뷰의 현재 매칭을 표와 같은 문으로 가져온다 (A33 — viewToQuery 하나).
 * 건수 표시는 이 결과의 길이다. next_cursor 가 있으면 "N+ 건"으로 읽는다.
 */
export async function fetchViewPage(
  collection: Pick<CollectionRecord, 'id' | 'schema_json' | 'schema_version'>,
  view: Pick<ViewRecord, 'where' | 'sort'>,
  limit = 200,
): Promise<Loaded<CollectionResponse>> {
  return safeQuery(async (core) => {
    const query = viewToQuery({ where: view.where, sort: view.sort }, new Date())
    return buildCollectionResponse(core.db, collection, {
      ...query,
      limit,
      include: ['provenance'],
    })
  })
}

// ── 사람 문장 요약 (B2 — 내부 표현을 화면에 내보내지 않는다) ─────────────

const numberFormat = new Intl.NumberFormat('ko-KR')

function fieldLabel(fields: readonly FieldDef[], key: string): string {
  return fields.find((f) => f.key === key)?.label ?? key
}

function enumLabel(fields: readonly FieldDef[], key: string, value: string): string {
  return fields.find((f) => f.key === key)?.value_labels?.[value] ?? value
}

/** 조건 하나 → 사람 문장 조각. 이름 자동 제안과 뷰 카드가 같이 쓴다 */
export function summarizeCondition(cond: ViewCondition, fields: readonly FieldDef[]): string {
  const label = fieldLabel(fields, cond.field)
  switch (cond.op) {
    case 'within':
      return cond.value === 'this_week' ? `이번 주 ${label}` : `이번 달 ${label}`
    case 'd_within':
      return `${label} D-${cond.value} 이내`
    case 'before':
      return `지난 ${label}`
    case 'after':
      return `다가올 ${label}`
    case 'is_null':
      return `${label} 없음`
    case 'gte':
      return `${label} ${numberFormat.format(cond.value)} 이상`
    case 'lte':
      return `${label} ${numberFormat.format(cond.value)} 이하`
    case 'between':
      return `${label} ${numberFormat.format(cond.value[0])}~${numberFormat.format(cond.value[1])}`
    case 'in':
      return `${label}: ${cond.value.map((v) => enumLabel(fields, cond.field, v)).join('/')}`
    case 'not_in':
      return `${label} 제외: ${cond.value.map((v) => enumLabel(fields, cond.field, v)).join('/')}`
    case 'contains':
      return `‘${cond.value}’ 포함`
    case 'not_contains':
      return `‘${cond.value}’ 제외`
  }
}

export function summarizeConditions(
  conds: readonly ViewCondition[],
  fields: readonly FieldDef[],
): string {
  return conds.map((c) => summarizeCondition(c, fields)).join(' · ')
}

/** 뷰 건강 → 사람 문장 (B2 — `warn`/`broken` 키를 그대로 내보내지 않는다) */
export function healthCopy(health: ViewHealth): { tone: 'ok' | 'healing' | 'attention'; text: string } {
  switch (health) {
    case 'ok':
      return { tone: 'ok', text: '정상' }
    case 'warn':
      return { tone: 'healing', text: '일부 사이트에만 조건이 적용돼요' }
    case 'broken':
      return { tone: 'attention', text: '조건에 쓰인 칸이 표에서 사라졌어요 — 알림이 멈춰 있어요' }
  }
}

// ── 표 위 필터 ↔ 조건 (델타 2-10 — 뷰 편집은 폼이 아니라 표 위에서) ───────

/**
 * 표 탭의 필터 바 파라미터 → 조건. 파라미터 이름 규약:
 *   d_<key>   date  — 'this_week' | 'this_month' | 숫자(D-n 이내)
 *   e_<key>   enum  — 정규화 키 하나
 *   min_<key> / max_<key>  number·money
 * 모르는 값·스키마 밖 키는 조용히 버린다 — 주소창을 손으로 고친 경우다.
 */
export function conditionsFromParams(
  params: Record<string, string | string[] | undefined>,
  fields: readonly FieldDef[],
): ViewCondition[] {
  const byKey = new Map(fields.map((f) => [f.key, f]))
  const out: ViewCondition[] = []

  for (const [name, rawValue] of Object.entries(params)) {
    const value = Array.isArray(rawValue) ? rawValue[0] : rawValue
    if (value === undefined || value === '') continue

    if (name.startsWith('d_')) {
      const key = name.slice(2)
      if (byKey.get(key)?.type !== 'date') continue
      if (value === 'this_week' || value === 'this_month') {
        out.push({ field: key, op: 'within', value })
      } else {
        const days = Number(value)
        if (Number.isInteger(days) && days >= 0 && days <= 365) {
          out.push({ field: key, op: 'd_within', value: days })
        }
      }
    } else if (name.startsWith('e_')) {
      const key = name.slice(2)
      if (byKey.get(key)?.type !== 'enum') continue
      out.push({ field: key, op: 'in', value: [value] })
    } else if (name.startsWith('min_') || name.startsWith('max_')) {
      const key = name.slice(4)
      const type = byKey.get(key)?.type
      if (type !== 'number' && type !== 'money') continue
      const n = Number(value)
      if (!Number.isFinite(n)) continue
      out.push({ field: key, op: name.startsWith('min_') ? 'gte' : 'lte', value: n })
    }
  }
  return out
}

/** 조건 → 필터 바가 다시 그릴 파라미터 (저장된 뷰를 골랐을 때 바에 반영) */
export function paramsFromConditions(conds: readonly ViewCondition[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const cond of conds) {
    switch (cond.op) {
      case 'within':
        out[`d_${cond.field}`] = cond.value
        break
      case 'd_within':
        out[`d_${cond.field}`] = String(cond.value)
        break
      case 'in':
        if (cond.value.length === 1 && cond.value[0] !== undefined) out[`e_${cond.field}`] = cond.value[0]
        break
      case 'gte':
        out[`min_${cond.field}`] = String(cond.value)
        break
      case 'lte':
        out[`max_${cond.field}`] = String(cond.value)
        break
      default:
        break
    }
  }
  return out
}
