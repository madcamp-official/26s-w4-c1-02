// enum 파서 테스트 — "A사이트의 기술개발 과 B사이트의 R&D 를 같은 값으로 묶는다" (기획서 5장③)

import { describe, expect, it } from 'vitest'
import { normalizeEnumKey, parseEnum } from './enum'

/** 컬렉션 필드의 mapping. 두 사이트의 분류어가 한 값으로 모인다 */
const MAPPING: Record<string, string> = {
  기술개발: 'rnd',
  'R&D': 'rnd',
  연구개발: 'rnd',
  창업교육: 'education',
  '교육·멘토링': 'education',
}

describe('parseEnum — 매핑 적용', () => {
  it.each([
    ['기술개발', 'rnd'],
    ['R&D', 'rnd'],
    ['연구개발', 'rnd'],
    ['창업교육', 'education'],
    ['교육·멘토링', 'education'],
  ])('%s → %s', (raw, expected) => {
    expect(parseEnum(raw, { mapping: MAPPING })).toEqual({
      ok: true,
      value: { value: expected, unmapped: false },
    })
  })

  it('두 사이트의 다른 표기가 한 값으로 모인다 — 통합이 진짜가 되는 지점', () => {
    const a = parseEnum('기술개발', { mapping: MAPPING })
    const b = parseEnum('R&D', { mapping: MAPPING })
    expect(a.ok && a.value.value).toBe(b.ok && b.value.value)
  })
})

describe('parseEnum — 느슨한 대조', () => {
  it.each(['R & D', 'r&d', 'r-and-d'.replace('and', '&'), ' R&D ', 'R＆D'.replace('＆', '&')])(
    '%s 도 R&D 로 본다',
    (raw) => {
      const r = parseEnum(raw, { mapping: MAPPING })
      expect(r.ok && r.value).toEqual({ value: 'rnd', unmapped: false })
    },
  )

  it('교육 · 멘토링 — 가운뎃점 주변 공백이 달라도 같다', () => {
    const r = parseEnum('교육 · 멘토링', { mapping: MAPPING })
    expect(r.ok && r.value.value).toBe('education')
  })

  it('normalizeEnumKey 는 대소문자·공백·구분기호를 무시한다', () => {
    expect(normalizeEnumKey('R & D')).toBe(normalizeEnumKey('r&d'))
    expect(normalizeEnumKey('교육·멘토링')).toBe(normalizeEnumKey('교육 멘토링'))
  })
})

describe('parseEnum — 매핑에 없는 값', () => {
  it('원값을 유지하고 unmapped 로 표시한다. 버리거나 실패시키지 않는다', () => {
    expect(parseEnum('판로개척', { mapping: MAPPING })).toEqual({
      ok: true,
      value: { value: '판로개척', unmapped: true },
    })
  })

  it('매핑 자체가 없으면 정리된 원값 + unmapped', () => {
    expect(parseEnum('  판로  개척 ')).toEqual({
      ok: true,
      value: { value: '판로 개척', unmapped: true },
    })
  })

  it('unmapped 목록이 사용자에게 물어볼 것의 원천이다', () => {
    const raws = ['기술개발', '판로개척', 'R&D', '수출지원']
    const unmapped = raws
      .map((raw) => parseEnum(raw, { mapping: MAPPING }))
      .filter((r) => r.ok && r.value.unmapped)
      .map((r) => (r.ok ? r.value.value : ''))
    expect(unmapped).toEqual(['판로개척', '수출지원'])
  })
})

describe('parseEnum — 실패는 값으로 돌린다 (throw 금지)', () => {
  it.each([null, undefined, '', '   ', {}])('%p → ok:false', (raw) => {
    expect(parseEnum(raw, { mapping: MAPPING }).ok).toBe(false)
  })
})
