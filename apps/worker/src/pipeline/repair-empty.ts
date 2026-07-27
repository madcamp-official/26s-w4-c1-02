// 항상 비는 칸을 표에서 없앤다 (보장선 B3)
//
// ── 왜 필요한가 ─────────────────────────────────────────────────────────
// LLM 이 **값을 반드시 지우는 변환**을 낸다. 실제로 이런 걸 냈다:
//
//     {"op": "replace", "flags": "g", "pattern": ".*", "replacement": ""}
//
// `replace(/.*/g, '')` 는 무엇을 넣든 빈 문자열이다. 셀렉터는 맞았고 원값도 잡혔는데
// (`raw._fields.organization` = "재단법인 글로벌디지털혁신네트워크") 변환이 그걸 지웠다.
//
// 검증 보고서는 `null_ratio: 1` 로 정확히 기록하고 CLI 도 찍는다. **그런데 아무도 막지 않아서**
// 영원히 비는 칸이 그대로 저장되고 API 로 나갔다. 사용자가 보는 건 빈 열 하나다.
//
// ── 왜 정적 검사가 아닌가 ───────────────────────────────────────────────
// "이 정규식이 파괴적인가" 는 일반적으로 풀 수 없다. `.*` 는 파괴적이지만 `\s*` 는 아니고
// (`'abc'.replace(/\s*/g,'')` 는 `'abc'` 다), 그 사이에 무한한 회색지대가 있다.
// 우리는 **컴파일 시점에 이미 행을 들고 있다.** 그러니 돌려 보고 판단하는 게 맞다.
//
// ── 판단 ────────────────────────────────────────────────────────────────
//   값이 비었다 + 원값은 있었다  → 변환이 죽인 것이다      → **변환만 버린다**
//   값이 비었다 + 원값도 없었다  → 경로가 틀린 것이다      → **칸을 뺀다**
//
// 마지막 칸까지 빼지는 않는다. 빈 칸 하나보다 표가 통째로 없는 게 나쁘다.

import type { CollectionSchemaJson, ValidationReport } from '@endpointer/core'
import type { AdapterSpec, InterpretedItem } from '@endpointer/core/spec'

/** 이 비율 이상 비어 있으면 "항상 빈다" 로 본다. 1.0 이 아닌 이유는 아래 주석 */
const EMPTY_THRESHOLD = 0.95

/** 원값이 이 비율 이상 있었으면 "뽑히긴 했다" 로 본다 */
const RAW_PRESENT_THRESHOLD = 0.5

export interface RepairPlan {
  /** 변환을 버릴 칸 — 원값은 잡혔는데 변환이 지웠다 */
  drop_transform: string[]
  /** 표에서 뺄 칸 — 원값 자체가 안 잡혔다 */
  drop_column: string[]
}

/** 고칠 게 있는가 */
export function hasWork(plan: RepairPlan): boolean {
  return plan.drop_transform.length > 0 || plan.drop_column.length > 0
}

/**
 * 뽑아 본 결과를 보고 무엇을 고칠지 정한다.
 *
 * `report.fields[].null_ratio` 를 쓰지 않고 값을 직접 세는 이유:
 * 보고서는 `null` 만 세지만 우리가 잡으려는 건 **빈 문자열**이다.
 * `replace(/.*​/g,'')` 의 결과는 `null` 이 아니라 `''` 다.
 */
export function planRepair(spec: AdapterSpec, items: readonly InterpretedItem[]): RepairPlan {
  const plan: RepairPlan = { drop_transform: [], drop_column: [] }
  if (items.length === 0) return plan

  for (const key of Object.keys(spec.fields)) {
    const empty = items.filter((item) => isEmpty(item.data[key])).length / items.length
    // 한두 행이 비는 건 정상이다 (마감일 없는 공고). **거의 전부** 빌 때만 본다.
    if (empty < EMPTY_THRESHOLD) continue

    const rawPresent = items.filter((item) => !isEmpty(rawFieldOf(item, key))).length / items.length
    const hasTransform = (spec.fields[key]?.transform ?? []).length > 0

    if (rawPresent >= RAW_PRESENT_THRESHOLD && hasTransform) plan.drop_transform.push(key)
    else plan.drop_column.push(key)
  }

  return plan
}

/** 변환만 버린 스펙을 만든다. 원본은 건드리지 않는다 */
export function applyTransformDrop(spec: AdapterSpec, keys: readonly string[]): AdapterSpec {
  if (keys.length === 0) return spec

  const fields: AdapterSpec['fields'] = {}
  for (const [key, field] of Object.entries(spec.fields)) {
    if (!keys.includes(key)) {
      fields[key] = field
      continue
    }
    // `transform` 키를 남기고 빈 배열을 넣지 않는다 — 스펙을 읽는 사람이
    // "변환이 있었는데 비웠나" 를 궁금해할 이유가 없다
    const { transform: _dropped, ...rest } = field
    fields[key] = rest
  }
  return { ...spec, fields }
}

export interface DropColumnsResult {
  spec: AdapterSpec
  schema: CollectionSchemaJson
  items: InterpretedItem[]
  /** 뺀 칸을 지운 검증 보고서 — 남겨두면 없는 칸을 "값이 자주 빈다" 고 알려준다 */
  report: ValidationReport
  /** 실제로 뺀 칸. 마지막 칸이라 못 뺀 것은 여기 없다 */
  dropped: string[]
}

/**
 * 칸을 표에서 뺀다. **다시 뽑지 않는다** — 이미 들고 있는 결과에서 지우면 된다.
 *
 * 전부 빼면 표가 사라지므로 최소 한 칸은 남긴다.
 */
export function dropColumns(
  spec: AdapterSpec,
  schema: CollectionSchemaJson,
  items: readonly InterpretedItem[],
  report: ValidationReport,
  keys: readonly string[],
): DropColumnsResult {
  const keep = schema.filter((f) => !keys.includes(f.key))
  if (keys.length === 0 || keep.length === 0) {
    return { spec, schema: [...schema], items: [...items], report, dropped: [] }
  }

  const fields: AdapterSpec['fields'] = {}
  for (const [key, field] of Object.entries(spec.fields)) {
    if (!keys.includes(key)) fields[key] = field
  }

  const trimmed = items.map((item) => {
    const data = { ...item.data }
    for (const key of keys) delete data[key]
    return { ...item, data }
  })

  // 보고서에서도 지운다. 안 지우면 화면과 로그가 없는 칸을 계속 얘기한다.
  const stats = Object.fromEntries(Object.entries(report.fields).filter(([key]) => !keys.includes(key)))

  return {
    spec: { ...spec, fields },
    schema: keep,
    items: trimmed,
    report: { ...report, fields: stats },
    dropped: [...keys],
  }
}

/** 사용자가 읽을 문장. 무엇이 사라졌는지는 알려준다 — 조용히 빼면 그것도 거짓말이다 (B4) */
export function repairNotes(schema: CollectionSchemaJson, dropped: readonly string[]): string[] {
  if (dropped.length === 0) return []
  const labels = dropped.map((key) => schema.find((f) => f.key === key)?.label ?? key)
  return [`값이 하나도 없어서 ${labels.join(' · ')} 칸은 뺐어요.`]
}

// ── 거들 ───────────────────────────────────────────────────────────────

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  return false
}

/** 변환 전 원값. 해석기가 `raw._fields` 에 넣어 둔다 */
function rawFieldOf(item: InterpretedItem, key: string): unknown {
  const fields = item.raw['_fields']
  if (fields === null || typeof fields !== 'object') return undefined
  return (fields as Record<string, unknown>)[key]
}
