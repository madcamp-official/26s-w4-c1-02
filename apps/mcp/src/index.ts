// MCP Streamable HTTP 서버 — 기획서 12장
//
//   POST|GET|DELETE  /{slug}     컬렉션 하나가 곧 MCP 서버 하나
//   GET              /healthz
//
// 포트는 MCP_PORT (기본 3002). 배포에서는 Caddy 가 mcp.example.com/* 을 여기로 붙인다.
//
// ── 세션을 두지 않는다 (stateless) ───────────────────────────────────────
// `sessionIdGenerator: undefined` 로 두고 **요청마다 McpServer + transport 를 새로 만든다.**
// 근거 세 가지:
//   1. 이 서버의 도구는 전부 읽기 전용이다. 요청 사이에 이어갈 상태가 없다.
//   2. 세션을 두면 메모리에 transport 맵이 생기고, 프로세스를 재시작하거나 인스턴스를
//      늘리는 순간 클라이언트가 404 를 받는다. G4 판정이 "재부팅해도 다시 뜬다" 이므로
//      재시작이 연결을 끊지 않는 쪽이 맞다.
//   3. 도구 목록이 **컬렉션 스키마에서 생성**된다. 스키마가 바뀌면 다음 요청부터 자동으로
//      새 도구 목록이 나간다 — 세션에 서버 인스턴스를 캐싱하면 낡은 도구가 살아남는다.
// 대가는 요청마다 도구를 다시 등록하는 비용인데, 이건 순수 객체 조립이라 무시할 수준이다.
// 서버→클라이언트 알림(구독 푸시 등)이 필요해지면 그때 세션을 켠다.

import 'dotenv/config'

import { randomUUID } from 'node:crypto'

import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { NextFunction, Request, Response } from 'express'
import { pino } from 'pino'

import { closeDb, db, getEnv } from '@endpointer/core/db'
import type { ApiErrorResponse } from '@endpointer/core'

import { KEY_QUERY_PARAM, presentedKeyFrom, resolveCollectionAccess } from './auth'
import { instructionsFor, registerCollectionTools } from './tools'

const env = getEnv()

const log = pino({
  name: 'endpointer-mcp',
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
})

const SERVER_VERSION = '0.1.0'

/**
 * 컨테이너 밖에서 들어와야 하므로 모든 인터페이스에 붙는다.
 * 대신 Host 헤더 화이트리스트로 DNS 리바인딩을 막는다 (아래 allowedHosts).
 */
const BIND_HOST = '0.0.0.0'

/** 공개 주소의 호스트명 + 로컬. 포트는 미들웨어가 알아서 무시한다 */
function allowedHostnames(): string[] {
  const hosts = new Set(['localhost', '127.0.0.1', '[::1]'])
  try {
    hosts.add(new URL(env.PUBLIC_MCP_BASE_URL).hostname)
  } catch {
    log.warn('PUBLIC_MCP_BASE_URL 을 주소로 읽지 못해 로컬 주소만 허용합니다')
  }
  return [...hosts]
}

const app = createMcpExpressApp({ host: BIND_HOST, allowedHosts: allowedHostnames() })
app.disable('x-powered-by')

// ── /healthz ─────────────────────────────────────────────────────────────
// `/:slug` 보다 먼저 선언해야 컬렉션으로 오인되지 않는다.
app.get('/healthz', (_req: Request, res: Response) => {
  res.json({ ok: true, service: 'mcp', version: SERVER_VERSION })
})

// ── /{slug} ──────────────────────────────────────────────────────────────

function fail(res: Response, status: number, body: ApiErrorResponse): void {
  res.status(status).json(body)
}

app.all('/:slug', async (req: Request, res: Response) => {
  const slug = String(req.params['slug'] ?? '')

  const presentedKey = presentedKeyFrom({
    authorization: req.headers.authorization,
    queryKey: req.query[KEY_QUERY_PARAM] as string | string[] | undefined,
  })

  const grant = await resolveCollectionAccess(db, slug, presentedKey)
  if (!grant.ok) {
    // 키 자체는 절대 로그에 남기지 않는다. 제시 여부만 남긴다.
    log.info({ slug, code: grant.code, keyPresented: presentedKey !== null }, '접근 거절')
    fail(res, grant.code === 'not_found' ? 404 : 401, {
      error: { message: grant.message, code: grant.code },
    })
    return
  }

  const collection = grant.collection

  const server = new McpServer(
    { name: `endpointer/${collection.slug}`, title: collection.name, version: SERVER_VERSION },
    { instructions: instructionsFor(collection) },
  )
  registerCollectionTools(server, { db, collection })

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })

  // 요청이 끝나면 둘 다 닫는다. 이게 없으면 stateless 인데도 객체가 쌓인다.
  res.on('close', () => {
    void transport.close().catch(() => {})
    void server.close().catch(() => {})
  })

  await server.connect(transport)
  await transport.handleRequest(req, res, req.body)
})

// 컬렉션 주소가 아닌 곳으로 들어온 요청 — 사람이 실수로 브라우저로 열었을 때 포함
app.use((req: Request, res: Response) => {
  log.debug({ path: req.path }, '알 수 없는 주소')
  fail(res, 404, {
    error: { message: '그런 주소의 컬렉션을 찾지 못했습니다.', code: 'not_found' },
  })
})

// 마지막 그물. 스택 트레이스를 응답에 절대 싣지 않는다 (보장선 B4)
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  const traceId = randomUUID()
  log.error({ err, traceId }, '요청 처리 중 오류')
  if (res.headersSent) {
    next(err)
    return
  }
  fail(res, 503, {
    error: { message: '지금은 응답을 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요.', code: 'unavailable' },
  })
})

// ── 기동 ─────────────────────────────────────────────────────────────────

const listener = app.listen(env.MCP_PORT, BIND_HOST, () => {
  log.info(
    { port: env.MCP_PORT, publicBaseUrl: env.PUBLIC_MCP_BASE_URL },
    'MCP 서버가 떴습니다 (컬렉션 주소: {공개주소}/{slug})',
  )
})

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, '종료합니다')
  listener.close()
  await closeDb().catch(() => {})
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

export { app }
