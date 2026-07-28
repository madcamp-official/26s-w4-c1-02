import Link from 'next/link'

import { CreateFlow } from '@/components/create-flow'

import { createCollectionAction, previewCollectionAction, suggestSourcesAction } from './actions'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ url?: string }>
}

/** 새 컬렉션 (기획서 9-1). 첫 화면·목록의 주소 입력이 여기로 모인다 */
export default async function NewCollectionPage({ searchParams }: PageProps) {
  const { url } = await searchParams

  return (
    <div className="mx-auto flex max-w-[880px] flex-col gap-1">
      <Link href="/collections" className="mb-3 text-[13px] text-faint hover:text-accent">
        ← 내 컬렉션
      </Link>
      <h1 className="text-[26px] font-extrabold tracking-tight text-ink">새 컬렉션</h1>
      <p className="mb-6 text-sm text-faint">
        지켜보고 싶은 목록 페이지의 주소를 붙여넣으면, 표를 대신 만들어 드려요.
      </p>
      <CreateFlow
        initialUrl={url ?? ''}
        preview={previewCollectionAction}
        create={createCollectionAction}
        suggest={suggestSourcesAction}
      />
    </div>
  )
}
