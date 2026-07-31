import Link from 'next/link'
import { notFound } from 'next/navigation'

import { UnavailableState } from '@/components/empty-state'
import { CollectionTitle } from '@/components/collection-title'
import { HeroBand } from '@/components/hero-band'
import { RepairForm } from '@/components/repair-form'
import { HostChip } from '@/components/ui/host-chip'
import { Icon } from '@/components/ui/icon'
import { resolveCollectionAccess } from '@/lib/access'
import { countHealedThisMonth, getCollectionBySlug, listSites } from '@/lib/collections'
import { FIELD_TYPE_HINT, SOURCE_STATUS_COPY, checkedAgoCopy, healedCopy } from '@/lib/labels'
import { cn } from '@/lib/utils'

import { repairSourceFieldAction } from '../repair-actions'

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

  // 고칠 수 있는 칸 — 링크는 조건도 수리도 말이 안 되므로 뺀다 (core 의 FIELD_OPS 와 같은 판단).
  // 화면에는 한국어 라벨만 나간다 (B1: 타입 코드를 타이핑하게 하지 않는다 · B2)
  const repairableFields = collection.schema_json
    .filter((field) => field.type !== 'link')
    .map((field) => ({ key: field.key, label: field.label }))

  return (
    <HeroBand
      dense
      overlap={false}
      title={<CollectionTitle name={collection.name} visibility={collection.visibility} />}
      sub="소스"
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
                  'py-3',
                  index < siteList.length - 1 && 'border-b border-divider',
                )}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
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
                  <span className="ml-auto text-xs text-faint">
                    {checkedAgoCopy(site.last_ok_at)}
                  </span>
                </div>

                {/* 스스로 못 고친 사이트에는 다음 걸음을 준다 — 값을 붙여넣으면 시스템이 역추적한다 (B1).
                    지금까지 화면은 "확인이 필요합니다" 에서 끝났고, 사용자가 할 수 있는 일이 없었다. */}
                {site.status === 'needs_attention' && (
                  <RepairForm
                    sourceId={site.id}
                    host={site.host}
                    fields={repairableFields}
                    repair={repairSourceFieldAction.bind(null, collection.slug)}
                  />
                )}
              </div>
            )
          })
        )}
      </section>

      {/* 표에 붙는 값 — 알약 무더기가 아니라 실제 표의 머리글처럼 (열 이름 + 값 종류) */}
      <section className="rounded-card border border-divider bg-surface p-5 shadow-[0_4px_20px_oklch(0.2_0.02_277/0.10)]">
        <h2 className="mb-3 text-[15px] font-semibold text-ink">표에 붙는 값</h2>
        <div className="scroll-x rounded-[10px] border border-border">
          <div className="flex min-w-max divide-x divide-divider bg-canvas">
            {collection.schema_json.map((field) => (
              <div key={field.key} className="flex min-w-[112px] flex-col gap-0.5 px-4 py-2.5">
                <span className="text-[13px] font-semibold whitespace-nowrap text-ink">
                  {field.label}
                </span>
                <span className="text-[11px] text-faint">{FIELD_TYPE_HINT[field.type]}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="mt-2.5 text-[12.5px] text-faint">
          어느 사이트에서 오든 같은 열, 같은 형태로 맞춰 담아요.
        </p>
      </section>
    </HeroBand>
  )
}
