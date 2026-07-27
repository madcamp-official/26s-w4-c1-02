// 워커의 HTTP 진입점 — 화면이 파이프라인을 부르는 문 (ADR A30)
//
//   GET  /healthz
//   POST /internal/preview       주소 하나 → 이미 채워진 표 (저장하지 않는다)
//   POST /internal/collections   같은 것 + DB 에 앉히기
//
// ── 왜 큐가 아니라 HTTP 인가 ────────────────────────────────────────────
// 미리보기는 본질적으로 요청-응답이다. 사용자는 표를 **보고 나서** 저장한다 (보장선 B3).
// 큐로 하면 화면이 폴링과 대기 상태를 다뤄야 한다. 정기 수집은 지금처럼 큐로 남는다 —
// 그건 요청-응답이 아니다.
//
// ── 절대 하지 않는 것: 클라이언트가 준 스펙을 받아 실행하기 ──────────────
// 미리보기에서 만든 스펙을 화면에 내려보냈다가 저장할 때 돌려받는 설계가 편해 보이지만,
// 그러면 **사용자가 스펙을 지어내 보낼 수 있다.** 스펙은 "어느 주소를 어떻게 긁을지" 이므로
// 그건 곧 임의 요청 실행이다. 그래서 저장할 때 **주소만 받아 다시 돈다.**
// 두 번 도는 비용은 HTTP 캐시와 LLM 디스크 캐시가 거의 0 으로 만든다.
//
// 새 의존성을 만들지 않으려고 `node:http` 를 그대로 쓴다. 경로가 셋뿐이라 라우터가 필요 없다.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'

import { getConfig } from '../config'
import { childLogger } from '../logger'
import { collectionNameFrom, createCollectionFromUrl, slugFrom } from '../pipeline'

const log = childLogger({ mod: 'http' })

/** 본문 상한. 우리가 받는 건 주소 하나와 이름 몇 개뿐이다 */
const MAX_BODY_BYTES = 16 * 1024

// ── 응답 모양 (트랙 B 와의 계약) ────────────────────────────────────────

/** `POST /internal/preview` 의 성공 응답. `apps/web` 의 CreatePreview 가 이걸 받는다 */
export interface PreviewResponse {
  ok: true
  host: string
  entry_url: string
  /** 컬렉션 이름 기본값. 사용자가 고칠 수 있다 */
  suggested_name: string
  /** 표의 열 — 그대로 `collections.schema_json` 이 된다 */
  fields: unknown
  /** 이미 정규화된 값들. 사용자가 첫 화면에서 보는 것 (보장선 B3) */
  rows: Record<string, unknown>[]
  /** 화면의 "이 사이트를 살펴봤어요" 근거. 개발자 상세로 접어 둔다 */
  trace: unknown
}

/** 실패는 HTTP 코드가 아니라 문구로 온다 (보장선 B4). 상태 코드는 200 이다 */
export interface FailureResponse {
  ok: false
  /** 화면에 그대로 나갈 수 있는 문장 */
  message: string
  stage: string
}

// ── 서버 ───────────────────────────────────────────────────────────────

export function createHttpServer(): Server {
  return createServer((req, res) => {
    void handle(req, res).catch((e: unknown) => {
      // 여기까지 온 예외는 우리 버그다. 밖으로는 아무것도 흘리지 않는다.
      log.error({ err: e, url: req.url }, '요청 처리 중 오류')
      send(res, 503, { ok: false, message: '지금은 처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.', stage: 'server' })
    })
  })
}

/**
 * 문을 연다. **토큰이 없으면 열지 않는다.**
 * 열어 두고 아무나 받으면 이 서버는 "아무 주소나 대신 열어 주는 공개 서비스" 가 된다.
 */
export function startHttpServer(): Server | null {
  const cfg = getConfig()
  if (cfg.workerInternalToken === undefined || cfg.workerInternalToken.length < 16) {
    log.warn('WORKER_INTERNAL_TOKEN 이 없거나 너무 짧습니다. 화면이 부르는 문을 열지 않습니다')
    return null
  }

  const server = createHttpServer()
  server.listen(cfg.workerHttpPort, cfg.workerHttpHost, () => {
    log.info({ port: cfg.workerHttpPort, host: cfg.workerHttpHost }, '화면이 부르는 문을 열었습니다')
  })
  return server
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = (req.url ?? '/').split('?')[0] ?? '/'

  if (req.method === 'GET' && path === '/healthz') {
    send(res, 200, { ok: true, service: 'worker' })
    return
  }

  if (req.method !== 'POST') {
    send(res, 404, { ok: false, message: '그런 주소가 없어요.', stage: 'route' })
    return
  }

  if (!authorized(req)) {
    // 왜 거절했는지 말하지 않는다. 토큰이 틀린 건지 없는 건지 알려줄 이유가 없다.
    log.warn({ path }, '토큰 없는 요청')
    send(res, 401, { ok: false, message: '허용되지 않은 요청이에요.', stage: 'auth' })
    return
  }

  const body = await readJson(req)
  if (body === null) {
    send(res, 200, { ok: false, message: '요청을 읽지 못했어요.', stage: 'body' })
    return
  }

  const url = typeof body['url'] === 'string' ? body['url'] : ''
  if (url === '') {
    send(res, 200, { ok: false, message: '주소를 넣어 주세요.', stage: 'url' })
    return
  }

  if (path === '/internal/preview') {
    await preview(res, url, body)
    return
  }
  if (path === '/internal/collections') {
    await create(res, url, body)
    return
  }

  send(res, 404, { ok: false, message: '그런 주소가 없어요.', stage: 'route' })
}

// ── 두 경로 ────────────────────────────────────────────────────────────

async function preview(res: ServerResponse, url: string, body: Record<string, unknown>): Promise<void> {
  const outcome = await createCollectionFromUrl({ url, ...options(body) })
  if (!outcome.ok) {
    log.info({ url, stage: outcome.stage }, '표를 못 만들었다')
    send(res, 200, { ok: false, message: outcome.message, stage: outcome.stage })
    return
  }

  send(res, 200, {
    ok: true,
    host: outcome.host,
    entry_url: outcome.final_url,
    suggested_name: collectionNameFrom(outcome.page_title, outcome.host),
    fields: outcome.schema,
    // 스펙은 내려보내지 않는다 (머리말 참조). 화면에 필요한 것은 값뿐이다.
    rows: outcome.items.map((item) => item.data),
    trace: outcome.trace,
  } satisfies PreviewResponse)
}

async function create(res: ServerResponse, url: string, body: Record<string, unknown>): Promise<void> {
  const ownerId = typeof body['owner_id'] === 'string' ? body['owner_id'] : ''
  if (ownerId === '') {
    send(res, 200, { ok: false, message: '누구의 표인지 알 수 없어요.', stage: 'owner' })
    return
  }

  // **주소만 받아 다시 돈다.** 화면이 준 스펙을 실행하지 않는다 (머리말 참조).
  // 캐시 덕분에 두 번째는 거의 공짜다.
  const outcome = await createCollectionFromUrl({ url, ...options(body) })
  if (!outcome.ok) {
    send(res, 200, { ok: false, message: outcome.message, stage: outcome.stage })
    return
  }

  // DB 를 아는 코드는 여기서만 부른다 — `createCollectionFromUrl` 은 끝까지 DB 를 모른다
  const { persistNewCollection } = await import('../pipeline/persist')
  const saved = await persistNewCollection({
    owner_id: ownerId,
    name: typeof body['name'] === 'string' && body['name'] !== '' ? body['name'] : collectionNameFrom(outcome.page_title, outcome.host),
    slug:
      typeof body['slug'] === 'string' && body['slug'] !== ''
        ? body['slug']
        : slugFrom(outcome.host, outcome.page_title),
    schema: outcome.schema,
    host: outcome.host,
    entry_url: outcome.final_url,
    fetch_mode: outcome.spec.fetch.mode,
    spec: outcome.spec,
    items: outcome.items,
    report: outcome.report,
  })

  log.info({ slug: saved.collection.slug, items: saved.items_inserted }, '화면이 부른 요청으로 컬렉션을 만들었다')
  send(res, 200, {
    ok: true,
    slug: saved.collection.slug,
    name: saved.collection.name,
    items_inserted: saved.items_inserted,
  })
}

/** 화면이 넘길 수 있는 것은 여기 적힌 것뿐이다. 나머지는 무시한다 */
function options(body: Record<string, unknown>): { skipBrowser?: boolean; skipDom?: boolean; maxPages?: number } {
  const out: { skipBrowser?: boolean; skipDom?: boolean; maxPages?: number } = {}
  if (body['skip_browser'] === true) out.skipBrowser = true
  if (body['skip_dom'] === true) out.skipDom = true
  const pages = body['max_pages']
  if (typeof pages === 'number' && Number.isFinite(pages)) out.maxPages = Math.min(3, Math.max(1, Math.trunc(pages)))
  return out
}

// ── 거들 ───────────────────────────────────────────────────────────────

function authorized(req: IncomingMessage): boolean {
  const expected = getConfig().workerInternalToken
  if (expected === undefined) return false

  const header = req.headers.authorization ?? ''
  const presented = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (presented === '') return false

  // 길이가 다르면 timingSafeEqual 이 던진다. 길이 자체도 비밀이 아니므로 먼저 본다.
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    size += buf.length
    // 상한을 넘으면 읽기를 멈춘다. 메모리를 남이 정하게 두지 않는다.
    if (size > MAX_BODY_BYTES) return null
    chunks.push(buf)
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(text)
}
