'use server'

// 컬렉션 관리 서버 액션 — 이름 변경·삭제. 주인만 할 수 있다.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { VisibilitySchema } from '@endpointer/core'

import { currentUser, isAuthReady } from '@/auth'
import type { ManageState } from '@/components/collection-manage'
import {
  deleteCollection,
  getCollectionBySlug,
  renameCollection,
  updateCollectionVisibility,
} from '@/lib/collections'
import { setCollectionListed } from '@/lib/gallery'

/** 주인 확인. 로그인 설정 전(데모)에는 통과시킨다 */
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
      return { ok: false, message: '이 컬렉션의 주인만 바꿀 수 있어요.' }
    }
  }
  return { ok: true, id: found.data.id }
}

export async function renameCollectionAction(
  slug: string,
  _prev: ManageState,
  formData: FormData,
): Promise<ManageState> {
  const name = String(formData.get('name') ?? '').trim()
  if (name === '') return { status: 'problem', message: '이름을 비워둘 수는 없어요.' }
  if (name.length > 100) return { status: 'problem', message: '이름이 너무 길어요. 100자 안으로 지어 주세요.' }

  const owned = await ownedCollection(slug)
  if (!owned.ok) return { status: 'problem', message: owned.message }

  const result = await renameCollection(owned.id, name)
  if (!result.ok) return { status: 'problem', message: result.message }

  revalidatePath(`/collections/${slug}`, 'layout')
  revalidatePath('/collections')
  return { status: 'done', message: '이름을 바꿨어요.' }
}

export async function updateVisibilityAction(
  slug: string,
  _prev: ManageState,
  formData: FormData,
): Promise<ManageState> {
  const parsed = VisibilitySchema.safeParse(formData.get('visibility'))
  if (!parsed.success) return { status: 'problem', message: '고를 수 없는 값이에요.' }

  const owned = await ownedCollection(slug)
  if (!owned.ok) return { status: 'problem', message: owned.message }

  const result = await updateCollectionVisibility(owned.id, parsed.data)
  if (!result.ok) return { status: 'problem', message: result.message }

  revalidatePath(`/collections/${slug}`, 'layout')
  return { status: 'done', message: '공개범위를 바꿨어요.' }
}

export async function updateListedAction(
  slug: string,
  _prev: ManageState,
  formData: FormData,
): Promise<ManageState> {
  // 체크박스는 켜졌을 때만 값을 보낸다 — 없으면 끈 것
  const listed = formData.get('listed') === 'on' || formData.get('listed') === 'true'

  const found = await getCollectionBySlug(slug)
  if (!found.ok) return { status: 'problem', message: found.message }
  if (found.data === null) return { status: 'problem', message: '이 컬렉션을 찾지 못했어요.' }
  if (isAuthReady) {
    const user = await currentUser()
    if (user === null || user.id !== found.data.owner_id) {
      return { status: 'problem', message: '이 컬렉션의 주인만 바꿀 수 있어요.' }
    }
  }

  const result = await setCollectionListed(
    { id: found.data.id, visibility: found.data.visibility },
    listed,
  )
  if (!result.ok) return { status: 'problem', message: result.message }

  revalidatePath(`/collections/${slug}/settings`)
  revalidatePath('/gallery')
  return { status: 'done', message: listed ? '창작마당에 올렸어요.' : '창작마당에서 내렸어요.' }
}

export async function deleteCollectionAction(slug: string, _formData: FormData): Promise<void> {
  const owned = await ownedCollection(slug)
  if (!owned.ok) return

  await deleteCollection(owned.id)
  revalidatePath('/collections')
  redirect('/collections')
}
