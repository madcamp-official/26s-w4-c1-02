// LLM 호출 예산 (기획서 15장 "Gemini 무료 티어 한도")
//
//   대응: 소스별 치유 시도를 하루 N회로 제한. 초과 시 `needs_attention` 으로 넘기고 사람 호출.
//         **한도 초과가 서비스 정지가 아니라 상태가 되게 한다** (원칙 ④).
//
// 그래서 이 모듈은 아무것도 던지지 않는다. "쓸 수 있음 / 오늘 다 씀" 을 값으로 돌려줄 뿐이고,
// 호출부는 그걸 받아 `needs_attention` 으로 넘긴다.
//
// TODO(G3): 지금은 프로세스 메모리다. 워커가 재시작되면 카운터가 0 이 된다.
//           `runs` 테이블에서 오늘자 치유 시도를 세거나 Redis 카운터로 옮긴다.

import { getConfig } from '../config'

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

const counters = new Map<string, Counter>()
/** 전체 호출 수 — 로그·CLI 에서 오늘 얼마나 썼는지 보기 위한 것 */
let totalToday: Counter = { day: today(), count: 0 }

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
export function consumeBudget(scope: BudgetScope): BudgetVerdict {
  const key = keyOf(scope)
  const limit = limitOf(scope)
  const day = today()

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
export function peekBudget(scope: BudgetScope): BudgetVerdict {
  const counter = counters.get(keyOf(scope))
  const limit = limitOf(scope)
  const used = counter !== undefined && counter.day === today() ? counter.count : 0
  return {
    allowed: used < limit,
    used,
    limit,
    message: used < limit ? null : exhaustedMessage(scope),
  }
}

export function budgetUsedToday(): number {
  return totalToday.day === today() ? totalToday.count : 0
}

export function resetBudget(): void {
  counters.clear()
  totalToday = { day: today(), count: 0 }
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
