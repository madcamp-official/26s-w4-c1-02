// 컬렉션 생성 — 워커의 HTTP 진입점을 부른다 (기획서 9-1 · ADR A30 · G2 배선).
//
// 미리보기(/internal/preview)는 저장하지 않고 "이미 채워진 표"만 돌려주고,
// 저장(/internal/collections)은 **주소만 다시 보내** 워커가 처음부터 다시 돈다 —
// 화면이 만든 스펙을 서버가 실행하는 일이 없게 하려는 워커 쪽 설계다 (http/index.ts 머리말).
// 사용자가 미리보기에서 지운 열은 저장 뒤 schema_json 을 다듬는 것으로 반영한다.

import {
  CollectionSchemaJsonSchema,
  type CollectionSchemaJson,
  type FieldDef,
} from '@endpointer/core'

import { safeQuery, type Loaded } from './db'

/** 미리보기 한 벌 — 화면이 그리는 "이미 채워진 표" (보장선 B3) */
export interface CreatePreview {
  host: string
  entryUrl: string
  suggestedName: string
  fields: FieldDef[]
  /** 필드 키 → 정규화된 값 (워커가 실제로 수집·정규화한 것) */
  rows: Record<string, unknown>[]
}

/** 워커 진입점 주소·토큰. 없으면 배선이 안 된 것 — 사람 문장으로 알린다 (B4) */
function workerTarget(): { url: string; token: string } | null {
  const url = process.env['WORKER_INTERNAL_URL']?.trim() ?? ''
  const token = process.env['WORKER_INTERNAL_TOKEN']?.trim() ?? ''
  if (url === '' || token === '') return null
  return { url, token }
}

export const WORKER_UNAVAILABLE =
  '지금은 사이트를 살펴보지 못하고 있어요. 잠시 뒤에 다시 시도해 주세요.'

export interface WorkerFailure {
  ok: false
  message: string
  stage: string
}

type WorkerPreviewBody =
  | WorkerFailure
  | {
      ok: true
      host: string
      entry_url: string
      suggested_name: string
      fields: unknown
      rows: Record<string, unknown>[]
      trace: unknown
    }

type WorkerCreateBody =
  | WorkerFailure
  | { ok: true; slug: string; name: string; items_inserted: number }

/** 워커에 POST 하나. 네트워크 실패도 값으로 돌려준다 — 화면까지 예외를 올리지 않는다 */
export async function callWorker<T>(path: string, body: Record<string, unknown>): Promise<T | null> {
  const target = workerTarget()
  if (target === null) return null
  try {
    const res = await fetch(`${target.url}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${target.token}`,
      },
      body: JSON.stringify(body),
      // probe → 컴파일 → 수집까지 도는 경로다. 브라우저 폴백이면 수십 초까지 간다
      signal: AbortSignal.timeout(90_000),
    })
    if (res.status === 401 || res.status === 404) return null
    return (await res.json()) as T
  } catch (cause) {
    console.warn(`[endpointer/web] 워커 호출 실패 (${path})`, cause)
    return null
  }
}

/** 주소 하나 → 이미 채워진 표. 실패 문구는 워커가 만든 사람 문장을 그대로 쓴다 */
export async function fetchWorkerPreview(url: string): Promise<Loaded<CreatePreview>> {
  const body = await callWorker<WorkerPreviewBody>('/internal/preview', { url })
  if (body === null) return { ok: false, message: WORKER_UNAVAILABLE }
  if (!body.ok) return { ok: false, message: body.message }

  const fields = CollectionSchemaJsonSchema.safeParse(body.fields)
  if (!fields.success || fields.data.length === 0) {
    console.warn('[endpointer/web] 워커 미리보기의 표 구성을 읽지 못했습니다', fields.error)
    return { ok: false, message: WORKER_UNAVAILABLE }
  }

  return {
    ok: true,
    data: {
      host: body.host,
      entryUrl: body.entry_url,
      suggestedName: body.suggested_name,
      fields: fields.data,
      rows: body.rows,
    },
  }
}

/**
 * 저장. 워커가 컬렉션·사이트·수집 결과까지 전부 앉힌다.
 * keptKeys 가 미리보기보다 줄었으면 저장 직후 schema_json 을 그 부분집합으로 다듬는다 —
 * 아직 아무도 소비하지 않은 표라 schema_version 은 올리지 않는다 (버전 증가는 "쓰던 표"의 변경 신호다).
 */
export async function createViaWorker(input: {
  url: string
  ownerId: string
  name: string
  keptKeys: string[]
}): Promise<Loaded<{ slug: string }>> {
  const body = await callWorker<WorkerCreateBody>('/internal/collections', {
    url: input.url,
    owner_id: input.ownerId,
    name: input.name,
  })
  if (body === null) return { ok: false, message: WORKER_UNAVAILABLE }
  if (!body.ok) return { ok: false, message: body.message }

  const trimmed = await trimSchemaTo(body.slug, input.keptKeys)
  if (!trimmed.ok) {
    // 표는 이미 만들어졌다. 열 다듬기만 실패한 것이므로 성공으로 돌리되 로그는 남긴다.
    console.warn('[endpointer/web] 만든 표의 열 다듬기에 실패했습니다', body.slug)
  }
  return { ok: true, data: { slug: body.slug } }
}

/** schema_json 을 keptKeys 부분집합으로 줄인다. 전부 유지면 아무것도 하지 않는다 */
async function trimSchemaTo(slug: string, keptKeys: string[]): Promise<Loaded<null>> {
  return safeQuery(async (core) => {
    const sql = core.queryClient
    const rows = await sql<{ id: string; schema_json: unknown }[]>`
      select id, schema_json from collections where slug = ${slug} limit 1
    `
    const row = rows[0]
    if (!row) return null

    const parsed = CollectionSchemaJsonSchema.safeParse(row.schema_json)
    if (!parsed.success) return null

    const kept: CollectionSchemaJson = parsed.data.filter((f) => keptKeys.includes(f.key))
    if (kept.length === 0 || kept.length === parsed.data.length) return null

    await sql`
      update collections
      set schema_json = ${JSON.stringify(kept)}::jsonb, updated_at = now()
      where id = ${row.id}
    `
    return null
  })
}

// ── 자연어 → 소스 후보 제안 (ADR A42) ──────────────────────────────────

/** 화면에 그릴 후보 하나. 제안일 뿐 — 사용자가 골라 목록에 담는다 */
export interface SourceSuggestionView {
  url: string
  title: string
  why: string | null
}

type WorkerSuggestBody =
  | WorkerFailure
  | { ok: true; candidates: SourceSuggestionView[] }

/** 자연어 요청 → 후보 URL. 실패도 값으로 (B4). 빈 목록은 "확실한 게 없어요" 다 */
export async function suggestSourcesViaWorker(input: {
  query: string
  ownerId: string
  already: string[]
}): Promise<Loaded<SourceSuggestionView[]>> {
  const body = await callWorker<WorkerSuggestBody>('/internal/suggest-sources', {
    query: input.query,
    owner_id: input.ownerId,
    already: input.already,
  })
  if (body === null) return { ok: false, message: WORKER_UNAVAILABLE }
  if (!body.ok) return { ok: false, message: body.message }
  return { ok: true, data: body.candidates }
}

/**
 * 여러 소스로 컬렉션을 만든다 (기능 ②를 생성 단계로 — 델타 2-9).
 * 첫 주소로 표를 만들고, 나머지는 같은 표에 접합한다. 결과는 하나의 표다.
 * 접합 실패는 치명적이지 않다 — 만든 표는 남고, 실패한 소스만 빠진다 (부분 성공이 1급).
 */
export async function createWithSourcesViaWorker(input: {
  primaryUrl: string
  extraUrls: string[]
  ownerId: string
  name: string
  keptKeys: string[]
}): Promise<Loaded<{ slug: string; attachedExtra: number; failedExtra: number }>> {
  const created = await createViaWorker({
    url: input.primaryUrl,
    ownerId: input.ownerId,
    name: input.name,
    keptKeys: input.keptKeys,
  })
  if (!created.ok) return created

  const slug = created.data.slug
  let attachedExtra = 0
  let failedExtra = 0
  // 순차로 붙인다 — 각 접합이 probe+매핑을 돌아 무겁고, 동시에 때리면 대상 사이트에 무례하다.
  // `/internal/sources` 를 직접 부른다 (attach.ts 를 import 하면 순환 참조가 된다).
  for (const url of input.extraUrls) {
    const body = await callWorker<WorkerFailure | { ok: true }>('/internal/sources', {
      url,
      slug,
      pasted: {},
    })
    if (body !== null && body.ok) attachedExtra += 1
    else failedExtra += 1
  }
  return { ok: true, data: { slug, attachedExtra, failedExtra } }
}

/** 로그인 설정 전 데모 경로 — 시드가 만든 첫 사용자를 주인으로 쓴다 */
export async function demoOwnerId(): Promise<Loaded<string | null>> {
  return safeQuery(async (core) => {
    const rows = await core.queryClient<{ id: string }[]>`select id from users order by "email" limit 1`
    return rows[0]?.id ?? null
  })
}
