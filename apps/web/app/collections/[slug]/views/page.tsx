import Link from 'next/link'
import { notFound } from 'next/navigation'

import { SubscribeForm, type SubscriptionView } from '@/components/subscribe-form'
import { UnavailableState } from '@/components/empty-state'
import { HeroBand } from '@/components/hero-band'
import { Badge, Dot } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { resolveCollectionAccess } from '@/lib/access'
import { getCollectionBySlug } from '@/lib/collections'
import { COPY, lastSentCopy } from '@/lib/labels'
import {
  listWebhookSubscriptions,
  subscriptionDisplayName,
  type SubscriptionRecord,
} from '@/lib/subscriptions'
import { fetchViewPage, healthCopy, listViews, summarizeConditions } from '@/lib/views'

import { stopSubscriptionAction, subscribeWebhookAction } from '../subscribe/actions'
import { deleteViewAction, setViewNotifyAction, toggleViewPinAction } from '../view-actions'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ slug: string }>
}

const SENT_AT_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Seoul',
})

function toChannelView(subscription: SubscriptionRecord): SubscriptionView {
  return {
    id: subscription.id,
    target: subscription.target,
    displayName: subscriptionDisplayName(subscription),
    sentCopy:
      subscription.last_sent_at === null
        ? COPY.subscribeNeverSent
        : lastSentCopy(SENT_AT_FORMAT.format(subscription.last_sent_at)),
  }
}

/**
 * 뷰 · 알림 (델타 3절 — 옛 작업실에서 분리).
 * 저장된 조건이 곧 뷰 — 화면 · API · MCP · 알림 네 곳이 같은 뷰를 본다.
 */
export default async function CollectionViewsPage({ params }: PageProps) {
  const { slug } = await params

  const found = await getCollectionBySlug(slug)
  if (!found.ok) return <UnavailableState message={found.message} />
  if (found.data === null) notFound()

  const collection = found.data

  // 뷰 관리는 관리 표면이다 — 읽기 전용 멤버에게는 없는 것과 같다 (ADR A40)
  const access = await resolveCollectionAccess(collection)
  if (!access.canManage) notFound()

  const basePath = `/collections/${collection.slug}`
  const tablePath = `${basePath}/table`

  const [viewsResult, subscriptions] = await Promise.all([
    listViews(collection),
    listWebhookSubscriptions(collection.id),
  ])
  const views = viewsResult.ok ? viewsResult.data : []
  const channels = subscriptions.ok ? subscriptions.data : []
  // 알림을 "이름으로" 걸고 읽는다 — id·주소가 아니라 사용자가 붙인 이름이 화면의 통화다
  const channelNameById = new Map(channels.map((c) => [c.id, subscriptionDisplayName(c)]))

  // 뷰별 현재 건수 — 표와 같은 문(viewToQuery)으로 센다. 50개 넘으면 "50+"
  const cards = await Promise.all(
    views.map(async (view) => {
      const page = view.health === 'broken' ? null : await fetchViewPage(collection, view, 50)
      const count = page !== null && page.ok ? page.data.items.length : null
      const more = page !== null && page.ok && page.data.page.next_cursor !== null
      return { view, countLabel: count === null ? '—' : `${count}${more ? '+' : ''}건` }
    }),
  )

  return (
    <HeroBand dense overlap={false} title={collection.name} sub="뷰 · 알림">
      {cards.length === 0 ? (
        <p className="rounded-card border border-dashed border-border-strong bg-raised px-5 py-5 text-sm text-muted">
          아직 저장한 조건이 없어요.{' '}
          <Link href={tablePath} className="font-semibold text-accent">
            표에서 조건을 걸고
          </Link>{' '}
          ‘이 조건 저장’을 누르면 여기에 쌓입니다.
        </p>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {cards.map(({ view, countLabel }) => {
            const health = healthCopy(view.health)
            const summary = summarizeConditions(view.where, collection.schema_json)
            return (
              <article
                key={view.id}
                className="flex flex-col gap-2.5 rounded-card border border-divider bg-surface p-4 shadow-[0_4px_20px_oklch(0.2_0.02_277/0.10)]"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`${tablePath}?view=${view.slug}`}
                    className="text-[14px] font-semibold text-ink hover:text-accent hover:no-underline"
                  >
                    {view.pinned && <span aria-hidden>★ </span>}
                    {view.name}
                  </Link>
                  <span className="text-[13px] font-semibold text-accent">{countLabel}</span>
                  <Badge tone={health.tone} className="ml-auto">
                    <Dot />
                    {health.text}
                  </Badge>
                </div>

                {/* 조건 요약 — 원본은 술어 문자열을 가라앉은 mono 박스에 담는다 */}
                <p className="rounded-md bg-canvas px-2.5 py-1.5 font-mono text-[11.5px] text-muted">
                  {summary === '' ? '조건 없음 (전체)' : summary}
                </p>

                <p className="text-xs text-faint">
                  표 · 주소(API) · AI(MCP)
                  {view.notify !== null
                    ? ` · 알림 → ${view.notify.channels
                        .map((id) => channelNameById.get(id) ?? '지워진 받을 곳')
                        .join(', ')}`
                    : ' · 알림 꺼짐'}
                </p>

                <div className="flex flex-wrap items-center gap-2 border-t border-divider pt-2.5">
                  {/* 알림 — 채널(받을 주소)을 골라 켠다. 실체는 아래 '받아보기 채널'의 행이다 */}
                  <form
                    action={setViewNotifyAction.bind(null, collection.slug)}
                    className="flex items-center gap-1.5"
                  >
                    <input type="hidden" name="view_id" value={view.id} />
                    <select
                      name="channel"
                      defaultValue={view.notify?.channels[0] ?? ''}
                      className="h-8 max-w-[180px] rounded-lg border border-border bg-surface px-2 text-xs text-ink"
                    >
                      <option value="">알림 끄기</option>
                      {channels.map((channel) => (
                        <option key={channel.id} value={channel.id}>
                          {subscriptionDisplayName(channel)}
                        </option>
                      ))}
                    </select>
                    <Button type="submit" size="sm" variant="outline">
                      적용
                    </Button>
                  </form>

                  <form action={toggleViewPinAction.bind(null, collection.slug)} className="ml-auto">
                    <input type="hidden" name="view_id" value={view.id} />
                    <input type="hidden" name="pinned" value={view.pinned ? 'false' : 'true'} />
                    <Button type="submit" size="sm" variant="ghost">
                      {view.pinned ? '고정 풀기' : '고정'}
                    </Button>
                  </form>
                  <form action={deleteViewAction.bind(null, collection.slug)}>
                    <input type="hidden" name="view_id" value={view.id} />
                    <Button type="submit" size="sm" variant="ghost" className="text-attention">
                      지우기
                    </Button>
                  </form>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {/* 받아보기 채널 (계약 §4-b: 채널의 실체) */}
      <section className="max-w-[640px]">
        <SubscribeForm
          subscribe={subscribeWebhookAction.bind(null, collection.slug)}
          stop={stopSubscriptionAction.bind(null, collection.slug)}
          subscriptions={channels.map(toChannelView)}
        />
      </section>

      {/* 뒤에서 도는 것 — 패널 대신 약관처럼 한 문단. 관찰만 말한다 (델타 4-4) */}
      <p className="max-w-[640px] text-[12px] leading-relaxed text-faint">
        손대지 않아도 하루 한 번 사이트를 다시 보고, 구조가 바뀌면 스스로 맞추고, 자정마다 저장한
        조건을 다시 재서 새 항목만 보내드려요. 오래 조용한 사이트는 따로 알려드려요.
      </p>
    </HeroBand>
  )
}
