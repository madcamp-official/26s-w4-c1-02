'use server'

// 초대 링크 · 함께 보는 사람 관리 (ADR A40). 전부 주인만 부를 수 있다 —
// 화면에서 숨기는 것과 별개로 여기서도 막는다 (숨긴 버튼은 보안이 아니다).

import { revalidatePath } from 'next/cache'

import { currentUser, isAuthReady } from '@/auth'
import { getCollectionBySlug } from '@/lib/collections'
import { disableInviteLinks, issueInviteLink, removeMember } from '@/lib/share'
import { inviteUrlFor } from '@/lib/urls'

export interface ShareState {
  status: 'idle' | 'done' | 'problem'
  message: string | null
  /** 새로 만든 초대 링크 — 이 응답에서만 보이고 다시 조회할 수 없다 */
  inviteUrl: string | null
}

/** 주인 확인. 로그인 설정 전(데모)에는 통과시킨다 — actions.ts 와 같은 관례 */
async function ownedCollection(
  slug: string,
): Promise<{ ok: true; id: string; userId: string | null } | { ok: false; message: string }> {
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
    return { ok: true, id: found.data.id, userId: user.id }
  }
  return { ok: true, id: found.data.id, userId: found.data.owner_id }
}

export async function createInviteLinkAction(
  slug: string,
  _prev: ShareState,
  _formData: FormData,
): Promise<ShareState> {
  const owned = await ownedCollection(slug)
  if (!owned.ok) return { status: 'problem', message: owned.message, inviteUrl: null }
  if (owned.userId === null) {
    return { status: 'problem', message: '로그인이 준비되면 만들 수 있어요.', inviteUrl: null }
  }

  const issued = await issueInviteLink(owned.id, owned.userId)
  if (!issued.ok) return { status: 'problem', message: issued.message, inviteUrl: null }

  revalidatePath(`/collections/${slug}/connect`)
  return {
    status: 'done',
    message: '새 초대 링크를 만들었어요. 지금만 보여요 — 복사해서 전해 주세요.',
    inviteUrl: inviteUrlFor(issued.data.token),
  }
}

export async function disableInviteLinkAction(
  slug: string,
  _prev: ShareState,
  _formData: FormData,
): Promise<ShareState> {
  const owned = await ownedCollection(slug)
  if (!owned.ok) return { status: 'problem', message: owned.message, inviteUrl: null }

  const result = await disableInviteLinks(owned.id)
  if (!result.ok) return { status: 'problem', message: result.message, inviteUrl: null }

  revalidatePath(`/collections/${slug}/connect`)
  return {
    status: 'done',
    message: '초대 링크를 껐어요. 이미 함께 보는 사람은 그대로예요.',
    inviteUrl: null,
  }
}

export async function removeMemberAction(
  slug: string,
  _prev: ShareState,
  formData: FormData,
): Promise<ShareState> {
  const memberId = String(formData.get('member_id') ?? '')
  if (memberId === '') return { status: 'problem', message: '누구를 내보낼지 몰라요.', inviteUrl: null }

  const owned = await ownedCollection(slug)
  if (!owned.ok) return { status: 'problem', message: owned.message, inviteUrl: null }

  const result = await removeMember(owned.id, memberId)
  if (!result.ok) return { status: 'problem', message: result.message, inviteUrl: null }

  revalidatePath(`/collections/${slug}/connect`)
  return { status: 'done', message: '내보냈어요. 다시 보려면 새 초대 링크가 필요해요.', inviteUrl: null }
}
