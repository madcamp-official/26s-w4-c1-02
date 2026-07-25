// text 정규화 — 공백 정리 · 보이지 않는 문자 제거 · HTML 엔티티 디코드
//
// 목록 사이트에서 긁힌 텍스트는 거의 항상 다음 셋 중 하나에 오염돼 있다:
//   1. `&amp;` `&nbsp;` 같은 HTML 엔티티
//   2. 제로폭 문자(​), BOM(﻿), soft hyphen(­) — 눈에 안 보이는데 비교를 깨뜨린다
//   3. 개행·탭·전각 공백이 섞인 들여쓰기
// 이 셋을 여기서 한 번에 털어야 dedupe 키(정규화 title 해시)가 안정된다.

import type { ParseResult } from './result'
import { EMPTY_REASON, fail, ok } from './result'

/**
 * 눈에 보이지 않는데 문자열 비교를 깨뜨리는 것들.
 * 제로폭(200B~200D) · word joiner(2060) · BOM(FEFF) · soft hyphen(00AD) · 몽골 모음 구분자(180E)
 */
const INVISIBLE_PATTERN = /[\u200B-\u200D\u2060\uFEFF\u00AD\u180E]/g

/** JS 의 `\s` 는 NBSP·전각 공백을 이미 포함한다 */
const WHITESPACE_PATTERN = /\s+/g

/** 목록 사이트에서 실제로 나오는 것만. 전체 HTML5 엔티티 표를 들고 있을 이유가 없다 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  middot: '·',
  bull: '•',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
  trade: '™',
  times: '×',
  divide: '÷',
  plusmn: '±',
  deg: '°',
  sect: '§',
  para: '¶',
  dagger: '†',
  permil: '‰',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  won: '₩',
  frasl: '/',
  sim: '∼',
}

const ENTITY_PATTERN = /&(#[Xx][0-9A-Fa-f]{1,6}|#\d{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/g

/**
 * HTML 엔티티를 한 번만 푼다.
 * 이중 인코딩(`&amp;lt;`)은 일부러 한 겹만 푼다 — 두 번 풀면 원문에 있던 `&lt;` 가
 * 태그로 둔갑해서 원문 대조(provenance)가 거짓말을 하게 된다.
 */
export function decodeHtmlEntities(input: string): string {
  if (!input.includes('&')) return input
  return input.replace(ENTITY_PATTERN, (whole, body: string) => {
    if (body.startsWith('#')) {
      const isHex = body[1] === 'x' || body[1] === 'X'
      const digits = isHex ? body.slice(2) : body.slice(1)
      const code = Number.parseInt(digits, isHex ? 16 : 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole
      // 서로게이트 영역은 단독으로 유효한 문자가 아니다
      if (code >= 0xd800 && code <= 0xdfff) return whole
      try {
        return String.fromCodePoint(code)
      } catch {
        return whole
      }
    }
    const named = NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()]
    return named ?? whole
  })
}

/** 제로폭·BOM·soft hyphen 제거 */
export function stripInvisible(input: string): string {
  return input.replace(INVISIBLE_PATTERN, '')
}

/**
 * 어떤 원값이든 문자열 후보로 바꾼다. 바꿀 수 없으면 null.
 * 배열은 공백으로 잇는다 — HTML 모드에서 텍스트 노드가 쪼개져 오는 일이 흔하다.
 */
export function coerceToString(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'string') return raw
  if (typeof raw === 'number') return Number.isFinite(raw) ? String(raw) : null
  if (typeof raw === 'bigint') return String(raw)
  if (typeof raw === 'boolean') return String(raw)
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw.toISOString()
  if (Array.isArray(raw)) {
    const parts = raw.map((v) => coerceToString(v)).filter((v): v is string => v !== null && v !== '')
    return parts.length > 0 ? parts.join(' ') : null
  }
  return null
}

/** 엔티티 디코드 → 보이지 않는 문자 제거 → 공백 접기 → 트림. 이 순서를 바꾸지 마라 */
export function cleanText(input: string | null): string {
  if (input === null) return ''
  return stripInvisible(decodeHtmlEntities(input)).replace(WHITESPACE_PATTERN, ' ').trim()
}

/**
 * text 타입 정규화.
 * 정리 후 빈 문자열이면 실패로 본다 — 필수 필드의 공백값을 성공으로 세면
 * null 비율 기반 드리프트 판정이 눈을 감는다.
 */
export function parseText(raw: unknown): ParseResult<string> {
  const cleaned = cleanText(coerceToString(raw))
  if (cleaned === '') return fail(EMPTY_REASON)
  return ok(cleaned)
}
