// 구독 발송 (기획서 9-4 · P7 · ADR A11)
//
//   구독 조회 → 보낼 아이템 결정 → 중복 제거 → 채널로 발송 → deliveries 기록
//
// "무엇을 보낼지" 는 전부 여기 있고, "어떻게 보낼지" 는 channels/ 의 구현체에 있다.
// 그 경계가 P7 의 "웹훅 먼저, 이메일 이어서" 를 새 기능이 아니라 파일 하나 추가로 만든다.
//
// 침묵의 규칙: 보낼 신규 아이템이 없으면 **아무것도 보내지 않는다.**
// "오늘은 새 공고가 없습니다" 메일은 구독을 해지하게 만든다.

import type { ApiItem, FieldDef, ItemProvenance, ItemRaw, ItemValue } from '@endpointer/core'

import { getConfig } from '../config'
import {
  alreadyDelivered,
  hostsBySourceId,
  loadCollection,
  loadItems,
  loadSubscription,
  markSubscriptionSent,
  recordDelivery,
  type ItemRow,
} from '../db'
import { childLogger } from '../logger'
import type { DeliverJobData } from '../queues'
import { getDeliverer, type DeliveryPayload } from './channels'

export type DeliverJobResult =
  | { outcome: 'sent'; channel: string; items: number; detail: string }
  | { outcome: 'skipped'; reason: DeliverSkipReason }
  | { outcome: 'failed'; retryable: boolean; message: string }

export type DeliverSkipReason =
  /** 구독이 사라졌다 */
  | 'no_subscription'
  /** 보낼 신규 아이템이 없다 — 침묵한다 */
  | 'nothing_new'
  /** 이미 다 보냈다 */
  | 'already_sent'
  /** 채널 설정이 안 돼 있다 (이메일 키 없음 등) */
  | 'channel_unavailable'
  /** 주소 체크가 꺼져 있다 — 큐에 오른 뒤 껐어도 여기서 걸린다 */
  | 'disabled'

export async function runDeliverJob(data: DeliverJobData): Promise<DeliverJobResult> {
  const log = childLogger({ job: 'deliver', subscription_id: data.subscription_id })

  const sub = await loadSubscription(data.subscription_id)
  if (sub === null) return { outcome: 'skipped', reason: 'no_subscription' }
  if (!sub.enabled) return { outcome: 'skipped', reason: 'disabled' }

  const collection = await loadCollection(sub.collection_id)
  if (collection === null) return { outcome: 'skipped', reason: 'no_subscription' }

  // ── 보낼 아이템 결정 ─────────────────────────────────────────────────
  const wanted = await resolveItemIds(data)
  if (wanted.length === 0) return { outcome: 'skipped', reason: 'nothing_new' }

  // 재발송·중복 방지 (9-4). 같은 아이템은 두 번 가지 않는다.
  const sent = await alreadyDelivered(sub.id, wanted)
  const fresh = wanted.filter((id) => !sent.has(id))
  if (fresh.length === 0) return { outcome: 'skipped', reason: 'already_sent' }

  const rows = await loadItems(fresh)
  if (rows.length === 0) return { outcome: 'skipped', reason: 'nothing_new' }

  // ── 채널 ────────────────────────────────────────────────────────────
  const deliverer = getDeliverer(sub.channel)
  if (deliverer === null || !deliverer.isConfigured()) {
    log.warn({ channel: sub.channel }, '보낼 방법이 준비되지 않았습니다')
    return { outcome: 'skipped', reason: 'channel_unavailable' }
  }

  const payload = await buildPayload({
    slug: collection.slug,
    name: collection.name,
    fields: collection.schema_json,
    rows,
  })

  const result = await deliverer.deliver(sub.target, payload)

  if (!result.ok) {
    await recordDelivery({ subscription_id: sub.id, item_ids: fresh, status: 'failed' })
    log.warn({ channel: sub.channel, retryable: result.retryable }, '발송 실패')
    // 재시도할 만한 실패는 던져서 BullMQ 의 백오프에 태운다. 영구 실패는 값으로 끝낸다.
    if (result.retryable) throw new Error(result.message)
    return { outcome: 'failed', retryable: false, message: result.message }
  }

  await recordDelivery({ subscription_id: sub.id, item_ids: fresh, status: 'sent' })
  await markSubscriptionSent(sub.id)
  log.info({ channel: sub.channel, items: rows.length }, '발송 완료')

  return { outcome: 'sent', channel: sub.channel, items: rows.length, detail: result.detail }
}

// ── 보낼 아이템 고르기 ─────────────────────────────────────────────────

/**
 * 잡에 아이템이 실려 오면 그것을 쓰고, 비어 있으면(스케줄이 깨운 경우) 직접 찾는다.
 *
 * TODO(G3): 스케줄 발송 — `last_sent_at` 이후 처음 등장한 아이템을 `filter_json` 으로 걸러
 *           가져온다. core 의 `planItemsQuery` 를 그대로 써야 표에서 건 필터와 발송 조건이
 *           같은 뜻이 된다 (지금 core 의 query 모듈은 worker 에서 import 할 진입점이 없다).
 */
async function resolveItemIds(data: DeliverJobData): Promise<string[]> {
  if (data.item_ids.length > 0) return [...data.item_ids]
  return []
}

// ── 페이로드 만들기 ────────────────────────────────────────────────────

interface BuildPayloadInput {
  slug: string
  name: string
  fields: readonly FieldDef[]
  rows: readonly ItemRow[]
}

async function buildPayload(input: BuildPayloadInput): Promise<DeliveryPayload> {
  const cfg = getConfig()
  const hosts = await hostsBySourceId([...new Set(input.rows.map((r) => r.source_id))])

  const items = input.rows.map((row) =>
    toDeliveryItem(row, { host: hosts.get(row.source_id) ?? '', fields: input.fields }),
  )

  return {
    collection: {
      slug: input.slug,
      name: input.name,
      // 웹의 실제 라우트는 /collections/<slug> 다 — /c/ 는 존재한 적 없는 경로 (리허설 실측 수리)
      url: `${cfg.publicBaseUrl.replace(/\/$/, '')}/collections/${input.slug}`,
    },
    items,
    summary:
      items.length === 1
        ? `‘${input.name}’ 에 새 항목이 1건 올라왔어요.`
        : `‘${input.name}’ 에 새 항목이 ${items.length}건 올라왔어요.`,
    sent_at: new Date().toISOString(),
  }
}

/**
 * `items` 행 → 공개 API 와 같은 모양의 아이템.
 *
 * core 의 `toApiItem` 과 같은 일을 한다. 지금 복제해 둔 이유는 그 함수가
 * `packages/core/src/query` 에 있고 core 의 package.json 에 `"./query"` 진입점이 없어서
 * 워커가 패키지 이름으로 들어갈 수 없기 때문이다 (상대 경로로 넘어가지 않는다는 규약).
 *
 * TODO(G3): core 에 `"./query"` 진입점이 생기면 이 함수를 지우고 `toApiItem` 을 부른다.
 *           **웹훅 수신자가 보는 모양과 API 응답의 모양은 같아야 한다** — 그 약속을
 *           복제된 코드로 지키는 건 오래 갈 수 없다.
 */
function toDeliveryItem(row: ItemRow, opts: { host: string; fields: readonly FieldDef[] }): ApiItem {
  const out: Record<string, ItemValue | ItemProvenance | ItemRaw | undefined> = {}
  for (const field of opts.fields) {
    out[field.key] = row.data_json[field.key] ?? null
  }
  const linkField = opts.fields.find((f) => f.type === 'link')
  const link = linkField ? row.data_json[linkField.key] : row.data_json['link']

  out['_source'] = opts.host
  out['_first_seen_at'] = row.first_seen_at.toISOString()
  out['_link'] = typeof link === 'string' && link !== '' ? link : null

  return out as unknown as ApiItem
}
