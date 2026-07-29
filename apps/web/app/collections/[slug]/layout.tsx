import Link from 'next/link'
import type { ReactNode } from 'react'

import { CollectionManage } from '@/components/collection-manage'
import { CollectionTabs } from '@/components/collection-tabs'
import { Dot } from '@/components/ui/badge'
import { resolveCollectionAccess } from '@/lib/access'
import {
  collectionStatusLine,
  countHealedThisMonth,
  getCollectionBySlug,
  listSites,
} from '@/lib/collections'
import {
  SOURCE_STATUS_COPY,
  VISIBILITY_COPY,
  checkedAgoCopy,
  closingCountCopy,
  healedCopy,
  newCountCopy,
} from '@/lib/labels'
import { quietSourceLines } from '@/lib/silence'
import { cn } from '@/lib/utils'

import { deleteCollectionAction, renameCollectionAction } from './actions'

/**
 * 컬렉션 셸 — 제목·사이트 상태·탭이 네 화면(표/읽기 피드/구독/연결)에 공통이다.
 * 커버리지가 내용보다 위에 있다: 부분 성공이 정상 상태다 (원칙 ④).
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
  const [sites, healed, status, quiet] = await Promise.all([
    listSites(collection.id),
    countHealedThisMonth(collection.id),
    collectionStatusLine(collection),
    quietSourceLines(collection.id),
  ])
  const quietList = quiet.ok ? quiet.data : []
  const siteList = sites.ok ? sites.data : []
  const healedCount = healed.ok ? healed.data : 0
  const troubled = siteList.filter((s) => s.status === 'healing' || s.status === 'needs_attention')

  // 상단 상태 줄 (델타 4-3) — 있는 것만 이어붙인다. 침묵 감지(⚠)는 워커가 판정을 주면 붙는다
  const statusParts = status.ok
    ? [
        checkedAgoCopy(status.data.last_ok_at),
        newCountCopy(status.data.new_count),
        closingCountCopy(status.data.closing_count),
      ].filter((part): part is string => part !== null)
    : []

  return (
    <div className="flex flex-col gap-0">
      <div className="mb-1.5 text-[13px] text-faint">
        <Link href="/collections" className="hover:text-accent">
          내 컬렉션
        </Link>
        <span> / {collection.name}</span>
      </div>

      {/* 브랜드 밴드 (원본 EpBand) — 인디고 위 흰 제목 + 다이아몬드 모티프. 콘솔의 시그니처 모먼트 */}
      <div className="relative mb-5 overflow-hidden rounded-2xl bg-accent px-6 py-5 text-white sm:px-7 sm:py-6">
        <img
          src="/diamond-motif.svg"
          alt=""
          aria-hidden
          className="pointer-events-none absolute -top-12 right-6 hidden h-[260px] opacity-25 sm:block"
        />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-[26px] font-bold tracking-[-0.03em] text-white">
                {collection.name}
              </h1>
              <span className="rounded-full bg-white/15 px-2.5 py-1 text-[12px] font-semibold text-white/90">
                {VISIBILITY_COPY[collection.visibility]}
              </span>
              {healedCount > 0 && (
                <span className="rounded-full bg-white/15 px-2.5 py-1 text-[12px] font-semibold text-white/90">
                  {healedCopy(healedCount)}
                </span>
              )}
            </div>

            {(statusParts.length > 0 || quietList.length > 0) && (
              <p className="mt-2.5 text-[13px] text-white/75">
                {statusParts.map((part, index) => (
                  <span key={part}>
                    {index > 0 && <span className="text-white/40"> · </span>}
                    {part.startsWith('마감') ? (
                      <span className="font-semibold text-[oklch(0.9_0.09_75)]">{part}</span>
                    ) : part.startsWith('새 항목') ? (
                      <span className="font-semibold text-white">{part}</span>
                    ) : (
                      part
                    )}
                  </span>
                ))}
                {/* 침묵 경고 (델타 4-3) — 관찰만 말한다. 판정 정본은 워커 silence 잡 */}
                {quietList.map((line) => (
                  <span key={line.host}>
                    <span className="text-white/40"> · </span>
                    <span
                      className="font-semibold text-[oklch(0.9_0.09_75)]"
                      title={line.sentence}
                    >
                      ⚠ {line.short}
                    </span>
                  </span>
                ))}
              </p>
            )}
          </div>

          {/* 기능 ② 의 입구 — 소스가 늘수록 커버리지가 좋아진다 (델타 2-9). 주인만 본다 (A40) */}
          <div className="flex shrink-0 items-center gap-2">
            {access.canManage ? (
              <>
                <Link
                  href={`/collections/${collection.slug}/attach`}
                  className="rounded-[10px] bg-white px-4 py-2 text-[13px] font-bold text-accent hover:bg-white/90 hover:no-underline"
                >
                  + 사이트 붙이기
                </Link>
                <CollectionManage
                  name={collection.name}
                  rename={renameCollectionAction.bind(null, collection.slug)}
                  remove={deleteCollectionAction.bind(null, collection.slug)}
                />
              </>
            ) : (
              <span className="rounded-full bg-white/15 px-3 py-1.5 text-[12.5px] font-semibold text-white/90">
                함께 보는 중 · 읽기만
              </span>
            )}
          </div>
        </div>
      </div>

      {siteList.length > 0 && (
        <div className="mt-3.5 flex flex-wrap gap-2">
          {siteList.map((site) => {
            const copy = SOURCE_STATUS_COPY[site.status]
            return (
              <span
                key={site.id}
                title={copy.sentence}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-[12.5px] font-semibold text-muted"
              >
                <Dot
                  className={cn(
                    site.status === 'ok' && 'bg-ok',
                    site.status === 'healing' && 'animate-pulse bg-healing',
                    site.status === 'needs_attention' && 'bg-attention',
                    site.status === 'paused' && 'bg-paused',
                  )}
                />
                <span className="font-mono">{site.host}</span>
                <span
                  className={cn(
                    site.status === 'ok' && 'text-ok',
                    site.status === 'healing' && 'text-healing',
                    site.status === 'needs_attention' && 'text-attention',
                    site.status === 'paused' && 'text-paused',
                  )}
                >
                  {copy.short}
                </span>
              </span>
            )
          })}
        </div>
      )}

      {/* 아픈 사이트는 배너로 — 빨간 에러가 아니라 사람 문장 (보장선 B4) */}
      {troubled.map((site) => {
        const copy = SOURCE_STATUS_COPY[site.status]
        return (
          <div
            key={site.id}
            className={cn(
              'mt-3 flex items-center gap-3 rounded-xl border px-5 py-3.5 text-[13.5px]',
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

      <div className="mt-6 mb-6">
        <CollectionTabs slug={collection.slug} manage={access.canManage} />
      </div>

      {children}
    </div>
  )
}
