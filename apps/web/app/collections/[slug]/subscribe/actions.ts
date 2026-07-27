'use server'

// 구독 등록·해지 서버 액션. 실패도 던지지 않고 사람 문장으로 돌려준다 (보장선 B4).

import { revalidatePath } from 'next/cache'

import { currentUser, isAuthReady } from '@/auth'
import type { SubscribeState } from '@/components/subscribe-form'
import { getCollectionBySlug } from '@/lib/collections'
import { createWebhookSubscription, removeSubscription } from '@/lib/subscriptions'

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

  const found = await getCollectionBySlug(slug)
  if (!found.ok) return { status: 'problem', message: found.message }
  if (found.data === null) {
    return { status: 'problem', message: '이 컬렉션을 찾지 못했어요. 화면을 새로 고쳐 주세요.' }
  }

  // 컬렉션 상세는 로그인 없이 볼 수 있으므로(미들웨어) 쓰기는 여기서 막는다
  const user = await currentUser()
  if (isAuthReady && user === null) {
    return { status: 'problem', message: '받아보기는 로그인한 뒤에 걸 수 있어요.' }
  }
  // 로그인 설정이 아직 없는 동안은 컬렉션 주인 몫으로 저장한다 (데모 경로)
  const userId = user?.id ?? found.data.owner_id

  const result = await createWebhookSubscription(found.data.id, userId, target)
  if (!result.ok) return { status: 'problem', message: result.message }

  revalidatePath(`/collections/${slug}/subscribe`)
  if (!result.data.created) {
    return { status: 'exists', message: '이미 이 주소로 받아보고 있어요.' }
  }
  return { status: 'done', message: '이제 새 항목이 생기면 이 주소로 보내드려요.' }
}

export async function stopSubscriptionAction(slug: string, formData: FormData): Promise<void> {
  const subscriptionId = String(formData.get('subscription') ?? '').trim()
  if (subscriptionId === '') return

  const found = await getCollectionBySlug(slug)
  if (!found.ok || found.data === null) return

  await removeSubscription(found.data.id, subscriptionId)
  revalidatePath(`/collections/${slug}/subscribe`)
}
