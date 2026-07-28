import { notFound } from 'next/navigation'

import { AttachFlow } from '@/components/attach-flow'
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
    <div className="mx-auto w-full max-w-[880px]">
      <h2 className="mb-1 text-lg font-bold text-ink">사이트 붙이기</h2>
      <p className="mb-5 text-sm text-faint">
        이미 만든 표에 새 사이트를 붙여요. 기존 열은 자동으로 찾아보고, 못 찾은 것만 여쭤볼게요.
      </p>
      <AttachFlow
        initialUrl={url ?? ''}
        preview={previewAttachAction.bind(null, found.data.slug)}
        save={saveAttachAction.bind(null, found.data.slug)}
        suggest={suggestAttachSourcesAction.bind(null, found.data.slug)}
      />
    </div>
  )
}
