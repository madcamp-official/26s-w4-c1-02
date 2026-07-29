import Link from 'next/link'
import { notFound } from 'next/navigation'

import { UnavailableState } from '@/components/empty-state'
import { HeroBand } from '@/components/hero-band'
import { Dot } from '@/components/ui/badge'
import { resolveCollectionAccess } from '@/lib/access'
import type { SourceStatus } from '@endpointer/core'

import {
  collectionStatusLine,
  countCollectionItems,
  countHealedThisMonth,
  countItemsByHost,
  getCollectionBySlug,
  listSites,
} from '@/lib/collections'
import {
  SOURCE_STATUS_COPY,
  VISIBILITY_COPY,
  checkedAgoCopy,
  closingCountCopy,
} from '@/lib/labels'
import { forkCreditFor } from '@/lib/gallery'
import { quietSourceLines } from '@/lib/silence'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ slug: string }>
}

// 연결 카드의 행 표기 (원본 EpColDashboard) — 상태 키를 그대로 찍지 않는다 (B2)
const ROW_LABEL: Record<SourceStatus, { label: string; className: string }> = {
  ok: { label: '연결됨', className: 'text-accent' },
  healing: { label: '동기화 중', className: 'text-accent' },
  needs_attention: { label: '확인 필요', className: 'text-faint' },
  paused: { label: '멈춤', className: 'text-faint' },
}

/**
 * 대시보드 (원본 콘솔의 컬렉션 첫 화면) — 인디고 밴드에 큰 지표,
 * 겹쳐 올라온 연결 카드가 사이트별로 얼마나 채웠는지 보여준다.
 */
export default async function CollectionDashboardPage({ params }: PageProps) {
  const { slug } = await params

  const found = await getCollectionBySlug(slug)
  if (!found.ok) return <UnavailableState message={found.message} />
  if (found.data === null) notFound()

  const collection = found.data

  // 주인·멤버가 아니면 없는 것과 같다 (ADR A40)
  const access = await resolveCollectionAccess(collection)
  if (!access.canView) notFound()

  const [sites, healed, status, quiet, itemCount, byHost, forkCredit] = await Promise.all([
    listSites(collection.id),
    countHealedThisMonth(collection.id),
    collectionStatusLine(collection),
    quietSourceLines(collection.id),
    countCollectionItems(collection.id),
    countItemsByHost(collection.id),
    forkCreditFor(collection.id),
  ])
  const origin = forkCredit.ok ? forkCredit.data : null
  const quietList = quiet.ok ? quiet.data : []
  const siteList = sites.ok ? sites.data : []
  const healedCount = healed.ok ? healed.data : 0
  const items = itemCount.ok ? itemCount.data : 0
  const newCount = status.ok ? status.data.new_count : 0
  const hostCounts = byHost.ok ? byHost.data : {}
  const troubled = siteList.filter((s) => s.status === 'healing' || s.status === 'needs_attention')

  // 상단 상태 줄 (델타 4-3) — 확인시각 · 마감 · 침묵 감지
  const numberFormat = new Intl.NumberFormat('ko-KR')
  const statusParts = status.ok
    ? [checkedAgoCopy(status.data.last_ok_at), closingCountCopy(status.data.closing_count)].filter(
        (part): part is string => part !== null,
      )
    : []

  const statusLine =
    statusParts.length > 0 || quietList.length > 0 ? (
      <>
        {statusParts.map((part, index) => (
          <span key={part}>
            {index > 0 && <span className="text-white/40"> · </span>}
            {part.startsWith('마감') ? (
              <span className="font-semibold text-[oklch(0.9_0.09_75)]">{part}</span>
            ) : (
              part
            )}
          </span>
        ))}
        {quietList.map((line) => (
          <span key={line.host}>
            {statusParts.length > 0 && <span className="text-white/40"> · </span>}
            <span className="font-semibold text-[oklch(0.9_0.09_75)]" title={line.sentence}>
              ⚠ {line.short}
            </span>
          </span>
        ))}
      </>
    ) : null

  return (
    <HeroBand
      dense
      title={
        <>
          <h1 className="text-[22px] font-bold tracking-[-0.03em] text-white">{collection.name}</h1>
          <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11.5px] font-semibold text-white/90">
            {VISIBILITY_COPY[collection.visibility]}
          </span>
        </>
      }
      status={statusLine}
      metrics={[
        { label: '항목', value: numberFormat.format(items) },
        { label: '새 항목', value: numberFormat.format(newCount) },
        { label: '자동 복구', value: `${healedCount}회` },
      ]}
      action={
        !access.canManage ? (
          <span className="rounded-full bg-white/15 px-3 py-1.5 text-[12.5px] font-semibold text-white/90">
            함께 보는 중 · 읽기만
          </span>
        ) : undefined
      }
    >
      {/* 복제로 생긴 컬렉션이면 원본 크레딧 + "내 사이트를 더하라"는 다음 걸음 (델타 §8) */}
      {origin !== null && access.canManage && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-accent-soft bg-accent-soft/40 px-5 py-3.5">
          <p className="text-[13px] text-ink">
            {origin.visible ? (
              <Link href={`/gallery/${origin.slug}`} className="font-semibold text-accent">
                {origin.name}
              </Link>
            ) : (
              <b className="font-semibold text-ink">{origin.name}</b>
            )}
            <span className="text-muted"> ({origin.author} 님) 에서 복제했어요.</span>
          </p>
          <Link
            href={`/collections/${collection.slug}/attach`}
            className="text-[13px] font-semibold text-accent hover:no-underline"
          >
            내가 아는 사이트 더하기 →
          </Link>
        </div>
      )}

      {/* 연결 카드 (원본 EpColDashboard) — 사이트별로 얼마나 채웠는지 */}
      <section className="rounded-card border border-divider bg-surface px-7 pt-2.5 pb-4 shadow-[0_4px_20px_oklch(0.2_0.02_277/0.10)]">
        <div className="flex items-center justify-between py-3">
          <span className="text-[15px] font-semibold text-ink">연결</span>
          <span className="font-mono text-[12px] text-faint">
            GET /api/v1/{collection.slug} → {siteList.length} sources
          </span>
        </div>
        {siteList.length === 0 ? (
          <p className="pb-2 text-sm text-muted">
            아직 붙은 사이트가 없어요.{' '}
            <Link href={`/collections/${collection.slug}/attach`} className="font-semibold text-accent">
              사이트를 붙이면
            </Link>{' '}
            표가 채워지기 시작해요.
          </p>
        ) : (
          siteList.map((site, index) => {
            const row = ROW_LABEL[site.status]
            const count = hostCounts[site.host]
            return (
              <div
                key={site.id}
                className={cn(
                  'flex items-center gap-3.5 py-3.5',
                  index < siteList.length - 1 && 'border-b border-divider',
                )}
                title={SOURCE_STATUS_COPY[site.status].sentence}
              >
                {site.status === 'needs_attention' ? (
                  <span aria-hidden className="size-[9px] rounded-full border-2 border-border-strong" />
                ) : (
                  <span
                    aria-hidden
                    className={cn(
                      'size-[9px] rounded-full bg-accent',
                      site.status === 'healing' && 'animate-pulse opacity-50',
                      site.status === 'paused' && 'bg-border-strong',
                    )}
                  />
                )}
                <span className="flex-1 font-mono text-[13px] font-medium text-ink">{site.host}</span>
                <span className="font-mono text-[12px] text-faint">
                  {site.status === 'needs_attention' ? '—' : numberFormat.format(count ?? 0)}
                </span>
                <span className={cn('w-[70px] text-right text-[12.5px] font-semibold', row.className)}>
                  {row.label}
                </span>
              </div>
            )
          })
        )}
      </section>

      {/* 아픈 사이트는 배너로 — 빨간 에러가 아니라 사람 문장 (보장선 B4) */}
      {troubled.map((site) => {
        const copy = SOURCE_STATUS_COPY[site.status]
        return (
          <div
            key={site.id}
            className={cn(
              'flex items-center gap-3 rounded-xl border px-5 py-3.5 text-[13.5px]',
              site.status === 'healing'
                ? 'border-healing-line bg-healing-soft text-healing-deep'
                : 'border-attention/30 bg-attention-soft text-attention',
            )}
          >
            <Dot
              className={cn(
                'shrink-0',
                site.status === 'healing' ? 'animate-pulse bg-healing' : 'bg-attention',
              )}
            />
            <span>
              <b className="font-mono font-semibold">{site.host}</b> — {copy.sentence}
            </span>
          </div>
        )
      })}
    </HeroBand>
  )
}
