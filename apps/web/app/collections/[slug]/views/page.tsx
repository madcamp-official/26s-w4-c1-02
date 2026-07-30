import Link from 'next/link'
import { notFound } from 'next/navigation'

import { SubscribeForm, type SubscriptionView } from '@/components/subscribe-form'
import { CollectionTitle } from '@/components/collection-title'
import { UnavailableState } from '@/components/empty-state'
import { HeroBand } from '@/components/hero-band'
import { Badge, Dot } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { resolveCollectionAccess } from '@/lib/access'
import { getCollectionBySlug } from '@/lib/collections'
import {
  listWebhookSubscriptions,
  subscriptionDisplayName,
  type SubscriptionRecord,
} from '@/lib/subscriptions'
import { ViewName } from '@/components/view-rename'
import { fetchViewPage, healthCopy, listViews, summarizeConditions } from '@/lib/views'

import {
  stopSubscriptionAction,
  subscribeWebhookAction,
  toggleSubscriptionAction,
} from '../subscribe/actions'
import {
  deleteViewAction,
  renameViewAction,
  setViewNotifyAction,
  toggleViewPinAction,
} from '../view-actions'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ slug: string }>
}

function toChannelView(subscription: SubscriptionRecord): SubscriptionView {
  return {
    id: subscription.id,
    target: subscription.target,
    displayName: subscriptionDisplayName(subscription),
    enabled: subscription.enabled,
  }
}

/**
 * 뷰 · 알림 (델타 3절 — 옛 작업실에서 분리 · 07-30 개편).
 * 받을 주소는 컬렉션 단위 주소록(오른쪽 패널)이고, 뷰는 알림 켬/끔만 정한다 —
 * 알림 켠 뷰에 새 항목이 들어오면 체크된 주소 전부로 나간다.
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
    <HeroBand
      dense
      overlap={false}
      title={<CollectionTitle name={collection.name} visibility={collection.visibility} />}
      sub="뷰 · 알림"
    >
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* ── 왼쪽: 저장한 조건(뷰) ──────────────────────────────────── */}
        <div className="min-w-0 flex-1">
          {cards.length === 0 ? (
            <p className="rounded-card border border-dashed border-border-strong bg-raised px-5 py-5 text-sm text-muted">
              아직 저장한 조건이 없어요.{' '}
              <Link href={tablePath} className="font-semibold text-accent">
                표에서 조건을 걸고
              </Link>{' '}
              ‘이 조건 저장’을 누르면 여기에 쌓입니다.
            </p>
          ) : (
            <div className="grid items-start gap-4 lg:grid-cols-2">
              {cards.map(({ view, countLabel }) => {
                const health = healthCopy(view.health)
                const summary = summarizeConditions(view.where, collection.schema_json)
                const notifyOn = view.notify !== null
                return (
                  <article
                    key={view.id}
                    className="flex flex-col gap-2.5 rounded-card border border-divider bg-surface p-4 shadow-[0_4px_20px_oklch(0.2_0.02_277/0.10)]"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <ViewName
                        viewId={view.id}
                        name={view.name}
                        href={`${tablePath}?view=${view.slug}`}
                        pinned={view.pinned}
                        rename={renameViewAction.bind(null, collection.slug)}
                      />
                      <span className="text-[13px] font-semibold text-accent">{countLabel}</span>
                      {notifyOn && (
                        <Badge tone="accent">
                          <Dot />
                          알림
                        </Badge>
                      )}
                      <Badge tone={health.tone} className="ml-auto">
                        <Dot />
                        {health.text}
                      </Badge>
                    </div>

                    {/* 조건 요약 — 원본은 술어 문자열을 가라앉은 mono 박스에 담는다 */}
                    <p className="rounded-md bg-canvas px-2.5 py-1.5 font-mono text-[11.5px] text-muted">
                      {summary === '' ? '조건 없음 (전체)' : summary}
                    </p>

                    <div className="flex flex-wrap items-center gap-2 border-t border-divider pt-2.5">
                      {/* 알림은 켬/끔뿐 — 어디로 갈지는 오른쪽 '알림 받을 곳'의 체크가 정한다 */}
                      <form action={setViewNotifyAction.bind(null, collection.slug)}>
                        <input type="hidden" name="view_id" value={view.id} />
                        <input type="hidden" name="notify" value={notifyOn ? 'off' : 'on'} />
                        <Button type="submit" size="sm" variant={notifyOn ? 'ghost' : 'outline'}>
                          {notifyOn ? '알림 끄기' : '알림 켜기'}
                        </Button>
                      </form>

                      <form
                        action={toggleViewPinAction.bind(null, collection.slug)}
                        className="ml-auto"
                      >
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

          {/* 뒤에서 도는 것 — 패널 대신 약관처럼 한 문단. 관찰만 말한다 (델타 4-4) */}
          <p className="mt-6 max-w-[640px] text-[12px] leading-relaxed text-faint">
            손대지 않아도 하루 한 번 사이트를 다시 보고, 구조가 바뀌면 스스로 맞추고, 자정마다
            저장한 조건을 다시 재서 새 항목만 보내드려요. 오래 조용한 사이트는 따로 알려드려요.
          </p>
        </div>

        {/* ── 오른쪽: 알림 받을 곳 (컬렉션 단위 주소록 · 고정) ─────────── */}
        <aside className="w-full lg:sticky lg:top-24 lg:w-[320px] lg:shrink-0">
          <SubscribeForm
            subscribe={subscribeWebhookAction.bind(null, collection.slug)}
            stop={stopSubscriptionAction.bind(null, collection.slug)}
            toggle={toggleSubscriptionAction.bind(null, collection.slug)}
            subscriptions={channels.map(toChannelView)}
          />
        </aside>
      </div>
    </HeroBand>
  )
}
