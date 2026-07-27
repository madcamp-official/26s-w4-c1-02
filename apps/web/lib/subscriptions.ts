// 구독 저장·해지 (기획서 9-4 · 10장 `subscriptions` · P7 웹훅 먼저).
//
// 여기서는 구독을 **저장만** 한다 — 신규 항목을 골라 실제로 보내는 것은
// 워커(트랙 A)의 발송 잡이다. 화면이 만드는 행이 곧 그 잡의 입력이 된다.

import { DEFAULT_SUBSCRIPTION_SCHEDULE } from '@endpointer/core'

import { asDate } from './collections'
import { safeQuery, type Loaded } from './db'

export interface SubscriptionRecord {
  id: string
  target: string
  last_sent_at: Date | null
}

interface RawSubscriptionRow {
  id: string
  target: string
  last_sent_at: Date | string | null
}

/** 이 컬렉션에 걸린 웹훅 구독들 */
export async function listWebhookSubscriptions(
  collectionId: string,
): Promise<Loaded<SubscriptionRecord[]>> {
  return safeQuery(async (core) => {
    const rows = await core.queryClient<RawSubscriptionRow[]>`
      select id, target, last_sent_at
      from subscriptions
      where collection_id = ${collectionId} and channel = 'webhook'
      order by created_at asc
    `
    return rows.map((row) => ({ id: row.id, target: row.target, last_sent_at: asDate(row.last_sent_at) }))
  })
}

/** 웹훅 구독 등록. 같은 주소가 이미 있으면 새로 만들지 않는다 (created: false) */
export async function createWebhookSubscription(
  collectionId: string,
  userId: string,
  target: string,
): Promise<Loaded<{ created: boolean }>> {
  return safeQuery(async (core) => {
    const sql = core.queryClient
    const existing = await sql<{ id: string }[]>`
      select id
      from subscriptions
      where collection_id = ${collectionId} and channel = 'webhook' and target = ${target}
      limit 1
    `
    if (existing.length > 0) return { created: false }

    // filter_json 은 "표에서 건 필터 그대로"의 자리다 (기획서 10장).
    // 필터 UI 가 붙기 전까지는 전체 = 빈 필터로 저장한다.
    const emptyFilter = JSON.stringify({ eq: {}, gte: {}, lte: {} })
    await sql`
      insert into subscriptions (collection_id, user_id, channel, target, filter_json, schedule)
      values (${collectionId}, ${userId}, 'webhook', ${target},
              ${emptyFilter}::jsonb, ${DEFAULT_SUBSCRIPTION_SCHEDULE})
    `
    return { created: true }
  })
}

/** 구독 해지. 컬렉션 id 를 같이 걸어 다른 컬렉션의 구독을 지우지 못하게 한다 */
export async function removeSubscription(
  collectionId: string,
  subscriptionId: string,
): Promise<Loaded<null>> {
  return safeQuery(async (core) => {
    await core.queryClient`
      delete from subscriptions
      where id = ${subscriptionId} and collection_id = ${collectionId}
    `
    return null
  })
}
