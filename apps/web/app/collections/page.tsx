import Link from 'next/link'

import { currentUser, isAuthReady } from '@/auth'
import { AuthNotice, SignInForm } from '@/components/auth-actions'
import { EmptyState, UnavailableState } from '@/components/empty-state'
import { Badge } from '@/components/ui/badge'
import { UrlPasteForm } from '@/components/url-paste-form'
import { listCollections } from '@/lib/collections'
import { VISIBILITY_COPY, coverageCopy } from '@/lib/labels'

// 로그인 상태와 저장된 내용에 따라 매번 달라진다
export const dynamic = 'force-dynamic'

export default async function CollectionsPage() {
  const user = await currentUser()

  // 로그인이 실제로 붙어 있는데 아직 안 들어온 사람 — 목록을 보여주지 않는다
  if (isAuthReady && user === null) {
    return (
      <div className="flex flex-col gap-4 pt-6">
        <h1 className="text-2xl font-semibold text-ink">내 컬렉션</h1>
        <p className="text-sm text-muted">로그인하면 만들어 둔 표가 여기에 쌓입니다.</p>
        <SignInForm redirectTo="/collections" />
      </div>
    )
  }

  const result = await listCollections(user?.id ?? null)

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2 pt-2">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">내 컬렉션</h1>
        <p className="text-sm text-muted">
          여기 있는 표 하나하나가 여러 사이트를 한 형식으로 모아둔 결과예요.
        </p>
      </header>

      {!isAuthReady && <AuthNotice />}

      {!result.ok ? (
        <UnavailableState message={result.message} />
      ) : result.data.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* 목록이 있어도 새로 만드는 길이 항상 위에 있다 (기획서 2장) */}
          <UrlPasteForm className="max-w-2xl" />

          <ul className="grid gap-3 sm:grid-cols-2">
            {result.data.map((collection) => (
              <li key={collection.id}>
                <Link
                  href={`/collections/${collection.slug}`}
                  className="flex h-full flex-col gap-2 rounded-card border border-border bg-surface p-4 transition-colors hover:border-border-strong"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-semibold text-ink">{collection.name}</span>
                    <Badge tone="neutral">{VISIBILITY_COPY[collection.visibility]}</Badge>
                  </span>
                  <span className="text-xs text-muted">
                    {coverageCopy(collection.site_count, collection.item_count)}
                  </span>
                  <span className="font-mono text-xs text-faint">/{collection.slug}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
