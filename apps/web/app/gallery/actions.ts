'use server'

// 창작마당 서버 액션 — 복제. 로그인한 사람이 공개 컬렉션을 자기 것으로 가져온다 (델타 §8).

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { currentUser, isAuthReady } from '@/auth'
import type { CloneState } from '@/components/clone-button'
import { cloneViaWorker } from '@/lib/gallery'
import { demoOwnerId } from '@/lib/create'

/** 복제를 부탁할 주인의 id 를 정한다. 로그인 설정 전(데모)에는 시드 첫 사용자를 쓴다 */
async function cloneOwnerId(): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  if (isAuthReady) {
    const user = await currentUser()
    if (user === null) return { ok: false, message: '복제하려면 먼저 로그인해 주세요.' }
    return { ok: true, id: user.id }
  }
  const demo = await demoOwnerId()
  if (!demo.ok) return { ok: false, message: demo.message }
  if (demo.data === null) return { ok: false, message: '복제할 계정을 찾지 못했어요.' }
  return { ok: true, id: demo.data }
}

/**
 * 공개 컬렉션 하나를 복제한다. 성공하면 새로 생긴 내 컬렉션으로 바로 이동한다 —
 * 복제 직후 "여기에 내 사이트를 붙여보세요" 로 이어지는 게 이 기능의 핵심 장면이다.
 */
export async function cloneCollectionAction(
  sourceSlug: string,
  _prev: CloneState,
  _formData: FormData,
): Promise<CloneState> {
  const owner = await cloneOwnerId()
  if (!owner.ok) return { status: 'problem', message: owner.message }

  const result = await cloneViaWorker({ sourceSlug, ownerId: owner.id })
  if (!result.ok) return { status: 'problem', message: result.message }

  // 복제본은 내 목록에 새로 생겼다 — 목록과 창작마당(복제수) 둘 다 새로 그린다
  revalidatePath('/collections')
  revalidatePath('/gallery')
  redirect(`/collections/${result.data.slug}`)
}
