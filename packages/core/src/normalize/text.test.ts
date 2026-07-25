// text 파서 테스트 — 여기가 새면 dedupe 키(정규화 title 해시)가 흔들리고
// 매 수집이 전부 신규가 되어 구독이 스팸이 된다 (기획서 15장 external_key 리스크)

import { describe, expect, it } from 'vitest'
import { cleanText, coerceToString, decodeHtmlEntities, parseText, stripInvisible } from './text'

function t(raw: unknown): string {
  const r = parseText(raw)
  if (!r.ok) throw new Error(`파싱 실패: ${r.reason}`)
  return r.value
}

describe('decodeHtmlEntities', () => {
  it.each([
    ['R&amp;D', 'R&D'],
    ['&lt;공고&gt;', '<공고>'],
    // &nbsp; 는 보통 공백으로 푼다 (JS 의 \s 는 NBSP 를 포함하므로 cleanText 가 어차피 접는다)
    ['2026&nbsp;년', '2026\u0020년'],
    ['&quot;창업&quot;', '"창업"'],
    ['&#65;', 'A'],
    ['&#x41;', 'A'],
    ['&middot;', '·'],
    ['&hellip;', '…'],
    ['&won;', '₩'],
  ])('%s → %s', (raw, expected) => {
    expect(decodeHtmlEntities(raw)).toBe(expected)
  })

  it('이중 인코딩은 한 겹만 푼다 — 두 번 풀면 원문 대조가 거짓말을 한다', () => {
    expect(decodeHtmlEntities('&amp;lt;')).toBe('&lt;')
  })

  it('엔티티가 아닌 & 는 건드리지 않는다', () => {
    expect(decodeHtmlEntities('A & B')).toBe('A & B')
  })

  it('모르는 named 엔티티는 원문 그대로 둔다', () => {
    expect(decodeHtmlEntities('&zzzz;')).toBe('&zzzz;')
  })
})

describe('stripInvisible', () => {
  it.each([
    ['공모​전', '공모전'],
    ['﻿공모전', '공모전'],
    ['공모­전', '공모전'],
    ['공모⁠전', '공모전'],
  ])('보이지 않는 문자를 턴다', (raw, expected) => {
    expect(stripInvisible(raw)).toBe(expected)
  })
})

describe('cleanText — 엔티티 → 보이지 않는 문자 → 공백 접기 → 트림', () => {
  it('개행·탭·연속 공백을 하나로 접는다', () => {
    expect(cleanText('  청년   창업\n\t지원사업  ')).toBe('청년 창업 지원사업')
  })

  it('&nbsp; 도 공백으로 접힌다', () => {
    expect(cleanText('청년&nbsp;&nbsp;창업')).toBe('청년 창업')
  })

  it('전각 공백도 접는다', () => {
    expect(cleanText('청년　창업')).toBe('청년 창업')
  })

  it('null 은 빈 문자열', () => {
    expect(cleanText(null)).toBe('')
  })

  it('같은 뜻의 지저분한 두 문자열이 같은 값으로 수렴한다 (dedupe 안정성)', () => {
    expect(cleanText(' 2026​년  R&amp;D  지원 ')).toBe(cleanText('2026년 R&D 지원'))
  })
})

describe('coerceToString', () => {
  it.each([
    ['문자열', '문자열'],
    [42, '42'],
    [true, 'true'],
  ])('%p → %p', (raw, expected) => {
    expect(coerceToString(raw)).toBe(expected)
  })

  it('배열은 공백으로 잇는다 — HTML 텍스트 노드가 쪼개져 온다', () => {
    expect(coerceToString(['청년', '창업'])).toBe('청년 창업')
  })

  it.each([null, undefined, {}, Number.NaN])('%p → null', (raw) => {
    expect(coerceToString(raw)).toBeNull()
  })
})

describe('parseText', () => {
  it('정리된 값을 낸다', () => {
    expect(t('  청년  창업&amp;도전  ')).toBe('청년 창업&도전')
  })

  it.each([null, undefined, '', '   ', '​', {}])(
    '%p → ok:false (필수 필드의 공백값을 성공으로 세면 드리프트가 눈을 감는다)',
    (raw) => {
      expect(parseText(raw).ok).toBe(false)
    },
  )
})
