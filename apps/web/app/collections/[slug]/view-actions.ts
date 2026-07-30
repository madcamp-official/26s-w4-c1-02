'use server'

// 뷰 저장·관리 서버 액션 (뷰 계약 · G3 트랙 B). 실패는 사람 문장 (B4).

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { currentUser, isAuthReady } from '@/auth'
import type { SaveViewState } from '@/components/save-view-form'
import { getCollectionBySlug, type CollectionRecord } from '@/lib/collections'
import { createView, deleteView, setViewNotify, setViewPinned } from '@/lib/views'

/** 뷰는 표의 구성물이므로 주인만 만진다 (상세 열람은 누구나 — 미들웨어) */
async function owned(
  slug: string,
): Promise<{ ok: true; collection: CollectionRecord } | { ok: false; message: string }> {
  const found = await getCollectionBySlug(slug)
  if (!found.ok) return { ok: false, message: found.message }
  if (found.data === null) return { ok: false, message: '이 컬렉션을 찾지 못했어요.' }
  if (isAuthReady) {
    const user = await currentUser()
    if (user === null || user.id !== found.data.owner_id) {
      return { ok: false, message: '이 표의 주인만 바꿀 수 있어요.' }
    }
  }
  return { ok: true, collection: found.data }
}

export async function createViewAction(
  slug: string,
  _prev: SaveViewState,
  formData: FormData,
): Promise<SaveViewState> {
  const name = String(formData.get('name') ?? '').trim()
  if (name === '') return { status: 'problem', message: '조건의 이름을 지어 주세요.' }
  if (name.length > 60) return { status: 'problem', message: '이름이 너무 길어요. 60자 안으로 지어 주세요.' }

  let where: unknown
  try {
    where = JSON.parse(String(formData.get('conditions') ?? '[]'))
  } catch {
    return { status: 'problem', message: '조건을 읽지 못했어요. 화면을 새로 고쳐 주세요.' }
  }

  const guard = await owned(slug)
  if (!guard.ok) return { status: 'problem', message: guard.message }

  const user = await currentUser()
  const ownerId = user?.id ?? guard.collection.owner_id

  const result = await createView(guard.collection, ownerId, { name, where })
  if (!result.ok) return { status: 'problem', message: result.message }
  if ('problem' in result.data) return { status: 'problem', message: result.data.problem }

  revalidatePath(`/collections/${slug}`, 'layout')
  // 저장한 조건이 바로 적용된 표로 돌아간다 — 결과를 보면서 정의한다 (델타 2-10)
  redirect(`/collections/${slug}/table?view=${result.data.slug}`)
}

export async function deleteViewAction(slug: string, formData: FormData): Promise<void> {
  const viewId = String(formData.get('view_id') ?? '').trim()
  if (viewId === '') return
  const guard = await owned(slug)
  if (!guard.ok) return
  await deleteView(guard.collection.id, viewId)
  revalidatePath(`/collections/${slug}`, 'layout')
}

export async function toggleViewPinAction(slug: string, formData: FormData): Promise<void> {
  const viewId = String(formData.get('view_id') ?? '').trim()
  const pinned = String(formData.get('pinned') ?? '') === 'true'
  if (viewId === '') return
  const guard = await owned(slug)
  if (!guard.ok) return
  await setViewPinned(guard.collection.id, viewId, pinned)
  revalidatePath(`/collections/${slug}`, 'layout')
}

export async function setViewNotifyAction(slug: string, formData: FormData): Promise<void> {
  const viewId = String(formData.get('view_id') ?? '').trim()
  if (viewId === '') return
  const on = String(formData.get('notify') ?? '') === 'on'
  const guard = await owned(slug)
  if (!guard.ok) return
  await setViewNotify(guard.collection.id, viewId, on)
  revalidatePath(`/collections/${slug}`, 'layout')
}
