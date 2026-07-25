// 구독과 발송 — 기획서 10장 `subscriptions` · `deliveries`
// 채널은 인터페이스로 추상화하고 웹훅을 먼저 붙인다 (ADR A11)

import { z } from 'zod'
import type { CollectionFilter } from './api'

/** G0 계약 (1) */
export const SUBSCRIPTION_CHANNELS = ['webhook', 'email'] as const
export type SubscriptionChannel = (typeof SUBSCRIPTION_CHANNELS)[number]
export const SubscriptionChannelSchema = z.enum(SUBSCRIPTION_CHANNELS)

/** 기본 스케줄 — 매일 오전 9시 */
export const DEFAULT_SUBSCRIPTION_SCHEDULE = '0 9 * * *'

/** 기획서 10장 `subscriptions` */
export interface Subscription {
  id: string
  collection_id: string
  user_id: string
  channel: SubscriptionChannel
  /** URL 또는 이메일 주소 */
  target: string
  /** 표에서 건 필터 그대로 */
  filter_json: CollectionFilter
  /** cron 표현식 */
  schedule: string
  last_sent_at: Date | null
  created_at: Date
}

export type SubscriptionInput = Omit<Subscription, 'id' | 'created_at'>

/**
 * 발송 결과 상태. 기획서에 값이 명시돼 있지 않아 G0 에서 고정한다.
 * 재시도는 BullMQ 가 맡으므로 `pending` 은 큐에 올라간 상태를 뜻한다.
 */
export const DELIVERY_STATUSES = ['pending', 'sent', 'failed'] as const
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number]
export const DeliveryStatusSchema = z.enum(DELIVERY_STATUSES)

/** 기획서 10장 `deliveries` */
export interface Delivery {
  id: string
  subscription_id: string
  item_ids: string[]
  sent_at: Date
  status: DeliveryStatus
}

export type DeliveryInput = Omit<Delivery, 'id' | 'sent_at'>
