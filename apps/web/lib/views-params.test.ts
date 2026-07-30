import { describe, expect, it } from 'vitest'

import type { FieldDef } from '@endpointer/core'

import { conditionsFromParams, paramsFromConditions } from './views'

/**
 * 텍스트 "포함" 필터 (q_<key> → contains) 회귀.
 * 세일 공지처럼 전부 텍스트 칸인 표에서 뷰를 만들 유일한 길이라, 파라미터 규약이 곧 계약이다.
 */
const field = (key: string, type: FieldDef['type']): FieldDef => ({
  key,
  label: key,
  type,
  required: false,
  mapping: null,
  value_labels: null,
})

const FIELDS = [field('benefit', 'text'), field('link', 'link'), field('deadline', 'date')]

describe('conditionsFromParams — q_(텍스트 포함)', () => {
  it('텍스트 칸의 q_ 를 contains 조건으로 만든다', () => {
    expect(conditionsFromParams({ q_benefit: '할인' }, FIELDS)).toEqual([
      { field: 'benefit', op: 'contains', value: '할인' },
    ])
  })

  it('텍스트가 아닌 칸(q_link·q_deadline)은 조용히 버린다', () => {
    expect(conditionsFromParams({ q_link: 'x', q_deadline: 'x' }, FIELDS)).toEqual([])
  })

  it('공백뿐인 값은 조건이 되지 않는다', () => {
    expect(conditionsFromParams({ q_benefit: '   ' }, FIELDS)).toEqual([])
  })

  it('200자 초과는 스키마 상한에 맞춰 자른다 (버리지 않는다)', () => {
    const long = '가'.repeat(250)
    const out = conditionsFromParams({ q_benefit: long }, FIELDS)
    expect(out).toHaveLength(1)
    expect((out[0] as { value: string }).value).toHaveLength(200)
  })

  it('저장된 뷰를 다시 필터바에 그릴 때 왕복이 맞다', () => {
    const conds = conditionsFromParams({ q_benefit: '할인' }, FIELDS)
    expect(paramsFromConditions(conds)).toEqual({ q_benefit: '할인' })
  })
})
