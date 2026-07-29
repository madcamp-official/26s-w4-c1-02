import type { ReactNode } from 'react'

import { CollectionNameBroadcast } from '@/components/collection-context'
import { CollectionTabs } from '@/components/collection-tabs'
import { resolveCollectionAccess } from '@/lib/access'
import { getCollectionBySlug } from '@/lib/collections'

/**
 * 컬렉션 셸 — 원본 콘솔대로 각 화면(대시보드/표/피드/뷰·알림/소스/연결/설정)이
 * 자기 밴드를 그린다. 셸은 좁은 화면용 가로 탭만 담당한다 (데스크톱 nav 는 좌측 사이드바).
 */
export default async function CollectionLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const found = await getCollectionBySlug(slug)

  // 못 읽었거나 없는 컬렉션 — 셸 없이 페이지가 자기 상태 문구를 그리게 둔다 (B4)
  if (!found.ok || found.data === null) return <>{children}</>

  const collection = found.data

  // 주인도 멤버도 아니면 셸을 그리지 않는다 (ADR A40) — 각 페이지가 notFound 를 낸다
  const access = await resolveCollectionAccess(collection)
  if (!access.canView) return <>{children}</>

  return (
    <>
      {/* 사이드바가 컬렉션 이름을 보여줄 수 있게 방송한다 (원본 Sidebar.jsx 의 col.name 자리) */}
      <CollectionNameBroadcast name={collection.name} />
      {/* 데스크톱은 좌측 사이드바가 섹션 nav 를 담당한다. 좁은 화면에서만 가로 탭 */}
      <div className="px-5 pt-4 md:hidden">
        <CollectionTabs slug={collection.slug} manage={access.canManage} />
      </div>
      {children}
    </>
  )
}
