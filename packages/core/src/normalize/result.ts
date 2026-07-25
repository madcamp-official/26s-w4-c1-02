// 정규화 파서 공통 결과 타입
//
// **파서는 절대 throw 하지 않는다.** 실패를 값으로 돌려야
// 드리프트 판정(기획서 7장⑤ · 5장④)이 "이 필드의 실패율이 얼마인가"를 셀 수 있다.
// 예외로 던지면 한 아이템의 지저분한 값 하나가 수집 전체를 죽인다 — 원칙 ④(부분 성공)에 어긋난다.

export type ParseOk<T> = { readonly ok: true; readonly value: T }
export type ParseFail = { readonly ok: false; readonly reason: string }

/** 성공이면 value, 실패면 reason. 둘 다 순수 값이다 */
export type ParseResult<T> = ParseOk<T> | ParseFail

export function ok<T>(value: T): ParseOk<T> {
  return { ok: true, value }
}

export function fail(reason: string): ParseFail {
  return { ok: false, reason }
}

/** 실패 사유는 내부 로그·드리프트 집계용이다. 화면에 그대로 쓰지 않는다 (보장선 B4) */
export const EMPTY_REASON = '빈 값입니다'

export function isOk<T>(result: ParseResult<T>): result is ParseOk<T> {
  return result.ok
}

export function isFail<T>(result: ParseResult<T>): result is ParseFail {
  return !result.ok
}

/** 실패면 기본값으로 대체 (스펙의 `default` 연산자가 쓰는 형태) */
export function unwrapOr<T>(result: ParseResult<T>, fallback: T): T {
  return result.ok ? result.value : fallback
}
