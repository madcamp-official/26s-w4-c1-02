import Link from 'next/link'
import { notFound } from 'next/navigation'

import { UnavailableState } from '@/components/empty-state'
import { HeroBand } from '@/components/hero-band'
import { HostChip } from '@/components/ui/host-chip'
import { Icon } from '@/components/ui/icon'
import { resolveCollectionAccess } from '@/lib/access'
import { countHealedThisMonth, getCollectionBySlug, listSites } from '@/lib/collections'
import { FIELD_TYPE_HINT, SOURCE_STATUS_COPY, checkedAgoCopy, healedCopy } from '@/lib/labels'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ slug: string }>
}

/**
 * 소스 (원본 SourcesCare — 옛 작업실에서 분리).
 * 붙어 있는 사이트들 — 문제는 스스로 고치고, 여기엔 결과만 문장으로 쌓인다 (기능 ④).
 */
export default async function CollectionSourcesPage({ params }: PageProps) {
  const { slug } = await params

  const found = await getCollectionBySlug(slug)
  if (!found.ok) return <UnavailableState message={found.message} />
  if (found.data === null) notFound()

  const collection = found.data

  // 소스 관리는 관리 표면이다 (ADR A40)
  const access = await resolveCollectionAccess(collection)
  if (!access.canManage) notFound()

  const [sites, healed] = await Promise.all([
    listSites(collection.id),
    countHealedThisMonth(collection.id),
  ])
  const siteList = sites.ok ? sites.data : []
  const healedCount = healed.ok ? healed.data : 0

  return (
    <HeroBand
      dense
      overlap={false}
      title="소스"
      sub="붙어 있는 사이트들 — 문제는 스스로 고치고, 결과만 알려요"
    >
      {/* 사이트 상태 */}
      <section className="rounded-card border border-divider bg-surface p-5 shadow-[0_4px_20px_oklch(0.2_0.02_277/0.10)]">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2.5">
          <span className="inline-flex items-center gap-2.5 text-[15px] font-semibold text-ink">
            사이트 상태
            {healedCount > 0 && (
              <span className="text-[12.5px] font-normal text-faint">
                {healedCopy(healedCount)} — 손 안 대도 됐어요
              </span>
            )}
          </span>
          <Link
            href={`/collections/${collection.slug}/attach`}
            className="inline-flex items-center gap-1.5 rounded-[10px] border-[1.5px] border-accent px-3.5 py-1.5 text-[13px] font-bold text-accent hover:bg-accent-soft hover:no-underline"
          >
            <Icon name="plus" size={14} strokeWidth={2.2} />
            사이트 붙이기
          </Link>
        </div>

        {siteList.length === 0 ? (
          <p className="py-3 text-sm text-muted">아직 붙은 사이트가 없어요.</p>
        ) : (
          siteList.map((site, index) => {
            const copy = SOURCE_STATUS_COPY[site.status]
            return (
              <div
                key={site.id}
                className={cn(
                  'flex flex-wrap items-center gap-x-3 gap-y-1 py-3',
                  index < siteList.length - 1 && 'border-b border-divider',
                )}
              >
                <HostChip host={site.host} status={site.status} />
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 text-[12.5px] font-medium',
                    site.status === 'ok'
                      ? 'text-ok'
                      : site.status === 'healing'
                        ? 'text-accent'
                        : 'text-healing',
                  )}
                >
                  {copy.sentence}
                </span>
                <span className="ml-auto text-xs text-faint">{checkedAgoCopy(site.last_ok_at)}</span>
              </div>
            )
          })
        )}
      </section>

      {/* 표에 붙는 값 — 이 표의 열과 값 형태 (원본 SourcesCare 두 번째 패널) */}
      <section className="rounded-card border border-divider bg-surface p-4 shadow-[0_4px_20px_oklch(0.2_0.02_277/0.10)]">
        <h2 className="mb-3 text-[15px] font-semibold text-ink">표에 붙는 값</h2>
        <div className="flex flex-wrap gap-1.5">
          {collection.schema_json.map((field) => (
            <span
              key={field.key}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-raised px-3 py-1 text-[12px] font-medium text-muted"
            >
              {field.label}
              <span className="text-[11px] text-faint">{FIELD_TYPE_HINT[field.type]}</span>
            </span>
          ))}
        </div>
        <p className="mt-2.5 text-[12.5px] text-faint">
          어느 사이트에서 오든 같은 열, 같은 형태로 맞춰 담아요 — 날짜는 날짜답게, 금액은 금액답게.
        </p>
      </section>
    </HeroBand>
  )
}
