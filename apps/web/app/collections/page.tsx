import Link from 'next/link'

import { currentUser, isAuthReady } from '@/auth'
import { AuthNotice, SignInForm } from '@/components/auth-actions'
import { UnavailableState } from '@/components/empty-state'
import { HeroBand } from '@/components/hero-band'
import { Icon, type IconName } from '@/components/ui/icon'
import { listCollections, type CollectionSummary } from '@/lib/collections'
import { cardStatusCopy, healedCopy, type Tone } from '@/lib/labels'
import { cn } from '@/lib/utils'

// 카드 우상단 상태 — 텍스트 배지가 아니라 Lucide 아이콘 (원본 EpStatusPill)
const STATUS_ICON: Record<string, { icon: IconName; color: string; spin?: boolean }> = {
  ok: { icon: 'check-circle', color: 'text-ok' },
  healing: { icon: 'refresh', color: 'text-accent', spin: true },
  attention: { icon: 'alert-triangle', color: 'text-healing' },
}

function StatusIcon({ tone, label }: { tone: Tone; label: string }) {
  const s = STATUS_ICON[tone] ?? STATUS_ICON['ok']!
  return (
    <span title={label} className={cn('shrink-0', s.color)}>
      <Icon name={s.icon} size={17} strokeWidth={2} className={s.spin ? 'animate-spin' : undefined} />
    </span>
  )
}

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
        <span className="text-[15px] font-semibold tracking-tight text-ink">{collection.name}</span>
        <StatusIcon tone={status.tone} label={status.sentence} />
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {collection.hosts.map((host) => (
          <span
            key={host}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-0.5 font-mono text-[11.5px] text-muted"
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
  const list = result.ok ? result.data : []
  const normalCount = list.filter((c) => c.healing_count === 0 && c.attention_count === 0).length

  return (
    <HeroBand
      title={<h1 className="text-[26px] font-bold tracking-[-0.03em] text-white">내 컬렉션</h1>}
      sub={`${list.length}개 컬렉션 · 정상 ${normalCount}`}
      action={
        <Link
          href="/collections/new"
          className="inline-flex items-center gap-1.5 rounded-[10px] bg-white px-4 py-2 text-[13px] font-bold text-accent hover:bg-white/90 hover:no-underline"
        >
          <Icon name="plus" size={15} strokeWidth={2.2} />새 컬렉션
        </Link>
      }
    >
      {!isAuthReady && (
        <div className="mb-4">
          <AuthNotice />
        </div>
      )}

      {!result.ok ? (
        <UnavailableState message={result.message} />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {result.data.map((collection) => (
            <CollectionCard key={collection.id} collection={collection} />
          ))}

          {/* 새로 만드는 길이 항상 목록과 나란히 있다 (기획서 2장 · 보장선 B1) */}
          <Link
            href="/collections/new"
            className="flex min-h-[150px] flex-col items-center justify-center gap-2 rounded-card border-[1.5px] border-dashed border-border-strong bg-surface p-6 text-center transition-colors hover:border-accent hover:bg-raised hover:no-underline"
          >
            <Icon name="plus" size={20} className="text-muted" />
            <div className="text-[13.5px] font-semibold text-muted">새 컬렉션 만들기</div>
            <div className="text-xs text-faint">URL을 붙여넣거나, 말로 찾아요</div>
          </Link>
        </div>
      )}
    </HeroBand>
  )
}
