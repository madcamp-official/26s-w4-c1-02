// probe — URL 하나를 받아 "이 페이지의 목록이 무엇인지" 를 찾는다 (기획서 9-1① · ADR A3)
//
// ── 순서가 곧 설계다 ────────────────────────────────────────────────────
//   1. 정적 GET            static.ts       가장 쌈. 나머지 셋의 입력이기도 하다
//   2. 인라인 JSON         inline-json.ts  브라우저 없이 뚫리면 최고
//   3. 네트워크 관찰       network.ts      내부 API 를 목격한다 (원칙 ③)
//   4. DOM 반복 구조       dom.ts          마지막 폴백
//
// 싼 것부터 시도하고, **충분히 좋은 후보가 나오면 거기서 멈춘다.** "충분히 좋다" 의 기준은
// 겹침률(rank.ts)이다. 브라우저를 띄우는 3·4단계는 1·2단계가 실패했을 때만 돈다.
//
// ── G1 판정 조건 ────────────────────────────────────────────────────────
// "probe 가 어느 경로로 뚫렸는지가 로그에 구분돼 남는다."
// 그래서 결과에 `probe_path` 와 단계별 `steps` 가 **반드시** 들어간다. 이건 부가 정보가 아니라
// 이 함수의 출력 계약이다.

import type { FetchMode } from '@endpointer/core'

import { childLogger } from '../logger'
import { probeDom } from './dom'
import { scanInlineJson } from './inline-json'
import { probeNetwork } from './network'
import { rankCandidates } from './rank'
import { findRecordArrays } from './scan'
import { fetchStatic, parseJsonBody, type StaticPage } from './static'
import { extractPage } from '../html'
import { fetchBrowserPayload } from '../fetchers/browser'
import {
  PROBE_DEFAULTS,
  type ProbeCandidate,
  type ProbeOptions,
  type ProbePath,
  type ProbeResult,
  type ProbeStep,
  type RankedCandidate,
} from './types'

export * from './types'
export { rankCandidates } from './rank'
export { fetchStatic } from './static'
export { scanInlineJson } from './inline-json'
export { probeNetwork } from './network'
export { probeDom } from './dom'
export { findRecordArrays, sampleRows } from './scan'

/**
 * URL 하나를 probe 한다. 어떤 단계에서도 예외를 던지지 않는다 —
 * 못 뚫는 것은 사고가 아니라 결과다 (`ok: false`).
 */
export async function probe(url: string, opts: ProbeOptions = {}): Promise<ProbeResult> {
  const startedAt = Date.now()
  const log = childLogger({ mod: 'probe', url })

  const minOverlap = opts.minOverlap ?? PROBE_DEFAULTS.minOverlap
  const minRows = opts.minRows ?? PROBE_DEFAULTS.minRows
  const timeoutMs = opts.browserTimeoutMs ?? PROBE_DEFAULTS.browserTimeoutMs

  const steps: ProbeStep[] = []
  const warnings: string[] = []
  const collected: ProbeCandidate[] = []

  // ── 1단계 · 정적 GET ─────────────────────────────────────────────────
  const staticStart = Date.now()
  const staticRes = await fetchStatic(url)

  // 정적 GET 이 막혀도(봇 차단 403 등) 브라우저로는 열릴 수 있다 — 여기서 끝내지 않는다.
  // 한국 공공·대학 사이트는 기본 UA 에 403 을 주고 브라우저 UA 에는 본문을 주는 곳이 흔하다.
  // browserRescue 는 `fetchBrowserPayload` 를 쓰므로 4xx·5xx(소프트 404 포함)는 그대로 거부된다
  // — 정적이 막힌 것과 브라우저로 뚫리는 것만 살린다 (A 의 b6a4ae7 4xx 방어와 일관).
  let page: StaticPage
  if (staticRes.ok) {
    page = staticRes.page
  } else {
    if (opts.skipBrowser === true) {
      // 브라우저를 못 쓰면 정적이 유일한 길이었다 — 진짜 실패
      steps.push(step('network', false, 0, staticStart, `정적 요청이 막혔습니다 (${staticRes.message}) · 브라우저 건너뜀`))
      return failed(url, startedAt, steps, [staticRes.message])
    }
    const rescued = await browserRescue(url, timeoutMs)
    if (rescued === null) {
      steps.push(step('network', false, 0, staticStart, `정적 요청이 막혔고 브라우저로도 열지 못했습니다 (${staticRes.message})`))
      return failed(url, startedAt, steps, [staticRes.message])
    }
    page = rescued
    steps.push(step('network', true, 0, staticStart, `정적 요청이 막혀(${staticRes.message}) 브라우저로 다시 열었습니다`))
  }
  let pageText = page.page.text

  // 사용자가 내부 API 주소를 바로 붙여넣은 경우 — 1단계에서 끝난다 (원칙 ③의 최고 시나리오)
  const directJson = parseJsonBody(page)
  if (directJson !== null) {
    for (const arr of findRecordArrays(directJson, { minRows })) {
      collected.push({
        id: `direct${arr.path}`,
        origin: 'network',
        source: { kind: 'network', url: page.url, method: 'GET', json_path: arr.path },
        list_path: arr.list_path,
        fetch_mode: 'json',
        fetch_url: page.url,
        rows: arr.rows,
        keys: arr.keys,
        where: `이 주소의 응답 ${arr.path} (${arr.size}개)`,
      })
    }
    // 응답 자체가 JSON 이면 견줄 "화면 텍스트" 가 없다. 값끼리 비교할 게 없으므로
    // 겹침률 판정을 건너뛰고 통과시킨다.
    pageText = collectText(directJson)
    // 경로는 'network' 로 남긴다 — 사용자가 붙여넣은 것이 곧 내부 API 였다는 뜻이고,
    // 그게 이 단계에서 "목격" 한 것과 같은 종류의 후보다 (G1 판정 로그가 이 값을 읽는다).
    steps.push(step('network', true, collected.length, staticStart, '붙여넣은 주소의 응답이 곧 JSON 이었습니다'))
    const ranked = rankCandidates({ pageText, candidates: collected })
    return finish(url, page, pageText, startedAt, steps, ranked, warnings, 'network')
  }

  // 1단계(정적 GET)는 독립된 probe 경로가 아니라 나머지의 입력이다.
  // ProbePath 에 'static' 을 두지 않는 이유가 그것이고, 대신 2단계 note 에 합쳐 남긴다.
  // utf-8 이 아니면 적어 둔다. 안 적으면 글자가 깨진 채로도 겹침률 100% 가 나와서
  // 아무도 알아채지 못한다 (`fetchers/charset.ts` 머리말).
  const charsetNote = page.charset === 'utf-8' ? '' : ` · ${page.charset} 로 읽음`
  const staticNote = `HTML ${page.html.length.toLocaleString('ko-KR')}자 (${Date.now() - staticStart}ms)${charsetNote}`

  // ── 2단계 · 인라인 JSON ──────────────────────────────────────────────
  const inlineStart = Date.now()
  const inline = scanInlineJson({ page, minRows })
  collected.push(...inline)
  steps.push(
    step(
      'inline_json',
      true,
      inline.length,
      inlineStart,
      `${staticNote} · script ${page.page.scripts.length}개 검사`,
    ),
  )

  let ranked = rankCandidates({ pageText, candidates: collected })
  if (good(ranked, minOverlap)) {
    log.info({ probe_path: 'inline_json', overlap: ranked[0]?.overlap }, '인라인 JSON 으로 뚫림')
    return finish(url, page, pageText, startedAt, steps, ranked, warnings, 'inline_json')
  }

  // ── 3단계 · 네트워크 관찰 (브라우저) ─────────────────────────────────
  let renderedHtml: string | null = null
  if (opts.skipBrowser === true) {
    steps.push(step('network', false, 0, Date.now(), '브라우저 단계를 건너뛰도록 지정됨 (G1 강등 규칙 1)'))
  } else {
    const netStart = Date.now()
    const net = await probeNetwork({ url: page.url, minRows, timeoutMs })
    collected.push(...net.candidates)
    renderedHtml = net.renderedHtml
    if (net.renderedText !== null && net.renderedText.length > pageText.length) {
      // 브라우저가 렌더한 화면이 정적 HTML 보다 글자가 많다 = 목록이 JS 로 그려진다
      pageText = net.renderedText.replace(/\s+/g, ' ').trim()
    }
    steps.push(step('network', true, net.candidates.length, netStart, net.note))

    ranked = rankCandidates({ pageText, candidates: collected })
    if (good(ranked, minOverlap)) {
      log.info({ probe_path: 'network', overlap: ranked[0]?.overlap }, '네트워크 관찰로 뚫림')
      return finish(url, page, pageText, startedAt, steps, ranked, warnings, 'network')
    }
  }

  // ── 4단계 · DOM 반복 구조 ────────────────────────────────────────────
  if (opts.skipDom === true) {
    steps.push(step('dom', false, 0, Date.now(), 'DOM 반복 구조 탐지를 건너뛰도록 지정됨 (G1 강등 규칙 2)'))
  } else {
    const domStart = Date.now()
    const usingRendered = renderedHtml !== null
    const domOrigin: Extract<ProbePath, 'dom' | 'browser_render'> = usingRendered ? 'browser_render' : 'dom'
    const dom = probeDom({
      html: renderedHtml ?? page.html,
      url: page.url,
      minRows,
      origin: domOrigin,
    })
    collected.push(...dom.candidates)
    steps.push(step(domOrigin, true, dom.candidates.length, domStart, dom.note))

    ranked = rankCandidates({ pageText, candidates: collected })
    if (good(ranked, minOverlap)) {
      log.info({ probe_path: domOrigin, overlap: ranked[0]?.overlap }, 'DOM 반복 구조로 뚫림')
      return finish(url, page, pageText, startedAt, steps, ranked, warnings, domOrigin)
    }
  }

  // ── 전부 실패 ────────────────────────────────────────────────────────
  if (ranked.length > 0) {
    warnings.push(
      `후보를 ${ranked.length}개 찾았지만 화면에 보이는 내용과 충분히 겹치지 않습니다 (최고 ${Math.round((ranked[0]?.overlap ?? 0) * 100)}%).`,
    )
  } else {
    warnings.push('이 주소에서 반복되는 목록을 찾지 못했습니다.')
  }
  log.warn({ candidates: ranked.length }, 'probe 실패')

  return {
    url,
    final_url: page.url,
    host: page.host,
    ok: false,
    probe_path: null,
    fetch_mode: 'html',
    best: ranked[0] ?? null,
    candidates: ranked,
    steps,
    page: { title: page.page.title, text: pageText, html_bytes: page.html.length },
    warnings,
    duration_ms: Date.now() - startedAt,
  }
}

// ── 도우미 ─────────────────────────────────────────────────────────────

function good(ranked: readonly RankedCandidate[], minOverlap: number): boolean {
  const best = ranked[0]
  return best !== undefined && best.overlap >= minOverlap
}

function step(path: ProbePath, ran: boolean, candidates: number, since: number, note: string): ProbeStep {
  return { path, ran, candidates, duration_ms: Date.now() - since, note }
}

/**
 * `pageText` 를 따로 받는 이유: 브라우저가 렌더한 화면이 정적 HTML 보다 글자가 많으면
 * 그쪽을 쓴다. 이 텍스트는 순위 판정의 기준일 뿐 아니라 **컴파일 프롬프트의 입력** 이라
 * (`compile-spec.ts` 의 `pageText`) 여기서 정적 HTML 것으로 되돌리면 프롬프트가 빈 화면을 본다.
 */
function finish(
  url: string,
  page: StaticPage,
  pageText: string,
  startedAt: number,
  steps: ProbeStep[],
  ranked: RankedCandidate[],
  warnings: string[],
  probePath: ProbePath,
): ProbeResult {
  const best = ranked[0] ?? null
  const fetchMode: FetchMode = best?.fetch_mode ?? 'html'
  return {
    url,
    final_url: page.url,
    host: page.host,
    ok: best !== null,
    probe_path: best === null ? null : probePath,
    fetch_mode: fetchMode,
    best,
    candidates: ranked,
    steps,
    page: { title: page.page.title, text: pageText, html_bytes: page.html.length },
    warnings,
    duration_ms: Date.now() - startedAt,
  }
}

/**
 * 정적 GET 이 막혔을 때 브라우저로 페이지를 다시 열어 StaticPage 로 감싼다.
 * `fetchBrowserPayload` 가 4xx·5xx 를 거르므로, 봇 차단(403→브라우저 200)만 통과하고
 * 소프트 404(내용은 있지만 404) 는 여기서도 걸러진다. 못 열면 null.
 */
async function browserRescue(url: string, timeoutMs: number): Promise<StaticPage | null> {
  const out = await fetchBrowserPayload({ mode: 'browser', url, wait_for: 'networkidle' }, url, { timeoutMs })
  if (!out.ok) return null
  // browser 모드의 payload 는 언제나 HTML 문자열이다 (fetchers/browser.ts 머리말)
  const html = typeof out.payload === 'string' ? out.payload : ''
  if (html === '') return null
  const finalUrl = out.finalUrl
  let host = ''
  try {
    host = new URL(finalUrl).host
  } catch {
    host = ''
  }
  return {
    requestedUrl: url,
    url: finalUrl,
    host,
    status: 200,
    contentType: 'text/html',
    charset: 'utf-8', // 브라우저가 이미 디코드한 문자열이다
    html,
    isJson: false,
    page: extractPage(html),
  }
}

function failed(url: string, startedAt: number, steps: ProbeStep[], warnings: string[]): ProbeResult {
  let host = ''
  try {
    host = new URL(url).host
  } catch {
    host = ''
  }
  return {
    url,
    final_url: url,
    host,
    ok: false,
    probe_path: null,
    fetch_mode: 'html',
    best: null,
    candidates: [],
    steps,
    page: { title: null, text: '', html_bytes: 0 },
    warnings,
    duration_ms: Date.now() - startedAt,
  }
}

/** JSON 응답만 있을 때의 "화면 텍스트" 대용 — 값들을 이어붙인다 */
function collectText(data: unknown, limit = 40_000): string {
  const parts: string[] = []
  let size = 0
  const walk = (node: unknown, depth: number): void => {
    if (size > limit || depth > 8) return
    if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
      const s = String(node)
      parts.push(s)
      size += s.length
      return
    }
    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth + 1)
      return
    }
    if (node !== null && typeof node === 'object') {
      for (const child of Object.values(node as Record<string, unknown>)) walk(child, depth + 1)
    }
  }
  walk(data, 0)
  return parts.join(' ')
}
