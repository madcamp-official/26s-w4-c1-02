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
  /** 사용자가 붙인 이름. null 이면 화면이 target 호스트로 대신한다 */
  name: string | null
  /** 체크박스 — 꺼진 주소로는 아무것도 안 간다 */
  enabled: boolean
  last_sent_at: Date | null
}

interface RawSubscriptionRow {
  id: string
  target: string
  name: string | null
  enabled: boolean
  last_sent_at: Date | string | null
}

/** 받을 곳을 부르는 이름 — 붙인 이름이 없으면 주소의 호스트로 대신한다 */
export function subscriptionDisplayName(record: Pick<SubscriptionRecord, 'name' | 'target'>): string {
  if (record.name !== null && record.name !== '') return record.name
  try {
    return new URL(record.target).host
  } catch {
    return record.target
  }
}

/** 이 컬렉션에 걸린 웹훅 구독들 */
export async function listWebhookSubscriptions(
  collectionId: string,
): Promise<Loaded<SubscriptionRecord[]>> {
  return safeQuery(async (core) => {
    const rows = await core.queryClient<RawSubscriptionRow[]>`
      select id, target, name, enabled, last_sent_at
      from subscriptions
      where collection_id = ${collectionId} and channel = 'webhook'
      order by created_at asc
    `
    return rows.map((row) => ({
      id: row.id,
      target: row.target,
      name: row.name,
      enabled: row.enabled,
      last_sent_at: asDate(row.last_sent_at),
    }))
  })
}

/**
 * 웹훅 구독 등록. 같은 주소가 이미 있으면 새로 만들지 않는다 (created: false) —
 * 대신 이름이 새로 들어왔으면 그 이름으로 바꿔 단다 (renamed: true). 같은 주소를
 * 다시 붙여넣는 것이 곧 이름 바꾸기가 되도록.
 */
export async function createWebhookSubscription(
  collectionId: string,
  userId: string,
  target: string,
  name: string | null,
): Promise<Loaded<{ created: boolean; renamed: boolean }>> {
  return safeQuery(async (core) => {
    const sql = core.queryClient
    const existing = await sql<{ id: string; name: string | null }[]>`
      select id, name
      from subscriptions
      where collection_id = ${collectionId} and channel = 'webhook' and target = ${target}
      limit 1
    `
    const first = existing[0]
    if (first !== undefined) {
      if (name === null || name === first.name) return { created: false, renamed: false }
      await sql`update subscriptions set name = ${name} where id = ${first.id}`
      return { created: false, renamed: true }
    }

    // filter_json 은 "표에서 건 필터 그대로"의 자리다 (기획서 10장).
    // 필터 UI 가 붙기 전까지는 전체 = 빈 필터로 저장한다.
    const emptyFilter = JSON.stringify({ eq: {}, gte: {}, lte: {} })
    await sql`
      insert into subscriptions (collection_id, user_id, channel, target, name, filter_json, schedule)
      values (${collectionId}, ${userId}, 'webhook', ${target}, ${name},
              ${emptyFilter}::jsonb, ${DEFAULT_SUBSCRIPTION_SCHEDULE})
    `
    return { created: true, renamed: false }
  })
}

/** 주소 체크 켬/끔. 컬렉션 id 를 같이 걸어 다른 컬렉션의 것을 만지지 못하게 한다 */
export async function setSubscriptionEnabled(
  collectionId: string,
  subscriptionId: string,
  enabled: boolean,
): Promise<Loaded<null>> {
  return safeQuery(async (core) => {
    await core.queryClient`
      update subscriptions set enabled = ${enabled}
      where id = ${subscriptionId} and collection_id = ${collectionId}
    `
    return null
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
