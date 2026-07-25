// 드리프트 검증기 — 원칙 ⑤ "스키마가 곧 검증기다" (기획서 7장⑤ · 9-3②)
//
// 별도의 헬스체크를 만들지 않는다. 정규화된 수집 결과를 컬렉션 스키마에 통과시킨
// 통계(`ValidationReport.fields`)와 직전 성공 수집의 기준선만으로 고장을 감지한다.
//
// ── 두 개의 문자열, 두 명의 독자 ──────────────────────────────────────
// 이 파일은 같은 사건을 두 가지 언어로 두 번 쓴다. 섞으면 둘 다 망가진다.
//
//   `DriftReport.summary`  → **사람(사용자)** 이 화면에서 읽는다. 보장선 B2·B4.
//                            내부 명사(드리프트·스펙·어댑터·파서·null·런·probe) 금지.
//                            HTTP 코드·스택·경로·퍼센트 나열 금지.
//                            "이 사이트 구조가 바뀐 것 같아요. 다시 맞추는 중입니다."
//
//   `healPrompt()`         → **Gemini** 가 읽는다 (기획서 9-3③ "무엇이 깨졌는지").
//                            반대로 정확한 내부 용어를 써야 한다. 두루뭉술하면 재컴파일이 실패한다.
//                            "deadline 필드가 92% null 입니다. 이전 경로는 $.reqstEndDe"
//
// `signals` 는 세 번째 독자인 **기계**(치유 큐·run 로그·테스트)를 위한 것이다.

import type { FieldDef } from '../types/collection'
import type { FieldValidation, ValidationReport } from '../types/run'
import type { AdapterSpec } from '../spec/spec'
import type { DriftBaseline } from './baseline'

// ── 임계값 ─────────────────────────────────────────────────────────────

/**
 * 기획서 9-3② 의 네 가지 판정 기준. 하드코딩하지 않고 여기 모은다.
 *
 * 기획서 14장이 "드리프트 기준선이 적절한가"를 **사람이 판단할 항목**으로 지정했다.
 * 실사용 로그를 보고 조절하는 것이 정상이며, 조절은 여기 한 곳만 고치면 된다.
 * 호출부에서 부분 오버라이드도 가능하다 (`evaluateDrift(input, { typeFailRatio: 0.1 })`).
 */
export interface DriftThresholds {
  /**
   * "items 가 직전 대비 50% 이하" — 직전 성공 수집의 아이템 수에 이 비율을 곱한 값
   * **이하**면 드리프트 의심. 경계값(정확히 50%)은 드리프트로 본다.
   */
  itemsDropRatio: number
  /**
   * "필드별 null 비율이 기준선 대비 +30%p" — 0~1 스케일이므로 0.30 이 30%p.
   * 경계값(정확히 +30%p)은 드리프트로 본다.
   */
  nullRatioIncrease: number
  /**
   * "타입 파싱 실패율 > 20%" — 기획서가 명시적으로 초과(`>`)라고 썼으므로
   * 경계값(정확히 20%)은 통과다. 위 두 개와 부등호 방향이 다른 것은 의도된 것이다.
   */
  typeFailRatio: number
  /** 기준선으로 인정할 최소 성공 수집 횟수. 이보다 적으면 판정하지 않는다 (오탐 방지) */
  minBaselineRuns: number
  /** 기준선 계산에 쓸 최근 성공 수집 횟수 (중앙값의 표본 크기) */
  baselineWindow: number
  /**
   * 치유 승격의 마지막 관문 (기획서 9-3③).
   * 재컴파일한 candidate 가 뽑은 목록이 직전 성공 목록과 이 비율 미만으로 겹치면
   * "엉뚱한 목록을 잡았다"로 보고 승격하지 않는다.
   */
  minHealOverlapRatio: number
}

/** 기본값 = 기획서 9-3② 그대로 */
export const DRIFT_THRESHOLDS: DriftThresholds = {
  itemsDropRatio: 0.5,
  nullRatioIncrease: 0.3,
  typeFailRatio: 0.2,
  minBaselineRuns: 1,
  baselineWindow: 5,
  minHealOverlapRatio: 0.3,
}

export function resolveThresholds(overrides?: Partial<DriftThresholds>): DriftThresholds {
  return overrides ? { ...DRIFT_THRESHOLDS, ...overrides } : DRIFT_THRESHOLDS
}

// ── 신호 ───────────────────────────────────────────────────────────────

/**
 * 기획서 9-3② 의 네 가지 판정에 1:1 로 대응한다.
 * - `no_items`      items == 0                          → 실패
 * - `items_dropped` items 가 직전 대비 50% 이하           → 드리프트 의심
 * - `null_spike`    필드별 null 비율이 기준선 대비 +30%p  → 드리프트
 * - `type_fail`     타입 파싱 실패율 > 20%                → 드리프트
 */
export const DRIFT_SIGNAL_KINDS = ['no_items', 'items_dropped', 'null_spike', 'type_fail'] as const
export type DriftSignalKind = (typeof DRIFT_SIGNAL_KINDS)[number]

/** 기계가 읽는 판정 근거. run 로그와 치유 프롬프트가 이걸 그대로 소비한다 */
export interface DriftSignal {
  kind: DriftSignalKind
  /** 필드 단위 신호일 때만 (`null_spike` · `type_fail`) */
  field?: string
  /** 이번에 관측된 값. 개수(`no_items`·`items_dropped`) 또는 비율 0~1 */
  observed: number
  /** 비교 대상. 비교 없이 절대 임계로 판정하는 신호(`type_fail`)는 null */
  baseline: number | null
  /** 이 신호를 켠 임계값 */
  threshold: number
}

export type DriftVerdict = 'ok' | 'drift' | 'failed'

export interface DriftReport {
  verdict: DriftVerdict
  signals: DriftSignal[]
  /** 사용자에게 그대로 노출된다 (`runs.error_summary`). 보장선 B4 — 위 파일 머리말 참조 */
  summary: string
}

// ── 입력 ───────────────────────────────────────────────────────────────

export interface DriftInput {
  /** 이번 수집이 뽑은 아이템 수 */
  itemsFound: number
  /** 해석기가 낸 필드별 통계 (`ValidationReport.fields`) */
  fieldStats: Record<string, FieldValidation>
  /**
   * 직전 성공 수집들로 만든 기준선. **null 이면 첫 수집이므로 드리프트 판정을 하지 않는다.**
   * 기준선 없이 비교하면 전부 오탐이 된다 (`baseline.ts` 참조).
   */
  baseline: DriftBaseline | null
  /** 있으면 사용자 문구에 한국어 라벨을 쓴다. 없으면 필드를 이름 없이 뭉뚱그린다 */
  schema?: readonly FieldDef[]
}

// ── 판정 ───────────────────────────────────────────────────────────────

/**
 * 기획서 9-3② VALIDATE 단계.
 *
 * 판정 순서가 곧 심각도 순서다. `items == 0` 은 다른 무엇보다 먼저이며 `failed` 로 끝난다
 * (뽑힌 게 없으면 필드별 통계는 의미가 없다).
 */
export function evaluateDrift(input: DriftInput, overrides?: Partial<DriftThresholds>): DriftReport {
  const t = resolveThresholds(overrides)
  const { itemsFound, fieldStats, baseline } = input
  const signals: DriftSignal[] = []

  // ① items == 0 → 실패. 기준선이 없어도 이건 판정한다 (비교가 필요 없는 사실)
  if (itemsFound === 0) {
    signals.push({
      kind: 'no_items',
      observed: 0,
      baseline: baseline?.prevItems ?? null,
      threshold: 0,
    })
    return { verdict: 'failed', signals, summary: summarize('failed', signals, input) }
  }

  // 기준선이 없다 = 첫 수집. 여기서 드리프트를 내면 전부 오탐이다.
  // 이번 결과가 다음 수집의 기준선이 된다 (`computeBaseline`).
  const usable = baseline !== null && baseline.runs >= t.minBaselineRuns
  if (!usable) {
    return { verdict: 'ok', signals, summary: summarize('ok', signals, input) }
  }

  // ② items 가 직전 대비 50% 이하 → 드리프트 의심
  if (baseline.prevItems > 0 && itemsFound <= baseline.prevItems * t.itemsDropRatio) {
    signals.push({
      kind: 'items_dropped',
      observed: itemsFound,
      baseline: baseline.prevItems,
      threshold: t.itemsDropRatio,
    })
  }

  // ③ 필드별 null 비율이 기준선 대비 +30%p → 드리프트
  // ④ 타입 파싱 실패율 > 20% → 드리프트
  // 필드 순회는 키 정렬로 고정한다. 프롬프트와 로그가 수집마다 흔들리면 비교가 어렵다.
  for (const key of Object.keys(fieldStats).sort()) {
    const stat = fieldStats[key]
    if (!stat) continue

    const baseNull = baseline.fieldNullRatio[key]
    if (baseNull !== undefined && stat.null_ratio - baseNull >= t.nullRatioIncrease) {
      signals.push({
        kind: 'null_spike',
        field: key,
        observed: stat.null_ratio,
        baseline: baseNull,
        threshold: t.nullRatioIncrease,
      })
    }

    if (stat.type_fail_ratio > t.typeFailRatio) {
      signals.push({
        kind: 'type_fail',
        field: key,
        observed: stat.type_fail_ratio,
        baseline: baseline.fieldTypeFailRatio[key] ?? null,
        threshold: t.typeFailRatio,
      })
    }
  }

  const verdict: DriftVerdict = signals.length > 0 ? 'drift' : 'ok'
  return { verdict, signals, summary: summarize(verdict, signals, input) }
}

/**
 * 편의 래퍼 — 해석기가 만든 `ValidationReport` 를 그대로 넣는다.
 * `runs.validation_json` 을 저장하는 쪽과 판정하는 쪽이 같은 객체를 쓰게 한다.
 */
export function evaluateReport(
  report: ValidationReport,
  baseline: DriftBaseline | null,
  schema?: readonly FieldDef[],
  overrides?: Partial<DriftThresholds>,
): DriftReport {
  return evaluateDrift(
    { itemsFound: report.items_found, fieldStats: report.fields, baseline, schema },
    overrides,
  )
}

/** 드리프트 판정 → `runs.status` (G0 계약 (1)). 치유 성공 후의 `healed` 는 치유 쪽이 쓴다 */
export function verdictToRunStatus(verdict: DriftVerdict): 'ok' | 'drift' | 'failed' {
  return verdict
}

// ── 사람이 읽는 문구 (보장선 B2 · B4) ──────────────────────────────────
//
// 여기서 쓰면 안 되는 말: 드리프트 · 스펙 · 어댑터 · 파서 · null · 런 · probe · 컴파일 · 필드
// 써도 되는 말: 사이트 · 출처 · 목록 · 값 · 컬렉션, 그리고 사용자가 직접 지은 필드 라벨

function summarize(verdict: DriftVerdict, signals: DriftSignal[], input: DriftInput): string {
  if (verdict === 'failed') {
    return '지금은 이 사이트에서 목록을 가져오지 못했어요. 마지막으로 받아둔 내용을 그대로 보여드리는 중입니다.'
  }

  if (verdict === 'ok') {
    if (input.baseline === null) {
      return '처음 받아온 목록이에요. 다음부터 이번 결과와 견주어 이상이 없는지 살펴볼게요.'
    }
    return '새 목록을 정상적으로 받아왔어요.'
  }

  // drift — 첫 문장은 항상 같다. 사용자는 원인이 아니라 "지금 무슨 일이 벌어지는지"를 알아야 한다.
  const parts = ['이 사이트 구조가 바뀐 것 같아요.']

  const shrank = signals.some((s) => s.kind === 'items_dropped')
  const brokenLabels = labelsOf(
    signals.filter((s) => s.kind === 'null_spike' || s.kind === 'type_fail'),
    input.schema,
  )

  if (brokenLabels.length > 0) {
    parts.push(`${brokenLabels.join(', ')} 값이 제대로 들어오지 않고 있어요.`)
  } else if (!shrank) {
    parts.push('일부 값이 평소와 다르게 들어오고 있어요.')
  }
  if (shrank) {
    parts.push('가져온 목록도 평소보다 많이 줄었어요.')
  }

  parts.push('다시 맞추는 중입니다.')
  return parts.join(' ')
}

/** 필드 키 → 사용자가 지은 한국어 라벨. 라벨을 모르면 그 필드는 문구에서 뺀다 (키 노출 금지) */
function labelsOf(signals: readonly DriftSignal[], schema?: readonly FieldDef[]): string[] {
  if (!schema || schema.length === 0) return []
  const byKey = new Map(schema.map((f) => [f.key, f.label]))
  const seen = new Set<string>()
  const labels: string[] = []
  for (const s of signals) {
    if (s.field === undefined) continue
    const label = byKey.get(s.field)
    if (label === undefined || seen.has(label)) continue
    seen.add(label)
    labels.push(`‘${label}’`)
  }
  // 서너 개를 넘어가면 나열이 아니라 벽이 된다
  if (labels.length > 3) return [...labels.slice(0, 3), '그 밖의 값']
  return labels
}

// ── Gemini 가 읽는 문구 (기획서 9-3③) ─────────────────────────────────

/**
 * 재컴파일 입력의 "**무엇이 깨졌는지**" 부분 (기획서 9-3③).
 * 나머지 두 입력(현재 스펙 · 새 페이지 샘플)은 호출부가 붙인다.
 *
 * 위 `summary` 와 정반대의 문체를 쓴다. 여긴 독자가 기계이므로
 * 필드 키·경로·비율을 **정확히** 적는다. 두루뭉술하면 같은 곳을 또 틀린다.
 */
export function healPrompt(signals: readonly DriftSignal[], spec: AdapterSpec): string {
  const lines: string[] = []

  lines.push('[현재 어댑터 스펙으로 수집한 결과에서 발견된 문제]')
  lines.push(
    `대상: fetch.mode=${spec.fetch.mode} url=${spec.fetch.url} list=${spec.list}` +
      (spec.dedupe_key ? ` dedupe_key=${spec.dedupe_key}` : ''),
  )
  lines.push('')

  if (signals.length === 0) {
    lines.push('- 구체적인 실패 신호가 기록되지 않았습니다. 목록 경로부터 다시 확인하십시오.')
  }

  for (const s of signals) {
    lines.push(`- ${describeSignal(s, spec)}`)
  }

  lines.push('')
  lines.push('[요구사항]')
  lines.push('1. 위에 적힌 문제가 난 경로만 새 페이지 샘플에 맞게 고친 어댑터 스펙(JSON)을 출력하십시오.')
  lines.push('2. 문제가 없는 필드의 path 와 transform 은 그대로 유지하십시오.')
  lines.push('3. 필드 키 집합을 바꾸지 마십시오. 컬렉션 스키마가 이미 이 키로 고정돼 있습니다.')
  lines.push('4. 변환은 정해진 연산자 집합 안에서만 쓰십시오. 코드나 표현식을 넣지 마십시오.')

  return lines.join('\n')
}

function describeSignal(s: DriftSignal, spec: AdapterSpec): string {
  const at = s.field !== undefined ? spec.fields[s.field] : undefined
  const where = at ? ` 이전 경로는 ${at.path} (type=${at.type})` : ''

  switch (s.kind) {
    case 'no_items':
      return (
        `아이템이 0개 추출됐습니다. list 경로 ${spec.list} 가 더 이상 목록을 가리키지 않습니다.` +
        (s.baseline !== null ? ` 직전 성공 수집은 ${s.baseline}개였습니다.` : '')
      )
    case 'items_dropped':
      return (
        `아이템이 ${s.observed}개로, 직전 성공 수집 ${s.baseline}개 대비 ${pct(
          s.baseline ? s.observed / s.baseline : 0,
        )} 입니다 (임계: ${pct(s.threshold)} 이하). list 경로 ${spec.list} 또는 페이지네이션을 확인하십시오.`
      )
    case 'null_spike':
      return (
        `${s.field} 필드가 ${pct(s.observed)} null 입니다` +
        (s.baseline !== null ? ` (기준선 ${pct(s.baseline)}, 임계 +${pct(s.threshold)}p)` : '') +
        `.${where}`
      )
    case 'type_fail':
      return (
        `${s.field} 필드의 타입 파싱 실패율이 ${pct(s.observed)} 입니다 (임계 ${pct(s.threshold)} 초과).` +
        `${where} 값의 표기 형식이 바뀌었거나 다른 값을 집고 있습니다.`
      )
  }
}

/** 0.923 → "92.3%" · 0.5 → "50%" */
function pct(ratio: number): string {
  const v = ratio * 100
  const rounded = Math.round(v * 10) / 10
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`
}
