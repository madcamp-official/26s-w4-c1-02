import { notFound } from 'next/navigation'

import { AttachFlow } from '@/components/attach-flow'
import { HeroBand } from '@/components/hero-band'
import { UnavailableState } from '@/components/empty-state'
import { resolveCollectionAccess } from '@/lib/access'
import { getCollectionBySlug } from '@/lib/collections'

import { previewAttachAction, saveAttachAction, suggestAttachSourcesAction } from './actions'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ url?: string }>
}

/** 사이트 붙이기 (기능 ② — 제품의 정체성). 셸(layout)이 제목·탭을 그린다 */
export default async function AttachSourcePage({ params, searchParams }: PageProps) {
  const { slug } = await params
  const { url } = await searchParams

  const found = await getCollectionBySlug(slug)
  if (!found.ok) return <UnavailableState message={found.message} />
  if (found.data === null) notFound()

  // 사이트 붙이기는 관리 행동이다 — 주인만 (ADR A40)
  const access = await resolveCollectionAccess(found.data)
  if (!access.canManage) notFound()

  return (
    <HeroBand dense title="사이트 붙이기" sub={`${found.data.name}에 새 소스를 합쳐요`}>
      <div className="w-full max-w-[880px]">
        <AttachFlow
          initialUrl={url ?? ''}
          preview={previewAttachAction.bind(null, found.data.slug)}
          save={saveAttachAction.bind(null, found.data.slug)}
          suggest={suggestAttachSourcesAction.bind(null, found.data.slug)}
        />
      </div>
    </HeroBand>
  )
}
