// LLM 호출 예산 (기획서 15장 "Gemini 무료 티어 한도")
//
//   대응: 소스별 치유 시도를 하루 N회로 제한. 초과 시 `needs_attention` 으로 넘기고 사람 호출.
//         **한도 초과가 서비스 정지가 아니라 상태가 되게 한다** (원칙 ④).
//
// 그래서 이 모듈은 아무것도 던지지 않는다. "쓸 수 있음 / 오늘 다 씀" 을 값으로 돌려줄 뿐이고,
// 호출부는 그걸 받아 `needs_attention` 으로 넘긴다.
//
// ── 카운터는 Redis 다 (2026-07-27 · 구 TODO(G3) 해소) ────────────────────
// 메모리 카운터의 진짜 문제는 재시작 리셋만이 아니었다 — CLI(create·attach·heal)와
// 워커가 **별개 프로세스**라 서로의 호출을 못 세서, 상한이 프로세스 수만큼 늘어났다.
// Redis 키는 날짜별(`…:{scope}:{KST날짜}`)이고 이틀 뒤 스스로 사라진다.
//
// **Redis 가 죽어도 예산이 컴파일을 멈추면 안 된다** (원칙 ④). BullMQ 공용 연결은
// 명령이 영원히 재시도라 여기 쓰면 그대로 멈춘다 — 전용 빨리-실패 연결을 쓰고,
// 실패하면 예전 그대로의 프로세스 메모리 카운터로 물러난다 (한 번만 경고).

import IORedis from 'ioredis'

import { getConfig } from '../config'
import { childLogger } from '../logger'

const log = childLogger({ mod: 'budget' })

/** 무엇에 대한 예산인지 */
export type BudgetScope =
  /** 소스별 자가 치유 시도 (하루 상한이 걸리는 곳) */
  | { kind: 'heal'; source_id: string }
  /** 소스 최초 컴파일 — 사용자가 기다리고 있으므로 상한은 넉넉하게 */
  | { kind: 'compile'; source_id: string }
  /** 두 번째 소스 필드 매핑 */
  | { kind: 'match'; collection_id: string }

export interface BudgetVerdict {
  allowed: boolean
  used: number
  limit: number
  /** 사용자에게 보여줄 문구. 내부 용어 금지 (보장선 B2 · B4) */
  message: string | null
}

interface Counter {
  day: string
  count: number
}

// ── 폴백 저장소 (Redis 가 없을 때만) ────────────────────────────────────
const counters = new Map<string, Counter>()
/** 전체 호출 수 — 로그·CLI 에서 오늘 얼마나 썼는지 보기 위한 것 */
let totalToday: Counter = { day: today(), count: 0 }

// ── Redis 저장소 ────────────────────────────────────────────────────────

const REDIS_PREFIX = 'endpointer:budget'
/** 날짜별 키라 하루 지나면 무의미하다 — 이틀 뒤 스스로 사라지게 */
const KEY_TTL_S = 2 * 24 * 60 * 60

let redis: IORedis | null = null
let redisBroken = false

/** 예산 전용 연결 — 빨리 실패한다. BullMQ 공용 연결(영원히 재시도)을 쓰면 안 된다 (머리말) */
function getBudgetRedis(): IORedis | null {
  if (redisBroken) return null
  if (redis === null) {
    redis = new IORedis(getConfig().redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 1500,
      retryStrategy: () => null,
    })
    redis.on('error', () => {})
  }
  return redis
}

function markRedisBroken(): void {
  if (!redisBroken) {
    log.warn('예산 카운터가 Redis 에 닿지 못해 프로세스 메모리로 대신 셉니다 — 재시작하면 초기화됩니다')
  }
  redisBroken = true
}

function today(): string {
  // Asia/Seoul 기준 날짜. 무료 티어 리셋은 UTC 지만, 사람이 "오늘 3번" 을 세는 기준은 한국 날짜다.
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
}

function keyOf(scope: BudgetScope): string {
  switch (scope.kind) {
    case 'heal':
      return `heal:${scope.source_id}`
    case 'compile':
      return `compile:${scope.source_id}`
    case 'match':
      return `match:${scope.collection_id}`
  }
}

function limitOf(scope: BudgetScope): number {
  const cfg = getConfig()
  switch (scope.kind) {
    // 15장 대응의 본체
    case 'heal':
      return cfg.healMaxAttemptsPerDay
    // 최초 생성은 재생성 1회를 포함해 2회 (기획서 11장), 하루에 소스당 몇 번 다시 시도해도 되게 여유
    case 'compile':
      return 8
    case 'match':
      return 12
  }
}

/** 지금 호출해도 되는지 묻고, 된다면 한 칸 쓴다 */
export async function consumeBudget(scope: BudgetScope): Promise<BudgetVerdict> {
  const key = keyOf(scope)
  const limit = limitOf(scope)
  const day = today()

  const r = getBudgetRedis()
  if (r !== null) {
    try {
      // INCR 먼저 — GET 후 INCR 로 가르면 두 프로세스가 같은 마지막 칸을 나눠 쓴다.
      // 상한을 넘긴 시도도 세어 둔다 (몇 번을 더 두드렸는지도 정보다).
      const scopeKey = `${REDIS_PREFIX}:${key}:${day}`
      const totalKey = `${REDIS_PREFIX}:total:${day}`
      const [[, n]] = (await r
        .multi()
        .incr(scopeKey)
        .expire(scopeKey, KEY_TTL_S)
        .incr(totalKey)
        .expire(totalKey, KEY_TTL_S)
        .exec()) as [[unknown, number], ...unknown[]]

      if (n > limit) {
        return { allowed: false, used: n, limit, message: exhaustedMessage(scope) }
      }
      return { allowed: true, used: n, limit, message: null }
    } catch {
      markRedisBroken()
    }
  }

  // ── 폴백: 프로세스 메모리 (예전 동작 그대로) ─────────────────────────
  const current = counters.get(key)
  const counter: Counter = current !== undefined && current.day === day ? current : { day, count: 0 }

  if (counter.count >= limit) {
    counters.set(key, counter)
    return { allowed: false, used: counter.count, limit, message: exhaustedMessage(scope) }
  }

  counter.count += 1
  counters.set(key, counter)

  if (totalToday.day !== day) totalToday = { day, count: 0 }
  totalToday.count += 1

  return { allowed: true, used: counter.count, limit, message: null }
}

/** 쓰지 않고 남은 횟수만 본다 */
export async function peekBudget(scope: BudgetScope): Promise<BudgetVerdict> {
  const limit = limitOf(scope)
  let used = 0

  const r = getBudgetRedis()
  if (r !== null) {
    try {
      const raw = await r.get(`${REDIS_PREFIX}:${keyOf(scope)}:${today()}`)
      used = raw === null ? 0 : Number.parseInt(raw, 10) || 0
    } catch {
      markRedisBroken()
    }
  }
  if (redisBroken) {
    const counter = counters.get(keyOf(scope))
    used = counter !== undefined && counter.day === today() ? counter.count : 0
  }

  return {
    allowed: used < limit,
    used,
    limit,
    message: used < limit ? null : exhaustedMessage(scope),
  }
}

export async function budgetUsedToday(): Promise<number> {
  const r = getBudgetRedis()
  if (r !== null) {
    try {
      const raw = await r.get(`${REDIS_PREFIX}:total:${today()}`)
      return raw === null ? 0 : Number.parseInt(raw, 10) || 0
    } catch {
      markRedisBroken()
    }
  }
  return totalToday.day === today() ? totalToday.count : 0
}

/** 오늘 카운터를 지운다 (개발·테스트용). Redis 쪽은 오늘 키만 지운다 */
export async function resetBudget(): Promise<void> {
  counters.clear()
  totalToday = { day: today(), count: 0 }

  const r = getBudgetRedis()
  if (r === null) return
  try {
    const keys = await r.keys(`${REDIS_PREFIX}:*:${today()}`)
    if (keys.length > 0) await r.del(...keys)
  } catch {
    markRedisBroken()
  }
}

/**
 * 한도 초과 문구. 화면에 그대로 나갈 수 있으므로 내부 명사를 쓰지 않는다 —
 * 치유·컴파일·어댑터·스펙 대신 "고쳐보기 / 사이트 / 오늘".
 */
function exhaustedMessage(scope: BudgetScope): string {
  switch (scope.kind) {
    case 'heal':
      return '오늘은 이 사이트를 자동으로 고쳐보는 횟수를 다 썼어요. 마지막으로 받아둔 내용을 그대로 보여드리는 중이고, 내일 다시 시도합니다.'
    case 'compile':
      return '이 사이트를 읽어보는 시도를 오늘 너무 많이 했어요. 잠시 뒤에 다시 시도해 주세요.'
    case 'match':
      return '항목 맞추기를 오늘 너무 많이 시도했어요. 잠시 뒤에 다시 시도해 주세요.'
  }
}
