// enum 정규화 — 매핑 테이블로 소스마다 다른 분류어를 하나로 묶는다
//
// "A사이트의 '기술개발' 과 B사이트의 'R&D' 를 같은 값으로 묶는 매핑을
//  사용자가 한 번 알려주면 기억한다." (기획서 5장③)
//
// 매핑에 없는 값을 버리거나 실패로 만들지 않는다. **원값을 유지하고 `unmapped: true` 로 표시**한다.
// 사용자에게 "이 값들은 아직 묶이지 않았습니다" 라고 물어볼 목록이 여기서 나온다.

import type { ParseResult } from './result'
import { EMPTY_REASON, fail, ok } from './result'
import { cleanText, coerceToString } from './text'

export interface EnumValue {
  /** 매핑됐으면 매핑 결과, 아니면 정리된 원값 */
  value: string
  /** 매핑 테이블에서 짝을 못 찾았다 */
  unmapped: boolean
}

export interface EnumParseOptions {
  /** 컬렉션 필드의 `mapping` — 예: `{ "기술개발": "rnd", "R&D": "rnd" }` */
  mapping?: Record<string, string>
}

/**
 * 대조용 키. 대소문자·공백·구분기호를 무시한다.
 * `R&D` · `R & D` · `r-and-d` 를 사람이 같다고 보므로 파서도 같다고 봐야 한다.
 */
export function normalizeEnumKey(input: string): string {
  return cleanText(input)
    .toLowerCase()
    .replace(/[\s·・.,()[\]{}/\\&_-]+/g, '')
}

/** 매핑 테이블을 대조용 키로 한 번 색인해 둔다 */
function indexMapping(mapping: Record<string, string>): Map<string, string> {
  const index = new Map<string, string>()
  for (const [from, to] of Object.entries(mapping)) {
    const key = normalizeEnumKey(from)
    if (key !== '' && !index.has(key)) index.set(key, to)
  }
  return index
}

/**
 * enum 타입 정규화. 매핑을 안 주면 정리된 원값을 그대로 두고 unmapped 로 표시한다.
 */
export function parseEnum(raw: unknown, options: EnumParseOptions = {}): ParseResult<EnumValue> {
  const text = cleanText(coerceToString(raw))
  if (text === '') return fail(EMPTY_REASON)

  const mapping = options.mapping
  if (!mapping) return ok({ value: text, unmapped: true })

  const exact = mapping[text]
  if (exact !== undefined) return ok({ value: exact, unmapped: false })

  const loose = indexMapping(mapping).get(normalizeEnumKey(text))
  if (loose !== undefined) return ok({ value: loose, unmapped: false })

  return ok({ value: text, unmapped: true })
}
