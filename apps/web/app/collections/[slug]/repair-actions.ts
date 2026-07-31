'use server'

// 붙여넣은 값으로 깨진 칸 고치기 (보장선 B1) — 자가 치유가 실패한 사이트의 마지막 한 걸음.
//
// 화면이 서버로 보내는 것은 **어느 칸인지 + 붙여넣은 값** 둘뿐이다. 경로(css:…)는 오가지 않는다 —
// 화면이 경로를 보낼 수 있으면 그건 곧 임의 추출 지시가 되고, B1 도 그 자리에서 무너진다.

import { revalidatePath } from 'next/cache'

import { currentUser, isAuthReady } from '@/auth'
import type { ManageState } from '@/components/collection-manage'
import { getCollectionBySlug } from '@/lib/collections'
import { repairFieldViaWorker, sourceBelongsTo } from '@/lib/repair'

/** 주인 확인 — actions.ts 의 ownedCollection 과 같은 관례 ('use server' 파일은 함수만 내보낸다) */
async function ownedCollection(
  slug: string,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const found = await getCollectionBySlug(slug)
  if (!found.ok) return { ok: false, message: found.message }
  if (found.data === null) {
    return { ok: false, message: '이 컬렉션을 찾지 못했어요. 화면을 새로 고쳐 주세요.' }
  }
  if (isAuthReady) {
    const user = await currentUser()
    if (user === null || user.id !== found.data.owner_id) {
      return { ok: false, message: '이 컬렉션의 주인만 고칠 수 있어요.' }
    }
  }
  return { ok: true, id: found.data.id }
}

export async function repairSourceFieldAction(
  slug: string,
  _prev: ManageState,
  formData: FormData,
): Promise<ManageState> {
  const sourceId = String(formData.get('source_id') ?? '')
  const key = String(formData.get('key') ?? '')
  const value = String(formData.get('value') ?? '').trim()
  if (sourceId === '' || key === '') {
    return { status: 'problem', message: '어느 칸을 고칠지 알 수 없어요. 화면을 새로 고쳐 주세요.' }
  }
  if (value === '') return { status: 'problem', message: '값을 붙여넣어 주세요.' }

  const owned = await ownedCollection(slug)
  if (!owned.ok) return { status: 'problem', message: owned.message }

  // 이 컬렉션의 사이트가 맞는지 — 폼의 hidden 값을 그대로 믿지 않는다
  if (!(await sourceBelongsTo(owned.id, sourceId))) {
    return { status: 'problem', message: '이 표의 사이트가 아니에요. 화면을 새로 고쳐 주세요.' }
  }

  const result = await repairFieldViaWorker({ sourceId, key, value })
  if (!result.ok) return { status: 'problem', message: result.message }

  revalidatePath(`/collections/${slug}`, 'layout')
  const percent = Math.round(result.data.coverage * 100)
  return {
    status: 'done',
    message: `‘${result.data.label}’ 칸을 다시 맞췄어요 — 항목 ${result.data.items_found}개 중 ${percent}%에서 그 값을 찾았어요.`,
  }
}
