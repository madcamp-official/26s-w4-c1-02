// 컬렉션 복제 — 모두의 컬렉션의 심장 (델타 §8)
//
// 모두의 컬렉션은 "구독" 이 아니라 "복제" 다. 남의 공개 컬렉션을 **가져와 내 것으로** 만들고,
// 거기에 내가 아는 사이트를 빼고 더한다. 이 한 흐름이 두 문제를 동시에 푼다 —
// 빈 화면(남이 만든 게 예시가 된다)과 소스 발견(남이 이미 URL 을 찾아놨다).
//
// ── 왜 재컴파일하지 않고 spec_json 을 그대로 복사하는가 ──────────────────
// 원본 소스마다 이미 검증을 통과한 active 어댑터가 있다. 그걸 다시 LLM 으로 만들면
// 무료 티어 호출을 태우면서 **원본이 튜닝한 추출법보다 나빠질 수도** 있다. 복제는
// 그 spec 을 그대로 물려받는다. 비용 0, 품질은 원본과 동일.
//
// ── 왜 아이템까지 복사하는가 ────────────────────────────────────────────
// 모두의 컬렉션이 존재하는 이유가 "빈 화면을 없애는 것" 이다. 복제 직후 표가 비어 있으면
// 그 문제가 되살아난다. 그래서 아이템을 통째로 복사해 **복제하자마자 표가 차 있게** 한다.
// 이후 갱신은 스케줄이 맡는다 (아래). 원본 FK 만 새 소스·컬렉션으로 갈아끼우고 나머지는
// 그대로 둔다 — first_seen_at 을 보존해야 "언제 등장한 항목인지" 가 정직하다.
//
// ── 복제하지 않는 것 ────────────────────────────────────────────────────
//   · notify (알림 채널) — 웹훅 URL·메일은 원작자의 자격증명이다. where/sort 만 가져오고 끈다.
//   · api_key_hash — 복제본은 내 것이라 private 으로 시작한다. 키는 필요할 때 내가 만든다.

import {
  collections,
  db,
  insertCandidateAdapter,
  promoteAdapter,
  queryClient,
  sources,
  views,
} from '../db'
import { childLogger } from '../logger'
import { scheduleSource } from '../queues'
import { uniqueSlug } from './persist'

const log = childLogger({ mod: 'clone' })

export interface CloneInput {
  /** 복제할 원본 컬렉션의 slug */
  source_slug: string
  /** 복제본의 주인 */
  new_owner_id: string
  /** 복제본 이름. 없으면 원본 이름을 쓴다 */
  new_name?: string
}

export type CloneOutcome =
  | {
      ok: true
      slug: string
      name: string
      sources_copied: number
      items_copied: number
      views_copied: number
    }
  | { ok: false; message: string; stage: string }

export async function cloneCollection(input: CloneInput): Promise<CloneOutcome> {
  const original = await db.query.collections.findFirst({
    where: (c, { eq }) => eq(c.slug, input.source_slug),
  })
  if (original === undefined) {
    return { ok: false, message: '그런 컬렉션이 없어요.', stage: 'not_found' }
  }
  // private 은 링크로도 못 여는 컬렉션이다 — 복제도 막는다. 화면이 이미 걸러도 여기서 한 번 더.
  if (original.visibility === 'private') {
    return { ok: false, message: '이 컬렉션은 복제할 수 없어요.', stage: 'forbidden' }
  }

  const originalSources = await db.query.sources.findMany({
    where: (s, { eq }) => eq(s.collection_id, original.id),
  })
  if (originalSources.length === 0) {
    return { ok: false, message: '복제할 사이트가 없어요.', stage: 'empty' }
  }

  const name = input.new_name?.trim() !== undefined && input.new_name.trim() !== '' ? input.new_name.trim() : original.name
  const slug = await uniqueSlug(original.slug)

  // 복제본은 private·미전시로 시작한다 (내 것이니까). forked_from 이 원작자 크레딧의 근거.
  const createdRows = await db
    .insert(collections)
    .values({
      owner_id: input.new_owner_id,
      slug,
      name,
      schema_json: original.schema_json,
      schema_version: original.schema_version,
      visibility: 'private',
      listed: false,
      forked_from: original.id,
    })
    .returning()
  const created = createdRows[0]
  if (created === undefined) {
    return { ok: false, message: '복제하지 못했어요.', stage: 'insert' }
  }

  try {
    let itemsCopied = 0
    const scheduled: { source_id: string; host: string; schedule: string }[] = []

    for (const src of originalSources) {
      const sourceRows = await db
        .insert(sources)
        .values({
          collection_id: created.id,
          host: src.host,
          entry_url: src.entry_url,
          status: 'ok',
          schedule: src.schedule,
          fetch_mode: src.fetch_mode,
        })
        .returning()
      const newSource = sourceRows[0]
      if (newSource === undefined) continue

      // active 어댑터의 spec 을 그대로 물려준다 (persist 와 같은 경로: candidate → promote).
      const active = await db.query.adapters.findFirst({
        where: (a, { and, eq }) => and(eq(a.source_id, src.id), eq(a.status, 'active')),
        orderBy: (a, { desc }) => [desc(a.version)],
      })
      if (active !== undefined) {
        const candidate = await insertCandidateAdapter({
          source_id: newSource.id,
          spec: active.spec_json,
          origin: 'llm',
          validation: active.validation_json ?? null,
        })
        if (candidate !== null) await promoteAdapter(newSource.id, candidate.id)
      }

      // 아이템 복사 — FK 만 새 소스·컬렉션으로 갈아끼우고 나머지는 보존한다.
      // (source_id, external_key) 유니크는 소스별이라 새 소스에서는 충돌하지 않는다.
      const copied = await queryClient`
        insert into items
          (collection_id, source_id, external_key, data_json, raw_json, provenance_json, content_hash, first_seen_at, last_seen_at)
        select ${created.id}, ${newSource.id}, external_key, data_json, raw_json, provenance_json, content_hash, first_seen_at, last_seen_at
        from items where source_id = ${src.id}
      `
      itemsCopied += copied.count
      scheduled.push({ source_id: newSource.id, host: newSource.host, schedule: newSource.schedule })
    }

    // 뷰 복사 — where/sort/columns/pinned 만. notify 는 자격증명이라 끈 채로 (머리말).
    const originalViews = await db.query.views.findMany({
      where: (v, { eq }) => eq(v.collection_id, original.id),
    })
    for (const v of originalViews) {
      await db.insert(views).values({
        collection_id: created.id,
        slug: v.slug,
        name: v.name,
        where_json: v.where_json,
        sort_json: v.sort_json,
        columns_json: v.columns_json,
        notify_json: null,
        owner_id: input.new_owner_id,
        pinned: v.pinned,
      })
    }

    // 이후 자동 갱신을 위해 스케줄만 등록한다 (immediately:false).
    // 즉시 수집은 하지 않는다 — 방금 아이템을 통째로 복사했으니 표는 이미 차 있고,
    // 복제 직후 원본 사이트를 소스 수만큼 때리는 건 무례하다. 다음 크론에 자연히 갱신된다.
    for (const s of scheduled) {
      await scheduleSource({
        source_id: s.source_id,
        collection_id: created.id,
        host: s.host,
        schedule: s.schedule,
        immediately: false,
      }).catch((cause: unknown) => {
        // 스케줄 등록 실패는 치명적이지 않다 — 워커 부팅 시 syncSourceSchedules 가 다시 맞춘다.
        log.warn({ err: cause, source_id: s.source_id }, '복제본 스케줄 등록 실패 (부팅 시 재동기화됨)')
      })
    }

    log.info(
      { from: original.slug, to: slug, sources: scheduled.length, items: itemsCopied, views: originalViews.length },
      '컬렉션을 복제했다',
    )

    return {
      ok: true,
      slug,
      name,
      sources_copied: scheduled.length,
      items_copied: itemsCopied,
      views_copied: originalViews.length,
    }
  } catch (cause) {
    // 반쪽짜리 복제본을 남기지 않는다. sources·adapters·items·views 는 CASCADE 로 같이 지워진다.
    await queryClient`delete from collections where id = ${created.id}`.catch(() => {})
    log.error({ err: cause, from: original.slug }, '복제 중 실패 — 복제본을 되돌렸다')
    return { ok: false, message: '복제하지 못했어요. 잠시 뒤 다시 시도해 주세요.', stage: 'copy' }
  }
}
