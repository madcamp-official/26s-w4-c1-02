// probe 1단계 — 정적 GET → HTML 확보 (기획서 9-1①-1)
//
// 가장 싼 단계이자 나머지 세 단계의 입력이다. 여기서 받은 HTML 로
// 인라인 JSON 을 스캔하고(2단계), 눈에 보이는 텍스트를 뽑아 후보 순위를 매긴다.
//
// **이 파일은 실제로 동작한다.** 외부 의존이 fetch + cheerio 뿐이다.

import { httpGet, isJsonContentType } from '../fetchers/http'
import { extractPage, type ExtractedPage } from '../html'

export interface StaticPage {
  requestedUrl: string
  /** 리다이렉트를 따라간 최종 URL. 상대경로의 기준이 된다 */
  url: string
  host: string
  status: number
  contentType: string
  /** 본문을 무엇으로 읽었는지. utf-8 이 아니면 사람이 알아야 한다 (`fetchers/charset.ts`) */
  charset: string
  html: string
  /** 응답 자체가 JSON 이었다 — 사용자가 내부 API 주소를 바로 붙여넣은 경우 (원칙 ③ 대박) */
  isJson: boolean
  page: ExtractedPage
}

export type StaticOutcome = { ok: true; page: StaticPage } | { ok: false; message: string }

/**
 * URL 하나를 정적으로 받아온다.
 *
 * 응답이 JSON 이면 HTML 파싱을 하지 않고 그대로 넘긴다 — 사용자가 목록 페이지 대신
 * 내부 API 주소를 붙여넣었을 때 그게 가장 좋은 결과이기 때문이다.
 */
export async function fetchStatic(url: string, opts: { noCache?: boolean } = {}): Promise<StaticOutcome> {
  const res = await httpGet(url, { noCache: opts.noCache ?? false })
  if (!res.ok) return { ok: false, message: res.message }

  const { response } = res
  if (!response.ok) {
    return {
      ok: false,
      message: `${new URL(response.url).host} 가 목록을 주지 않았습니다 (응답 ${response.status})`,
    }
  }

  const isJson = isJsonContentType(response.contentType)
  const host = new URL(response.url).host

  return {
    ok: true,
    page: {
      requestedUrl: url,
      url: response.url,
      host,
      status: response.status,
      contentType: response.contentType,
      charset: response.charset,
      html: response.body,
      isJson,
      page: isJson ? { title: null, text: '', scripts: [] } : extractPage(response.body),
    },
  }
}

/**
 * 응답 본문이 JSON 이면 파싱해서 돌려준다. 아니면 null.
 * 사용자가 내부 API 를 바로 붙여넣은 경우를 1단계에서 낚아채기 위한 것.
 */
export function parseJsonBody(page: StaticPage): unknown | null {
  if (!page.isJson) return null
  try {
    return JSON.parse(page.html)
  } catch {
    return null
  }
}
