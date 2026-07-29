import Link from 'next/link'

import { CloneButton } from '@/components/clone-button'
import { UnavailableState } from '@/components/empty-state'
import { HeroBand } from '@/components/hero-band'
import { HostChip } from '@/components/ui/host-chip'
import { Icon } from '@/components/ui/icon'
import { listGalleryCollections, type GalleryCollection } from '@/lib/gallery'

import { cloneCollectionAction } from './actions'

// 전시 목록·복제수는 매번 달라진다
export const dynamic = 'force-dynamic'

const UPDATED_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  month: 'long',
  day: 'numeric',
  timeZone: 'Asia/Seoul',
})

function GalleryCard({ collection }: { collection: GalleryCollection }) {
  return (
    <div className="flex h-full flex-col rounded-card border border-border bg-surface p-6 transition-[border-color,box-shadow] hover:border-accent hover:shadow-[0_4px_14px_rgba(30,86,200,0.12)]">
      {/* 이름 → 공개 상세로. 표를 미리 보고 복제할지 정한다 */}
      <Link
        href={`/gallery/${collection.slug}`}
        className="mb-1 text-[15px] font-semibold tracking-tight text-ink hover:text-accent hover:no-underline"
      >
        {collection.name}
      </Link>
      <div className="mb-3.5 text-[12.5px] text-faint">
        {collection.author} 님이 만듦
        {collection.fork_count > 0 && (
          <>
            {' · '}
            <b className="font-semibold text-accent">복제 {collection.fork_count}회</b>
          </>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {collection.hosts.slice(0, 5).map((host) => (
          <HostChip key={host} host={host} />
        ))}
        {collection.hosts.length > 5 && (
          <span className="text-[12px] text-faint">+{collection.hosts.length - 5}</span>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-divider pt-3.5 text-[13px] text-faint">
        <span>
          <b className="font-bold text-ink">{collection.item_count}</b> 항목
        </span>
        <span>
          사이트 <b className="font-bold text-ink">{collection.site_count}</b>
        </span>
        <span className="ml-auto">{UPDATED_FORMAT.format(collection.updated_at)} 갱신</span>
      </div>

      {/* 복제 = 내 것으로 가져오기. 성공하면 새 컬렉션으로 바로 이동한다 (델타 §8) */}
      <div className="mt-auto">
        <CloneButton
          clone={cloneCollectionAction.bind(null, collection.slug)}
          size="sm"
          variant="outline"
          className="w-full"
        />
      </div>
    </div>
  )
}

export default async function GalleryPage() {
  const result = await listGalleryCollections()

  return (
    <HeroBand
      title={<h1 className="text-[26px] font-bold tracking-[-0.03em] text-white">모두의 컬렉션</h1>}
      sub="다른 사람이 만든 표를 복제해 내 것으로 — 여기에 내가 아는 사이트를 더하면 나만의 카테고리가 됩니다"
    >
      {!result.ok ? (
        <UnavailableState message={result.message} />
      ) : result.data.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-card border-[1.5px] border-dashed border-border-strong bg-surface px-6 py-16 text-center">
          <Icon name="sparkles" size={24} className="text-muted" />
          <div className="text-[14px] font-semibold text-muted">아직 올라온 컬렉션이 없어요</div>
          <p className="max-w-sm text-[13px] text-faint">
            컬렉션 설정에서 <b className="font-semibold text-ink">공개</b>로 바꾼 뒤{' '}
            <b className="font-semibold text-ink">모두의 컬렉션에 올리기</b>를 켜면 여기에 나타납니다.
          </p>
          <Link
            href="/collections"
            className="mt-1 inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent hover:no-underline"
          >
            내 컬렉션으로
          </Link>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {result.data.map((collection) => (
            <GalleryCard key={collection.id} collection={collection} />
          ))}
        </div>
      )}
    </HeroBand>
  )
}
