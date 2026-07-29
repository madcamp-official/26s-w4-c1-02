// probe 3단계 — Playwright 로 열고 네트워크 응답을 관찰한다 (기획서 9-1①-3 · 원칙 ③ · P3)
//
// **헤드리스는 JS 렌더링용이 아니라 내부 API 탐지용으로 먼저 쓰인다.**
// 브라우저로 열면 내부 API 를 "추측" 하는 게 아니라 "목격" 한다.
//
// 후보 조건 (기획서 그대로):
//   · content-type: application/json
//   · 배열 길이 ≥ 3
//   · 원소 키가 반복됨
//
// TODO(G1): 실제 사이트 3곳으로 돌려보고 대기 조건(networkidle vs 셀렉터)과
//           타임아웃, 스크롤 유발(무한 스크롤 목록) 을 조정한다. 지금은 골격이다.

import type { Browser, Page, Response } from 'playwright'

import { getConfig } from '../config'
import { checkOutboundUrl, isBlockedOutboundUrl } from '../fetchers/guard'
import { isJsonContentType } from '../fetchers/http'
import { findRecordArrays } from './scan'
import type { ProbeCandidate } from './types'

export interface NetworkProbeInput {
  url: string
  minRows: number
  timeoutMs: number
}

export interface NetworkProbeResult {
  candidates: ProbeCandidate[]
  /** 브라우저가 렌더한 뒤의 HTML — 4단계(DOM 반복 구조)가 이걸 받는다 */
  renderedHtml: string | null
  /** 브라우저가 본 화면 텍스트 */
  renderedText: string | null
  /** JSON 응답을 몇 개나 봤는지 (후보가 아니어도) */
  jsonResponses: number
  note: string
}

/** 페이지 안에서 도는 평가식. 문자열인 이유는 아래 호출부 주석 참조 */
const RENDERED_TEXT = 'document.body ? document.body.innerText : ""'

const EMPTY: NetworkProbeResult = {
  candidates: [],
  renderedHtml: null,
  renderedText: null,
  jsonResponses: 0,
  note: '브라우저를 쓰지 않았습니다',
}

/**
 * 페이지를 열고 오가는 JSON 응답을 전부 본 뒤, 목록으로 보이는 것만 후보로 남긴다.
 *
 * Playwright 가 설치돼 있지 않거나 브라우저가 없으면 **던지지 않고** 빈 결과를 돌려준다.
 * probe 는 실패해도 다음 단계로 내려가야 한다.
 */
export async function probeNetwork(input: NetworkProbeInput): Promise<NetworkProbeResult> {
  const cfg = getConfig()

  const entry = await checkOutboundUrl(input.url)
  if (!entry.ok) return { ...EMPTY, note: entry.message }

  let browser: Browser | null = null
  try {
    const { chromium } = await import('playwright')
    browser = await chromium.launch({ headless: true })
  } catch {
    return { ...EMPTY, note: '브라우저를 띄우지 못했습니다 (playwright install chromium 필요)' }
  }

  const seen: { url: string; method: string; postData: string | null; body: unknown }[] = []
  let jsonResponses = 0
  let renderedHtml: string | null = null
  let renderedText: string | null = null

  try {
    const context = await browser.newContext({
      userAgent: cfg.crawlerUserAgent,
      locale: 'ko-KR',
      // 15장 메모리 리스크 — 이미지·폰트는 목록 탐지에 쓸모가 없다
      viewport: { width: 1280, height: 900 },
    })
    await context.route('**/*', (route) => {
      // 리다이렉트와 페이지가 내는 요청 전부가 여기를 지난다 (fetchers/browser.ts 에 같은 메모)
      if (isBlockedOutboundUrl(route.request().url())) return route.abort()
      const type = route.request().resourceType()
      if (type === 'image' || type === 'font' || type === 'media') return route.abort()
      return route.continue()
    })

    const page: Page = await context.newPage()

    page.on('response', (res: Response) => {
      void (async () => {
        const ct = res.headers()['content-type'] ?? ''
        if (!isJsonContentType(ct)) return
        jsonResponses += 1
        try {
          const body: unknown = await res.json()
          const req = res.request()
          seen.push({ url: res.url(), method: req.method(), postData: req.postData(), body })
        } catch {
          // 본문을 못 읽는 응답(리다이렉트·204 등)은 그냥 넘어간다
        }
      })()
    })

    await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: input.timeoutMs })
    // 목록은 대개 첫 렌더 직후의 XHR 로 온다. networkidle 은 광고·추적 때문에 영영 안 올 수 있어
    // 짧게 기다린 뒤 끊는다.
    await page.waitForLoadState('networkidle', { timeout: input.timeoutMs }).catch(() => {})

    renderedHtml = await page.content()
    // 평가식을 문자열로 넘긴다 — 워커 tsconfig 의 lib 에 "dom" 이 없어 콜백 안에서
    // `document` 를 쓰면 타입 오류가 난다 (fetchers/browser.ts 에 같은 메모가 있다).
    const text: unknown = await page.evaluate(RENDERED_TEXT).catch(() => null)
    renderedText = typeof text === 'string' ? text : null
  } catch {
    // 타임아웃·차단·리다이렉트 루프. 결과는 그때까지 본 것으로 만든다.
  } finally {
    // 15장 대응 — 브라우저는 작업 후 즉시 닫는다
    await browser.close().catch(() => {})
  }

  const candidates: ProbeCandidate[] = []
  for (const res of seen) {
    for (const arr of findRecordArrays(res.body, { minRows: input.minRows, maxCandidates: 3 })) {
      candidates.push({
        id: `network:${res.url}${arr.path}`,
        origin: 'network',
        source: {
          kind: 'network',
          url: res.url,
          method: res.method,
          ...(res.postData !== null && res.postData !== '' ? { post_body: res.postData } : {}),
          json_path: arr.path,
        },
        list_path: arr.list_path,
        // **여기가 원칙 ③의 결실이다** — 내부 API 를 목격했으므로 json 모드로 간다
        fetch_mode: 'json',
        fetch_url: res.url,
        rows: arr.rows,
        keys: arr.keys,
        where: `${short(res.url)} 응답의 ${arr.path} (${arr.size}개)`,
      })
    }
  }

  return {
    candidates,
    renderedHtml,
    renderedText,
    jsonResponses,
    note: `JSON 응답 ${jsonResponses}개 관찰 · 목록 후보 ${candidates.length}개`,
  }
}

function short(url: string): string {
  try {
    const u = new URL(url)
    return `${u.host}${u.pathname}`
  } catch {
    return url
  }
}
