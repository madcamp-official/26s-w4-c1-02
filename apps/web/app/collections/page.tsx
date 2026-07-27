import Link from 'next/link'

import { currentUser, isAuthReady } from '@/auth'
import { AuthNotice, SignInForm } from '@/components/auth-actions'
import { UnavailableState } from '@/components/empty-state'
import { Badge, Dot } from '@/components/ui/badge'
import { UrlPasteForm } from '@/components/url-paste-form'
import { listCollections, type CollectionSummary } from '@/lib/collections'
import { cardStatusCopy, healedCopy } from '@/lib/labels'

// 로그인 상태와 저장된 내용에 따라 매번 달라진다
export const dynamic = 'force-dynamic'

const UPDATED_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  month: 'long',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Asia/Seoul',
})

function CollectionCard({ collection }: { collection: CollectionSummary }) {
  const status = cardStatusCopy(collection.healing_count, collection.attention_count)

  return (
    <Link
      href={`/collections/${collection.slug}`}
      className="flex h-full flex-col rounded-card border border-border bg-surface p-6 transition-[border-color,box-shadow] hover:border-accent hover:no-underline hover:shadow-[0_4px_14px_rgba(30,86,200,0.12)]"
    >
      <div className="mb-3.5 flex items-start justify-between gap-3">
        <span className="text-[17px] font-bold tracking-tight text-ink">{collection.name}</span>
        <Badge tone={status.tone} className="shrink-0 font-semibold">
          <Dot className={status.tone === 'healing' ? 'animate-pulse' : undefined} />
          <span title={status.sentence}>{status.short}</span>
        </Badge>
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {collection.hosts.map((host) => (
          <span
            key={host}
            className="rounded-md bg-canvas px-2 py-0.5 font-mono text-xs text-muted"
          >
            {host}
          </span>
        ))}
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-divider pt-3.5 text-[13px] text-faint">
        <span>
          <b className="font-bold text-ink">{collection.item_count}</b> 항목
        </span>
        {collection.new_count > 0 && (
          <span>
            <b className="font-bold text-accent">{collection.new_count}</b> 새 항목
          </span>
        )}
        <span>{healedCopy(collection.healed_count)}</span>
        {collection.last_ok_at !== null && (
          <span className="ml-auto">{UPDATED_FORMAT.format(collection.last_ok_at)} 갱신</span>
        )}
      </div>
    </Link>
  )
}

export default async function CollectionsPage() {
  const user = await currentUser()

  // 로그인이 실제로 붙어 있는데 아직 안 들어온 사람 — 목록을 보여주지 않는다
  if (isAuthReady && user === null) {
    return (
      <div className="flex flex-col gap-4 pt-6">
        <h1 className="text-[26px] font-extrabold tracking-tight text-ink">내 컬렉션</h1>
        <p className="text-sm text-muted">로그인하면 만들어 둔 표가 여기에 쌓입니다.</p>
        <SignInForm redirectTo="/collections" variant="primary" size="lg" />
      </div>
    )
  }

  const result = await listCollections(user?.id ?? null)

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1.5 pt-2">
        <h1 className="text-[26px] font-extrabold tracking-tight text-ink">내 컬렉션</h1>
        <p className="text-sm text-faint">지켜보고 있는 주제들이에요 — 매일 알아서 갱신돼요</p>
      </header>

      {!isAuthReady && <AuthNotice />}

      {!result.ok ? (
        <UnavailableState message={result.message} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {result.data.map((collection) => (
            <CollectionCard key={collection.id} collection={collection} />
          ))}

          {/* 새로 만드는 길이 항상 목록과 나란히 있다 (기획서 2장 · 보장선 B1) */}
          <div className="flex min-h-[170px] flex-col justify-center gap-2 rounded-card border-[1.5px] border-dashed border-border-strong bg-transparent p-6 transition-colors hover:border-accent hover:bg-raised">
            <div className="text-sm font-semibold text-faint">새 컬렉션 만들기</div>
            <div className="text-xs text-faint">URL 하나면 시작할 수 있어요</div>
            <UrlPasteForm className="mt-2" />
          </div>
        </div>
      )}
    </div>
  )
}
