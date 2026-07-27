// viewToQuery — 뷰가 네 출구(표 · 알림 · REST ?view= · MCP)로 나가는 유일한 문 (A33)
//
// 여기가 하나여야 하는 이유: 출구마다 조건 해석을 따로 구현하면 반드시 갈라지고,
// 갈라지는 순간 "표에서 보이는 것과 알림이 오는 것이 다르다"가 된다 — 워커의
// enter 판정(매칭 집합)도 이 함수가 낸 쿼리로 만든다.
//
// ── 상대 표현 → 절대 범위 환산은 여기서만 한다 ──────────────────────────
// 뷰에는 `this_month` 가 저장돼 있고 (A34), 실행 순간의 `now` 를 받아 그때의
// 달력 범위로 바꾼다. **기준 시간대는 KST 다** (계약 §3 — 일일 평가는 KST 자정 직후).
// `now` 를 인자로 받는 이유는 테스트가 시간을 고정할 수 있어야 하고,
// 하루 평가 잡이 "잡이 시작된 시각" 하나로 전체 뷰를 일관되게 평가해야 하기 때문이다.

import { CollectionQuerySchema, type CollectionQuery } from '../types/api'
import type { ViewCondition, ViewSort } from '../types/view'

/** 한국 표준시. 이 제품의 달력 경계는 전부 KST 다 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

// ── KST 달력 (순수 · 테스트 대상) ────────────────────────────────────────

/** `now` 가 KST 로 몇 년 몇 월 며칠인지. UTC 시각에 9시간을 더해 UTC 게터로 읽는다 */
function kstParts(now: Date): { y: number; m: number; d: number; dow: number } {
  const shifted = new Date(now.getTime() + KST_OFFSET_MS)
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth(), // 0-11
    d: shifted.getUTCDate(),
    dow: shifted.getUTCDay(), // 0=일
  }
}

function isoOf(y: number, m: number, d: number): string {
  // Date.UTC 가 월말·연말 넘김을 알아서 처리한다 (7/32 → 8/1)
  return new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10)
}

/** KST 기준 오늘 (YYYY-MM-DD) */
export function kstToday(now: Date): string {
  const { y, m, d } = kstParts(now)
  return isoOf(y, m, d)
}

/** KST 기준 오늘에서 n 일 뒤 (음수면 앞) */
export function kstTodayPlus(now: Date, days: number): string {
  const { y, m, d } = kstParts(now)
  return isoOf(y, m, d + days)
}

/**
 * 상대 구간 → [시작, 끝] (둘 다 포함).
 * 달력 그대로다 — `this_week` 는 월요일부터 일요일, `this_month` 는 1일부터 말일.
 * "이미 지난 마감 빼고"를 원하면 `after: today` 를 같이 건다 (조건은 AND 로 겹친다).
 */
export function kstRangeOf(now: Date, range: 'this_week' | 'this_month'): [string, string] {
  const { y, m, d, dow } = kstParts(now)
  if (range === 'this_week') {
    // 월요일 시작. dow: 0=일 → 지난 월요일은 6일 전
    const sinceMonday = (dow + 6) % 7
    return [isoOf(y, m, d - sinceMonday), isoOf(y, m, d - sinceMonday + 6)]
  }
  // this_month: 1일 ~ 말일 (다음 달 0일 = 이번 달 말일)
  return [isoOf(y, m, 1), isoOf(y, m + 1, 0)]
}

// ── 변환 ─────────────────────────────────────────────────────────────────

/** gte 는 더 큰 쪽이, lte 는 더 작은 쪽이 이긴다 — 조건들은 AND 라서 교집합이 맞다 */
function tighten(
  acc: Record<string, string | number>,
  key: string,
  value: string | number,
  dir: 'gte' | 'lte',
): void {
  const prev = acc[key]
  if (prev === undefined) {
    acc[key] = value
    return
  }
  // date 는 YYYY-MM-DD 문자열이라 사전순 = 시간순, number 는 수치 비교 — 둘 다 < 로 충분하다
  acc[key] = dir === 'gte' ? (prev < value ? value : prev) : (prev < value ? prev : value)
}

/**
 * 뷰의 조건·정렬 → CollectionQuery.
 *
 * 검증(`validateViewDefinition`)을 통과한 뷰를 넣어야 한다 — 여기서는 스키마를 다시
 * 보지 않는다 (build.ts 가 어차피 화이트리스트로 한 번 더 거른다).
 * 정렬은 첫 항목만 쿼리에 실린다 — CollectionQuery 의 정렬이 하나이기 때문이다.
 * 나머지 항목은 화면 표시용으로 예약돼 있다.
 */
export function viewToQuery(
  view: { where: readonly ViewCondition[]; sort?: readonly ViewSort[] },
  now: Date,
): CollectionQuery {
  const eq: Record<string, string | number | boolean> = {}
  const gte: Record<string, string | number> = {}
  const lte: Record<string, string | number> = {}
  const inMap: Record<string, (string | number)[]> = {}
  const notIn: Record<string, (string | number)[]> = {}
  const contains: Record<string, string> = {}
  const notContains: Record<string, string> = {}
  const isNull: string[] = []

  for (const cond of view.where) {
    switch (cond.op) {
      case 'within': {
        const [from, to] = kstRangeOf(now, cond.value)
        tighten(gte, cond.field, from, 'gte')
        tighten(lte, cond.field, to, 'lte')
        break
      }
      case 'd_within':
        // D-n 이내 = 오늘부터 n일 안. 지난 날짜는 자연히 빠진다
        tighten(gte, cond.field, kstToday(now), 'gte')
        tighten(lte, cond.field, kstTodayPlus(now, cond.value), 'lte')
        break
      case 'before':
        // 엄격 비교 — 오늘 "이전"에 오늘은 없다. 오늘 포함이 필요하면 d_within(0) 이 있다
        tighten(lte, cond.field, kstTodayPlus(now, -1), 'lte')
        break
      case 'after':
        tighten(gte, cond.field, kstTodayPlus(now, 1), 'gte')
        break
      case 'is_null':
        if (!isNull.includes(cond.field)) isNull.push(cond.field)
        break
      case 'gte':
        tighten(gte, cond.field, cond.value, 'gte')
        break
      case 'lte':
        tighten(lte, cond.field, cond.value, 'lte')
        break
      case 'between':
        tighten(gte, cond.field, cond.value[0], 'gte')
        tighten(lte, cond.field, cond.value[1], 'lte')
        break
      case 'in':
        inMap[cond.field] = [...cond.value]
        break
      case 'not_in':
        notIn[cond.field] = [...cond.value]
        break
      case 'contains':
        contains[cond.field] = cond.value
        break
      case 'not_contains':
        notContains[cond.field] = cond.value
        break
    }
  }

  const first = view.sort?.[0]
  return CollectionQuerySchema.parse({
    eq,
    gte,
    lte,
    in: inMap,
    not_in: notIn,
    contains,
    not_contains: notContains,
    is_null: isNull,
    ...(first !== undefined ? { sort: first.dir === 'desc' ? `-${first.field}` : first.field } : {}),
  })
}

/**
 * 기본 표 = 조건 없는 뷰 #0 (델타 2-3 · 계약 §1). **저장하지 않고 여기서 합성한다** —
 * 행으로 저장하면 삭제·이름변경 같은 엣지가 생긴다 (계약 §7).
 * 화면·MCP 가 뷰 목록을 낼 때 맨 앞에 이걸 붙인다.
 */
export function synthesizeViewZero(): {
  slug: string
  name: string
  where: ViewCondition[]
  sort: ViewSort[]
  columns: null
  notify: null
  pinned: true
} {
  return { slug: 'all', name: '전체', where: [], sort: [], columns: null, notify: null, pinned: true }
}

/** 다음 KST 자정 직후 평가 시각까지 남은 ms — 일일 뷰 평가 잡(A34)의 스케줄 재료 */
export function msUntilNextKstMidnight(now: Date): number {
  const { y, m, d } = kstParts(now)
  const nextMidnightUtc = Date.UTC(y, m, d + 1) - KST_OFFSET_MS
  const diff = nextMidnightUtc - now.getTime()
  return diff > 0 ? diff : diff + DAY_MS
}
