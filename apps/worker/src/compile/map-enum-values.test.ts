// enum 값 매핑 파서 테스트 — 관문 규칙이 전부다
//
// LLM 출력은 신뢰하지 않는다. 여기서 검사하는 것은 정확히 네 가지:
// 지어낸 원값 · 깨진 키 · 중복 원값 · 빈 label. 케이스는 bizinfo 컬렉션의
// 실제 관찰값(수출·사업화·광고/마케팅 …)을 그대로 쓴다.

import { describe, expect, it } from 'vitest'
import { parseEnumMapOutput } from './map-enum-values'

/** bizinfo 3소스의 실제 category 관찰값 (07-27 실측) */
const OBSERVED = [
  '수출',
  '내수',
  '경영',
  '기술',
  '사업화',
  '판로ㆍ해외진출',
  '글로벌',
  '광고/마케팅',
  '기획/아이디어',
]

describe('parseEnumMapOutput — 정상 경로', () => {
  it('그룹 제안을 mapping + value_labels 로 굳힌다', () => {
    const out = parseEnumMapOutput(
      JSON.stringify({
        groups: [
          { key: 'export', label: '수출·해외진출', members: ['수출', '판로ㆍ해외진출', '글로벌'] },
          { key: 'tech', label: '기술개발', members: ['기술'] },
        ],
      }),
      OBSERVED,
    )
    expect(out).not.toBeNull()
    expect(out?.mapping).toEqual({
      수출: 'export',
      '판로ㆍ해외진출': 'export',
      글로벌: 'export',
      기술: 'tech',
    })
    expect(out?.value_labels).toEqual({ export: '수출·해외진출', tech: '기술개발' })
  })

  it('제안에서 빠진 원값은 unmapped 로 남는다 — 버리지 않는다', () => {
    const out = parseEnumMapOutput(
      JSON.stringify({ groups: [{ key: 'export', label: '수출', members: ['수출'] }] }),
      OBSERVED,
    )
    expect(out?.unmapped).toContain('내수')
    expect(out?.unmapped).toContain('광고/마케팅')
    expect(out?.unmapped).not.toContain('수출')
  })

  it('코드 펜스로 감싼 출력도 읽는다', () => {
    const fenced = '```json\n{"groups":[{"key":"tech","label":"기술","members":["기술"]}]}\n```'
    expect(parseEnumMapOutput(fenced, OBSERVED)?.mapping).toEqual({ 기술: 'tech' })
  })
})

describe('parseEnumMapOutput — 관문 규칙', () => {
  it('관찰값 목록에 없는 member 는 버린다 — 지어낸 값이다', () => {
    const out = parseEnumMapOutput(
      JSON.stringify({
        groups: [{ key: 'rnd', label: 'R&D', members: ['기술', '연구개발지원'] }],
      }),
      OBSERVED,
    )
    expect(out?.mapping).toEqual({ 기술: 'rnd' })
  })

  it('키가 snake_case 가 아니면 그 그룹을 통째로 버린다 — URL 로 나가는 값이다', () => {
    const out = parseEnumMapOutput(
      JSON.stringify({
        groups: [
          { key: '수출그룹', label: '수출', members: ['수출'] },
          { key: 'Tech-Dev', label: '기술', members: ['기술'] },
          { key: 'management', label: '경영', members: ['경영'] },
        ],
      }),
      OBSERVED,
    )
    expect(out?.mapping).toEqual({ 경영: 'management' })
    expect(out?.unmapped).toContain('수출')
    expect(out?.unmapped).toContain('기술')
  })

  it('같은 원값이 두 그룹에 나오면 첫 그룹이 이긴다', () => {
    const out = parseEnumMapOutput(
      JSON.stringify({
        groups: [
          { key: 'export', label: '수출', members: ['수출'] },
          { key: 'domestic', label: '내수', members: ['내수', '수출'] },
        ],
      }),
      OBSERVED,
    )
    expect(out?.mapping['수출']).toBe('export')
    expect(out?.mapping['내수']).toBe('domestic')
  })

  it('label 이 비면 첫 member 를 표시 이름으로 쓴다', () => {
    const out = parseEnumMapOutput(
      JSON.stringify({ groups: [{ key: 'export', label: '  ', members: ['수출'] }] }),
      OBSERVED,
    )
    expect(out?.value_labels['export']).toBe('수출')
  })

  it('살아남은 매핑이 하나도 없으면 null — 빈 제안을 성공으로 치지 않는다', () => {
    expect(parseEnumMapOutput(JSON.stringify({ groups: [] }), OBSERVED)).toBeNull()
    expect(
      parseEnumMapOutput(JSON.stringify({ groups: [{ key: 'x', label: 'X', members: ['없는값'] }] }), OBSERVED),
    ).toBeNull()
  })

  it('JSON 이 아니거나 형태가 다르면 null (throw 금지)', () => {
    expect(parseEnumMapOutput('이건 JSON 이 아니다', OBSERVED)).toBeNull()
    expect(parseEnumMapOutput(JSON.stringify({ notGroups: [] }), OBSERVED)).toBeNull()
    expect(parseEnumMapOutput(JSON.stringify({ groups: [{ key: 1 }] }), OBSERVED)).toBeNull()
  })
})
