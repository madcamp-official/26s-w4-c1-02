import { notFound } from 'next/navigation'

import { CollectionTable } from '@/components/collection-table'
import { DeveloperDetails } from '@/components/developer-details'
import { EmptyState, UnavailableState } from '@/components/empty-state'
import { SourceCoverage } from '@/components/source-coverage'
import { Badge } from '@/components/ui/badge'
import {
  countHealedThisMonth,
  fetchCollectionPage,
  getCollectionBySlug,
  listSites,
} from '@/lib/collections'
import { VISIBILITY_COPY } from '@/lib/labels'
import { apiUrlFor, mcpUrlFor } from '@/lib/urls'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ slug: string }>
}

/** 화면은 한 번에 넉넉히 받아두고 정렬·필터는 브라우저에서 즉시 한다 (기획서 8장) */
const SCREEN_QUERY = 'limit=200&include=provenance'

export default async function CollectionDetailPage({ params }: PageProps) {
  const { slug } = await params

  const found = await getCollectionBySlug(slug)
  if (!found.ok) return <UnavailableState message={found.message} />
  if (found.data === null) notFound()

  const collection = found.data
  const [page, sites, healed] = await Promise.all([
    fetchCollectionPage(collection, SCREEN_QUERY),
    listSites(collection.id),
    countHealedThisMonth(collection.id),
  ])

  const siteList = sites.ok ? sites.data : []
  const summaries = page.ok ? page.data.sources : {}
  const items = page.ok ? page.data.items : []

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2 pt-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{collection.name}</h1>
          <Badge tone="neutral">{VISIBILITY_COPY[collection.visibility]}</Badge>
        </div>
        <p className="font-mono text-xs text-faint">/{collection.slug}</p>
      </header>

      {/* 커버리지가 표보다 위에 있다 — 부분 성공이 정상 상태다 (원칙 ④) */}
      <SourceCoverage
        sites={siteList}
        summaries={summaries}
        healedThisMonth={healed.ok ? healed.data : 0}
      />

      {!page.ok ? (
        <UnavailableState message={page.message} />
      ) : items.length === 0 ? (
        <EmptyState
          title="아직 이 표에 담긴 항목이 없어요"
          body="사이트를 하나 더 붙이면 같은 표에 같은 형식으로 담깁니다."
        />
      ) : (
        <CollectionTable
          fields={collection.schema_json}
          items={items}
          hosts={siteList.map((site) => site.host)}
        />
      )}

      {/* 보장선 B5·B7 — 기본은 접혀 있고, 펼치면 언제든 보인다 */}
      <DeveloperDetails apiUrl={apiUrlFor(collection.slug)} mcpUrl={mcpUrlFor(collection.slug)} />
    </div>
  )
}
