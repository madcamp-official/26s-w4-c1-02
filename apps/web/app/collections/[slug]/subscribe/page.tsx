import { notFound } from 'next/navigation'

import { SubscribeForm, type SubscriptionView } from '@/components/subscribe-form'
import { UnavailableState } from '@/components/empty-state'
import { getCollectionBySlug } from '@/lib/collections'
import { COPY, lastSentCopy } from '@/lib/labels'
import { listWebhookSubscriptions, type SubscriptionRecord } from '@/lib/subscriptions'

import { stopSubscriptionAction, subscribeWebhookAction } from './actions'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ slug: string }>
}

/** 시각은 서버에서 문장으로 만들어 내려보낸다 — 브라우저 시간대에 흔들리지 않게 */
const SENT_AT_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Seoul',
})

function toView(subscription: SubscriptionRecord): SubscriptionView {
  return {
    id: subscription.id,
    target: subscription.target,
    sentCopy:
      subscription.last_sent_at === null
        ? COPY.subscribeNeverSent
        : lastSentCopy(SENT_AT_FORMAT.format(subscription.last_sent_at)),
  }
}

/** 구독 탭 (기획서 9-4 · G3 트랙 B) */
export default async function CollectionSubscribePage({ params }: PageProps) {
  const { slug } = await params

  const found = await getCollectionBySlug(slug)
  if (!found.ok) return <UnavailableState message={found.message} />
  if (found.data === null) notFound()

  const subscriptions = await listWebhookSubscriptions(found.data.id)

  return (
    <div className="max-w-[640px]">
      <SubscribeForm
        subscribe={subscribeWebhookAction.bind(null, found.data.slug)}
        stop={stopSubscriptionAction.bind(null, found.data.slug)}
        subscriptions={subscriptions.ok ? subscriptions.data.map(toView) : []}
      />
    </div>
  )
}
