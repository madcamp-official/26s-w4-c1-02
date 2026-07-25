// 정규화 파서 배럴 + 타입 디스패처 (기능 ③ · 기획서 5장③ · 9-1⑤)
//
// 해석기는 스펙의 변환 파이프라인을 돌린 **뒤** 마지막으로 이걸 부른다.
// 그래야 소스가 달라도 같은 컬럼에 같은 형식이 들어간다 — "스키마가 하나" 가 참이 되는 지점.
//
// 규약 하나만 기억하면 된다: **여기 있는 함수는 throw 하지 않는다.**
// 실패는 `{ ok: false, reason }` 이고, 그 실패율이 곧 드리프트 신호다 (원칙 ⑤).

import type { FieldType } from '../types/collection'
import type { DateParseOptions, DateValue } from './date'
import type { EnumValue } from './enum'
import type { MoneyValue } from './money'
import { parseDate } from './date'
import { parseEnum } from './enum'
import { parseLink } from './link'
import { parseMoney } from './money'
import { parseNumber } from './number'
import { parseText } from './text'

export * from './result'
export * from './text'
export * from './date'
export * from './money'
export * from './number'
export * from './link'
export * from './enum'

/** 파서가 알아야 하는 바깥 맥락. 전역 상태를 읽지 않기 위해 전부 인자로 받는다 */
export interface NormalizeContext {
  /** 기준일. date 파서의 상대 표기·연도 추론이 여기 걸린다 */
  now: Date
  /** link 파서가 상대경로를 붙일 기준 주소 (보통 소스의 fetch.url) */
  baseUrl?: string
  /** enum 파서의 매핑 테이블 (컬렉션 필드의 `mapping`) */
  mapping?: Record<string, string>
  /** 스펙의 `date_parse.formats` (기획서 11장) */
  formats?: string[]
  /** 스펙의 `date_parse.timezone`. 기본 Asia/Seoul */
  timezone?: string
}

/** 타입별 정규화 결과. `type` 으로 좁히면 value 타입이 확정된다 */
export type NormalizeResult =
  | { ok: true; type: 'text'; value: string }
  | { ok: true; type: 'link'; value: string }
  | { ok: true; type: 'number'; value: number }
  | { ok: true; type: 'date'; value: DateValue }
  | { ok: true; type: 'money'; value: MoneyValue }
  | { ok: true; type: 'enum'; value: EnumValue }
  | { ok: false; type: FieldType; reason: string }

/**
 * FieldType 으로 파서를 고른다.
 *
 * @example
 * const r = normalizeValue('date', '~2026-08-21', { now: new Date('2026-07-26T00:00:00+09:00') })
 * // { ok: true, type: 'date', value: { iso: '2026-08-21', kind: 'exact' } }
 */
export function normalizeValue(type: FieldType, raw: unknown, ctx: NormalizeContext): NormalizeResult {
  switch (type) {
    case 'text': {
      const r = parseText(raw)
      return r.ok ? { ok: true, type, value: r.value } : { ok: false, type, reason: r.reason }
    }
    case 'date': {
      const options: DateParseOptions = { now: ctx.now }
      if (ctx.formats) options.formats = ctx.formats
      if (ctx.timezone) options.timezone = ctx.timezone
      const r = parseDate(raw, options)
      return r.ok ? { ok: true, type, value: r.value } : { ok: false, type, reason: r.reason }
    }
    case 'money': {
      const r = parseMoney(raw)
      return r.ok ? { ok: true, type, value: r.value } : { ok: false, type, reason: r.reason }
    }
    case 'number': {
      const r = parseNumber(raw)
      return r.ok ? { ok: true, type, value: r.value } : { ok: false, type, reason: r.reason }
    }
    case 'link': {
      const r = parseLink(raw, ctx.baseUrl === undefined ? {} : { baseUrl: ctx.baseUrl })
      return r.ok ? { ok: true, type, value: r.value } : { ok: false, type, reason: r.reason }
    }
    case 'enum': {
      const r = parseEnum(raw, ctx.mapping === undefined ? {} : { mapping: ctx.mapping })
      return r.ok ? { ok: true, type, value: r.value } : { ok: false, type, reason: r.reason }
    }
    default: {
      // FieldType 이 늘면 여기서 컴파일이 깨진다 — 조용히 통과시키지 않는다
      const exhaustive: never = type
      return { ok: false, type: exhaustive, reason: '알 수 없는 타입입니다' }
    }
  }
}

/**
 * 정규화 결과를 `items.data_json` 에 그대로 넣을 수 있는 스칼라로 납작하게 만든다.
 * 값의 부가 정보(kind · currency · unmapped)는 여기서 떨어져 나가므로,
 * 그게 필요한 화면은 `normalizeValue` 의 결과를 직접 들고 있어야 한다.
 */
export function toJsonValue(result: NormalizeResult): string | number | null {
  if (!result.ok) return null
  switch (result.type) {
    case 'date':
      return result.value.iso
    case 'money':
      return result.value.amount
    case 'enum':
      return result.value.value
    default:
      return result.value
  }
}

/** 컬렉션 스키마 전체를 한 번에 돌린다. 실패한 필드는 null 로 들어가고 사유가 따로 모인다 */
export function normalizeRecord(
  fields: ReadonlyArray<{ key: string; type: FieldType; mapping?: Record<string, string> | null }>,
  raw: Record<string, unknown>,
  ctx: NormalizeContext,
): { data: Record<string, string | number | null>; failures: Record<string, string> } {
  const data: Record<string, string | number | null> = {}
  const failures: Record<string, string> = {}
  for (const field of fields) {
    const fieldCtx: NormalizeContext = field.mapping ? { ...ctx, mapping: field.mapping } : ctx
    const result = normalizeValue(field.type, raw[field.key], fieldCtx)
    data[field.key] = toJsonValue(result)
    if (!result.ok) failures[field.key] = result.reason
  }
  return { data, failures }
}
