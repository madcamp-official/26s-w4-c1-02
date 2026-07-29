import Link from 'next/link'
import { notFound } from 'next/navigation'

import { CloneButton } from '@/components/clone-button'
import { CollectionTable } from '@/components/collection-table'
import { EmptyState, UnavailableState } from '@/components/empty-state'
import { HeroBand } from '@/components/hero-band'
import { HostChip } from '@/components/ui/host-chip'
import { Icon } from '@/components/ui/icon'
import { fetchCollectionPage, getCollectionBySlug, listSites } from '@/lib/collections'
import { galleryMetaFor } from '@/lib/gallery'

import { cloneCollectionAction } from '../actions'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ slug: string }>
}

/** 화면은 넉넉히 받아두고 정렬·검색은 브라우저에서 (표 탭과 같은 관례) */
const SCREEN_QUERY = 'limit=200&include=provenance'

/**
 * 모두의 컬렉션 공개 상세 (델타 §8). **로그인 없이** 표를 읽기 전용으로 보고, 복제할지 정한다.
 * 소유자 전용 access(resolveCollectionAccess)를 타지 않는다 — 여기서는 visibility='public'
 * 자체가 열쇠다. 공개가 아니면 없는 것과 같다.
 */
export default async function GalleryDetailPage({ params }: PageProps) {
  const { slug } = await params

  const found = await getCollectionBySlug(slug)
  if (!found.ok) return <UnavailableState message={found.message} />
  if (found.data === null) notFound()

  const collection = found.data
  // 공개만 모두의 컬렉션에서 열린다. private·unlisted 는 존재 여부도 드러내지 않는다.
  if (collection.visibility !== 'public') notFound()

  const [page, sites, meta] = await Promise.all([
    fetchCollectionPage(collection, SCREEN_QUERY),
    listSites(collection.id),
    galleryMetaFor(collection.id),
  ])

  const siteList = sites.ok ? sites.data : []
  const items = page.ok ? page.data.items : []
  const author = meta.ok ? meta.data.author : '익명'
  const forkCount = meta.ok ? meta.data.fork_count : 0

  return (
    <HeroBand
      dense
      overlap={false}
      title={<h1 className="text-[22px] font-bold tracking-[-0.03em] text-white">{collection.name}</h1>}
      sub={`${author} 님이 만듦${forkCount > 0 ? ` · 복제 ${forkCount}회` : ''}`}
      action={
        <CloneButton
          clone={cloneCollectionAction.bind(null, collection.slug)}
          variant="primary"
          size="md"
        />
      }
    >
      <div className="flex flex-col gap-4">
        <Link
          href="/gallery"
          className="inline-flex w-fit items-center gap-1.5 text-[13px] text-faint hover:text-accent hover:no-underline"
        >
          <Icon name="chevron-left" size={13} strokeWidth={2} /> 모두의 컬렉션으로
        </Link>

        {siteList.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[13px] text-faint">사이트</span>
            {siteList.map((site) => (
              <HostChip key={site.id} host={site.host} />
            ))}
          </div>
        )}

        {/* 복제하면 이 표가 그대로 내 것이 되고, 여기에 내 사이트를 더할 수 있다 */}
        <p className="rounded-card border border-accent-soft bg-accent-soft/40 px-4 py-3 text-[13px] text-ink">
          이 표를 <b className="font-semibold">복제</b>하면 사이트·뷰가 그대로 내 컬렉션으로 들어와요.
          거기에 내가 아는 사이트를 더하면 나만의 카테고리가 됩니다.
        </p>

        {!page.ok ? (
          <UnavailableState message={page.message} />
        ) : items.length === 0 ? (
          <EmptyState
            title="아직 이 표에 담긴 항목이 없어요"
            body="복제한 뒤 사이트를 붙이면 같은 표에 같은 형식으로 담깁니다."
          />
        ) : (
          <CollectionTable
            fields={collection.schema_json}
            items={items}
            hosts={siteList.map((site) => site.host)}
            storageKey={`gallery:${collection.slug}`}
          />
        )}
      </div>
    </HeroBand>
  )
}
