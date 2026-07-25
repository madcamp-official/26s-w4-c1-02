// 기획서 9-3② 네 가지 판정의 경계값 · 기준선 없음 · 정상 수집 · 명백한 드리프트

import { describe, expect, it } from 'vitest'
import type { FieldDef } from '../types/collection'
import type { FieldValidation, ValidationReport } from '../types/run'
import type { AdapterSpec } from '../spec/spec'
import { DRIFT_THRESHOLDS, evaluateDrift, evaluateReport, healPrompt } from './drift'
import type { DriftInput, DriftSignal } from './drift'
import type { DriftBaseline } from './baseline'

// ── 픽스처 ─────────────────────────────────────────────────────────────

function stat(nullRatio: number, typeFail = 0): FieldValidation {
  return { null_ratio: nullRatio, type_fail_ratio: typeFail, samples: [] }
}

function baseline(over: Partial<DriftBaseline> = {}): DriftBaseline {
  return {
    runs: 3,
    prevItems: 80,
    medianItems: 80,
    fieldNullRatio: { title: 0, deadline: 0.02, amount: 0.1 },
    fieldTypeFailRatio: { title: 0, deadline: 0, amount: 0 },
    ...over,
  }
}

function input(over: Partial<DriftInput> = {}): DriftInput {
  return {
    itemsFound: 80,
    fieldStats: { title: stat(0), deadline: stat(0.02), amount: stat(0.1) },
    baseline: baseline(),
    ...over,
  }
}

const SCHEMA: FieldDef[] = [
  { key: 'title', label: '공고명', type: 'text', required: true, mapping: null },
  { key: 'deadline', label: '마감일', type: 'date', required: false, mapping: null },
  { key: 'amount', label: '지원금액', type: 'money', required: false, mapping: null },
]

const SPEC = {
  spec_version: 1,
  fetch: { mode: 'json', url: 'https://k-startup.go.kr/api/list', method: 'GET', headers: {} },
  list: '$.data.items[*]',
  dedupe_key: '$.pbancSn',
  fields: {
    title: { path: '$.bizPbancNm', type: 'text' },
    deadline: { path: '$.reqstEndDe', type: 'date' },
    amount: { path: '$.suptAmt', type: 'money' },
  },
  pagination: { kind: 'none' },
} as unknown as AdapterSpec

const kinds = (signals: DriftSignal[]): string[] => signals.map((s) => s.kind)

// ── 정상 수집 ──────────────────────────────────────────────────────────

describe('정상 수집', () => {
  it('기준선과 같으면 ok 이고 신호가 없다', () => {
    const r = evaluateDrift(input())
    expect(r.verdict).toBe('ok')
    expect(r.signals).toEqual([])
  })

  it('아이템이 늘어나는 것은 드리프트가 아니다', () => {
    expect(evaluateDrift(input({ itemsFound: 400 })).verdict).toBe('ok')
  })

  it('null 비율이 낮아지는 것도 드리프트가 아니다', () => {
    const r = evaluateDrift(input({ fieldStats: { deadline: stat(0) } }))
    expect(r.verdict).toBe('ok')
  })
})

// ── ① items == 0 → 실패 ────────────────────────────────────────────────

describe('① items == 0', () => {
  it('아이템이 0이면 drift 가 아니라 failed 다', () => {
    const r = evaluateDrift(input({ itemsFound: 0 }))
    expect(r.verdict).toBe('failed')
    expect(kinds(r.signals)).toEqual(['no_items'])
    expect(r.signals[0]?.baseline).toBe(80)
  })

  it('아이템이 1개면 실패가 아니다 (경계값)', () => {
    const r = evaluateDrift(input({ itemsFound: 1, baseline: baseline({ prevItems: 1 }) }))
    expect(r.verdict).toBe('ok')
  })

  it('0개는 기준선이 없어도 실패로 잡는다 — 비교가 필요 없는 사실이다', () => {
    const r = evaluateDrift(input({ itemsFound: 0, baseline: null }))
    expect(r.verdict).toBe('failed')
    expect(r.signals[0]?.baseline).toBeNull()
  })

  it('0개면 필드 신호를 더 얹지 않는다 — 뽑힌 게 없으면 필드 통계는 무의미하다', () => {
    const r = evaluateDrift(input({ itemsFound: 0, fieldStats: { deadline: stat(1, 1) } }))
    expect(r.signals).toHaveLength(1)
  })
})

// ── ② items 가 직전 대비 50% 이하 ──────────────────────────────────────

describe('② 아이템 급감', () => {
  it('정확히 50% 는 드리프트다 ("이하")', () => {
    const r = evaluateDrift(input({ itemsFound: 40 }))
    expect(r.verdict).toBe('drift')
    expect(kinds(r.signals)).toContain('items_dropped')
    const s = r.signals.find((x) => x.kind === 'items_dropped')
    expect(s?.observed).toBe(40)
    expect(s?.baseline).toBe(80)
    expect(s?.threshold).toBe(0.5)
  })

  it('50% 를 한 개라도 넘으면 통과다', () => {
    expect(evaluateDrift(input({ itemsFound: 41 })).verdict).toBe('ok')
  })

  it('49% 는 드리프트다', () => {
    expect(evaluateDrift(input({ itemsFound: 39 })).verdict).toBe('drift')
  })

  it('임계값은 조절 가능하다 — 30% 로 낮추면 40개는 통과한다', () => {
    expect(evaluateDrift(input({ itemsFound: 40 }), { itemsDropRatio: 0.3 }).verdict).toBe('ok')
    expect(evaluateDrift(input({ itemsFound: 24 }), { itemsDropRatio: 0.3 }).verdict).toBe('drift')
  })

  it('직전이 0개였으면 비교하지 않는다 (0으로 나누지 않는다)', () => {
    const r = evaluateDrift(input({ itemsFound: 5, baseline: baseline({ prevItems: 0 }) }))
    expect(kinds(r.signals)).not.toContain('items_dropped')
  })
})

// ── ③ null 비율이 기준선 대비 +30%p ────────────────────────────────────

describe('③ null 비율 급증', () => {
  it('정확히 +30%p 는 드리프트다', () => {
    const r = evaluateDrift(input({ fieldStats: { deadline: stat(0.32) } }))
    expect(r.verdict).toBe('drift')
    const s = r.signals.find((x) => x.kind === 'null_spike')
    expect(s?.field).toBe('deadline')
    expect(s?.observed).toBeCloseTo(0.32)
    expect(s?.baseline).toBeCloseTo(0.02)
    expect(s?.threshold).toBe(0.3)
  })

  it('+29.9%p 는 통과다', () => {
    expect(evaluateDrift(input({ fieldStats: { deadline: stat(0.319) } })).verdict).toBe('ok')
  })

  it('기준선에 없던 필드는 비교하지 않는다 (새로 붙은 필드가 오탐이 되면 안 된다)', () => {
    const r = evaluateDrift(input({ fieldStats: { organization: stat(1) } }))
    expect(kinds(r.signals)).not.toContain('null_spike')
  })

  it('임계값 조절 — 10%p 로 조이면 +12%p 도 잡힌다', () => {
    const r = evaluateDrift(input({ fieldStats: { deadline: stat(0.14) } }), {
      nullRatioIncrease: 0.1,
    })
    expect(r.verdict).toBe('drift')
  })
})

// ── ④ 타입 파싱 실패율 > 20% ───────────────────────────────────────────

describe('④ 타입 파싱 실패율', () => {
  it('정확히 20% 는 통과다 (기획서가 초과로 명시했다)', () => {
    const r = evaluateDrift(input({ fieldStats: { deadline: stat(0, 0.2) } }))
    expect(r.verdict).toBe('ok')
  })

  it('20% 를 넘으면 드리프트다', () => {
    const r = evaluateDrift(input({ fieldStats: { deadline: stat(0, 0.201) } }))
    expect(r.verdict).toBe('drift')
    const s = r.signals.find((x) => x.kind === 'type_fail')
    expect(s?.field).toBe('deadline')
    expect(s?.threshold).toBe(0.2)
    expect(s?.baseline).toBe(0)
  })

  it('기준선에 없는 필드여도 절대 임계라 잡힌다', () => {
    const r = evaluateDrift(input({ fieldStats: { organization: stat(0, 0.9) } }))
    expect(kinds(r.signals)).toEqual(['type_fail'])
    expect(r.signals[0]?.baseline).toBeNull()
  })
})

// ── 기준선 없음 (첫 수집) ──────────────────────────────────────────────

describe('기준선 없음 = 첫 수집', () => {
  it('비교할 게 없으면 드리프트 판정을 하지 않는다', () => {
    const r = evaluateDrift(input({ baseline: null, itemsFound: 3, fieldStats: { deadline: stat(0.99, 0.99) } }))
    expect(r.verdict).toBe('ok')
    expect(r.signals).toEqual([])
  })

  it('첫 수집임이 사용자 문구에 드러난다', () => {
    const r = evaluateDrift(input({ baseline: null }))
    expect(r.summary).toContain('처음 받아온 목록')
  })

  it('minBaselineRuns 에 못 미치는 기준선도 없는 것으로 친다', () => {
    const r = evaluateDrift(input({ itemsFound: 1, baseline: baseline({ runs: 1 }) }), {
      minBaselineRuns: 3,
    })
    expect(r.verdict).toBe('ok')
  })
})

// ── 명백한 드리프트 ────────────────────────────────────────────────────

describe('명백한 드리프트', () => {
  const broken = input({
    itemsFound: 12,
    fieldStats: { title: stat(0), deadline: stat(0.92), amount: stat(0.1, 0.47) },
    schema: SCHEMA,
  })

  it('세 가지 신호가 한꺼번에 뜬다', () => {
    const r = evaluateDrift(broken)
    expect(r.verdict).toBe('drift')
    expect(kinds(r.signals).sort()).toEqual(['items_dropped', 'null_spike', 'type_fail'])
  })

  it('신호 순서는 필드 키 정렬로 고정된다', () => {
    const r = evaluateDrift(broken)
    const fields = r.signals.filter((s) => s.field !== undefined).map((s) => s.field)
    expect(fields).toEqual(['amount', 'deadline'])
  })
})

// ── 사용자 문구 (보장선 B2 · B4) ───────────────────────────────────────

describe('summary — 사용자가 읽는 문자열', () => {
  const FORBIDDEN = ['드리프트', '스펙', '어댑터', '파서', 'null', 'NULL', '런', 'probe', '컴파일', '필드', 'ratio', 'HTTP']

  const all = [
    evaluateDrift(input()),
    evaluateDrift(input({ baseline: null })),
    evaluateDrift(input({ itemsFound: 0 })),
    evaluateDrift(input({ itemsFound: 10, fieldStats: { deadline: stat(0.92) }, schema: SCHEMA })),
    evaluateDrift(input({ fieldStats: { deadline: stat(0.92) } })),
  ]

  it('어떤 판정에서도 내부 명사가 새지 않는다', () => {
    for (const r of all) {
      for (const word of FORBIDDEN) expect(r.summary).not.toContain(word)
    }
  })

  it('숫자·경로·필드 키를 노출하지 않는다', () => {
    for (const r of all) {
      expect(r.summary).not.toMatch(/\$\.|%|deadline|css:/)
    }
  })

  it('드리프트면 보장선 B4 의 문장으로 시작한다', () => {
    const r = evaluateDrift(input({ fieldStats: { deadline: stat(0.92) }, schema: SCHEMA }))
    expect(r.summary).toContain('이 사이트 구조가 바뀐 것 같아요')
    expect(r.summary).toContain('다시 맞추는 중입니다')
  })

  it('스키마를 주면 사용자가 지은 라벨로 어디가 문제인지 알려준다', () => {
    const r = evaluateDrift(input({ fieldStats: { deadline: stat(0.92) }, schema: SCHEMA }))
    expect(r.summary).toContain('마감일')
  })

  it('스키마가 없으면 필드 키 대신 뭉뚱그린다', () => {
    const r = evaluateDrift(input({ fieldStats: { deadline: stat(0.92) } }))
    expect(r.summary).toContain('일부 값이')
  })

  it('실패는 빨간 에러가 아니라 상태 문구다', () => {
    const r = evaluateDrift(input({ itemsFound: 0 }))
    expect(r.summary).toContain('마지막으로 받아둔 내용')
  })
})

// ── 치유 프롬프트 (기획서 9-3③) ───────────────────────────────────────

describe('healPrompt — Gemini 가 읽는 문자열', () => {
  const r = evaluateDrift(
    input({
      itemsFound: 12,
      fieldStats: { deadline: stat(0.92), amount: stat(0.1, 0.47) },
      schema: SCHEMA,
    }),
  )

  it('summary 와 정반대로 정확한 내부 용어를 쓴다', () => {
    const p = healPrompt(r.signals, SPEC)
    expect(p).toContain('deadline 필드가 92% null 입니다')
    expect(p).toContain('$.reqstEndDe')
  })

  it('타입 실패도 경로와 함께 짚어준다', () => {
    const p = healPrompt(r.signals, SPEC)
    expect(p).toContain('amount 필드의 타입 파싱 실패율이 47%')
    expect(p).toContain('$.suptAmt')
  })

  it('아이템 급감이면 list 경로를 지목한다', () => {
    const p = healPrompt(r.signals, SPEC)
    expect(p).toContain('$.data.items[*]')
    expect(p).toContain('직전 성공 수집 80개')
  })

  it('0개 실패면 list 경로부터 다시 보라고 한다', () => {
    const zero = evaluateDrift(input({ itemsFound: 0 }))
    const p = healPrompt(zero.signals, SPEC)
    expect(p).toContain('아이템이 0개 추출됐습니다')
    expect(p).toContain('$.data.items[*]')
  })

  it('신호가 없어도 빈 문자열을 내지 않는다', () => {
    expect(healPrompt([], SPEC).length).toBeGreaterThan(0)
  })

  it('필드 키 집합을 바꾸지 말라고 못 박는다 (스키마가 이미 고정돼 있다)', () => {
    expect(healPrompt(r.signals, SPEC)).toContain('필드 키 집합을 바꾸지 마십시오')
  })
})

// ── ValidationReport 래퍼 ──────────────────────────────────────────────

describe('evaluateReport', () => {
  it('해석기가 낸 ValidationReport 를 그대로 받는다', () => {
    const report: ValidationReport = {
      checked_at: '2026-07-26T00:00:00.000Z',
      items_found: 20,
      fields: { deadline: stat(0.92) },
      passed: false,
      notes: [],
    }
    const r = evaluateReport(report, baseline(), SCHEMA)
    expect(r.verdict).toBe('drift')
    expect(kinds(r.signals)).toContain('null_spike')
  })
})

// ── 임계값 상수 ────────────────────────────────────────────────────────

describe('DRIFT_THRESHOLDS', () => {
  it('기본값이 기획서 9-3② 와 같다', () => {
    expect(DRIFT_THRESHOLDS.itemsDropRatio).toBe(0.5)
    expect(DRIFT_THRESHOLDS.nullRatioIncrease).toBe(0.3)
    expect(DRIFT_THRESHOLDS.typeFailRatio).toBe(0.2)
  })
})
