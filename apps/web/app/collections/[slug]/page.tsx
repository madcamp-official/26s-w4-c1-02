import Link from 'next/link'
import { notFound } from 'next/navigation'

import { CollectionTable } from '@/components/collection-table'
import { DeveloperDetails } from '@/components/developer-details'
import { EmptyState, UnavailableState } from '@/components/empty-state'
import { FilterBar } from '@/components/filter-bar'
import { SaveViewForm } from '@/components/save-view-form'
import { Badge, Dot } from '@/components/ui/badge'
import { resolveCollectionAccess } from '@/lib/access'
import { fetchCollectionPage, getCollectionBySlug, listSites } from '@/lib/collections'
import { apiUrlFor } from '@/lib/urls'
import { cn } from '@/lib/utils'
import {
  conditionsFromParams,
  fetchViewPage,
  listViews,
  paramsFromConditions,
  summarizeConditions,
  type ViewRecord,
} from '@/lib/views'

import { createViewAction } from './view-actions'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/** 화면은 한 번에 넉넉히 받아두고 정렬·검색은 브라우저에서 즉시 한다 (기획서 8장) */
const SCREEN_QUERY = 'limit=200&include=provenance'

/**
 * 표 탭 = 뷰 #0 (조건 없는 뷰 — 델타 2-3).
 * 저장된 뷰를 고르거나, 필터 바로 임시 조건을 걸고 "이 조건 저장"으로 뷰를 만든다.
 * 조건 해석은 저장/임시 모두 core 의 viewToQuery 하나를 탄다 (A33).
 */
export default async function CollectionDetailPage({ params, searchParams }: PageProps) {
  const { slug } = await params
  const rawParams = await searchParams

  const found = await getCollectionBySlug(slug)
  if (!found.ok) return <UnavailableState message={found.message} />
  if (found.data === null) notFound()

  const collection = found.data

  // 주인·멤버가 아니면 없는 것과 같다 (ADR A40) — 존재 여부도 정보다
  const access = await resolveCollectionAccess(collection)
  if (!access.canView) notFound()

  const basePath = `/collections/${collection.slug}`

  const viewsResult = await listViews(collection)
  const views = viewsResult.ok ? viewsResult.data : []

  // 저장된 뷰가 골라졌나 → 그 조건으로. 아니면 필터 바의 임시 조건으로
  const viewSlug = typeof rawParams['view'] === 'string' ? rawParams['view'] : null
  const activeView: ViewRecord | null =
    viewSlug === null ? null : (views.find((v) => v.slug === viewSlug) ?? null)
  const adhocConditions = activeView === null ? conditionsFromParams(rawParams, collection.schema_json) : []
  const conditions = activeView?.where ?? adhocConditions

  const [page, sites] = await Promise.all([
    conditions.length > 0 || activeView !== null
      ? fetchViewPage(collection, { where: conditions, sort: activeView?.sort ?? [] })
      : fetchCollectionPage(collection, SCREEN_QUERY),
    listSites(collection.id),
  ])

  const siteList = sites.ok ? sites.data : []
  const items = page.ok ? page.data.items : []
  const summary = summarizeConditions(conditions, collection.schema_json)
  const filterValues = paramsFromConditions(conditions)

  return (
    <div className="flex flex-col gap-4">
      {/* 뷰 칩 — 전체(뷰 #0) + 저장된 뷰들 */}
      {views.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={basePath}
            className={cn(
              'rounded-full border px-3.5 py-1.5 text-[13px] font-bold hover:no-underline',
              activeView === null && conditions.length === 0
                ? 'border-accent bg-accent text-accent-ink'
                : 'border-border bg-surface text-muted hover:border-accent hover:text-accent',
            )}
          >
            전체
          </Link>
          {views.map((view) => (
            <Link
              key={view.id}
              href={`${basePath}?view=${view.slug}`}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] font-bold hover:no-underline',
                activeView?.id === view.id
                  ? 'border-accent bg-accent text-accent-ink'
                  : 'border-border bg-surface text-muted hover:border-accent hover:text-accent',
              )}
            >
              {view.health !== 'ok' && <Dot className="bg-attention" />}
              {view.pinned && <span aria-hidden>★</span>}
              {view.name}
            </Link>
          ))}
        </div>
      )}

      <FilterBar basePath={basePath} fields={collection.schema_json} values={filterValues} />

      {/* 임시 조건이 걸려 있으면 저장을 권한다 (델타 2-10) — 뷰 저장은 주인 몫이다 (A40) */}
      {adhocConditions.length > 0 && access.canManage && (
        <SaveViewForm
          conditionsJson={JSON.stringify(adhocConditions)}
          summary={summary}
          suggestedName={summary.slice(0, 60) || '내 조건'}
          save={createViewAction.bind(null, collection.slug)}
        />
      )}
      {activeView !== null && (
        <p className="text-[13px] text-muted">
          <Badge tone="accent" className="mr-1.5 font-bold">
            {activeView.name}
          </Badge>
          {summary === '' ? '조건 없이 전체를 봐요' : `조건: ${summary}`}
          {activeView.health === 'broken' && (
            <span className="ml-2 font-semibold text-attention">
              조건에 쓰인 칸이 표에서 사라졌어요 — 작업실에서 고쳐 주세요
            </span>
          )}
        </p>
      )}

      {!page.ok ? (
        <UnavailableState message={page.message} />
      ) : items.length === 0 ? (
        conditions.length > 0 ? (
          <p className="rounded-card border border-border bg-raised px-4 py-4 text-sm text-muted">
            이 조건에 맞는 항목이 지금은 없어요. 조건을 넓히거나, 저장해 두면 새로 생길 때 알 수
            있어요.
          </p>
        ) : (
          <EmptyState
            title="아직 이 표에 담긴 항목이 없어요"
            body="사이트를 하나 더 붙이면 같은 표에 같은 형식으로 담깁니다."
          />
        )
      ) : (
        <CollectionTable
          fields={collection.schema_json}
          items={items}
          hosts={siteList.map((site) => site.host)}
        />
      )}

      {/* 보장선 B5 — 기본은 접혀 있고, 펼치면 언제든 보인다. MCP 는 '연결' 탭에 */}
      <DeveloperDetails apiUrl={apiUrlFor(collection.slug)} />
    </div>
  )
}
