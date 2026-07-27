// 공개 REST API — `GET /api/v1/{slug}` (기획서 12장 · G0 계약 (3)).
// 배포에서는 Caddy 가 api.example.com/* 를 여기로 붙인다.
//
// 여기에 로직을 다시 짜지 않는다. 파라미터 해석도 응답 조립도 core 가 한다 —
// MCP 의 list_items 와 **같은 코드**여야 두 표면이 갈라지지 않는다.
//
// `?view={slug}` (뷰 계약 §4): 저장된 뷰가 기본값이 되고, 쿼리 파라미터가 그 위를 덮어쓴다.
// 조건 해석은 표·MCP·알림과 같은 문(viewToQuery) 하나다 (A33).

import type { CollectionQuery } from '@endpointer/core'
import { buildCollectionResponse, parseCollectionQuery, viewToQuery } from '@endpointer/core/query'

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
import { getViewBySlug } from '@/lib/views'

// 필터·정렬·커서가 매 요청 다르다. 캐시하면 부분 성공 상태가 굳어버린다
export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ collection: string }>
}

/**
 * 뷰(기본값) 위에 사용자의 쿼리 파라미터를 덮는다 (계약 §4).
 * 조건 객체들은 키 단위로 사용자가 이긴다. limit·cursor·include 는 뷰에 없는 개념이라
 * 언제나 사용자(또는 파라미터 기본값) 몫이다.
 */
function overlayQuery(base: CollectionQuery, user: CollectionQuery): CollectionQuery {
  return {
    ...base,
    eq: { ...base.eq, ...user.eq },
    gte: { ...base.gte, ...user.gte },
    lte: { ...base.lte, ...user.lte },
    in: { ...base.in, ...user.in },
    not_in: { ...base.not_in, ...user.not_in },
    contains: { ...base.contains, ...user.contains },
    not_contains: { ...base.not_contains, ...user.not_contains },
    is_null: [...new Set([...base.is_null, ...user.is_null])],
    q: user.q ?? base.q,
    source: user.source ?? base.source,
    since: user.since ?? base.since,
    sort: user.sort ?? base.sort,
    limit: user.limit,
    cursor: user.cursor,
    include: user.include,
  }
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
  // view 는 여기서 소비한다 — parseCollectionQuery 에 넘기면 "모르는 조건" 경고가 난다
  const viewSlug = url.searchParams.get('view')
  url.searchParams.delete('view')

  const { query, warnings } = parseCollectionQuery(url.searchParams, collection.schema_json)

  let finalQuery = query
  if (viewSlug !== null && viewSlug.trim() !== '') {
    const viewResult = await getViewBySlug(collection, viewSlug.trim())
    const view = viewResult.ok ? viewResult.data : null
    if (view === null) {
      // 없는 뷰는 조용히 무시하지 않는다 — 무엇이 적용 안 됐는지 말한다 (B4·2-8 정신)
      warnings.push(`'${viewSlug}' 라는 저장된 조건이 없어서 조건 없이 보여드려요.`)
    } else if (view.health === 'broken') {
      warnings.push(
        `저장된 조건 '${view.name}' 에 쓰인 칸이 표에서 사라져서 그 조건 없이 보여드려요. 표 주인이 작업실에서 고칠 수 있어요.`,
      )
    } else {
      finalQuery = overlayQuery(viewToQuery({ where: view.where, sort: view.sort }, new Date()), query)
    }
  }

  try {
    const body = await buildCollectionResponse(core.db, collection, finalQuery)
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
