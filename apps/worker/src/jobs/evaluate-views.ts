// 뷰 평가 — enter 전이 감지 (뷰 계약 A34 · 델타 2-5·2-6)
//
//   [뷰의 조건] ─viewToQuery─ [지금 매칭되는 항목 집합]
//                                    │ 차집합 (view_matches 와)
//                          enter ────┴──── exit
//
// ── 왜 수집과 별개로 매일 도는가 ────────────────────────────────────────
// `마감 D-7 이내` 뷰는 **데이터가 안 바뀌어도** 전이가 일어난다 — 어제 D-8 이던 것이
// 오늘 D-7 이 된다. 그리고 그게 사용자가 가장 원하는 알림이다 (델타 2-6).
// 그래서 트리거가 둘이다: 수집 직후(새 데이터) + KST 자정 직후(시간 전이).
//
// ── 매칭 판정은 여기서 하지 않는다 ──────────────────────────────────────
// `viewToQuery`(core) → `buildItemsWhere`(core) — 표·REST·MCP 가 타는 **바로 그 코드**로
// 매칭 집합을 만든다. 여기서 조건을 따로 해석하면 "표에서 보이는 것과 알림이 오는 것이
// 다르다"가 된다. 이 파일이 아는 것은 차집합과 동기화 순서뿐이다.
//
// ── 알림 (A36) ──────────────────────────────────────────────────────────
// 같은 전이 사건에서 한 항목이 뷰 3개에 걸려도 **채널당 1건** — 항목→뷰 목록으로 묶어
// notification_log 에 사건당 한 줄을 남기고, 24시간 안에 같은 (채널, 항목) 재발송은 막는다
// (경계값이 흔들려 매 평가마다 들락거리는 항목의 스팸 안전판). 재진입 자체는 새 사건이다.

import { buildItemsWhere, viewToQuery } from '@endpointer/core/query'
import type { ViewCondition, ViewSort } from '@endpointer/core'

import {
  db,
  items,
  listViews,
  loadCollection,
  loadSubscription,
  recentlyNotified,
  recordNotifications,
  syncViewMatches,
  viewMatchedItemIds,
  type ViewRow,
} from '../db'
import { childLogger } from '../logger'
import { enqueueDeliver } from '../queues'
import { channelKeyOf } from './channel-key'

const log = childLogger({ job: 'evaluate-views' })

export interface ViewEvaluation {
  view_id: string
  slug: string
  name: string
  /** 지금 조건에 맞는 항목 수 — 뷰 카드의 "(12)" */
  matched: number
  entered: string[]
  exited: string[]
  /** 알림이 걸려 있고 enter 가 있어 발송 큐에 넣었는가 */
  notified: boolean
}

/**
 * 한 컬렉션의 뷰 전부를 평가한다. 뷰 하나가 죽어도 나머지는 계속 간다 (원칙 ④).
 * `now` 를 받는 이유는 viewToQuery 와 같다 — 한 번의 평가는 한 시각으로 일관되게.
 */
export async function evaluateCollectionViews(
  collectionId: string,
  now: Date = new Date(),
): Promise<ViewEvaluation[]> {
  const collection = await loadCollection(collectionId)
  if (collection === null) return []

  const views = await listViews(collectionId)
  if (views.length === 0) return []

  const results: ViewEvaluation[] = []
  /** 채널별 발송 묶음 — 항목 하나가 여러 뷰에 걸리면 뷰 목록으로 합쳐진다 (A36) */
  const perChannel = new Map<string, Map<string, Set<string>>>()

  for (const view of views) {
    try {
      const evaluated = await evaluateOne(view, collection.schema_json, collectionId, now)
      results.push(evaluated)

      if (view.notify_json !== null && evaluated.entered.length > 0) {
        for (const channelId of view.notify_json.channels) {
          const byItem = perChannel.get(channelId) ?? new Map<string, Set<string>>()
          for (const itemId of evaluated.entered) {
            const viewIds = byItem.get(itemId) ?? new Set<string>()
            viewIds.add(view.id)
            byItem.set(itemId, viewIds)
          }
          perChannel.set(channelId, byItem)
        }
      }
    } catch (e) {
      // 이 뷰만 건너뛴다. 조건 하나가 이상해도 다른 뷰의 알림은 나가야 한다.
      log.error({ err: e, view: view.slug }, '뷰 하나를 평가하지 못했다')
    }
  }

  const notifiedViews = await notifyEnters(perChannel, now)
  for (const r of results) if (notifiedViews.has(r.view_id)) r.notified = true

  return results
}

async function evaluateOne(
  view: ViewRow,
  fields: import('@endpointer/core').CollectionSchemaJson,
  collectionId: string,
  now: Date,
): Promise<ViewEvaluation> {
  // 네 출구가 타는 그 코드로 매칭 집합을 만든다 (머리말)
  const query = viewToQuery(
    { where: view.where_json as ViewCondition[], sort: view.sort_json as ViewSort[] },
    now,
  )
  const where = buildItemsWhere(query, { collectionId, fields })
  const rows = await db.select({ id: items.id }).from(items).where(where)
  const current = new Set(rows.map((r) => r.id))

  const previous = await viewMatchedItemIds(view.id)
  const entered = [...current].filter((id) => !previous.has(id))
  const exited = [...previous].filter((id) => !current.has(id))

  // exit 는 지운다 (계약 §7 결정 ①) — 그래야 재진입이 새 enter 로 잡힌다
  await syncViewMatches(view.id, entered, exited, now)

  return { view_id: view.id, slug: view.slug, name: view.name, matched: current.size, entered, exited, notified: false }
}

// ── 알림 (A36) ─────────────────────────────────────────────────────────

/** 발송까지 간 뷰 id 집합을 돌려준다 (평가 결과 표시용) */
async function notifyEnters(
  perChannel: ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>,
  now: Date,
): Promise<Set<string>> {
  const notifiedViews = new Set<string>()

  for (const [channelId, byItem] of perChannel) {
    const sub = await loadSubscription(channelId)
    if (sub === null) {
      log.warn({ channel: channelId }, '뷰가 가리키는 배달 채널이 없다 — 건너뜁니다')
      continue
    }

    const channelKey = channelKeyOf(sub.channel, sub.target)
    const itemIds = [...byItem.keys()]

    // 24시간 안전판 — 이미 나간 (채널, 항목) 은 다시 보내지 않는다
    const recent = await recentlyNotified(channelKey, itemIds, now)
    const fresh = itemIds.filter((id) => !recent.has(id))
    if (fresh.length === 0) continue

    // 사건 기록이 발송보다 먼저다 — 발송이 재시도돼도 기록은 한 번이다
    await recordNotifications(
      channelKey,
      fresh.map((item_id) => ({ item_id, view_ids: [...(byItem.get(item_id) ?? [])] })),
      now,
    )

    await enqueueDeliver({
      subscription_id: sub.id,
      collection_id: sub.collection_id,
      item_ids: fresh,
      reason: 'immediate',
    })

    for (const item of fresh) for (const viewId of byItem.get(item) ?? []) notifiedViews.add(viewId)
    log.info({ channel: channelKey, items: fresh.length }, 'enter 알림을 발송 큐에 넣었다')
  }

  return notifiedViews
}
