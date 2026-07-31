// 붙여넣은 값으로 깨진 칸 고치기 (보장선 B1) — 워커의 수리 문을 부른다.
//
// 자가 치유가 두 번 다 실패하면 소스는 "확인이 필요합니다" 에서 멈춘다. 그때 사용자가
// 목록에서 값 하나를 복사해 붙여넣으면, 워커가 그 값이 있는 자리를 역추적해 그 칸만 고친다.
// **화면은 값만 보낸다** — 경로(css:…)는 화면이 만들지도, 받지도 않는다 (B1 · 워커 http 머리말).

import { callWorker, WORKER_UNAVAILABLE } from './create'
import type { Loaded } from './db'

export interface RepairOk {
  /** 승격된 새 어댑터 버전 */
  version: number
  items_found: number
  /** 붙여넣은 값이 목록에서 발견된 비율 (0~1) */
  coverage: number
  /** 고친 칸의 화면 이름 — 내부 키를 화면에 쓰지 않기 위해 (B2) */
  label: string
}

type WorkerRepairBody =
  | { ok: false; message: string; stage: string }
  | ({ ok: true } & RepairOk)

export async function repairFieldViaWorker(input: {
  sourceId: string
  key: string
  value: string
}): Promise<Loaded<RepairOk>> {
  const body = await callWorker<WorkerRepairBody>('/internal/repair', {
    source_id: input.sourceId,
    key: input.key,
    value: input.value,
  })
  if (body === null) return { ok: false, message: WORKER_UNAVAILABLE }
  if (!body.ok) return { ok: false, message: body.message }
  return {
    ok: true,
    data: {
      version: body.version,
      items_found: body.items_found,
      coverage: body.coverage,
      label: body.label,
    },
  }
}

/** 이 사이트가 이 컬렉션 것인지 — 남의 소스를 고치라고 시킬 수 없게 (화면 권한과 별개의 마지막 확인) */
export async function sourceBelongsTo(collectionId: string, sourceId: string): Promise<boolean> {
  const { safeQuery } = await import('./db')
  const found = await safeQuery(async (core) => {
    const rows = await core.queryClient<{ id: string }[]>`
      select id from sources where id = ${sourceId} and collection_id = ${collectionId} limit 1
    `
    return rows[0]?.id ?? null
  })
  return found.ok && found.data !== null
}
