// 창작마당 — 공개 컬렉션을 전시하고, 복제로 가져오게 한다 (델타 §8).
//
// 창작마당은 "구독" 이 아니라 "복제" 다. 남이 만든 표를 **가져와 내 것으로** 만들고
// 거기에 내가 아는 사이트를 빼고 더한다. 이 한 흐름이 빈 화면 문제와 소스 발견 문제를
// 동시에 푼다 — 남이 만든 게 예시가 되고, 남이 이미 URL 을 찾아놨다.
//
// 실제 복제(sources·adapters·items·views 복사)는 워커가 한다 (`/internal/clone`).
// 화면은 목록을 읽고, 복제를 **부탁**할 뿐이다. 쓰기는 워커의 persist 계층이 소유한다.

import { callWorker } from './create'
import { asDate, type CollectionRecord } from './collections'
import { safeQuery, type Loaded } from './db'

/** 창작마당 카드 하나 — 목록에 그릴 최소 정보 */
export interface GalleryCollection {
  id: string
  slug: string
  name: string
  schema_version: number
  updated_at: Date
  /** 원작자 이름 (크레딧) */
  author: string
  item_count: number
  site_count: number
  /** 카드에 그릴 사이트 호스트들 */
  hosts: string[]
  /** 이 컬렉션이 복제된 횟수 — 인기 정렬·"복제 N회" 표시의 재료 */
  fork_count: number
}

interface RawGalleryRow {
  id: string
  slug: string
  name: string
  schema_version: number
  updated_at: Date | string
  author: string | null
  item_count: number
  site_count: number
  hosts: string[] | null
  fork_count: number
}

/**
 * 창작마당에 전시된 컬렉션들. **전시(listed) + 공개(public) + 항목이 있는** 것만.
 * "누구나 볼 수 있음(public)" 과 "갤러리에 올림(listed)" 은 의도가 다르므로 둘 다 요구한다.
 * 인기(복제수) 우선, 그다음 최신순.
 */
export async function listGalleryCollections(limit = 30): Promise<Loaded<GalleryCollection[]>> {
  return safeQuery(async (core) => {
    const rows = await core.queryClient<RawGalleryRow[]>`
      select
        c.id, c.slug, c.name, c.schema_version, c.updated_at,
        u.name as author,
        (select count(*)::int from items i where i.collection_id = c.id) as item_count,
        (select count(*)::int from sources s where s.collection_id = c.id) as site_count,
        (select coalesce(array_agg(s.host order by s.created_at), '{}')
           from sources s where s.collection_id = c.id) as hosts,
        (select count(*)::int from collections f where f.forked_from = c.id) as fork_count
      from collections c
      join users u on u.id = c.owner_id
      where c.listed = true and c.visibility = 'public'
        and exists (select 1 from items i where i.collection_id = c.id)
      order by fork_count desc, c.updated_at desc
      limit ${limit}
    `
    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      schema_version: row.schema_version,
      updated_at: asDate(row.updated_at) ?? new Date(0),
      author: row.author ?? '익명',
      item_count: Number(row.item_count),
      site_count: Number(row.site_count),
      hosts: row.hosts ?? [],
      fork_count: Number(row.fork_count),
    }))
  })
}

/** 공개 상세에 얹는 메타 — 원작자 이름과 복제 횟수 */
export interface GalleryMeta {
  author: string
  fork_count: number
}

interface RawGalleryMetaRow {
  author: string | null
  fork_count: number
}

export async function galleryMetaFor(collectionId: string): Promise<Loaded<GalleryMeta>> {
  return safeQuery(async (core) => {
    const rows = await core.queryClient<RawGalleryMetaRow[]>`
      select
        u.name as author,
        (select count(*)::int from collections f where f.forked_from = c.id) as fork_count
      from collections c
      join users u on u.id = c.owner_id
      where c.id = ${collectionId}
      limit 1
    `
    const row = rows[0]
    return {
      author: row?.author ?? '익명',
      fork_count: Number(row?.fork_count ?? 0),
    }
  })
}

/** "○○에서 복제됨" 크레딧 한 줄. forked_from 이 없으면 null */
export interface ForkCredit {
  slug: string
  name: string
  author: string
  /** 원본이 아직 창작마당에 전시돼 있어 링크로 갈 수 있는지 */
  visible: boolean
}

interface RawForkCreditRow {
  slug: string
  name: string
  author: string | null
  listed: boolean
  visibility: string
}

/** 이 컬렉션이 복제본이면 원본 크레딧을 돌려준다. 원본이 지워졌으면(forked_from=null) null */
export async function forkCreditFor(collectionId: string): Promise<Loaded<ForkCredit | null>> {
  return safeQuery(async (core) => {
    const rows = await core.queryClient<RawForkCreditRow[]>`
      select o.slug, o.name, uo.name as author, o.listed, o.visibility
      from collections c
      join collections o on o.id = c.forked_from
      join users uo on uo.id = o.owner_id
      where c.id = ${collectionId}
      limit 1
    `
    const row = rows[0]
    if (row === undefined) return null
    return {
      slug: row.slug,
      name: row.name,
      author: row.author ?? '익명',
      visible: row.listed === true && row.visibility === 'public',
    }
  })
}

/**
 * 창작마당 전시 여부를 바꾼다. **전시하려면 공개여야 한다** —
 * private·unlisted 를 갤러리에 올리면 카드는 보이는데 열면 막히는 모순이 된다.
 * 그래서 전시를 켤 때 공개가 아니면 여기서 막고, 부르는 쪽이 사람 문장을 낸다.
 */
export async function setCollectionListed(
  collection: Pick<CollectionRecord, 'id' | 'visibility'>,
  listed: boolean,
): Promise<Loaded<null> & { blocked?: boolean }> {
  if (listed && collection.visibility !== 'public') {
    return { ok: false, message: '창작마당에 올리려면 먼저 공개로 바꿔 주세요.', blocked: true }
  }
  return safeQuery(async (core) => {
    await core.queryClient`
      update collections set listed = ${listed}, updated_at = now() where id = ${collection.id}
    `
    return null
  })
}

// ── 복제 (워커에 부탁한다) ───────────────────────────────────────────────

type WorkerCloneBody =
  | { ok: false; message: string; stage: string }
  | { ok: true; slug: string; name: string; sources_copied: number; items_copied: number; views_copied: number }

export interface CloneOk {
  slug: string
  name: string
  sources_copied: number
  items_copied: number
  views_copied: number
}

export const CLONE_UNAVAILABLE =
  '지금은 복제하지 못하고 있어요. 잠시 뒤에 다시 시도해 주세요.'

/** 공개 컬렉션 하나를 내 것으로 복제한다. 실패는 값으로 (보장선 B4) */
export async function cloneViaWorker(input: {
  sourceSlug: string
  ownerId: string
  name?: string
}): Promise<Loaded<CloneOk>> {
  const body = await callWorker<WorkerCloneBody>('/internal/clone', {
    source_slug: input.sourceSlug,
    owner_id: input.ownerId,
    ...(input.name !== undefined ? { name: input.name } : {}),
  })
  if (body === null) return { ok: false, message: CLONE_UNAVAILABLE }
  if (!body.ok) return { ok: false, message: body.message }
  return {
    ok: true,
    data: {
      slug: body.slug,
      name: body.name,
      sources_copied: body.sources_copied,
      items_copied: body.items_copied,
      views_copied: body.views_copied,
    },
  }
}
