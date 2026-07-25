// 기준선 계산 — 기획서 10장 `runs.validation_json` → 최근 N회 중앙값

import { describe, expect, it } from 'vitest'
import type { Run, ValidationReport } from '../types/run'
import { baselineFromRuns, computeBaseline, hasUsableBaseline, median, seedBaseline } from './baseline'
import { evaluateDrift } from './drift'

function report(items: number, nulls: Record<string, number>, typeFails: Record<string, number> = {}): ValidationReport {
  const fields: ValidationReport['fields'] = {}
  for (const [key, ratio] of Object.entries(nulls)) {
    fields[key] = { null_ratio: ratio, type_fail_ratio: typeFails[key] ?? 0, samples: [] }
  }
  return { checked_at: '2026-07-26T00:00:00.000Z', items_found: items, fields, passed: true, notes: [] }
}

type RunRow = Pick<Run, 'status' | 'validation_json' | 'started_at'>

function run(row: RunRow): RunRow {
  return row
}

describe('median', () => {
  it('빈 표본은 null', () => expect(median([])).toBeNull())
  it('홀수는 가운데 값', () => expect(median([3, 1, 2])).toBe(2))
  it('짝수는 가운데 두 값의 평균', () => expect(median([1, 2, 3, 4])).toBe(2.5))
  it('원본 배열을 건드리지 않는다', () => {
    const src = [3, 1, 2]
    median(src)
    expect(src).toEqual([3, 1, 2])
  })
})

describe('computeBaseline', () => {
  it('표본이 없으면 null — 첫 수집에서는 판정하지 않는다', () => {
    expect(computeBaseline([])).toBeNull()
  })

  it('한 번의 성공만으로도 기준선이 선다 (기본 minBaselineRuns=1)', () => {
    const b = computeBaseline([report(50, { deadline: 0.1 })])
    expect(b?.runs).toBe(1)
    expect(b?.prevItems).toBe(50)
    expect(b?.fieldNullRatio['deadline']).toBe(0.1)
  })

  it('minBaselineRuns 를 올리면 표본이 찰 때까지 기준선을 안 만든다', () => {
    const reports = [report(50, {}), report(50, {})]
    expect(computeBaseline(reports, { minBaselineRuns: 3 })).toBeNull()
    expect(computeBaseline([...reports, report(50, {})], { minBaselineRuns: 3 })).not.toBeNull()
  })

  it('null 비율은 평균이 아니라 중앙값이다 — 사고 한 번이 기준선을 오염시키면 안 된다', () => {
    const b = computeBaseline([
      report(80, { deadline: 0.0 }),
      report(80, { deadline: 0.05 }),
      report(80, { deadline: 0.9 }), // 사이트 점검으로 망가졌던 날
    ])
    expect(b?.fieldNullRatio['deadline']).toBe(0.05) // 평균이면 0.316
  })

  it('prevItems 는 중앙값이 아니라 가장 최근 값이다 ("직전 대비")', () => {
    const b = computeBaseline([report(10, {}), report(80, {}), report(90, {})])
    expect(b?.prevItems).toBe(10)
    expect(b?.medianItems).toBe(80)
  })

  it('최근 N회만 본다 — 오래된 수집은 잘라낸다', () => {
    const reports = [report(1, {}), report(2, {}), report(3, {}), report(100, {})]
    expect(computeBaseline(reports, { baselineWindow: 3 })?.medianItems).toBe(2)
  })

  it('중간에 생긴 필드는 관측된 수집만으로 중앙값을 낸다 (0으로 메우지 않는다)', () => {
    const b = computeBaseline([
      report(80, { deadline: 0.1, amount: 0.4 }),
      report(80, { deadline: 0.1 }),
      report(80, { deadline: 0.1 }),
    ])
    expect(b?.fieldNullRatio['amount']).toBe(0.4)
    expect(b?.fieldNullRatio['deadline']).toBe(0.1)
  })

  it('타입 실패율 중앙값도 같이 낸다', () => {
    const b = computeBaseline([
      report(80, { amount: 0 }, { amount: 0.02 }),
      report(80, { amount: 0 }, { amount: 0.04 }),
      report(80, { amount: 0 }, { amount: 0.06 }),
    ])
    expect(b?.fieldTypeFailRatio['amount']).toBe(0.04)
  })
})

describe('baselineFromRuns', () => {
  const at = (iso: string): Date => new Date(iso)

  it('성공한 수집만 기준선이 된다 — 고장난 상태가 새 정상이 되면 치유가 영원히 안 돈다', () => {
    const b = baselineFromRuns([
      run({ status: 'drift', validation_json: report(2, { deadline: 0.95 }), started_at: at('2026-07-26T00:00:00Z') }),
      run({ status: 'failed', validation_json: report(0, {}), started_at: at('2026-07-25T00:00:00Z') }),
      run({ status: 'ok', validation_json: report(80, { deadline: 0.02 }), started_at: at('2026-07-24T00:00:00Z') }),
    ])
    expect(b?.runs).toBe(1)
    expect(b?.prevItems).toBe(80)
    expect(b?.fieldNullRatio['deadline']).toBe(0.02)
  })

  it('healed 는 검증을 통과해서 승격된 것이므로 성공으로 센다', () => {
    const b = baselineFromRuns([
      run({ status: 'healed', validation_json: report(70, {}), started_at: at('2026-07-26T00:00:00Z') }),
      run({ status: 'ok', validation_json: report(80, {}), started_at: at('2026-07-25T00:00:00Z') }),
    ])
    expect(b?.runs).toBe(2)
    expect(b?.prevItems).toBe(70)
  })

  it('입력 순서와 무관하게 started_at 내림차순으로 정렬한다', () => {
    const b = baselineFromRuns([
      run({ status: 'ok', validation_json: report(10, {}), started_at: at('2026-07-20T00:00:00Z') }),
      run({ status: 'ok', validation_json: report(99, {}), started_at: at('2026-07-26T00:00:00Z') }),
    ])
    expect(b?.prevItems).toBe(99)
  })

  it('validation_json 이 비어 있는 수집은 건너뛴다', () => {
    const b = baselineFromRuns([
      run({ status: 'ok', validation_json: null, started_at: at('2026-07-26T00:00:00Z') }),
    ])
    expect(b).toBeNull()
  })

  it('성공 이력이 하나도 없으면 null', () => {
    expect(baselineFromRuns([])).toBeNull()
  })
})

describe('seedBaseline · hasUsableBaseline', () => {
  it('첫 수집 결과로 다음 수집이 견줄 기준선을 세운다', () => {
    const b = seedBaseline(report(20, { deadline: 0.05 }))
    expect(b?.runs).toBe(1)
    expect(b?.prevItems).toBe(20)
  })

  it('hasUsableBaseline 이 판정 가능 여부를 알려준다', () => {
    expect(hasUsableBaseline(null)).toBe(false)
    expect(hasUsableBaseline(seedBaseline(report(20, {})))).toBe(true)
    expect(hasUsableBaseline(seedBaseline(report(20, {})), { minBaselineRuns: 2 })).toBe(false)
  })
})

describe('기준선 → 판정 연결', () => {
  it('첫 수집은 어떤 값이 나와도 통과하고, 그 결과가 다음 수집의 잣대가 된다', () => {
    const first = report(100, { deadline: 0.0 })
    expect(evaluateDrift({ itemsFound: first.items_found, fieldStats: first.fields, baseline: null }).verdict).toBe('ok')

    const b = seedBaseline(first)
    const second = report(100, { deadline: 0.95 })
    const r = evaluateDrift({ itemsFound: second.items_found, fieldStats: second.fields, baseline: b })
    expect(r.verdict).toBe('drift')
  })
})
