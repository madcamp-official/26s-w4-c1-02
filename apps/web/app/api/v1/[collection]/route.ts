// 공개 REST API — `GET /api/v1/{slug}` (기획서 12장 · G0 계약 (3)).
// 배포에서는 Caddy 가 api.example.com/* 를 여기로 붙인다.
//
// 여기에 로직을 다시 짜지 않는다. 파라미터 해석도 응답 조립도 core 가 한다 —
// MCP 의 list_items 와 **같은 코드**여야 두 표면이 갈라지지 않는다.

import { buildCollectionResponse, parseCollectionQuery } from '@endpointer/core/query'

import { getCollectionBySlug } from '@/lib/collections'
import { loadCore } from '@/lib/db'
import {
  API_MESSAGES,
  errorResponse,
  isAuthorized,
  jsonResponse,
  preflightResponse,
  type PublicApiBody,
} from '@/lib/public-api'

// 필터·정렬·커서가 매 요청 다르다. 캐시하면 부분 성공 상태가 굳어버린다
export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ collection: string }>
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { collection: slug } = await context.params

  const found = await getCollectionBySlug(slug)
  if (!found.ok) return errorResponse('unavailable', API_MESSAGES.unavailable, 503)

  const collection = found.data
  if (collection === null) return errorResponse('not_found', API_MESSAGES.notFound, 404)

  // private 만 열쇠를 본다. unlisted 는 주소가 곧 열쇠, public 은 무인증 (기획서 12장)
  if (!isAuthorized(request, collection.visibility, collection.api_key_hash)) {
    return errorResponse('unauthorized', API_MESSAGES.unauthorized, 401)
  }

  const core = await loadCore()
  if (core === null) return errorResponse('unavailable', API_MESSAGES.unavailable, 503)

  const url = new URL(request.url)
  const { query, warnings } = parseCollectionQuery(url.searchParams, collection.schema_json)

  try {
    const body = await buildCollectionResponse(core.db, collection, query)
    const payload: PublicApiBody = warnings.length > 0 ? { ...body, warnings } : body
    return jsonResponse(payload)
  } catch (cause) {
    // 조회가 통째로 실패해도 모양은 지킨다. 클라이언트가 items 를 그냥 읽어도 터지지 않는다
    console.warn('[endpointer/web] 공개 응답을 만들지 못했습니다', cause)
    return errorResponse('unavailable', API_MESSAGES.unavailable, 503)
  }
}

export async function OPTIONS(): Promise<Response> {
  return preflightResponse()
}
