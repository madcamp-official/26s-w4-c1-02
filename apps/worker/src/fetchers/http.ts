// HTTP 한 겹 — 기획서 6장 "기술적 예의" 를 코드로 옮긴 곳
//
//   · 식별 가능한 User-Agent      CRAWLER_USER_AGENT
//   · 소스별 요청 간격            CRAWLER_MIN_INTERVAL_MS (호스트 단위 직렬화)
//   · 캐시 TTL                    CRAWLER_CACHE_TTL_S (같은 페이지를 반복해 때리지 않는다)
//
// 예의라기보다 수집 안정성 설계다. 차단당하면 데모가 죽는다.
//
// 나가는 주소는 전부 `guard.ts` 를 지난다. **리다이렉트를 손으로 따라가는 이유가 그것이다** —
// `redirect: 'follow'` 로 두면 302 한 번에 내부망으로 넘어가는 걸 볼 방법이 없다.

import { getConfig } from '../config'
import { decodeBody } from './charset'
import { checkOutboundUrl } from './guard'

export interface HttpResponse {
  ok: boolean
  status: number
  /** 리다이렉트를 따라간 뒤의 최종 URL */
  url: string
  contentType: string
  body: string
  /** 본문을 무엇으로 읽었는지 (`charset.ts`). utf-8 이 아니면 probe 가 알려준다 */
  charset: string
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

/** 리다이렉트를 몇 번까지 따라갈지. 브라우저 관례(20)보다 짧다 — 목록 페이지에 그만큼 필요 없다 */
const MAX_REDIRECTS = 5

/**
 * GET 한 번. 예외를 던지지 않고 결과로 돌려준다 — 수집 실패는 상태이지 사고가 아니다 (원칙 ④).
 */
export async function httpGet(url: string, opts: HttpGetOptions = {}): Promise<HttpOutcome> {
  const cfg = getConfig()

  const entry = await checkOutboundUrl(url)
  if (!entry.ok) return { ok: false, message: entry.message }

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

  const outcome = await followRedirects(entry.url, headers, opts)
  if (!outcome.ok) return outcome

  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next()
    if (!oldest.done) cache.delete(oldest.value)
  }
  cache.set(key, { at: Date.now(), response: outcome.response })

  return outcome
}

/**
 * 리다이렉트를 손으로 따라간다. **홉마다 관문을 다시 지난다.**
 *
 * 처음 주소만 검사하고 `redirect: 'follow'` 로 두면 아무 의미가 없다. 공인 주소를 하나 두고
 * 302 로 169.254.169.254 를 가리키는 건 SSRF 의 기본형이다.
 */
async function followRedirects(start: URL, headers: Record<string, string>, opts: HttpGetOptions): Promise<HttpOutcome> {
  // 시한은 홉마다가 아니라 **전체 한 번**이다. 홉마다 20초면 리다이렉트 다섯 번에 2분이 된다.
  const deadline = AbortSignal.timeout(opts.timeoutMs ?? 20_000)

  let current = start
  let method = opts.method ?? 'GET'
  let body = opts.body

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const at = current
    let res: Response
    try {
      res = await throttleHost(at.host, () => {
        const init: RequestInit = { method, headers, redirect: 'manual', signal: deadline }
        if (body !== undefined) init.body = body
        return fetch(at, init)
      })
    } catch (e) {
      // HTTP 코드·스택은 사용자 화면에 안 간다 (보장선 B4). 여기 문장은 로그·CLI 용이다.
      const reason = e instanceof Error && e.name === 'TimeoutError' ? '응답이 너무 늦습니다' : '연결하지 못했습니다'
      return { ok: false, message: `${at.host} 에 ${reason}` }
    }

    const location = res.headers.get('location')
    if (!isRedirect(res.status) || location === null) {
      const contentType = res.headers.get('content-type') ?? ''
      // `res.text()` 를 쓰지 않는다 — 그러면 헤더에 charset 을 안 적은 EUC-KR 페이지가
      // 통째로 깨진 채 통과한다. 바이트로 받아 직접 정한다 (`charset.ts`).
      const buf = await res.arrayBuffer().catch(() => null)
      const decoded = buf === null ? { text: '', charset: 'utf-8' } : decodeBody(new Uint8Array(buf), contentType)
      return {
        ok: true,
        response: {
          ok: res.ok,
          status: res.status,
          url: at.toString(),
          contentType,
          body: decoded.text,
          charset: decoded.charset,
          cached: false,
        },
      }
    }

    // 본문을 안 읽고 버리면 연결이 남는다
    await discard(res)

    let next: URL
    try {
      next = new URL(location, at)
    } catch {
      return { ok: false, message: `${at.host} 가 알 수 없는 곳으로 넘겼습니다` }
    }

    const checked = await checkOutboundUrl(next)
    if (!checked.ok) return checked

    // 브라우저와 같은 규칙: 303 과, POST 를 받은 301·302 는 GET 으로 바뀌고 본문을 버린다.
    // 307·308 만 방법과 본문을 그대로 들고 간다.
    if (res.status === 303 || (method === 'POST' && (res.status === 301 || res.status === 302))) {
      method = 'GET'
      body = undefined
    }
    current = checked.url
  }

  return { ok: false, message: `${start.host} 가 다른 주소로 계속 넘깁니다` }
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

async function discard(res: Response): Promise<void> {
  try {
    await res.body?.cancel()
  } catch {
    // 이미 닫힌 본문
  }
}

/** content-type 이 JSON 계열인가 (기획서 9-1①-3 의 후보 조건 첫 번째) */
export function isJsonContentType(contentType: string): boolean {
  const t = contentType.toLowerCase()
  return t.includes('application/json') || t.includes('+json') || t.includes('text/json')
}
