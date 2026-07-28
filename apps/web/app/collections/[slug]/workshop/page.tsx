import Link from 'next/link'
import { notFound } from 'next/navigation'

import { SubscribeForm, type SubscriptionView } from '@/components/subscribe-form'
import { UnavailableState } from '@/components/empty-state'
import { Badge, Dot } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { resolveCollectionAccess } from '@/lib/access'
import { getCollectionBySlug, listSites } from '@/lib/collections'
import { COPY, checkedAgoCopy, lastSentCopy, SOURCE_STATUS_COPY } from '@/lib/labels'
import { listWebhookSubscriptions, type SubscriptionRecord } from '@/lib/subscriptions'
import { fetchViewPage, healthCopy, listViews, summarizeConditions } from '@/lib/views'
import { cn } from '@/lib/utils'

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
    sentCopy:
      subscription.last_sent_at === null
        ? COPY.subscribeNeverSent
        : lastSentCopy(SENT_AT_FORMAT.format(subscription.last_sent_at)),
  }
}

/**
 * 작업실 (델타 3절 — 구독 탭 개편).
 * "내가 한 번 정하면 나 없이도 계속 작동하는 것"만 산다:
 * 위 = 내가 만든 것(저장된 뷰), 아래 = 이 컬렉션의 상태(사이트·배달 채널). (델타 3-4 의 분리)
 */
export default async function WorkshopPage({ params }: PageProps) {
  const { slug } = await params

  const found = await getCollectionBySlug(slug)
  if (!found.ok) return <UnavailableState message={found.message} />
  if (found.data === null) notFound()

  const collection = found.data

  // 작업실은 관리 표면이다 — 읽기 전용 멤버에게는 없는 것과 같다 (ADR A40)
  const access = await resolveCollectionAccess(collection)
  if (!access.canManage) notFound()

  const basePath = `/collections/${collection.slug}`

  const [viewsResult, sites, subscriptions] = await Promise.all([
    listViews(collection),
    listSites(collection.id),
    listWebhookSubscriptions(collection.id),
  ])
  const views = viewsResult.ok ? viewsResult.data : []
  const siteList = sites.ok ? sites.data : []
  const channels = subscriptions.ok ? subscriptions.data : []

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
    <div className="flex flex-col gap-8">
      {/* ── 내가 만든 것 ── */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-lg font-bold text-ink">저장된 조건 (뷰)</h2>
          <p className="text-sm text-faint">
            한 번 정해두면 표 · 주소 · AI · 알림 네 곳에서 같이 살아요.
          </p>
        </div>

        {cards.length === 0 ? (
          <p className="rounded-card border border-dashed border-border-strong bg-raised px-5 py-5 text-sm text-muted">
            아직 저장한 조건이 없어요.{' '}
            <Link href={basePath} className="font-semibold text-accent">
              표에서 조건을 걸고
            </Link>{' '}
            ‘이 조건 저장’을 누르면 여기에 쌓입니다.
          </p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {cards.map(({ view, countLabel }) => {
              const health = healthCopy(view.health)
              const summary = summarizeConditions(view.where, collection.schema_json)
              return (
                <article
                  key={view.id}
                  className="flex flex-col gap-2.5 rounded-card border border-border bg-surface p-5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`${basePath}?view=${view.slug}`}
                      className="text-[15px] font-bold text-ink hover:text-accent hover:no-underline"
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

                  <p className="text-[13px] text-muted">
                    {summary === '' ? '조건 없음 (전체)' : summary}
                  </p>

                  <p className="text-xs text-faint">
                    표 · 주소(API) · AI(MCP)
                    {view.notify !== null
                      ? ` · 알림 켜짐 (채널 ${view.notify.channels.length}개)`
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
                            {channel.target.slice(0, 28)}…
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
      </section>

      {/* ── 이 컬렉션의 상태 ── */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-lg font-bold text-ink">사이트</h2>
            <p className="text-sm text-faint">이 표가 지켜보고 있는 곳들이에요.</p>
          </div>
          <Link
            href={`${basePath}/attach`}
            className="rounded-[9px] border-[1.5px] border-accent px-3.5 py-1.5 text-[13px] font-bold text-accent hover:bg-accent-soft hover:no-underline"
          >
            + 사이트 붙이기
          </Link>
        </div>
        <ul className="flex flex-col gap-2">
          {siteList.map((site) => {
            const copy = SOURCE_STATUS_COPY[site.status]
            return (
              <li
                key={site.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-surface px-4 py-2.5"
              >
                <span className="font-mono text-[13px] text-ink">{site.host}</span>
                <Badge tone={copy.tone}>
                  <Dot className={cn(site.status === 'healing' && 'animate-pulse')} />
                  {copy.short}
                </Badge>
                <span className="text-xs text-faint">{checkedAgoCopy(site.last_ok_at)}</span>
                <span className="w-full text-xs text-faint sm:ml-auto sm:w-auto">{copy.sentence}</span>
              </li>
            )
          })}
        </ul>
      </section>

      {/* ── 받아보기 채널 (기존 구독 화면 승계 — 계약 §4-b: 채널의 실체) ── */}
      <section className="max-w-[640px]">
        <SubscribeForm
          subscribe={subscribeWebhookAction.bind(null, collection.slug)}
          stop={stopSubscriptionAction.bind(null, collection.slug)}
          subscriptions={channels.map(toChannelView)}
        />
      </section>
    </div>
  )
}
