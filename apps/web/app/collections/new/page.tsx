import { CreateFlow } from '@/components/create-flow'
import { HeroBand } from '@/components/hero-band'

import { createCollectionAction, previewCollectionAction, suggestSourcesAction } from './actions'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ url?: string }>
}

/** 새 컬렉션 (기획서 9-1). 첫 화면·목록의 주소 입력이 여기로 모인다 */
export default async function NewCollectionPage({ searchParams }: PageProps) {
  const { url } = await searchParams

  return (
    <HeroBand title="새 컬렉션" sub="페이지를 붙여넣으면, 표가 되어 돌아와요">
      <div className="w-full max-w-[1100px]">
        <CreateFlow
          initialUrl={url ?? ''}
          preview={previewCollectionAction}
          create={createCollectionAction}
          suggest={suggestSourcesAction}
        />
      </div>
    </HeroBand>
  )
}
