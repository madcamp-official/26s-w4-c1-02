// 항상 비는 칸 고치기
//
// 여기서 보는 건 하나다: **사용자가 빈 열을 보게 되는가.**
// 실제로 겪은 건 `replace(/.*​/g,'')` 였지만, 어떤 변환이든 결과가 같으면 같이 걸려야 한다 —
// 그래서 테스트도 "이 정규식" 이 아니라 **"값이 비었나"** 로 적는다.

import { describe, expect, it } from 'vitest'

import type { CollectionSchemaJson, ValidationReport } from '@endpointer/core'
import type { AdapterSpec, InterpretedItem } from '@endpointer/core/spec'

import { applyTransformDrop, dropColumns, hasWork, planRepair, repairNotes } from './repair-empty'

// ── 픽스처 ─────────────────────────────────────────────────────────────

const KILLER = { op: 'replace', pattern: '.*', replacement: '', flags: 'g' } as const

function specWith(fields: Record<string, { transform?: unknown[] }>): AdapterSpec {
  return {
    spec_version: 1,
    fetch: { mode: 'html', url: 'https://example.com/list' },
    list: { path: 'css:tbody > tr' },
    pagination: { kind: 'none' },
    fields: Object.fromEntries(
      Object.entries(fields).map(([key, f]) => [
        key,
        { path: `css:.${key}`, type: 'text', ...(f.transform !== undefined ? { transform: f.transform } : {}) },
      ]),
    ),
  } as unknown as AdapterSpec
}

/** data 는 변환 **뒤**, raw._fields 는 변환 **전** */
function rows(
  n: number,
  build: (i: number) => { data: Record<string, unknown>; raw: Record<string, unknown> },
): InterpretedItem[] {
  return Array.from({ length: n }, (_, i) => {
    const { data, raw } = build(i)
    return {
      external_key: `k${i}`,
      external_key_origin: 'link',
      data,
      raw: { _row: '<tr/>', _fields: raw },
    } as unknown as InterpretedItem
  })
}

function reportWith(keys: readonly string[]): ValidationReport {
  return {
    checked_at: '2026-07-27T00:00:00.000Z',
    items_found: 3,
    fields: Object.fromEntries(keys.map((k) => [k, { null_ratio: 0, type_fail_ratio: 0, samples: [] }])),
    passed: true,
    notes: [],
  }
}

const SCHEMA: CollectionSchemaJson = [
  { key: 'title', label: '공고명', type: 'text', required: true, mapping: null, value_labels: null },
  { key: 'organization', label: '주관기관', type: 'text', required: false, mapping: null, value_labels: null },
]

// ── 판단 ───────────────────────────────────────────────────────────────

describe('무엇을 고칠지 정한다', () => {
  it('원값은 있는데 값이 비면 변환을 버린다 — 실제로 겪은 경우', () => {
    const spec = specWith({ title: {}, organization: { transform: [KILLER] } })
    const items = rows(15, (i) => ({
      data: { title: `공고 ${i}`, organization: '' },
      raw: { title: `공고 ${i}`, organization: '재단법인 글로벌디지털혁신네트워크' },
    }))

    const plan = planRepair(spec, items)

    expect(plan.drop_transform).toEqual(['organization'])
    expect(plan.drop_column).toEqual([])
  })

  it('원값도 없으면 칸을 뺀다 — 경로가 틀린 것이다', () => {
    const spec = specWith({ title: {}, organization: {} })
    const items = rows(15, (i) => ({
      data: { title: `공고 ${i}`, organization: null },
      raw: { title: `공고 ${i}`, organization: null },
    }))

    const plan = planRepair(spec, items)

    expect(plan.drop_column).toEqual(['organization'])
    expect(plan.drop_transform).toEqual([])
  })

  it('원값이 있어도 변환이 없으면 뺄 수밖에 없다', () => {
    // 변환이 없는데 결과가 비었다면 버릴 변환도 없다
    const spec = specWith({ title: {}, organization: {} })
    const items = rows(10, () => ({ data: { title: 'ㅇ', organization: '' }, raw: { organization: '있음' } }))

    expect(planRepair(spec, items).drop_column).toContain('organization')
  })

  it('가끔 비는 칸은 건드리지 않는다 — 마감일 없는 공고가 흔하다', () => {
    const spec = specWith({ title: {}, deadline: { transform: [{ op: 'trim' }] } })
    const items = rows(15, (i) => ({
      data: { title: 'ㅇ', deadline: i < 2 ? null : '2026-08-14' },
      raw: { title: 'ㅇ', deadline: i < 2 ? null : '2026-08-14' },
    }))

    expect(hasWork(planRepair(spec, items))).toBe(false)
  })

  it('빈 문자열을 빈 것으로 센다 — 보고서의 null_ratio 로는 안 잡힌다', () => {
    // `replace(/.*​/g,'')` 의 결과는 null 이 아니라 '' 다. 이게 이 파일이 있는 이유다.
    const spec = specWith({ organization: { transform: [KILLER] } })
    const nulls = rows(5, () => ({ data: { organization: null }, raw: { organization: 'ㅇ' } }))
    const empties = rows(5, () => ({ data: { organization: '' }, raw: { organization: 'ㅇ' } }))

    expect(planRepair(spec, nulls).drop_transform).toEqual(['organization'])
    expect(planRepair(spec, empties).drop_transform).toEqual(['organization'])
  })

  it('항목이 없으면 아무 판단도 하지 않는다', () => {
    expect(hasWork(planRepair(specWith({ a: {} }), []))).toBe(false)
  })
})

// ── 적용 ───────────────────────────────────────────────────────────────

describe('변환 버리기', () => {
  it('지목한 칸의 변환만 없앤다', () => {
    const spec = specWith({ title: { transform: [{ op: 'trim' }] }, organization: { transform: [KILLER] } })

    const fixed = applyTransformDrop(spec, ['organization'])

    expect(fixed.fields['organization']?.transform).toBeUndefined()
    // 남의 변환은 그대로 둔다
    expect(fixed.fields['title']?.transform).toHaveLength(1)
    // 경로와 타입은 손대지 않는다 — 변환만 문제였다
    expect(fixed.fields['organization']?.path).toBe('css:.organization')
  })

  it('원본 스펙을 바꾸지 않는다', () => {
    const spec = specWith({ organization: { transform: [KILLER] } })

    applyTransformDrop(spec, ['organization'])

    expect(spec.fields['organization']?.transform).toHaveLength(1)
  })
})

describe('칸 빼기', () => {
  it('스펙·표 구성·항목에서 같이 없앤다 — 셋 중 하나만 빼면 어긋난다', () => {
    const spec = specWith({ title: {}, organization: {} })
    const items = rows(3, () => ({ data: { title: 'ㅇ', organization: '' }, raw: {} }))

    const r = dropColumns(spec, SCHEMA, items, reportWith(['title', 'organization']), ['organization'])

    expect(r.dropped).toEqual(['organization'])
    expect(r.schema.map((f) => f.key)).toEqual(['title'])
    expect(Object.keys(r.spec.fields)).toEqual(['title'])
    expect(r.items.every((i) => !('organization' in i.data))).toBe(true)
    // 보고서에서도 빠져야 한다 — 안 그러면 화면이 없는 칸을 "값이 자주 빈다" 고 알린다
    expect(Object.keys(r.report.fields)).toEqual(['title'])
  })

  it('마지막 칸은 빼지 않는다 — 빈 칸 하나보다 표가 없는 게 나쁘다', () => {
    const spec = specWith({ title: {} })
    const items = rows(3, () => ({ data: { title: '' }, raw: {} }))
    const oneColumn: CollectionSchemaJson = [SCHEMA[0]!]

    const r = dropColumns(spec, oneColumn, items, reportWith(['title']), ['title'])

    expect(r.dropped).toEqual([])
    expect(r.schema).toHaveLength(1)
  })
})

describe('사용자에게 하는 말', () => {
  it('무엇이 사라졌는지 라벨로 알려준다 — 조용히 빼면 그것도 거짓말이다', () => {
    const notes = repairNotes(SCHEMA, ['organization'])

    expect(notes).toHaveLength(1)
    expect(notes[0]).toContain('주관기관')
    // 내부 명사가 새면 안 된다 (보장선 B2)
    for (const bad of ['어댑터', '스펙', '변환', 'transform', 'null', 'field']) {
      expect(notes[0]).not.toContain(bad)
    }
  })

  it('뺀 게 없으면 아무 말도 하지 않는다', () => {
    expect(repairNotes(SCHEMA, [])).toEqual([])
  })
})
