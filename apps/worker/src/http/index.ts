// 워커의 HTTP 진입점 — 화면이 파이프라인을 부르는 문 (ADR A30)
//
//   GET  /healthz
//   POST /internal/preview       주소 하나 → 이미 채워진 표 (저장하지 않는다)
//   POST /internal/collections   같은 것 + DB 에 앉히기
//   POST /internal/attach        두 번째 주소 → 기존 표에 맞춰본 결과 (저장하지 않는다)
//   POST /internal/sources       같은 것 + 소스로 앉히기
//   POST /internal/clone         공개 컬렉션 하나 → 내 것으로 복제 (모두의 컬렉션 · 델타 §8)
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
// 붙여넣기(보장선 B1)도 같은 규율이다 — 화면은 **값**만 보내고, 경로는 워커가 역추적한다.
// 경로(`css:…`)도 스펙 조각이라 받아서 실행하면 위 원칙이 그 자리에서 무너진다.
//
// 새 의존성을 만들지 않으려고 `node:http` 를 그대로 쓴다. 경로가 셋뿐이라 라우터가 필요 없다.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'

import { getConfig } from '../config'
import { childLogger } from '../logger'
import {
  attachSourceToCollection,
  cloneCollection,
  collectionNameFrom,
  createCollectionFromUrl,
  repairFieldByPastedValue,
  resolveByPastedValue,
  slugFrom,
} from '../pipeline'
import { suggestSources, type SourceSuggestion } from '../compile/suggest-sources'

const log = childLogger({ mod: 'http' })

/**
 * 방금 앉힌 사이트를 그 자리에서 정기 수집에 태운다.
 *
 * 이게 없으면 스케줄 등록이 워커 **부팅 동기화 한 곳뿐**이라, 화면에서 만든 컬렉션은
 * 워커가 재시작할 때까지 자동 수집이 없다 — 개발에선 tsx watch 의 잦은 재시작이 가려주지만
 * 프로덕션(pnpm start)에선 영원히 안 걸린다. "한 번 만들어 두면 계속 갱신"이라는 약속의 배선이다.
 *
 * `upsertJobScheduler` 라 멱등 — 부팅 동기화(syncSourceSchedules)와 겹쳐도 안전하다.
 * 실패해도 응답을 막지 않는다: 표는 이미 앉았고, 다음 부팅 동기화가 스케줄을 줍는다.
 */
async function scheduleSavedSource(source: {
  id: string
  collection_id: string
  host: string
  schedule: string
}): Promise<void> {
  try {
    const { scheduleSource } = await import('../queues')
    await scheduleSource({
      source_id: source.id,
      collection_id: source.collection_id,
      host: source.host,
      schedule: source.schedule,
    })
  } catch (cause) {
    log.warn({ host: source.host, cause }, '방금 앉힌 사이트의 수집 스케줄 등록 실패 — 부팅 동기화가 줍는다')
  }
}

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

/** `POST /internal/suggest-sources` 의 성공 응답 (ADR A42). 후보는 제안일 뿐 붙지 않는다 */
export interface SuggestResponse {
  ok: true
  candidates: SourceSuggestion[]
}

/** 실패는 HTTP 코드가 아니라 문구로 온다 (보장선 B4). 상태 코드는 200 이다 */
export interface FailureResponse {
  ok: false
  /** 화면에 그대로 나갈 수 있는 문장 */
  message: string
  stage: string
  /** attach 가 매핑까지는 갔다가 막힌 경우, 물어볼 칸 목록은 줄 수 있다 */
  missing?: { key: string; label: string }[]
}

/** 붙여넣은 값 하나의 처리 결과 — 화면이 "✓ 찾았어요 / ✗ 못 찾았어요" 를 그린다 */
export type PasteReport =
  | { key: string; ok: true; found: string; coverage: number }
  | { key: string; ok: false; message: string }

/** `POST /internal/attach` 의 성공 응답. 화면의 "사이트 붙이기" 흐름이 이걸 받는다 */
export interface AttachPreviewResponse {
  ok: true
  host: string
  entry_url: string
  /** 붙은 칸들 — 화면은 칸마다 실제로 뽑힌 값 표본을 같이 보여준다 (보장선 B3) */
  attached: { key: string; label: string; origin: 'matched' | 'pasted'; confidence: number; samples: string[] }[]
  /** 못 찾은 칸 — 화면은 **이 칸만** "값을 붙여넣어 주세요" 로 물어본다 (보장선 B1) */
  missing: { key: string; label: string }[]
  /** 이번 요청에서 붙여넣은 값들의 처리 결과 */
  pasted: PasteReport[]
  /** 새 사이트에서 뽑혀 정규화된 값들 — 미리보기 표 */
  rows: Record<string, unknown>[]
  warnings: string[]
}

/** `POST /internal/sources` 의 성공 응답 */
export interface AttachSaveResponse {
  ok: true
  slug: string
  host: string
  items_inserted: number
  items_new: number
  /** 저장은 됐지만 여전히 빈 칸 — "나중에 값을 알려주시면 채울 수 있어요" 의 재료 */
  missing: { key: string; label: string }[]
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

  // 자연어 추천은 주소가 아니라 요청 문장을 받는다 (ADR A42) — url 검사 앞에 둔다
  if (path === '/internal/suggest-sources') {
    await suggest(res, body)
    return
  }

  // 복제는 주소가 아니라 원본 slug 를 받는다 (모두의 컬렉션 · 델타 §8) — url 검사 앞에 둔다
  if (path === '/internal/clone') {
    await clone(res, body)
    return
  }

  // 수리도 주소가 아니라 소스 id 를 받는다 (붙여넣기로 칸 고치기 · B1) — url 검사 앞에 둔다
  if (path === '/internal/repair') {
    await repair(res, body)
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
  if (path === '/internal/attach') {
    await attachPreview(res, url, body)
    return
  }
  if (path === '/internal/sources') {
    await attachSave(res, url, body)
    return
  }

  send(res, 404, { ok: false, message: '그런 주소가 없어요.', stage: 'route' })
}

// ── 두 경로 ────────────────────────────────────────────────────────────

async function suggest(res: ServerResponse, body: Record<string, unknown>): Promise<void> {
  const query = typeof body['query'] === 'string' ? body['query'] : ''
  const ownerId = typeof body['owner_id'] === 'string' ? body['owner_id'] : ''
  if (ownerId === '') {
    send(res, 200, { ok: false, message: '누구의 요청인지 알 수 없어요.', stage: 'owner' })
    return
  }
  const already = Array.isArray(body['already'])
    ? body['already'].filter((u): u is string => typeof u === 'string')
    : []

  const outcome = await suggestSources({ query, ownerId, already })
  if (!outcome.ok) {
    send(res, 200, { ok: false, message: outcome.message, stage: 'suggest' })
    return
  }
  send(res, 200, { ok: true, candidates: outcome.candidates } satisfies SuggestResponse)
}

/** `POST /internal/clone` 의 성공 응답 (모두의 컬렉션 · 델타 §8). `apps/web` 의 복제 흐름이 받는다 */
export interface CloneResponse {
  ok: true
  /** 복제본 slug — 화면은 여기로 이동한다 */
  slug: string
  name: string
  sources_copied: number
  items_copied: number
  views_copied: number
}

/** `POST /internal/repair` 의 성공 응답 (붙여넣기로 칸 고치기 · B1) */
export interface RepairResponse {
  ok: true
  /** 승격된 새 어댑터 버전 */
  version: number
  items_found: number
  /** 붙여넣은 값이 목록에서 발견된 비율 — 화면 문구의 재료 */
  coverage: number
  /** 고친 칸의 화면 이름 ("등록일") — 화면이 내부 키를 안 쓰게 (B2) */
  label: string
}

async function repair(res: ServerResponse, body: Record<string, unknown>): Promise<void> {
  const sourceId = typeof body['source_id'] === 'string' ? body['source_id'] : ''
  const key = typeof body['key'] === 'string' ? body['key'] : ''
  const value = typeof body['value'] === 'string' ? body['value'] : ''
  if (sourceId === '' || key === '') {
    send(res, 200, { ok: false, message: '어느 칸을 고칠지 알 수 없어요.', stage: 'input' })
    return
  }
  if (value.trim() === '') {
    send(res, 200, { ok: false, message: '값을 붙여넣어 주세요.', stage: 'input' })
    return
  }

  const outcome = await repairFieldByPastedValue({ source_id: sourceId, key, value })
  if (!outcome.ok) {
    send(res, 200, { ok: false, message: outcome.message, stage: outcome.stage })
    return
  }
  send(res, 200, {
    ok: true,
    version: outcome.version,
    items_found: outcome.items_found,
    coverage: outcome.coverage,
    label: outcome.label,
  } satisfies RepairResponse)
}

async function clone(res: ServerResponse, body: Record<string, unknown>): Promise<void> {
  const sourceSlug = typeof body['source_slug'] === 'string' ? body['source_slug'] : ''
  const ownerId = typeof body['owner_id'] === 'string' ? body['owner_id'] : ''
  if (sourceSlug === '') {
    send(res, 200, { ok: false, message: '어느 컬렉션을 복제할지 알 수 없어요.', stage: 'source' })
    return
  }
  if (ownerId === '') {
    send(res, 200, { ok: false, message: '누구의 복제인지 알 수 없어요.', stage: 'owner' })
    return
  }

  const newName = typeof body['name'] === 'string' ? body['name'] : undefined
  const outcome = await cloneCollection({
    source_slug: sourceSlug,
    new_owner_id: ownerId,
    ...(newName !== undefined ? { new_name: newName } : {}),
  })
  if (!outcome.ok) {
    send(res, 200, { ok: false, message: outcome.message, stage: outcome.stage })
    return
  }
  send(res, 200, {
    ok: true,
    slug: outcome.slug,
    name: outcome.name,
    sources_copied: outcome.sources_copied,
    items_copied: outcome.items_copied,
    views_copied: outcome.views_copied,
  } satisfies CloneResponse)
}

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

  // 재시작 없이도 내일 아침 수집이 돌게 — 만든 즉시 스케줄에 태운다
  await scheduleSavedSource(saved.source)

  log.info({ slug: saved.collection.slug, items: saved.items_inserted }, '화면이 부른 요청으로 컬렉션을 만들었다')
  send(res, 200, {
    ok: true,
    slug: saved.collection.slug,
    name: saved.collection.name,
    items_inserted: saved.items_inserted,
  })
}

// ── 사이트 붙이기 (기능 ② · 9-2) ───────────────────────────────────────

/** 붙여넣기 항목 상한. 스키마 칸 수보다 조금 넉넉하게 — 그 이상은 화면이 아니라 공격이다 */
const MAX_PASTED = 12

interface PreparedAttach {
  loaded: import('../db').CollectionForAttach
  resolved: Record<string, string>
  pasted: PasteReport[]
}

/**
 * 두 경로가 공유하는 앞부분: 표 찾기 → 같은 사이트 중복 확인 → 붙여넣은 값 역추적.
 * 실패하면 응답까지 보내고 null 을 돌려준다.
 */
async function prepareAttach(
  res: ServerResponse,
  url: string,
  body: Record<string, unknown>,
): Promise<PreparedAttach | null> {
  const slug = typeof body['slug'] === 'string' ? body['slug'] : ''
  if (slug === '') {
    send(res, 200, { ok: false, message: '어느 표에 붙일지 알 수 없어요.', stage: 'collection' })
    return null
  }

  const { loadCollectionForAttach, hasSourceWithHost } = await import('../db')
  const loaded = await loadCollectionForAttach(slug)
  if (loaded === null) {
    send(res, 200, { ok: false, message: '그런 표가 없어요.', stage: 'collection' })
    return null
  }

  // 같은 사이트를 두 번 붙이는 실수 — 파이프라인(LLM 포함)을 돌리기 전에 싸게 잡는다.
  // 여기서는 입력 주소의 호스트만 본다. 리다이렉트 끝의 진짜 호스트는 저장 직전에 한 번 더 본다.
  const inputHost = hostOf(url)
  if (inputHost !== null && (await hasSourceWithHost(loaded.collection.id, inputHost))) {
    send(res, 200, { ok: false, message: '이 사이트는 이미 이 표에 붙어 있어요.', stage: 'duplicate' })
    return null
  }

  const { resolved, pasted } = await resolvePasted(url, body)
  return { loaded, resolved, pasted }
}

async function attachPreview(res: ServerResponse, url: string, body: Record<string, unknown>): Promise<void> {
  const prepared = await prepareAttach(res, url, body)
  if (prepared === null) return

  const outcome = await attachSourceToCollection({
    collection_id: prepared.loaded.collection.id,
    schema: prepared.loaded.schema,
    existingSample: prepared.loaded.sample,
    url,
    resolved: prepared.resolved,
    ...attachOptions(body),
  })
  if (!outcome.ok) {
    log.info({ url, stage: outcome.stage }, '사이트를 못 붙였다')
    send(res, 200, { ok: false, message: outcome.message, stage: outcome.stage, missing: outcome.missing })
    return
  }

  send(res, 200, {
    ok: true,
    host: outcome.host,
    entry_url: outcome.final_url,
    attached: outcome.attached.map(({ key, label, origin, confidence, samples }) => ({
      key,
      label,
      origin,
      confidence,
      samples,
    })),
    missing: outcome.missing,
    pasted: prepared.pasted,
    // 스펙은 내려보내지 않는다 (머리말 참조). 저장할 때 주소와 값만 다시 받는다.
    rows: outcome.items.map((item) => item.data),
    warnings: outcome.warnings,
  } satisfies AttachPreviewResponse)
}

async function attachSave(res: ServerResponse, url: string, body: Record<string, unknown>): Promise<void> {
  const prepared = await prepareAttach(res, url, body)
  if (prepared === null) return

  // **주소와 값만 받아 다시 돈다.** 미리보기의 스펙을 돌려받지 않는다 (머리말 참조).
  const outcome = await attachSourceToCollection({
    collection_id: prepared.loaded.collection.id,
    schema: prepared.loaded.schema,
    existingSample: prepared.loaded.sample,
    url,
    resolved: prepared.resolved,
    ...attachOptions(body),
  })
  if (!outcome.ok) {
    send(res, 200, { ok: false, message: outcome.message, stage: outcome.stage, missing: outcome.missing })
    return
  }

  // 리다이렉트 끝의 진짜 호스트로 중복을 한 번 더 본다 — 입력 주소만 보면 별칭 도메인이 샌다
  const { hasSourceWithHost } = await import('../db')
  if (await hasSourceWithHost(prepared.loaded.collection.id, outcome.host)) {
    send(res, 200, { ok: false, message: '이 사이트는 이미 이 표에 붙어 있어요.', stage: 'duplicate' })
    return
  }

  // DB 를 아는 코드는 여기서만 부른다 — `attachSourceToCollection` 은 끝까지 DB 를 모른다
  const { persistAttachedSource } = await import('../pipeline/persist')
  const saved = await persistAttachedSource({
    collection_id: prepared.loaded.collection.id,
    host: outcome.host,
    entry_url: outcome.final_url,
    fetch_mode: outcome.spec.fetch.mode,
    spec: outcome.spec,
    items: outcome.items,
    report: outcome.report,
  })

  // 붙인 사이트도 그 자리에서 스케줄에 태운다 (만들기와 같은 이유)
  await scheduleSavedSource(saved.source)

  log.info(
    { slug: prepared.loaded.collection.slug, host: saved.source.host, items: saved.items_inserted },
    '화면이 부른 요청으로 사이트를 붙였다',
  )
  send(res, 200, {
    ok: true,
    slug: prepared.loaded.collection.slug,
    host: saved.source.host,
    items_inserted: saved.items_inserted,
    items_new: saved.items_new,
    missing: outcome.missing,
  } satisfies AttachSaveResponse)
}

/**
 * 붙여넣은 값들을 경로로 역추적한다 (보장선 B1 — LLM 없음).
 * probe 는 캐시에서 나오므로 값이 여러 개여도 페이지를 다시 열지 않는다.
 */
async function resolvePasted(
  url: string,
  body: Record<string, unknown>,
): Promise<{ resolved: Record<string, string>; pasted: PasteReport[] }> {
  const resolved: Record<string, string> = {}
  const pasted: PasteReport[] = []

  const raw = body['pasted']
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { resolved, pasted }

  for (const [key, value] of Object.entries(raw as Record<string, unknown>).slice(0, MAX_PASTED)) {
    if (typeof value !== 'string' || value.trim() === '') continue
    const r = await resolveByPastedValue({ url, key, value, ...attachOptions(body) })
    if (r.ok) {
      resolved[key] = r.path
      pasted.push({ key, ok: true, found: r.found, coverage: r.coverage })
    } else {
      pasted.push({ key, ok: false, message: r.message })
    }
  }
  return { resolved, pasted }
}

/** attach 는 페이지 수 옵션이 없다 — 두 번째 사이트는 1페이지부터 (attach-source.ts 머리말) */
function attachOptions(body: Record<string, unknown>): { skipBrowser?: boolean; skipDom?: boolean } {
  const out: { skipBrowser?: boolean; skipDom?: boolean } = {}
  if (body['skip_browser'] === true) out.skipBrowser = true
  if (body['skip_dom'] === true) out.skipDom = true
  return out
}

function hostOf(url: string): string | null {
  const withProto = /^https?:\/\//i.test(url) ? url : `https://${url}`
  try {
    return new URL(withProto).hostname
  } catch {
    return null
  }
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
