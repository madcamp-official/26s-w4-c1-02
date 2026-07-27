// 만들어진 표를 DB 에 앉힌다 (기획서 9-1 의 끝 · 10장)
//
// `create-collection.ts` 는 DB 를 모른다. 저장은 전부 여기서 한다. 그 경계 덕분에
// 화면의 "미리보기" 는 저장 없이 같은 파이프라인을 부를 수 있고, 사용자가 표를 보고
// **확인을 누른 다음에** 저장이 일어난다.
//
// ── 저장 순서가 곧 안전 순서다 ──────────────────────────────────────────
//   collection → source → adapter(candidate) → promote(active) → items
//
// 어댑터를 곧장 active 로 넣지 않고 candidate 로 넣었다가 올리는 이유:
// `insertCandidateAdapter` + `promoteAdapter` 가 자가 치유와 **같은 경로**이기 때문이다.
// 여기서만 다른 방법으로 넣으면 "한 소스에 active 가 둘" 같은 상태가 두 경로 중
// 한쪽에서만 생긴다.

import type { AdapterSpec, InterpretedItem } from '@endpointer/core/spec'
import type { CollectionSchemaJson, FetchMode, ValidationReport } from '@endpointer/core'

import {
  collections,
  db,
  finishRun,
  insertCandidateAdapter,
  promoteAdapter,
  queryClient,
  sources,
  startRun,
  upsertItems,
  type CollectionRow,
  type SourceRow,
} from '../db'
import { childLogger } from '../logger'

const log = childLogger({ mod: 'persist' })

export interface PersistInput {
  owner_id: string
  name: string
  /** 원하는 slug. 이미 있으면 뒤에 숫자를 붙인다 */
  slug: string
  schema: CollectionSchemaJson
  /** 기획서 16장 O2 의 기본값 */
  visibility?: 'private' | 'unlisted' | 'public'

  host: string
  entry_url: string
  fetch_mode: FetchMode

  spec: AdapterSpec
  items: readonly InterpretedItem[]
  report: ValidationReport
}

export interface PersistResult {
  collection: CollectionRow
  source: SourceRow
  adapter_version: number
  items_inserted: number
}

/**
 * 새 컬렉션 하나를 통째로 앉힌다.
 *
 * 실패하면 **아무것도 남기지 않는다** — 컬렉션만 만들어지고 어댑터가 없는 상태로 남으면
 * 화면에는 빈 표가 보이고 정기 수집은 조용히 건너뛴다 (collect.ts 가 adapter===null 을 skip 한다).
 * 그건 사용자가 원인을 알 수 없는 고장이다.
 */
export async function persistNewCollection(input: PersistInput): Promise<PersistResult> {
  const slug = await uniqueSlug(input.slug)

  // ── 컬렉션 + 사이트는 한 트랜잭션으로 ─────────────────────────────────
  // 이 둘이 갈라지면 소속 없는 사이트나 사이트 없는 컬렉션이 남는다.
  const created = await db.transaction(async (tx) => {
    const collectionRows = await tx
      .insert(collections)
      .values({
        owner_id: input.owner_id,
        slug,
        name: input.name,
        schema_json: input.schema,
        schema_version: 1,
        visibility: input.visibility ?? 'unlisted',
      })
      .returning()
    const collection = collectionRows[0]
    if (collection === undefined) throw new Error('컬렉션 행이 만들어지지 않았습니다')

    const sourceRows = await tx
      .insert(sources)
      .values({
        collection_id: collection.id,
        host: input.host,
        entry_url: input.entry_url,
        status: 'ok',
        fetch_mode: input.fetch_mode,
      })
      .returning()
    const source = sourceRows[0]
    if (source === undefined) throw new Error('사이트 행이 만들어지지 않았습니다')

    return { collection, source }
  })

  try {
    // ── 어댑터: 치유와 같은 경로로 넣고 올린다 ──────────────────────────
    const adapter = await insertCandidateAdapter({
      source_id: created.source.id,
      spec: input.spec,
      origin: 'llm',
      validation: input.report,
    })
    if (adapter === null) throw new Error('추출 방법을 저장하지 못했습니다')
    await promoteAdapter(created.source.id, adapter.id)

    // ── 첫 수집 기록 — 이 컬렉션의 드리프트 기준선 첫 값이 된다 ─────────
    const runId = await startRun({ source_id: created.source.id, adapter_id: adapter.id })
    const upsert = await upsertItems({
      collection_id: created.collection.id,
      source_id: created.source.id,
      items: input.items,
    })
    if (runId !== null) {
      await finishRun(runId, {
        status: 'ok',
        items_found: input.items.length,
        items_new: upsert.newItemIds.length,
        validation_json: input.report,
        error_summary: null,
      })
    }

    log.info(
      { slug, host: input.host, items: upsert.total, version: adapter.version },
      '컬렉션을 만들었다',
    )

    return {
      collection: created.collection,
      source: created.source,
      adapter_version: adapter.version,
      items_inserted: upsert.total,
    }
  } catch (cause) {
    // 반쪽짜리 컬렉션을 남기지 않는다. sources·adapters·items·runs 는
    // ON DELETE CASCADE 로 같이 지워진다 (schema.ts).
    await queryClient`delete from collections where id = ${created.collection.id}`.catch(() => {})
    throw cause
  }
}

/**
 * slug 는 `GET /api/v1/{slug}` 에 그대로 들어가고 unique 제약이 걸려 있다.
 * 충돌하면 `-2`, `-3` 을 붙인다 — 사용자에게 "이미 쓰는 이름입니다" 를 묻지 않는다 (보장선 B1·B3).
 */
export async function uniqueSlug(desired: string): Promise<string> {
  const base = desired.replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '') || 'collection'
  for (let n = 1; n <= 50; n += 1) {
    const candidate = n === 1 ? base : `${base}-${n}`
    const hit = await db.query.collections.findFirst({
      where: (c, { eq }) => eq(c.slug, candidate),
      columns: { id: true },
    })
    if (hit === undefined) return candidate
  }
  // 50개나 겹치는 건 사실상 없다. 그래도 던지지 않고 유일한 값을 만든다.
  return `${base}-${Date.now().toString(36)}`
}
