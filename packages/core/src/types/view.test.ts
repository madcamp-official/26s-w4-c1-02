// 뷰 계약의 파싱 겹 — 여기서 지키는 것은 A35 하나다:
// **닫힌 집합 밖은 파싱 단계에서 거부된다.** 목록 밖 op, 절대 날짜, 스키마 밖 필드.
// 이 테스트가 깨지면 네 출구(표·알림·REST·MCP) 전부의 안전 전제가 깨진 것이다.

import { describe, expect, it } from 'vitest'

import type { FieldDef } from './collection'
import {
  MAX_VIEW_CONDITIONS,
  ViewConditionSchema,
  ViewDefinitionSchema,
  suggestViewSlug,
  validateViewDefinition,
  type ViewDefinition,
} from './view'

const FIELDS: FieldDef[] = [
  { key: 'title', label: '공고명', type: 'text', required: true, mapping: null, value_labels: null },
  { key: 'deadline', label: '마감일', type: 'date', required: false, mapping: null, value_labels: null },
  { key: 'amount', label: '지원금', type: 'money', required: false, mapping: null, value_labels: null },
  { key: 'category', label: '분야', type: 'enum', required: false, mapping: { 'R&D': 'rnd' }, value_labels: null },
  { key: 'link', label: '원문', type: 'link', required: true, mapping: null, value_labels: null },
]

function def(partial: Partial<ViewDefinition>): ViewDefinition {
  return ViewDefinitionSchema.parse({ name: '테스트 뷰', ...partial })
}

describe('술어 닫힌 집합 (A35)', () => {
  it('목록 밖 op 는 파싱이 거부한다 — custom 을 여는 순간 네 출구가 뚫린다', () => {
    expect(ViewConditionSchema.safeParse({ field: 'title', op: 'custom', value: '1=1' }).success).toBe(false)
    expect(ViewConditionSchema.safeParse({ field: 'title', op: 'regex', value: '.*' }).success).toBe(false)
    expect(ViewConditionSchema.safeParse({ field: 'title', op: 'sql', value: 'drop table' }).success).toBe(false)
  })

  it('절대 날짜는 저장 계층에서 거부된다 (A34·계약 2-b) — 뷰가 한 달 뒤 조용히 죽는다', () => {
    expect(ViewConditionSchema.safeParse({ field: 'deadline', op: 'before', value: '2026-08-31' }).success).toBe(false)
    expect(ViewConditionSchema.safeParse({ field: 'deadline', op: 'within', value: '2026-08' }).success).toBe(false)
    // 상대 표현은 통과한다
    expect(ViewConditionSchema.safeParse({ field: 'deadline', op: 'before', value: 'today' }).success).toBe(true)
    expect(ViewConditionSchema.safeParse({ field: 'deadline', op: 'within', value: 'this_month' }).success).toBe(true)
    expect(ViewConditionSchema.safeParse({ field: 'deadline', op: 'd_within', value: 7 }).success).toBe(true)
  })

  it('op 마다 value 모양이 검증된다', () => {
    expect(ViewConditionSchema.safeParse({ field: 'amount', op: 'between', value: [1, 2] }).success).toBe(true)
    expect(ViewConditionSchema.safeParse({ field: 'amount', op: 'between', value: [1] }).success).toBe(false)
    expect(ViewConditionSchema.safeParse({ field: 'category', op: 'in', value: [] }).success).toBe(false)
    expect(ViewConditionSchema.safeParse({ field: 'deadline', op: 'd_within', value: 1000 }).success).toBe(false)
    expect(ViewConditionSchema.safeParse({ field: 'title', op: 'contains', value: '' }).success).toBe(false)
  })
})

describe('스키마 대조 (validateViewDefinition)', () => {
  it('스키마에 없는 필드 키를 거부한다 — SQL 화이트리스트의 첫 겹', () => {
    const r = validateViewDefinition(
      def({ where: [{ field: 'no_such', op: 'contains', value: '값' }] }),
      FIELDS,
    )
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain('no_such')
  })

  it('필드 타입에 안 맞는 op 를 거부한다 — text 에 gte, link 에 아무거나', () => {
    const bad = validateViewDefinition(
      def({ where: [{ field: 'title', op: 'in', value: ['a'] }] }),
      FIELDS,
    )
    expect(bad.ok).toBe(false)

    const link = validateViewDefinition(
      def({ where: [{ field: 'link', op: 'contains', value: 'http' }] }),
      FIELDS,
    )
    expect(link.ok).toBe(false)
  })

  it('같은 칸에 같은 종류 조건 둘은 거부한다 — 무엇을 의도했는지 알 수 없다', () => {
    const r = validateViewDefinition(
      def({
        where: [
          { field: 'amount', op: 'gte', value: 1 },
          { field: 'amount', op: 'gte', value: 2 },
        ],
      }),
      FIELDS,
    )
    expect(r.ok).toBe(false)
  })

  it('뒤집힌 between 을 거부한다', () => {
    const r = validateViewDefinition(
      def({ where: [{ field: 'amount', op: 'between', value: [10, 1] }] }),
      FIELDS,
    )
    expect(r.ok).toBe(false)
  })

  it('정렬·열도 스키마에 있어야 한다', () => {
    const r = validateViewDefinition(
      def({ sort: [{ field: 'ghost', dir: 'asc' }], columns: ['title', 'ghost2'] }),
      FIELDS,
    )
    expect(r.ok).toBe(false)
    expect(r.errors).toHaveLength(2)
  })

  it('에러 문구에 내부 명사가 없다 (B2) — 화면에 그대로 나갈 수 있어야 한다', () => {
    const r = validateViewDefinition(
      def({ where: [{ field: 'title', op: 'in', value: ['a'] }] }),
      FIELDS,
    )
    for (const e of r.errors) {
      expect(e).not.toMatch(/op|predicate|schema|field_type|zod/i)
    }
  })

  it('정상 정의는 통과한다', () => {
    const r = validateViewDefinition(
      def({
        where: [
          { field: 'deadline', op: 'd_within', value: 7 },
          { field: 'category', op: 'in', value: ['rnd'] },
          { field: 'amount', op: 'gte', value: 1_000_000 },
        ],
        sort: [{ field: 'deadline', dir: 'asc' }],
      }),
      FIELDS,
    )
    expect(r).toEqual({ ok: true, errors: [] })
  })

  it(`조건 수 상한 ${MAX_VIEW_CONDITIONS}개를 넘기면 모양 검증이 거부한다`, () => {
    const many = Array.from({ length: MAX_VIEW_CONDITIONS + 1 }, () => ({
      field: 'title',
      op: 'contains' as const,
      value: '값',
    }))
    expect(ViewDefinitionSchema.safeParse({ name: 'n', where: many }).success).toBe(false)
  })
})

describe('suggestViewSlug — MCP 도구명의 ASCII 제약 (계약 §1 ※)', () => {
  it('라틴 이름은 slug 가 된다', () => {
    expect(suggestViewSlug('Deadline Soon!')).toBe('deadline-soon')
  })

  it('한국어 이름은 null — 호출자가 view-N 순번으로 떨어진다', () => {
    expect(suggestViewSlug('이번 달 마감 · 대학생')).toBeNull()
  })

  it('섞인 이름은 라틴 부분만 살아남는다', () => {
    expect(suggestViewSlug('D-7 마감')).toBe('d-7')
  })
})
