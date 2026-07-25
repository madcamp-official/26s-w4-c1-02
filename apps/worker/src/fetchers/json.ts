// fetch.mode = 'json' — 내부 API 를 그대로 부른다 (기획서 11장 JSON 모드 · 원칙 ③)
//
// 가장 좋은 경로다. HTML 구조 변경에 강하고 페이지네이션이 깔끔하다.

import type { JsonFetchSpec } from '@endpointer/core/spec'

import { httpGet } from './http'
import type { PageFetchOutcome } from './types'

export async function fetchJsonPayload(fetchSpec: JsonFetchSpec, url: string): Promise<PageFetchOutcome> {
  const opts = {
    accept: fetchSpec.headers?.['Accept'] ?? 'application/json, text/plain, */*',
    headers: fetchSpec.headers ?? {},
    method: fetchSpec.method,
  } as const

  const res = await httpGet(url, opts)
  if (!res.ok) return { ok: false, message: res.message }

  const { response } = res
  if (!response.ok) {
    return { ok: false, message: `목록을 주지 않았습니다 (응답 ${response.status})` }
  }

  try {
    const payload: unknown = JSON.parse(response.body)
    return { ok: true, payload, finalUrl: response.url, cached: response.cached }
  } catch {
    // JSON 을 기대했는데 HTML 이 왔다 = 사이트가 바뀌었거나 차단됐다.
    // 드리프트 판정으로 넘어가게 실패로 돌려준다 (원칙 ⑤).
    return { ok: false, message: '받아온 내용이 예상한 형식이 아닙니다' }
  }
}
