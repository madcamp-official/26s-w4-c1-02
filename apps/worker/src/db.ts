// 워커가 쓰는 DB 접근 — `@endpointer/core/db` 위의 얇은 층
//
// ── 주의 ────────────────────────────────────────────────────────────────
// 이 모듈을 import 하는 순간 postgres 커넥션 풀이 만들어지고 DATABASE_URL 이 없으면 던진다.
// 그래서 **jobs/* 에서만** import 한다. probe CLI 는 DB 가 필요 없으므로 여기를 타지 않는다.
//
// worker 에는 `drizzle-orm` 이 직접 설치돼 있지 않다 (core 의 의존이다). 그래서
// `eq()` 같은 연산자를 import 할 수 없고, 두 가지 방법만 쓴다:
//   · 읽기·삽입 → drizzle 관계형 질의 API (`where` 콜백이 연산자를 넘겨준다)
//   · WHERE 가 필요한 UPDATE → core 가 재수출하는 postgres.js 원시 클라이언트로 직접 SQL
// worker 에 drizzle-orm 을 dependency 로 넣으면 아래 raw SQL 을 전부 지울 수 있다.

import type {
  AdapterRow,
  CollectionRow,
  ItemRow,
  RunRow,
  SourceRow,
  SubscriptionRow,
} from '@endpointer/core/db'
import { db, queryClient, adapters, collections, items, runs, sources } from '@endpointer/core/db'
import type { ItemData, ItemProvenance, ItemRaw, RunStatus, SourceStatus, ValidationReport } from '@endpointer/core'
import type { AdapterSpec, InterpretedItem } from '@endpointer/core/spec'
import { hashString, stableStringify } from '@endpointer/core/spec'

export { db, queryClient } from '@endpointer/core/db'
// pipeline/persist.ts 가 INSERT 를 하려면 테이블 객체가 필요하다.
// worker 에 drizzle-orm 이 없어서 여기를 거쳐 간다 (위 주석 참조).
export { collections, sources, adapters, items, runs } from '@endpointer/core/db'
export type { SourceRow, CollectionRow, AdapterRow, ItemRow, RunRow, SubscriptionRow }

// ── 읽기 ───────────────────────────────────────────────────────────────

export interface SourceContext {
  source: SourceRow
  collection: CollectionRow
  /** status='active' 인 어댑터. 아직 컴파일 전이면 null */
  adapter: AdapterRow | null
}

export async function loadSourceContext(sourceId: string): Promise<SourceContext | null> {
  const source = await db.query.sources.findFirst({
    where: (s, { eq }) => eq(s.id, sourceId),
    with: { collection: true },
  })
  if (source === undefined) return null

  const adapter = await db.query.adapters.findFirst({
    where: (a, { and, eq }) => and(eq(a.source_id, sourceId), eq(a.status, 'active')),
    orderBy: (a, { desc }) => [desc(a.version)],
  })

  const { collection, ...rest } = source as SourceRow & { collection: CollectionRow }
  return { source: rest as SourceRow, collection, adapter: adapter ?? null }
}

/** 드리프트 기준선의 재료 — 최근 성공 수집의 검증 결과 (최신순) */
export async function recentValidationReports(sourceId: string, limit = 5): Promise<ValidationReport[]> {
  const rows = await db.query.runs.findMany({
    where: (r, { and, eq, inArray }) => and(eq(r.source_id, sourceId), inArray(r.status, ['ok', 'healed'])),
    orderBy: (r, { desc }) => [desc(r.started_at)],
    limit,
  })
  return rows
    .map((r) => r.validation_json)
    .filter((v): v is ValidationReport => v !== null && v !== undefined)
}

/** 치유 승격 관문의 비교 대상 — 이 소스에 이미 들어 있는 아이템 키들 */
export async function existingItemKeys(sourceId: string, limit = 200): Promise<string[]> {
  const rows = await db.query.items.findMany({
    where: (i, { eq }) => eq(i.source_id, sourceId),
    orderBy: (i, { desc }) => [desc(i.last_seen_at)],
    limit,
  })
  return rows.map((r) => r.external_key)
}

/** 스케줄 동기화용 — 일시정지가 아닌 소스 전부 */
export async function listSchedulableSources(): Promise<
  { source_id: string; collection_id: string; host: string; schedule: string }[]
> {
  const rows = await db.query.sources.findMany({
    where: (s, { ne }) => ne(s.status, 'paused'),
  })
  return rows.map((s) => ({
    source_id: s.id,
    collection_id: s.collection_id,
    host: s.host,
    schedule: s.schedule,
  }))
}

/** 발송 페이로드가 컬렉션 이름·slug 를 필요로 한다 (9-4) */
export async function loadCollection(collectionId: string): Promise<CollectionRow | null> {
  const row = await db.query.collections.findFirst({ where: (c, { eq }) => eq(c.id, collectionId) })
  return row ?? null
}

/** 아이템의 출처 호스트명 — 발송 페이로드의 `_source` */
export async function hostsBySourceId(sourceIds: readonly string[]): Promise<Map<string, string>> {
  if (sourceIds.length === 0) return new Map()
  const rows = await db.query.sources.findMany({
    where: (s, { inArray }) => inArray(s.id, [...sourceIds]),
  })
  return new Map(rows.map((s) => [s.id, s.host]))
}

export async function listSubscriptions(collectionId: string): Promise<SubscriptionRow[]> {
  return db.query.subscriptions.findMany({
    where: (s, { eq }) => eq(s.collection_id, collectionId),
  })
}

export async function loadSubscription(id: string): Promise<SubscriptionRow | null> {
  const row = await db.query.subscriptions.findFirst({ where: (s, { eq }) => eq(s.id, id) })
  return row ?? null
}

export async function loadItems(ids: readonly string[]): Promise<ItemRow[]> {
  if (ids.length === 0) return []
  return db.query.items.findMany({
    where: (i, { inArray }) => inArray(i.id, [...ids]),
  })
}

// ── runs ───────────────────────────────────────────────────────────────

export async function startRun(input: {
  source_id: string
  adapter_id: string | null
}): Promise<string | null> {
  const inserted = await db
    .insert(runs)
    .values({
      source_id: input.source_id,
      adapter_id: input.adapter_id,
      status: 'ok',
      started_at: new Date(),
    })
    .returning({ id: runs.id })
  return inserted[0]?.id ?? null
}

export async function finishRun(
  runId: string,
  patch: {
    status: RunStatus
    items_found: number
    items_new: number
    validation_json: ValidationReport | null
    /** 사용자에게 보여줄 상태 문구. 내부 용어 금지 (보장선 B4) */
    error_summary: string | null
  },
): Promise<void> {
  // jsonb 는 `queryClient.json()` 이 아니라 직접 문자열로 만든다.
  // 클라이언트를 `prepare: false` 로 만들었는데 (client.ts — PgBouncer 대비)
  // 그 조합에서 postgres.js 3.4 가 객체를 그대로 넘겨
  // "The string argument must be of type string" 으로 죽는다.
  await queryClient`
    update runs set
      finished_at     = now(),
      status          = ${patch.status},
      items_found     = ${patch.items_found},
      items_new       = ${patch.items_new},
      validation_json = ${patch.validation_json === null ? null : JSON.stringify(patch.validation_json)},
      error_summary   = ${patch.error_summary}
    where id = ${runId}
  `
}

/** 드리프트를 잡아낸 그 수집. 치유가 "무엇이 깨졌는지" 를 여기서 읽는다 (9-3③) */
export async function loadRun(runId: string): Promise<RunRow | null> {
  const row = await db.query.runs.findFirst({ where: (r, { eq }) => eq(r.id, runId) })
  return row ?? null
}

/** 오늘 이 소스에 대해 자가 치유를 몇 번 시도했는지 (15장 하루 상한의 진짜 근거) */
export async function healAttemptsToday(sourceId: string): Promise<number> {
  const rows = await queryClient<{ n: number }[]>`
    select count(*)::int as n from runs
    where source_id = ${sourceId}
      and status in ('healed', 'drift')
      and started_at >= date_trunc('day', now() at time zone 'Asia/Seoul')
  `
  return rows[0]?.n ?? 0
}

// ── sources ────────────────────────────────────────────────────────────

export async function setSourceStatus(sourceId: string, status: SourceStatus): Promise<void> {
  await queryClient`update sources set status = ${status} where id = ${sourceId}`
}

export async function markSourceRun(sourceId: string, ok: boolean): Promise<void> {
  if (ok) {
    await queryClient`update sources set last_run_at = now(), last_ok_at = now() where id = ${sourceId}`
  } else {
    await queryClient`update sources set last_run_at = now() where id = ${sourceId}`
  }
}

// ── adapters ───────────────────────────────────────────────────────────

/** 치유가 만든 candidate 를 저장한다 (아직 승격하지 않는다) */
export async function insertCandidateAdapter(input: {
  source_id: string
  spec: AdapterSpec
  origin: 'llm' | 'heal' | 'human'
  validation: ValidationReport | null
}): Promise<AdapterRow | null> {
  const latest = await db.query.adapters.findFirst({
    where: (a, { eq }) => eq(a.source_id, input.source_id),
    orderBy: (a, { desc }) => [desc(a.version)],
  })
  const version = (latest?.version ?? 0) + 1

  const rows = await db
    .insert(adapters)
    .values({
      source_id: input.source_id,
      version,
      spec_json: input.spec,
      origin: input.origin,
      status: 'candidate',
      validation_json: input.validation,
    })
    .returning()
  return rows[0] ?? null
}

/**
 * candidate 를 active 로 올리고 기존 active 를 retired 로 내린다.
 * **이전 버전을 지우지 않는다** — 롤백 가능해야 한다 (기획서 9-3③).
 */
export async function promoteAdapter(sourceId: string, adapterId: string): Promise<void> {
  await queryClient.begin(async (tx) => {
    await tx`update adapters set status = 'retired' where source_id = ${sourceId} and status = 'active'`
    await tx`update adapters set status = 'active' where id = ${adapterId}`
  })
}

// ── items UPSERT (기획서 9-3② · ADR A13) ───────────────────────────────

export interface UpsertResult {
  /** 처음 등장한 아이템 (구독이 "새 항목만" 보낼 때 쓰는 그것) */
  newItemIds: string[]
  /** content_hash 가 바뀐 아이템 */
  changedItemIds: string[]
  total: number
}

/**
 * 신규 판정은 `(source_id, external_key)` 의 최초 등장이다 (ADR A13).
 * 변경 판정은 content_hash 의 변화다.
 */
export async function upsertItems(input: {
  collection_id: string
  source_id: string
  items: readonly InterpretedItem[]
}): Promise<UpsertResult> {
  const result: UpsertResult = { newItemIds: [], changedItemIds: [], total: 0 }
  if (input.items.length === 0) return result

  const keys = input.items.map((i) => i.external_key)
  const existingRows = await db.query.items.findMany({
    where: (i, { and, eq, inArray }) => and(eq(i.source_id, input.source_id), inArray(i.external_key, keys)),
  })
  const existing = new Map(existingRows.map((r) => [r.external_key, r]))

  const now = new Date()
  for (const item of input.items) {
    const hash = contentHashOf(item.data)
    const prev = existing.get(item.external_key)

    const rows = await db
      .insert(items)
      .values({
        collection_id: input.collection_id,
        source_id: input.source_id,
        external_key: item.external_key,
        data_json: item.data as ItemData,
        raw_json: item.raw as ItemRaw,
        provenance_json: item.provenance as ItemProvenance,
        content_hash: hash,
        first_seen_at: now,
        last_seen_at: now,
      })
      .onConflictDoUpdate({
        target: [items.source_id, items.external_key],
        set: {
          data_json: item.data as ItemData,
          raw_json: item.raw as ItemRaw,
          provenance_json: item.provenance as ItemProvenance,
          content_hash: hash,
          last_seen_at: now,
        },
      })
      .returning({ id: items.id })

    const id = rows[0]?.id
    if (id === undefined) continue
    result.total += 1

    if (prev === undefined) result.newItemIds.push(id)
    else if (prev.content_hash !== hash) result.changedItemIds.push(id)
  }

  return result
}

/** 변경 감지용 지문. 정규화된 값만 본다 — 원문의 공백 변화로 알림이 울리면 안 된다 */
export function contentHashOf(data: ItemData): string {
  return hashString(stableStringify(data))
}

// ── deliveries ─────────────────────────────────────────────────────────

export async function recordDelivery(input: {
  subscription_id: string
  item_ids: readonly string[]
  status: 'pending' | 'sent' | 'failed'
}): Promise<void> {
  await queryClient`
    insert into deliveries (subscription_id, item_ids, status)
    values (${input.subscription_id}, ${queryClient.array([...input.item_ids])}::uuid[], ${input.status})
  `
}

/** 같은 아이템을 두 번 보내지 않기 위한 확인 (기획서 9-4 "재발송·중복 방지") */
export async function alreadyDelivered(subscriptionId: string, itemIds: readonly string[]): Promise<Set<string>> {
  if (itemIds.length === 0) return new Set()
  const rows = await queryClient<{ item_ids: string[] }[]>`
    select item_ids from deliveries
    where subscription_id = ${subscriptionId} and status = 'sent'
    order by sent_at desc limit 50
  `
  const sent = new Set<string>()
  for (const row of rows) for (const id of row.item_ids) sent.add(id)
  return sent
}

export async function markSubscriptionSent(subscriptionId: string): Promise<void> {
  await queryClient`update subscriptions set last_sent_at = now() where id = ${subscriptionId}`
}
