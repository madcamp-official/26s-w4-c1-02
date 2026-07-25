// 드리프트 기준선 — 기획서 10장 `runs.validation_json` 에서 계산한다
//
// 드리프트는 절대 상태가 아니라 **변화**다. 그래서 비교 대상이 있어야 하고,
// 그 대상은 "최근 N회 성공 수집의 중앙값"이다. 평균이 아니라 중앙값인 이유는
// 한 번의 사고(예: 사이트 점검 중이라 절반만 나온 날)가 기준선을 통째로 오염시키기 때문이다.
//
// 기준선이 없으면(= 첫 수집) 판정하지 않는다. 비교 대상 없이 내린 판정은 전부 오탐이다.

import type { Run, ValidationReport } from '../types/run'
import { DRIFT_THRESHOLDS, type DriftThresholds, resolveThresholds } from './drift'

/**
 * 직전 성공 수집들에서 뽑아낸 비교 기준.
 * `evaluateDrift` 의 입력이며, null 이면 "아직 판정하지 않는다"는 뜻이다.
 */
export interface DriftBaseline {
  /** 기준선을 만든 성공 수집 횟수. `minBaselineRuns` 미만이면 애초에 만들지 않는다 */
  runs: number
  /**
   * **직전** 성공 수집의 아이템 수. 기획서 9-3② 가 "직전 대비"라고 명시했으므로
   * 여기만 중앙값이 아니라 가장 최근 값이다.
   */
  prevItems: number
  /** 최근 N회 아이템 수의 중앙값. 판정에는 안 쓰고 화면·프롬프트의 맥락용 */
  medianItems: number
  /** 필드 키 → 최근 N회 null 비율의 중앙값 (0~1) */
  fieldNullRatio: Record<string, number>
  /** 필드 키 → 최근 N회 타입 실패율의 중앙값 (0~1) */
  fieldTypeFailRatio: Record<string, number>
}

/**
 * 최근 성공 수집의 검증 결과로 기준선을 만든다.
 *
 * @param reports `runs.validation_json` 들. **최신순(newest first)** 이어야 한다.
 *                호출부에서 `started_at DESC LIMIT N` 으로 뽑은 순서를 그대로 넣으면 된다.
 * @returns 표본이 `minBaselineRuns` 에 못 미치면 `null` — 이 경우 드리프트 판정을 하지 않는다.
 */
export function computeBaseline(
  reports: readonly ValidationReport[],
  overrides?: Partial<DriftThresholds>,
): DriftBaseline | null {
  const t = resolveThresholds(overrides)
  const window = reports.slice(0, Math.max(1, t.baselineWindow))
  if (window.length < t.minBaselineRuns || window.length === 0) return null

  const latest = window[0]
  if (!latest) return null

  // 필드가 중간에 추가·삭제될 수 있으므로 "그 필드가 실제로 관측된 수집"만 모은다.
  // 없던 필드를 0 으로 채우면 기준선이 낮아져서 진짜 고장을 놓친다.
  const nulls = new Map<string, number[]>()
  const typeFails = new Map<string, number[]>()

  for (const report of window) {
    for (const [key, stat] of Object.entries(report.fields)) {
      push(nulls, key, stat.null_ratio)
      push(typeFails, key, stat.type_fail_ratio)
    }
  }

  return {
    runs: window.length,
    prevItems: latest.items_found,
    medianItems: median(window.map((r) => r.items_found)) ?? latest.items_found,
    fieldNullRatio: medianOf(nulls),
    fieldTypeFailRatio: medianOf(typeFails),
  }
}

/**
 * `runs` 행 목록에서 바로 기준선을 만든다.
 *
 * 성공한 수집만 기준선이 된다 — `drift` · `failed` 수집을 기준선에 섞으면
 * 고장난 상태가 새 정상이 되어버려서 자가 치유가 영원히 안 돈다.
 * `healed` 는 검증을 통과해서 승격된 것이므로 성공으로 센다.
 */
export function baselineFromRuns(
  runs: readonly Pick<Run, 'status' | 'validation_json' | 'started_at'>[],
  overrides?: Partial<DriftThresholds>,
): DriftBaseline | null {
  const reports = runs
    .filter((r) => r.status === 'ok' || r.status === 'healed')
    .filter((r) => r.validation_json !== null)
    .slice()
    .sort((a, b) => b.started_at.getTime() - a.started_at.getTime())
    .map((r) => r.validation_json as ValidationReport)

  return computeBaseline(reports, overrides)
}

/**
 * 기준선이 없을 때 이번 결과 하나로 첫 기준선을 세운다 (기획서 9-3 첫 수집).
 * 판정은 하지 않고 다음 수집이 견줄 대상만 남긴다.
 */
export function seedBaseline(report: ValidationReport): DriftBaseline | null {
  return computeBaseline([report], { minBaselineRuns: 1 })
}

/** 기준선을 쓸 수 있는 상태인가 */
export function hasUsableBaseline(
  baseline: DriftBaseline | null,
  overrides?: Partial<DriftThresholds>,
): baseline is DriftBaseline {
  const t = overrides ? resolveThresholds(overrides) : DRIFT_THRESHOLDS
  return baseline !== null && baseline.runs >= t.minBaselineRuns
}

// ── 내부 ───────────────────────────────────────────────────────────────

function push(m: Map<string, number[]>, key: string, value: number): void {
  const arr = m.get(key)
  if (arr) arr.push(value)
  else m.set(key, [value])
}

function medianOf(m: Map<string, number[]>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [key, values] of m) {
    const v = median(values)
    if (v !== null) out[key] = v
  }
  return out
}

/** 표본이 비면 null. 짝수 개면 가운데 두 값의 평균 */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid] ?? null
  const lo = sorted[mid - 1]
  const hi = sorted[mid]
  if (lo === undefined || hi === undefined) return null
  return (lo + hi) / 2
}
