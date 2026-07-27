// 뷰(View) — "내가 계속 신경 쓰기로 한 것"의 정의 (뷰 계약 · 델타 2절)
//
// 계약의 정본은 docs/view-contract-draft.md 다 (07-27 저녁 확정 · G0 계약 #6).
// 여기를 고치는 것은 G0 계약을 고치는 것이다 — 양쪽 트랙이 같이 있을 때만.
//
// ── 술어(op)는 닫힌 집합이다 (A35 — 변환 연산자 A2 와 같은 규율) ─────────
// 목록 밖 op · 자유 표현식 · SQL 조각은 **파싱 단계에서** 거부한다. 뷰는 표·알림·REST·MCP
// 네 출구를 전부 타므로, 여기가 열리면 네 곳에서 안전을 보장해야 한다.
// 표현이 부족하면 임시방편을 끼우지 말고 **술어를 추가하라.**
//
// ── date 조건 값은 상대 표현만 저장한다 (A34·A35) ────────────────────────
// `2026-08-31` 같은 절대 날짜가 박힌 뷰는 기준일이 지나면 영원히 0건이 된다 —
// 화면의 0건은 "해당 없음"과 구별되지 않는 조용한 실패다. 절대 날짜는 조회 계층
// (REST 쿼리 파라미터 · 표 위 필터)의 몫이고, 저장 계층인 여기서는 스키마가 거부한다.

import { z } from 'zod'

import type { FieldDef, FieldType } from './collection'

// ── 건강 · 이벤트 ────────────────────────────────────────────────────────

/** 뷰 건강 (델타 2-8). **저장하지 않는다** — 읽을 때 계산한다 (계약 §7 결정 ③).
 *  값 키는 내부용 — 화면은 사람 문장으로 옮긴다 (B2) */
export const VIEW_HEALTH = ['ok', 'warn', 'broken'] as const
export type ViewHealth = (typeof VIEW_HEALTH)[number]

/** 알림 전이 (델타 2-5). v1 은 enter 만 — 재진입도 새 enter 다 (계약 §7 결정 ①) */
export const VIEW_EVENTS = ['enter'] as const
export type ViewEvent = (typeof VIEW_EVENTS)[number]

// ── 상대 시간 표현 (A34) ─────────────────────────────────────────────────

/** `within` 이 받는 달력 구간. KST 기준 (계약 §3 — 일일 평가는 KST 자정 직후) */
export const RELATIVE_DATE_RANGES = ['this_week', 'this_month'] as const
export type RelativeDateRange = (typeof RELATIVE_DATE_RANGES)[number]

/** `before`/`after` 가 받는 기준점. 부족하면 여기에 **추가**한다 — 절대 날짜를 열지 마라 */
export const RELATIVE_DATE_POINTS = ['today'] as const
export type RelativeDatePoint = (typeof RELATIVE_DATE_POINTS)[number]

// ── 조건 (술어 닫힌 집합 — 계약 §2) ──────────────────────────────────────

/** 한 뷰에 담을 수 있는 조건 수. 그 이상은 뷰가 아니라 프로그램이다 */
export const MAX_VIEW_CONDITIONS = 10

/** `in`/`not_in` 목록 상한 */
const MAX_ENUM_VALUES = 50

const fieldKey = z.string().min(1)

/**
 * op 마다 value 의 모양이 다르므로 discriminated union 으로 검증한다.
 * 여기 없는 op 는 파싱이 거부한다 — 이 목록이 곧 A35 의 닫힌 집합이다.
 */
export const ViewConditionSchema = z.discriminatedUnion('op', [
  // date — 상대 표현만. 절대 날짜(YYYY-MM-DD)는 enum 검증에서 자연히 거부된다
  z.object({ field: fieldKey, op: z.literal('within'), value: z.enum(RELATIVE_DATE_RANGES) }),
  z.object({ field: fieldKey, op: z.literal('d_within'), value: z.number().int().min(0).max(365) }),
  z.object({ field: fieldKey, op: z.literal('before'), value: z.enum(RELATIVE_DATE_POINTS) }),
  z.object({ field: fieldKey, op: z.literal('after'), value: z.enum(RELATIVE_DATE_POINTS) }),
  // 값 없음 판정 — `상시`(마감 없음) 같은 것. 마감 뷰의 기본은 제외다 (범위 비교가 null 을 자연히 거른다)
  z.object({ field: fieldKey, op: z.literal('is_null') }),
  // number / money
  z.object({ field: fieldKey, op: z.literal('gte'), value: z.number().finite() }),
  z.object({ field: fieldKey, op: z.literal('lte'), value: z.number().finite() }),
  z.object({
    field: fieldKey,
    op: z.literal('between'),
    value: z.tuple([z.number().finite(), z.number().finite()]),
  }),
  // enum — 정규화 키 기준
  z.object({ field: fieldKey, op: z.literal('in'), value: z.array(z.string().min(1)).min(1).max(MAX_ENUM_VALUES) }),
  z.object({
    field: fieldKey,
    op: z.literal('not_in'),
    value: z.array(z.string().min(1)).min(1).max(MAX_ENUM_VALUES),
  }),
  // text
  z.object({ field: fieldKey, op: z.literal('contains'), value: z.string().min(1).max(200) }),
  z.object({ field: fieldKey, op: z.literal('not_contains'), value: z.string().min(1).max(200) }),
])

export type ViewCondition = z.infer<typeof ViewConditionSchema>
export type ViewOp = ViewCondition['op']

/** 필드 타입별로 허용되는 술어. 이 표 밖의 조합은 validateViewWhere 가 거부한다 */
export const VIEW_OPS_BY_FIELD_TYPE: Record<FieldType, readonly ViewOp[]> = {
  date: ['within', 'd_within', 'before', 'after', 'is_null'],
  number: ['gte', 'lte', 'between', 'is_null'],
  money: ['gte', 'lte', 'between', 'is_null'],
  enum: ['in', 'not_in'],
  text: ['contains', 'not_contains'],
  // 링크에 거는 조건은 말이 되는 게 없다. 필요해지면 술어를 추가한다
  link: [],
}

// ── 뷰 본체 ──────────────────────────────────────────────────────────────

/** 컬렉션당 뷰 상한 (델타 2-9 — 성능이 아니라 신호). **서버가 거부한다** (계약 §5) */
export const MAX_VIEWS_PER_COLLECTION = 20

export const ViewSortSchema = z.object({
  field: z.string().min(1),
  dir: z.enum(['asc', 'desc']),
})
export type ViewSort = z.infer<typeof ViewSortSchema>

export const ViewNotifySchema = z.object({
  on: z.enum(VIEW_EVENTS),
  /** 배달 채널 id 목록 — 실체는 subscriptions 행이다 (계약 §4-b · §7 결정 ②) */
  channels: z.array(z.string().min(1)).min(1).max(10),
})
export type ViewNotify = z.infer<typeof ViewNotifySchema>

/**
 * 저장되는 뷰 정의 (views 테이블의 jsonb 들 + 메타).
 * **health 는 여기 없다** — 읽을 때 계산해 응답에만 싣는다 (계약 §7 결정 ③).
 */
export const ViewDefinitionSchema = z.object({
  name: z.string().min(1).max(60),
  where: z.array(ViewConditionSchema).max(MAX_VIEW_CONDITIONS).default([]),
  sort: z.array(ViewSortSchema).max(3).default([]),
  /** null = 컬렉션 기본 열 */
  columns: z.array(z.string().min(1)).min(1).nullable().default(null),
  /** null = 알림 꺼짐 (기본) */
  notify: ViewNotifySchema.nullable().default(null),
  pinned: z.boolean().default(false),
})
export type ViewDefinition = z.infer<typeof ViewDefinitionSchema>

// ── 검증 — 스키마(FieldDef[]) 대조 (A35 의 "파싱 단계에서 거부") ─────────

export interface ViewValidation {
  ok: boolean
  /** 화면에 그대로 나갈 수 있는 문장들 (B2 — 내부 명사 없음) */
  errors: string[]
}

/**
 * 조건·정렬·열이 실제 스키마와 맞는지 본다. zod(모양) 다음의 두 번째 겹이다.
 * 여기서 통과한 필드 키만 SQL 근처로 간다 — build.ts 의 화이트리스트 근거와 같은 원리.
 */
export function validateViewDefinition(
  def: ViewDefinition,
  fields: readonly FieldDef[],
): ViewValidation {
  const byKey = new Map(fields.map((f) => [f.key, f]))
  const errors: string[] = []

  const seen = new Set<string>()
  for (const cond of def.where) {
    const field = byKey.get(cond.field)
    if (field === undefined) {
      errors.push(`'${cond.field}' 라는 칸이 이 표에 없어요.`)
      continue
    }
    if (!VIEW_OPS_BY_FIELD_TYPE[field.type].includes(cond.op)) {
      errors.push(`'${field.label}' 칸에는 쓸 수 없는 조건이에요.`)
      continue
    }
    // 같은 칸에 같은 종류 조건이 두 번이면 무엇을 의도했는지 알 수 없다 — 합치지 말고 거부한다
    const dupKey = `${cond.field}:${cond.op}`
    if (seen.has(dupKey)) {
      errors.push(`'${field.label}' 칸에 같은 종류의 조건이 두 번 있어요. 하나로 합쳐 주세요.`)
      continue
    }
    seen.add(dupKey)

    if (cond.op === 'between' && cond.value[0] > cond.value[1]) {
      errors.push(`'${field.label}' 범위의 시작이 끝보다 커요.`)
    }
  }

  for (const s of def.sort) {
    if (!byKey.has(s.field)) errors.push(`정렬 기준 '${s.field}' 이(가) 이 표에 없어요.`)
  }
  if (def.columns !== null) {
    for (const c of def.columns) {
      if (!byKey.has(c)) errors.push(`'${c}' 라는 칸이 이 표에 없어요.`)
    }
  }

  return { ok: errors.length === 0, errors }
}

// ── slug ─────────────────────────────────────────────────────────────────

/**
 * 뷰 이름 → slug 후보. **MCP 도구명의 ASCII 제약이 이 규칙의 이유다** (계약 §1 ※).
 * 한국어 이름("이번 달 마감")처럼 라틴 문자가 안 남으면 null — 호출자가 `view-N` 순번을 쓴다.
 * 한국어 이름은 MCP 도구 설명에 들어간다.
 */
export function suggestViewSlug(name: string): string | null {
  const latin = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
  const alnum = latin.replace(/-/g, '')
  if (alnum.length < 2 || latin.length > 40) return null
  return latin
}
