// 큐 · 잡 페이로드 · 스케줄 (ADR A8 — repeatable job 이 크론을 대체한다)
//
// 큐는 세 개다. 기획서 9-3 · 9-4 의 흐름이 그대로 큐 경계가 된다.
//
//   collect  소스 하나를 한 바퀴 돈다 (스케줄이 밀어넣는다)
//   heal     드리프트가 잡힌 소스를 격리·재컴파일한다 (collect 가 밀어넣는다)
//   deliver  신규 아이템을 구독 채널로 보낸다 (collect 가 밀어넣는다)
//
// ── 소스별 rate limit 에 대한 메모 (기획서 6장 기술적 예의) ─────────────
// BullMQ 의 `limiter` 는 **워커 단위**라 "호스트별 1.5초 간격" 을 그대로 표현하지 못한다.
// 그래서 두 겹으로 건다:
//   ① 워커 limiter — 전체 처리량의 상한 (여기)
//   ② 호스트별 간격 — `fetchers/http.ts` 의 throttle (실제 예의를 지키는 쪽)
// BullMQ Pro 의 group rate limit 이 있으면 ②를 큐로 올릴 수 있다. 지금은 ②가 진짜다.

import { Queue, type JobsOptions, type RateLimiterOptions } from 'bullmq'

import { getConfig } from './config'
import { getRedis } from './redis'

// ── 이름 ───────────────────────────────────────────────────────────────

export const QUEUE_PREFIX = 'endpointer'

export const QUEUE_COLLECT = 'collect'
export const QUEUE_HEAL = 'heal'
export const QUEUE_DELIVER = 'deliver'
export const QUEUE_EVALUATE = 'evaluate'

export const QUEUE_NAMES = [QUEUE_COLLECT, QUEUE_HEAL, QUEUE_DELIVER, QUEUE_EVALUATE] as const
export type QueueName = (typeof QUEUE_NAMES)[number]

// ── 잡 페이로드 ────────────────────────────────────────────────────────
//
// 페이로드에는 **id 만** 담는다. 객체를 통째로 넣으면 큐에 든 잡이 DB 와 어긋난다.

/** 왜 이 수집이 시작됐는지 — run 로그와 화면 문구가 이걸 쓴다 */
export type CollectReason = 'schedule' | 'manual' | 'first_run' | 'after_heal'

export interface CollectJobData {
  source_id: string
  collection_id: string
  /** 로그·rate limit 키. DB 를 안 읽고도 어느 사이트인지 알기 위해 넣는다 */
  host: string
  reason: CollectReason
}

export interface HealJobData {
  source_id: string
  collection_id: string
  /** 드리프트를 잡아낸 run */
  run_id: string
  /** 오늘 몇 번째 시도인지 (1부터). 상한은 HEAL_MAX_ATTEMPTS_PER_DAY */
  attempt: number
}

export type DeliverReason = 'schedule' | 'immediate'

export interface DeliverJobData {
  subscription_id: string
  collection_id: string
  /** 보낼 아이템. 비어 있으면 발송하지 않는다 (신규가 없으면 침묵) */
  item_ids: string[]
  reason: DeliverReason
}

/**
 * 뷰 평가 (A34). collection_id 가 null 이면 **전체** 컬렉션 — 일일 잡이 이것이다.
 * 수집 직후의 평가는 collect 잡 안에서 직접 부르므로 큐를 타지 않는다.
 */
export interface EvaluateJobData {
  collection_id: string | null
}

export interface QueueDataMap {
  collect: CollectJobData
  heal: HealJobData
  deliver: DeliverJobData
  evaluate: EvaluateJobData
}

// ── 잡 옵션 ────────────────────────────────────────────────────────────

/** 실패한 잡을 며칠씩 쌓아두지 않는다. 5일짜리 VM 에서 Redis 를 태우면 안 된다 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 60 * 60 * 24, count: 200 },
  removeOnFail: { age: 60 * 60 * 24 * 3, count: 200 },
}

/**
 * 최소 요청 간격을 워커 limiter 로 환산한다.
 * `max: 1 / duration: 간격` = "이 워커는 간격당 잡 하나".
 */
export function limiterFromInterval(minIntervalMs: number): RateLimiterOptions {
  return { max: 1, duration: Math.max(1, minIntervalMs) }
}

// ── 큐 인스턴스 ────────────────────────────────────────────────────────

const queues = new Map<string, Queue>()

function makeQueue<N extends QueueName>(name: N): Queue<QueueDataMap[N]> {
  const existing = queues.get(name)
  if (existing) return existing as Queue<QueueDataMap[N]>
  const q = new Queue<QueueDataMap[N]>(name, {
    connection: getRedis(),
    prefix: QUEUE_PREFIX,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  })
  queues.set(name, q as unknown as Queue)
  return q
}

export function collectQueue(): Queue<CollectJobData> {
  return makeQueue(QUEUE_COLLECT)
}
export function healQueue(): Queue<HealJobData> {
  return makeQueue(QUEUE_HEAL)
}
export function deliverQueue(): Queue<DeliverJobData> {
  return makeQueue(QUEUE_DELIVER)
}
export function evaluateQueue(): Queue<EvaluateJobData> {
  return makeQueue(QUEUE_EVALUATE)
}

export async function closeQueues(): Promise<void> {
  const all = [...queues.values()]
  queues.clear()
  await Promise.all(all.map((q) => q.close()))
}

// ── 밀어넣기 ───────────────────────────────────────────────────────────

export async function enqueueCollect(data: CollectJobData, opts?: JobsOptions): Promise<void> {
  await collectQueue().add(`collect:${data.host}`, data, opts)
}

export async function enqueueHeal(data: HealJobData, opts?: JobsOptions): Promise<void> {
  // 치유는 재시도를 큐가 아니라 우리가 센다 (하루 상한이 있으므로 · 15장)
  await healQueue().add(`heal:${data.source_id}`, data, { attempts: 1, ...opts })
}

export async function enqueueDeliver(data: DeliverJobData, opts?: JobsOptions): Promise<void> {
  if (data.item_ids.length === 0) return
  await deliverQueue().add(`deliver:${data.subscription_id}`, data, opts)
}

// ── repeatable job = 크론 (ADR A8) ─────────────────────────────────────
//
// BullMQ v5 에서 `QueueScheduler` 클래스는 사라졌다 (v4 에서 Worker 안으로 흡수됐다).
// 지연·반복 잡의 승격은 Worker 가 알아서 하고, 스케줄 등록은 `upsertJobScheduler` 가 맡는다.

/** 소스 하나당 스케줄 하나. 이 id 로 등록·해제·조회한다 */
export function collectSchedulerId(sourceId: string): string {
  return `source:${sourceId}`
}

export function deliverSchedulerId(subscriptionId: string): string {
  return `subscription:${subscriptionId}`
}

export interface SourceSchedule {
  source_id: string
  collection_id: string
  host: string
  /** cron 표현식. 기본 하루 1회 (열린 결정 O3) */
  schedule: string
  /** 등록 즉시 한 번 돌릴지 */
  immediately?: boolean
}

/**
 * 소스의 정기 수집을 등록한다. 이미 있으면 갱신한다 (멱등).
 * 소스를 만들 때·스케줄을 바꿀 때 web 쪽에서도 같은 함수를 부르는 게 이상적이지만,
 * 지금은 워커가 부팅할 때 DB 를 훑어 한 번 맞춘다 (`syncSourceSchedules`).
 */
export async function scheduleSource(input: SourceSchedule): Promise<void> {
  await collectQueue().upsertJobScheduler(
    collectSchedulerId(input.source_id),
    { pattern: input.schedule, tz: 'Asia/Seoul', immediately: input.immediately ?? false },
    {
      name: `collect:${input.host}`,
      data: {
        source_id: input.source_id,
        collection_id: input.collection_id,
        host: input.host,
        reason: 'schedule',
      },
    },
  )
}

/** 소스가 삭제되거나 일시정지(paused)되면 스케줄을 뗀다 */
export async function unscheduleSource(sourceId: string): Promise<boolean> {
  return collectQueue().removeJobScheduler(collectSchedulerId(sourceId))
}

/** 지금 등록돼 있는 수집 스케줄의 id 목록 */
export async function listSourceSchedules(): Promise<string[]> {
  const rows = await collectQueue().getJobSchedulers(0, -1, true)
  return rows.map((r) => r.key).filter((k): k is string => typeof k === 'string')
}

/**
 * DB 의 소스 목록과 Redis 의 스케줄을 맞춘다.
 * status 가 'paused' 인 소스는 떼고, 나머지는 등록하고, DB 에 없는 스케줄은 지운다.
 */
export async function syncSourceSchedules(sources: readonly SourceSchedule[]): Promise<{
  added: number
  removed: number
}> {
  const wanted = new Map(sources.map((s) => [collectSchedulerId(s.source_id), s]))
  const existing = new Set(await listSourceSchedules())

  let added = 0
  for (const [id, source] of wanted) {
    await scheduleSource(source)
    if (!existing.has(id)) added += 1
  }

  let removed = 0
  for (const id of existing) {
    if (wanted.has(id)) continue
    if (await collectQueue().removeJobScheduler(id)) removed += 1
  }

  return { added, removed }
}

/** 구독 발송 스케줄 (기획서 9-4 "즉시 발송이 아니라 정해진 시각에 묶어 보냄") */
export async function scheduleSubscription(input: {
  subscription_id: string
  collection_id: string
  schedule: string
}): Promise<void> {
  await deliverQueue().upsertJobScheduler(
    deliverSchedulerId(input.subscription_id),
    { pattern: input.schedule, tz: 'Asia/Seoul' },
    {
      name: `deliver:${input.subscription_id}`,
      data: {
        subscription_id: input.subscription_id,
        collection_id: input.collection_id,
        // 스케줄이 깨우면 그때 "보낼 게 있는지" 를 잡 안에서 조회한다 (9-4)
        item_ids: [],
        reason: 'schedule',
      },
    },
  )
}

export async function unscheduleSubscription(subscriptionId: string): Promise<boolean> {
  return deliverQueue().removeJobScheduler(deliverSchedulerId(subscriptionId))
}

/**
 * 뷰 평가 일일 잡 (A34 · 계약 §3 — **KST 자정 직후**).
 * `마감 D-7 이내` 는 데이터가 안 바뀌어도 자정에 전이가 일어난다. 소스가 조용해도 시간은 간다.
 */
export const DAILY_VIEW_EVALUATION_ID = 'views:daily'

export async function scheduleDailyViewEvaluation(): Promise<void> {
  await evaluateQueue().upsertJobScheduler(
    DAILY_VIEW_EVALUATION_ID,
    { pattern: '5 0 * * *', tz: 'Asia/Seoul' },
    { name: 'evaluate:daily', data: { collection_id: null } },
  )
}

/** 워커 limiter 설정 — index.ts 가 그대로 쓴다 */
export function collectLimiter(): RateLimiterOptions {
  return limiterFromInterval(getConfig().crawlerMinIntervalMs)
}
