// fetch.mode = 'browser' — Playwright 로 열고 wait_for 후 DOM 을 잡는다 (기획서 11장 browser 모드)
//
// payload 는 html 모드와 같은 **HTML 문자열** 이다. 그래서 해석기 입장에서 두 모드는 같다.
// 다른 건 "어떻게 그 HTML 을 얻었는가" 뿐이다.
//
// 15장 메모리 리스크 대응이 여기 다 걸린다:
//   · 브라우저는 작업 후 즉시 닫는다
//   · 이미지·폰트·미디어는 받지 않는다
//   · 동시에 뜨는 브라우저 수를 BROWSER_CONCURRENCY 로 막는다 (아래 세마포어)
//
// TODO(G1): wait_for 셀렉터 대기와 scroll 페이지네이션을 실제 사이트로 조정한다.

import type { Browser } from 'playwright'

import type { BrowserFetchSpec } from '@endpointer/core/spec'
import { parseCssPathStrict } from '@endpointer/core/spec'

import { getConfig } from '../config'
import { checkOutboundUrl, isBlockedOutboundUrl } from './guard'
import { throttleHost } from './http'
import type { PageFetchOutcome } from './types'

// ── 브라우저 동시성 제한 (15장) ────────────────────────────────────────

let running = 0
const waiting: (() => void)[] = []

async function acquireBrowserSlot(): Promise<() => void> {
  const limit = getConfig().browserConcurrency
  if (running >= limit) {
    await new Promise<void>((resolve) => waiting.push(resolve))
  }
  running += 1
  let released = false
  return () => {
    if (released) return
    released = true
    running -= 1
    waiting.shift()?.()
  }
}

/** 지금 브라우저를 몇 개 띄우고 있는지 (로그·헬스체크용) */
export function browsersInUse(): number {
  return running
}

// ── 페이지 안에서 도는 평가식 (문자열 · 위 주석 참조) ──────────────────

const SCROLL_TO_BOTTOM = 'window.scrollTo(0, document.body.scrollHeight)'

// ── 본체 ───────────────────────────────────────────────────────────────

export interface BrowserFetchOptions {
  /** `pagination.kind === 'scroll'` 일 때 몇 번 내릴지 */
  scrollTimes?: number
  timeoutMs?: number
}

export async function fetchBrowserPayload(
  fetchSpec: BrowserFetchSpec,
  url: string,
  opts: BrowserFetchOptions = {},
): Promise<PageFetchOutcome> {
  const cfg = getConfig()
  const timeout = opts.timeoutMs ?? 20_000

  const entry = await checkOutboundUrl(url)
  if (!entry.ok) return { ok: false, message: entry.message }
  const host = entry.url.host

  const release = await acquireBrowserSlot()
  let browser: Browser | null = null

  try {
    return await throttleHost(host, async () => {
      const { chromium } = await import('playwright')
      browser = await chromium.launch({ headless: true })

      const context = await browser.newContext({
        userAgent: cfg.crawlerUserAgent,
        locale: 'ko-KR',
        viewport: { width: 1280, height: 900 },
      })
      await context.route('**/*', (route) => {
        // 브라우저는 리다이렉트도 따라가고 페이지가 시키는 요청도 낸다. 그 전부가 여기를 지난다 —
        // 첫 주소만 보고 열어 주면 페이지 안의 `<img src="http://127.0.0.1:6379/…">` 한 줄로
        // 내부망을 두드릴 수 있다.
        if (isBlockedOutboundUrl(route.request().url())) return route.abort()
        const type = route.request().resourceType()
        if (type === 'image' || type === 'font' || type === 'media') return route.abort()
        return route.continue()
      })

      const page = await context.newPage()
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout })

      // html·json 모드는 4xx·5xx 를 걸러내는데 browser 모드만 안 보고 있었다 —
      // 404 페이지의 HTML 이 해석기로 들어가면 "수집 성공 · 0건"이 된다 (조용한 실패 · day2 §4-1).
      // 에러 페이지에서는 wait_for 를 기다릴 이유도 없으므로 여기서 바로 끝낸다.
      const status = response?.status() ?? null
      if (status !== null && status >= 400) {
        return { ok: false, message: `목록을 주지 않았습니다 (응답 ${status})` }
      }

      if (fetchSpec.wait_for === 'networkidle') {
        await page.waitForLoadState('networkidle', { timeout }).catch(() => {})
      } else {
        const { selector } = parseCssPathStrict(fetchSpec.wait_for)
        await page.waitForSelector(selector, { timeout }).catch(() => {})
      }

      // TODO(G1): scroll 페이지네이션. 지금은 횟수만 받아 두고 새 항목이 실제로 늘었는지는
      //           확인하지 않는다 (무한 스크롤의 끝 판정은 사이트마다 다르다).
      //
      // 평가식을 화살표 함수가 아니라 **문자열**로 넘기는 이유: tsconfig 의 lib 에 "dom" 이 없다
      // (워커는 Node 전용이다). 콜백으로 쓰면 `window`·`document` 가 타입 오류가 난다.
      // Playwright 는 문자열 평가식을 정식으로 받는다.
      const times = opts.scrollTimes ?? 0
      for (let i = 0; i < times; i += 1) {
        await page.evaluate(SCROLL_TO_BOTTOM)
        await page.waitForTimeout(700)
      }

      const html = await page.content()
      return { ok: true, payload: html, finalUrl: page.url(), cached: false } satisfies PageFetchOutcome
    })
  } catch {
    return { ok: false, message: '이 사이트를 여는 데 실패했습니다' }
  } finally {
    // 즉시 닫는다 (15장)
    if (browser !== null) await (browser as Browser).close().catch(() => {})
    release()
  }
}
