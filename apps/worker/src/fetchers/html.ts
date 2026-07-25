// fetch.mode = 'html' — 정적 HTML 폴백 (기획서 11장 HTML 모드)
//
// payload 는 HTML **문자열** 이다. 해석기가 CSS 경로를 적용할 때
// 우리가 주입한 cheerio HtmlAdapter 를 쓴다 (cheerio-adapter.ts 참조).

import type { HtmlFetchSpec } from '@endpointer/core/spec'

import { httpGet } from './http'
import type { PageFetchOutcome } from './types'

export async function fetchHtmlPayload(_fetchSpec: HtmlFetchSpec, url: string): Promise<PageFetchOutcome> {
  const res = await httpGet(url, {
    accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
  })
  if (!res.ok) return { ok: false, message: res.message }

  const { response } = res
  if (!response.ok) {
    return { ok: false, message: `목록을 주지 않았습니다 (응답 ${response.status})` }
  }
  if (response.body.trim() === '') {
    return { ok: false, message: '빈 페이지를 받았습니다' }
  }

  return { ok: true, payload: response.body, finalUrl: response.url, cached: response.cached }
}
