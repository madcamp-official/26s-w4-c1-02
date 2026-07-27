// 두 번째 사이트 접합 (기능 ②)
//
// 여기서 지키는 불변식은 하나다:
//
//   **말한 것과 내놓는 것이 같아야 한다.**
//   `missing` 에 든 칸은 `spec.fields` 에도 없고 항목에도 없어야 한다.
//
// 실제로 이걸 어긴 적이 있다 — 지어낸 링크를 잡아 "못 만들었어요" 라고 말해 놓고
// 스펙과 항목에는 그대로 두어 그 값이 저장되고 API 로 나갔다.
// 사용자에게 하는 말과 DB 에 넣는 것이 다른 게 제일 나쁜 거짓말이다.
//
// probe·LLM·네트워크는 전부 가짜로 바꾼다. 여기서 보는 건 **조립 규칙**이지 매핑 품질이 아니다.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CollectionSchemaJson } from '@endpointer/core'

const { STATE } = vi.hoisted(() => ({
  STATE: {
    /** matchFields 가 낸다고 칠 매핑 */
    matched: {} as Record<string, { path: string; confidence: number; why: string | null }>,
    /** runAdapter 가 내놓을 항목의 data */
    rows: [] as Record<string, unknown>[],
    /** verifyLinkField 판정 */
    linkOk: true,
  },
}))

vi.mock('../probe', () => ({
  probe: async () => ({
    ok: true,
    probe_path: 'dom',
    host: 'new.example',
    final_url: 'https://new.example/list',
    warnings: [],
    best: {
      id: 'c1',
      origin: 'dom',
      source: 'html',
      list_path: 'css:ul > li',
      fetch_mode: 'html',
      fetch_url: 'https://new.example/list',
      rows: ['행 글자'],
      row_html: ['<li>…</li>'],
      keys: [],
      where: '반복 묶음',
      overlap: 1,
      score: 1,
      reasons: [],
    },
  }),
}))

vi.mock('../compile', () => ({
  matchFields: async () => ({
    ok: true,
    result: { list: 'css:ul > li', dedupe_key: null, matched: STATE.matched, missing: [] },
  }),
  traceValue: () => [],
}))

vi.mock('../fetchers', () => ({
  // 진짜 runAdapter 는 **스펙에 있는 칸만** 내놓는다. 목이 그걸 어기면
  // "스펙에서 뺐는데 항목에 남아 있다" 를 테스트가 못 잡는다.
  runAdapter: async ({ spec }: { spec: { fields: Record<string, unknown> } }) => ({
    items: STATE.rows.map((row, i) => {
      const data = Object.fromEntries(Object.entries(row).filter(([k]) => k in spec.fields))
      return { external_key: `k${i}`, external_key_origin: 'link', data, raw: { _row: '<li/>', _fields: data } }
    }),
    report: { checked_at: '2026-07-27T00:00:00.000Z', items_found: STATE.rows.length, fields: {}, passed: true, notes: [] },
    pagesFetched: 1,
    warnings: [],
    failure: null,
  }),
}))

vi.mock('./verify-link', () => ({
  verifyLinkField: async () => (STATE.linkOk ? { ok: true, reason: '항목 상세로 보입니다' } : { ok: false, reason: '열어 보니 목록이었습니다' }),
}))

const { attachSourceToCollection } = await import('./attach-source')

const SCHEMA: CollectionSchemaJson = [
  { key: 'title', label: '공고명', type: 'text', required: true, mapping: null, value_labels: null },
  { key: 'link', label: '원문 링크', type: 'link', required: false, mapping: null, value_labels: null },
  { key: 'organization', label: '주관기관', type: 'text', required: false, mapping: null, value_labels: null },
]

const found = (path: string) => ({ path, confidence: 0.9, why: null })

async function attach() {
  return attachSourceToCollection({
    collection_id: 'c-1',
    schema: SCHEMA,
    existingSample: [{ title: '기존 공고', link: 'https://old.example/1', organization: '기존기관' }],
    url: 'https://new.example/list',
  })
}

/** 이 파일의 존재 이유 — 말한 것과 내놓는 것이 같은가 */
function expectConsistent(r: Awaited<ReturnType<typeof attach>>): void {
  expect(r.ok).toBe(true)
  if (!r.ok) return
  for (const m of r.missing) {
    expect(Object.keys(r.spec.fields), `${m.key} 가 스펙에 남아 있다`).not.toContain(m.key)
    for (const item of r.items) expect(item.data, `${m.key} 가 항목에 남아 있다`).not.toHaveProperty(m.key)
  }
  for (const f of r.attached) expect(Object.keys(r.spec.fields)).toContain(f.key)
}

beforeEach(() => {
  STATE.matched = {
    title: found('css:.tit'),
    link: found('css:a@href'),
    organization: found('css:.organ'),
  }
  STATE.rows = Array.from({ length: 5 }, (_, i) => ({
    title: `공고 ${i}`,
    link: `https://new.example/detail/${i}`,
    organization: `기관 ${i}`,
  }))
  STATE.linkOk = true
})

describe('전부 찾으면', () => {
  it('물어볼 칸이 없다 — 이게 이 기능이 노리는 결과다', async () => {
    const r = await attach()

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.missing).toEqual([])
    expect(r.attached.map((f) => f.key).sort()).toEqual(['link', 'organization', 'title'])
    expectConsistent(r)
  })

  it('붙은 칸마다 실제로 뽑힌 값을 같이 낸다 (보장선 B3)', async () => {
    const r = await attach()

    if (!r.ok) throw new Error('붙었어야 한다')
    expect(r.attached.find((f) => f.key === 'title')?.samples[0]).toBe('공고 0')
  })
})

describe('링크가 목록으로 가면', () => {
  it('물어볼 칸으로 돌리고 **스펙과 항목에서도 뺀다**', async () => {
    // 실제로 겪은 버그: missing 에만 넣고 스펙·항목에는 남겨 두어
    // "못 만들었어요" 라고 말한 값이 그대로 저장됐다.
    STATE.linkOk = false

    const r = await attach()

    if (!r.ok) throw new Error('붙었어야 한다')
    expect(r.missing.map((m) => m.key)).toEqual(['link'])
    expect(Object.keys(r.spec.fields)).not.toContain('link')
    expect(r.items.every((i) => !('link' in i.data))).toBe(true)
    expectConsistent(r)
  })

  it('나머지 칸은 그대로 붙는다 — 하나 때문에 전부 버리지 않는다', async () => {
    STATE.linkOk = false

    const r = await attach()

    if (!r.ok) throw new Error('붙었어야 한다')
    expect(r.attached.map((f) => f.key).sort()).toEqual(['organization', 'title'])
    expect(r.items).toHaveLength(5)
  })
})

describe('값이 전부 비는 칸은', () => {
  it('물어볼 칸으로 돌린다 — 빈 열을 표에 내지 않는다', async () => {
    STATE.rows = STATE.rows.map((r) => ({ ...r, organization: '' }))

    const r = await attach()

    if (!r.ok) throw new Error('붙었어야 한다')
    expect(r.missing.map((m) => m.key)).toContain('organization')
    expectConsistent(r)
  })
})

describe('매핑이 못 찾은 칸은', () => {
  it('그대로 물어볼 칸이 된다', async () => {
    delete STATE.matched['organization']

    const r = await attach()

    if (!r.ok) throw new Error('붙었어야 한다')
    expect(r.missing.map((m) => m.key)).toEqual(['organization'])
    // 라벨을 같이 준다 — 화면이 "주관기관 값을 붙여넣어 주세요" 를 만들 수 있어야 한다
    expect(r.missing[0]?.label).toBe('주관기관')
    expectConsistent(r)
  })

  it('사용자가 붙여넣어 확정한 경로는 매핑보다 세다', async () => {
    delete STATE.matched['organization']

    const r = await attachSourceToCollection({
      collection_id: 'c-1',
      schema: SCHEMA,
      existingSample: [],
      url: 'https://new.example/list',
      resolved: { organization: 'css:.org-pasted' },
    })

    if (!r.ok) throw new Error('붙었어야 한다')
    const organization = r.attached.find((f) => f.key === 'organization')
    expect(organization?.origin).toBe('pasted')
    expect(organization?.path).toBe('css:.org-pasted')
    expect(r.missing).toEqual([])
  })
})
