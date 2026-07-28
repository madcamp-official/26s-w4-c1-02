import Link from 'next/link'
import { notFound } from 'next/navigation'

import { FeedList } from '@/components/feed-list'
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
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-accent bg-accent px-4 py-2 text-[13.5px] font-bold text-accent-ink">
          {COPY.feedFreshTitle} {fresh.length}
        </span>
        {dateField !== null && (
          <span className="rounded-full border border-border bg-surface px-4 py-2 text-[13.5px] font-bold text-muted">
            {COPY.feedClosingTitle} {closing.length}
          </span>
        )}
        <Link
          href={`/collections/${collection.slug}/workshop`}
          className="ml-auto rounded-[9px] border-[1.5px] border-accent px-4 py-2 text-[13.5px] font-bold text-accent hover:bg-accent-soft hover:no-underline"
        >
          새 항목 받아보기 →
        </Link>
      </div>

      {/* 급한 것부터 — 마감 임박이 위 (기획서 3장) */}
      {dateField !== null && closing.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-lg font-bold text-ink">{COPY.feedClosingTitle}</h2>
            <p className="text-sm text-faint">{closingCopy(dateField.label)}</p>
          </div>
          <FeedList items={closing} fields={collection.schema_json} dateField={dateField} />
        </section>
      )}

      <section className="flex flex-col gap-3">
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
  )
}
