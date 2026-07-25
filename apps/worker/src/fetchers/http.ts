// HTTP 한 겹 — 기획서 6장 "기술적 예의" 를 코드로 옮긴 곳
//
//   · 식별 가능한 User-Agent      CRAWLER_USER_AGENT
//   · 소스별 요청 간격            CRAWLER_MIN_INTERVAL_MS (호스트 단위 직렬화)
//   · 캐시 TTL                    CRAWLER_CACHE_TTL_S (같은 페이지를 반복해 때리지 않는다)
//
// 예의라기보다 수집 안정성 설계다. 차단당하면 데모가 죽는다.

import { getConfig } from '../config'

export interface HttpResponse {
  ok: boolean
  status: number
  /** 리다이렉트를 따라간 뒤의 최종 URL */
  url: string
  contentType: string
  body: string
  /** 캐시에서 나왔는지 */
  cached: boolean
}

export type HttpOutcome = { ok: true; response: HttpResponse } | { ok: false; message: string }

export interface HttpGetOptions {
  accept?: string
  headers?: Record<string, string>
  timeoutMs?: number
  /** 캐시를 무시하고 새로 받는다 */
  noCache?: boolean
  method?: 'GET' | 'POST'
  body?: string
}

// ── 호스트별 직렬화 ────────────────────────────────────────────────────
//
// 호스트마다 "마지막 요청 시각" 을 들고, 간격이 모자라면 그만큼 잔다.
// 프로세스 안에서만 유효하다. 워커가 여러 대가 되면 Redis 로 옮겨야 한다 (TODO(G3)).

const lastRequestAt = new Map<string, number>()
const hostChain = new Map<string, Promise<void>>()

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** 같은 호스트로 가는 요청을 최소 간격 이상 벌려서 직렬 실행한다 */
export async function throttleHost<T>(host: string, run: () => Promise<T>): Promise<T> {
  const minInterval = getConfig().crawlerMinIntervalMs
  const prev = hostChain.get(host) ?? Promise.resolve()

  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  // 다음 호출자는 내가 끝날 때까지 기다린다
  hostChain.set(
    host,
    prev.then(() => gate),
  )

  await prev
  try {
    const last = lastRequestAt.get(host)
    if (last !== undefined) {
      const wait = last + minInterval - Date.now()
      if (wait > 0) await sleep(wait)
    }
    lastRequestAt.set(host, Date.now())
    return await run()
  } finally {
    release()
  }
}

// ── 캐시 ───────────────────────────────────────────────────────────────

interface CacheEntry {
  at: number
  response: HttpResponse
}

const cache = new Map<string, CacheEntry>()
/** 메모리 상한. 5일짜리 프로세스에서 무한히 쌓이면 안 된다 */
const MAX_CACHE_ENTRIES = 200

function cacheKey(url: string, opts: HttpGetOptions): string {
  return `${opts.method ?? 'GET'} ${url} ${opts.accept ?? ''} ${opts.body ?? ''}`
}

export function clearHttpCache(): void {
  cache.clear()
}

// ── 본체 ───────────────────────────────────────────────────────────────

/**
 * GET 한 번. 예외를 던지지 않고 결과로 돌려준다 — 수집 실패는 상태이지 사고가 아니다 (원칙 ④).
 */
export async function httpGet(url: string, opts: HttpGetOptions = {}): Promise<HttpOutcome> {
  const cfg = getConfig()

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, message: `주소를 읽을 수 없습니다: ${url}` }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, message: `http · https 주소만 받습니다: ${url}` }
  }

  const key = cacheKey(url, opts)
  if (!opts.noCache) {
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < cfg.crawlerCacheTtlS * 1000) {
      return { ok: true, response: { ...hit.response, cached: true } }
    }
  }

  const headers: Record<string, string> = {
    'User-Agent': cfg.crawlerUserAgent,
    'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
    Accept: opts.accept ?? 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
    ...opts.headers,
  }

  try {
    const response = await throttleHost(parsed.host, async () => {
      const init: RequestInit = {
        method: opts.method ?? 'GET',
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
      }
      if (opts.body !== undefined) init.body = opts.body
      const res = await fetch(url, init)
      const body = await res.text()
      return {
        ok: res.ok,
        status: res.status,
        url: res.url === '' ? url : res.url,
        contentType: res.headers.get('content-type') ?? '',
        body,
        cached: false,
      } satisfies HttpResponse
    })

    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next()
      if (!oldest.done) cache.delete(oldest.value)
    }
    cache.set(key, { at: Date.now(), response })

    return { ok: true, response }
  } catch (e) {
    // HTTP 코드·스택은 사용자 화면에 안 간다 (보장선 B4). 여기 문장은 로그·CLI 용이다.
    const reason = e instanceof Error && e.name === 'TimeoutError' ? '응답이 너무 늦습니다' : '연결하지 못했습니다'
    return { ok: false, message: `${parsed.host} 에 ${reason}` }
  }
}

/** content-type 이 JSON 계열인가 (기획서 9-1①-3 의 후보 조건 첫 번째) */
export function isJsonContentType(contentType: string): boolean {
  const t = contentType.toLowerCase()
  return t.includes('application/json') || t.includes('+json') || t.includes('text/json')
}
