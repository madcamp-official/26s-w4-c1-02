import type { SourceSummary } from '@endpointer/core'

import { StatusPill } from '@/components/status-pill'
import { Badge } from '@/components/ui/badge'
import { SOURCE_STATUS_COPY, healedCopy } from '@/lib/labels'
import type { SiteRecord } from '@/lib/collections'

/**
 * 커버리지 줄 (기획서 7장④ · 5장 신뢰 계층).
 * "몇 곳 중 몇 곳이 잘 되고 있는지" 가 표보다 위에 있어야 부분 성공이 정상 상태로 읽힌다.
 * 아래의 자동 복구 횟수는 5장④ — 조용히 고치지 않고 쌓아서 보여준다.
 */
export function SourceCoverage({
  sites,
  summaries,
  healedThisMonth,
}: {
  sites: readonly SiteRecord[]
  summaries: Record<string, SourceSummary>
  healedThisMonth: number
}) {
  if (sites.length === 0) {
    return (
      <p className="text-sm text-muted">아직 이 표에 붙여둔 사이트가 없어요.</p>
    )
  }

  const healthy = sites.filter((s) => s.status === 'ok').length

  return (
    <section aria-label="사이트별 상태" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-ink">
          사이트 {sites.length}곳 중 {healthy}곳이 잘 되고 있어요
        </span>
        <Badge tone={healedThisMonth > 0 ? 'accent' : 'neutral'}>{healedCopy(healedThisMonth)}</Badge>
      </div>

      <ul className="flex flex-col gap-2">
        {sites.map((site) => {
          const summary = summaries[site.host]
          const copy = SOURCE_STATUS_COPY[site.status]
          return (
            <li
              key={site.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-surface px-3 py-2"
            >
              <span className="font-mono text-xs text-muted">{site.host}</span>
              <StatusPill status={site.status} />
              <span className="text-xs text-muted">항목 {summary?.items ?? 0}개</span>
              {summary?.age && (
                <span className="text-xs text-healing">마지막으로 받아둔 내용 · {summary.age} 전</span>
              )}
              <span className="w-full text-xs text-faint sm:w-auto sm:flex-1">{copy.sentence}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
