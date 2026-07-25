// 공개 REST API 의 공통 부품 — 기획서 12장.
//
// 두 가지 규칙만 지킨다.
//  1. **모양이 항상 같다.** 실패해도 items/sources/schema_version/page 가 있다.
//     부분 성공이 1급 시민인 제품에서 실패만 다른 모양이면 클라이언트가 두 번 짠다 (원칙 ④).
//  2. **사람 말로 낸다.** 상태 코드와 내부 사정은 응답 본문의 message 에 넣지 않는다 (보장선 B4).

import { createHash, timingSafeEqual } from 'node:crypto'

import type { ApiErrorCode, CollectionResponse } from '@endpointer/core'

/** 공개 읽기 전용 API 다. GET 은 어디서든 부를 수 있어야 한다 */
export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
}

const BASE_HEADERS: Record<string, string> = {
  ...CORS_HEADERS,
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
}

/** 응답 봉투 — 계약(G0 (2))에 경고 한 칸만 더 붙는다. 비어 있으면 아예 안 붙는다 */
export interface PublicApiBody extends CollectionResponse {
  /** 이해하지 못해 버린 조건들. 사람이 읽는 한국어 문장이다 */
  warnings?: string[]
  error?: { message: string; code: ApiErrorCode }
}

const EMPTY: CollectionResponse = {
  items: [],
  sources: {},
  schema_version: 0,
  page: { limit: 0, next_cursor: null },
}

export function jsonResponse(body: PublicApiBody, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: BASE_HEADERS })
}

/** 실패도 같은 모양으로. 클라이언트가 `items` 를 그냥 읽어도 터지지 않는다 */
export function errorResponse(code: ApiErrorCode, message: string, status: number): Response {
  return jsonResponse({ ...EMPTY, error: { message, code } }, status)
}

export function preflightResponse(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

/** 사람이 읽을 실패 문구. 코드도 스택도 없다 */
export const API_MESSAGES = {
  notFound: '이 주소에 해당하는 컬렉션을 찾지 못했어요.',
  unauthorized: '이 컬렉션은 열쇠가 있어야 볼 수 있어요.',
  unavailable: '지금은 내용을 불러오지 못하고 있어요. 잠시 뒤에 다시 시도해 주세요.',
} as const

// ── 인증 (기획서 12장) ───────────────────────────────────────────────────

const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex')

/** 길이가 달라도 timingSafeEqual 이 던지지 않게 해시끼리만 비교한다 */
function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(sha256Hex(a), 'hex')
  const right = Buffer.from(sha256Hex(b), 'hex')
  return timingSafeEqual(left, right)
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match?.[1]?.trim() ?? null
}

/**
 * private 만 열쇠를 요구한다. unlisted 는 추측하기 어려운 주소가 곧 열쇠이고,
 * public 은 아무나 볼 수 있다 (기획서 12장).
 */
export function isAuthorized(
  request: Request,
  visibility: 'private' | 'unlisted' | 'public',
  apiKeyHash: string | null,
): boolean {
  if (visibility !== 'private') return true
  const token = bearerToken(request)
  if (token === null) return false
  // 열쇠를 아직 안 만든 컬렉션은 열어주지 않는다 (기본값이 안전한 쪽)
  if (!apiKeyHash) return false
  return constantTimeEquals(sha256Hex(token), apiKeyHash)
}
