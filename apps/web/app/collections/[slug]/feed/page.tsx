import { notFound } from 'next/navigation'

import { FeedList } from '@/components/feed-list'
import { FeedSectionChips } from '@/components/feed-section-chips'
import { CollectionTitle } from '@/components/collection-title'
import { HeroBand } from '@/components/hero-band'
import { UnavailableState } from '@/components/empty-state'
import { resolveCollectionAccess } from '@/lib/access'
import { getCollectionBySlug } from '@/lib/collections'
import { fetchFeed } from '@/lib/feed'
import { COPY, closingCopy } from '@/lib/labels'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ slug: string }>
}

/** 읽기 피드 탭 (기획서 3장 · G3 트랙 B) — 새로 올라온 것과 마감 임박이 구분된다 */
export default async function CollectionFeedPage({ params }: PageProps) {
  const { slug } = await params

  const found = await getCollectionBySlug(slug)
  if (!found.ok) return <UnavailableState message={found.message} />
  if (found.data === null) notFound()

  const collection = found.data

  // 주인·멤버가 아니면 없는 것과 같다 (ADR A40)
  const access = await resolveCollectionAccess(collection)
  if (!access.canView) notFound()

  const feed = await fetchFeed(collection)

  if (!feed.ok) return <UnavailableState message={feed.message} />

  const { fresh, closing, dateField } = feed.data

  return (
    <HeroBand
      dense
      overlap={false}
      title={<CollectionTitle name={collection.name} visibility={collection.visibility} />}
      sub="읽기 피드"
    >
    <div className="flex flex-col gap-7">
      {/* 절 바로가기 칩 — 누른 쪽이 진해지고 해당 절로 스크롤 */}
      <FeedSectionChips
        freshCount={fresh.length}
        closingCount={dateField !== null ? closing.length : null}
      />

      {/* 급한 것부터 — 마감 임박이 위 (기획서 3장) */}
      {dateField !== null && closing.length > 0 && (
        <section id="closing" className="flex scroll-mt-4 flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-lg font-bold text-ink">{COPY.feedClosingTitle}</h2>
            <p className="text-sm text-faint">{closingCopy(dateField.label)}</p>
          </div>
          <FeedList items={closing} fields={collection.schema_json} dateField={dateField} />
        </section>
      )}

      <section id="fresh" className="flex scroll-mt-4 flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-lg font-bold text-ink">{COPY.feedFreshTitle}</h2>
          <p className="text-sm text-faint">{COPY.feedFreshBody}</p>
        </div>
        {fresh.length === 0 ? (
          <p className="rounded-card border border-border bg-raised px-4 py-4 text-sm text-muted">
            {COPY.feedEmpty}
          </p>
        ) : (
          <FeedList items={fresh} fields={collection.schema_json} dateField={dateField} />
        )}
      </section>
    </div>
    </HeroBand>
  )
}
