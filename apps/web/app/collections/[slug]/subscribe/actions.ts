'use server'

// 구독 등록·해지 서버 액션. 실패도 던지지 않고 사람 문장으로 돌려준다 (보장선 B4).

import { revalidatePath } from 'next/cache'

import { currentUser, isAuthReady } from '@/auth'
import type { SubscribeState } from '@/components/subscribe-form'
import { getCollectionBySlug } from '@/lib/collections'
import { createWebhookSubscription, removeSubscription } from '@/lib/subscriptions'

/**
 * 주인 확인 (ADR A40). 구독은 관리 행동이다 — 읽기 전용 뷰어는 걸 수도 끊을 수도 없다.
 * 화면(작업실)은 canManage 로 이미 막지만, 서버 액션은 페이지를 안 거치므로 여기서 다시 막는다.
 * 로그인 설정 전(데모)에는 통과시킨다 — actions.ts 의 ownedCollection 과 같은 관례.
 */
async function ownedCollection(
  slug: string,
): Promise<{ ok: true; id: string; ownerId: string } | { ok: false; message: string }> {
  const found = await getCollectionBySlug(slug)
  if (!found.ok) return { ok: false, message: found.message }
  if (found.data === null) {
    return { ok: false, message: '이 컬렉션을 찾지 못했어요. 화면을 새로 고쳐 주세요.' }
  }
  if (isAuthReady) {
    const user = await currentUser()
    if (user === null || user.id !== found.data.owner_id) {
      return { ok: false, message: '이 컬렉션의 주인만 받아보기를 걸 수 있어요.' }
    }
  }
  return { ok: true, id: found.data.id, ownerId: found.data.owner_id }
}

/** 받을 곳 이름 상한 — 뷰 이름(60)보다 짧게. 목록·선택칸에 한 줄로 들어가야 한다 */
const MAX_CHANNEL_NAME = 40

/** 폼에서 받은 이름을 다듬는다. 비어 있으면 null (화면이 호스트로 대신한다) */
function normalizeName(raw: string): { ok: true; name: string | null } | { ok: false } {
  const trimmed = raw.trim().replace(/\s+/g, ' ')
  if (trimmed === '') return { ok: true, name: null }
  if (trimmed.length > MAX_CHANNEL_NAME) return { ok: false }
  return { ok: true, name: trimmed }
}

/** 폼에서 받은 주소를 웹훅으로 다듬는다. 이상하면 null */
function normalizeTarget(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  try {
    const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

export async function subscribeWebhookAction(
  slug: string,
  _prev: SubscribeState,
  formData: FormData,
): Promise<SubscribeState> {
  const target = normalizeTarget(String(formData.get('target') ?? ''))
  if (target === null) {
    return {
      status: 'problem',
      message: '주소처럼 보이지 않아요. 받을 곳의 주소를 그대로 붙여넣어 주세요.',
    }
  }

  const named = normalizeName(String(formData.get('name') ?? ''))
  if (!named.ok) {
    return {
      status: 'problem',
      message: `이름이 너무 길어요. ${MAX_CHANNEL_NAME}자 안으로 지어 주세요.`,
    }
  }

  // 주인만 구독을 건다 (ADR A40) — 뷰어는 읽기 전용이다
  const owned = await ownedCollection(slug)
  if (!owned.ok) return { status: 'problem', message: owned.message }

  const result = await createWebhookSubscription(owned.id, owned.ownerId, target, named.name)
  if (!result.ok) return { status: 'problem', message: result.message }

  revalidatePath(`/collections/${slug}/views`)
  if (!result.data.created) {
    return result.data.renamed
      ? { status: 'done', message: '이미 받아보고 있는 주소예요 — 이름을 새로 붙였어요.' }
      : { status: 'exists', message: '이미 이 주소로 받아보고 있어요.' }
  }
  return { status: 'done', message: '이제 새 항목이 생기면 이 주소로 보내드려요.' }
}

export async function stopSubscriptionAction(slug: string, formData: FormData): Promise<void> {
  const subscriptionId = String(formData.get('subscription') ?? '').trim()
  if (subscriptionId === '') return

  // 주인만 끊는다 (ADR A40). 예전엔 인증이 아예 없어 slug + 구독 id 만으로 남의 구독을 취소할 수 있었다.
  const owned = await ownedCollection(slug)
  if (!owned.ok) return

  await removeSubscription(owned.id, subscriptionId)
  revalidatePath(`/collections/${slug}/views`)
}
