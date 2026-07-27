// 사이트 붙이기 — 워커의 attach 문을 부른다 (기능 ② · G2 의 화면 실체).
//
// 미리보기(/internal/attach)는 저장하지 않고 "어느 칸이 붙었고 어느 칸을 물어봐야 하는지"를
// 돌려주고, 저장(/internal/sources)은 **주소와 붙여넣은 값만** 다시 보내 워커가 처음부터 다시
// 돈다 — 스펙(경로)은 절대 주고받지 않는다 (worker http/index.ts 머리말 · 보장선 B1).

import { WORKER_UNAVAILABLE, callWorker, type WorkerFailure } from './create'
import type { Loaded } from './db'

/** 붙은 칸 하나 — 화면은 실제로 뽑힌 값 표본을 같이 보여준다 (보장선 B3) */
export interface AttachedField {
  key: string
  label: string
  origin: 'matched' | 'pasted'
  confidence: number
  samples: string[]
}

export interface MissingField {
  key: string
  label: string
}

/** 붙여넣은 값 하나의 처리 결과 */
export type AttachPasteReport =
  | { key: string; ok: true; found: string; coverage: number }
  | { key: string; ok: false; message: string }

export interface AttachPreview {
  host: string
  entryUrl: string
  attached: AttachedField[]
  missing: MissingField[]
  pasted: AttachPasteReport[]
  rows: Record<string, unknown>[]
  warnings: string[]
}

export interface AttachSaved {
  slug: string
  host: string
  items_inserted: number
  items_new: number
  missing: MissingField[]
}

type WorkerAttachBody =
  | (WorkerFailure & { missing?: MissingField[] })
  | {
      ok: true
      host: string
      entry_url: string
      attached: AttachedField[]
      missing: MissingField[]
      pasted: AttachPasteReport[]
      rows: Record<string, unknown>[]
      warnings: string[]
    }

type WorkerSaveBody = (WorkerFailure & { missing?: MissingField[] }) | ({ ok: true } & AttachSaved)

/** 미리보기 — 기존 표(slug)에 새 주소를 맞춰본다. pasted 는 {필드키: 붙여넣은 값} */
export async function attachPreviewViaWorker(input: {
  slug: string
  url: string
  pasted: Record<string, string>
}): Promise<Loaded<AttachPreview>> {
  const body = await callWorker<WorkerAttachBody>('/internal/attach', {
    url: input.url,
    slug: input.slug,
    pasted: input.pasted,
  })
  if (body === null) return { ok: false, message: WORKER_UNAVAILABLE }
  if (!body.ok) return { ok: false, message: body.message }
  return {
    ok: true,
    data: {
      host: body.host,
      entryUrl: body.entry_url,
      attached: body.attached,
      missing: body.missing,
      pasted: body.pasted,
      rows: body.rows,
      warnings: body.warnings,
    },
  }
}

/** 저장 — 워커가 소스·수집 결과까지 앉힌다 */
export async function attachSaveViaWorker(input: {
  slug: string
  url: string
  pasted: Record<string, string>
}): Promise<Loaded<AttachSaved>> {
  const body = await callWorker<WorkerSaveBody>('/internal/sources', {
    url: input.url,
    slug: input.slug,
    pasted: input.pasted,
  })
  if (body === null) return { ok: false, message: WORKER_UNAVAILABLE }
  if (!body.ok) return { ok: false, message: body.message }
  return {
    ok: true,
    data: {
      slug: body.slug,
      host: body.host,
      items_inserted: body.items_inserted,
      items_new: body.items_new,
      missing: body.missing,
    },
  }
}
