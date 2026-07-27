import { CopyButton } from '@/components/copy-button'
import { COPY } from '@/lib/labels'

/**
 * 보장선 B5·B7 — **개발자를 위한 것은 빼는 게 아니라 접는다.**
 * 기본은 접혀 있고, 펼치면 주소가 언제든 보인다. 숨겨서 못 찾게 해도 위반이다.
 * mcpUrl 을 주지 않으면 API 부분만 그린다 (MCP 는 '연결' 탭이 담당).
 */
export function DeveloperDetails({ apiUrl, mcpUrl }: { apiUrl: string; mcpUrl?: string }) {
  return (
    <details className="group rounded-card border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-5 py-3.5 text-[13.5px] font-semibold text-muted select-none hover:text-accent">
        <span className="inline-block text-[11px] transition-transform group-open:rotate-90">▸</span>
        {COPY.developerSummary}
        <span className="ml-auto hidden text-xs font-normal text-faint sm:inline">
          표에서 건 필터가 그대로 쿼리가 돼요
        </span>
      </summary>

      <div className="flex flex-col gap-5 border-t border-divider px-5 py-4">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-muted">{COPY.apiLabel}</span>
          <div className="flex flex-wrap items-center gap-2">
            <code className="scroll-x rounded-lg bg-brand px-4 py-3 font-mono text-xs text-accent-line">
              <span className="text-accent-line/70">GET</span> {apiUrl}
            </code>
            <CopyButton value={apiUrl} />
          </div>
          <p className="text-xs leading-relaxed text-faint">
            응답에는 <code className="font-mono">items · sources · schema_version</code> 이 항상 함께
            와요 — 사이트 하나가 아파도 나머지는 정상 응답이에요.
            <br />
            범위 <code className="font-mono">?deadline_gte=2026-08-01</code> · 정렬{' '}
            <code className="font-mono">?sort=-amount</code> · 신규만{' '}
            <code className="font-mono">?since=2026-07-20</code>
          </p>
        </div>

        {mcpUrl !== undefined && (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-muted">{COPY.mcpLabel}</span>
            <p className="text-xs text-faint">{COPY.mcpHelp}</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="scroll-x rounded-lg bg-raised px-3 py-2 font-mono text-xs text-ink">
                {mcpUrl}
              </code>
              <CopyButton value={mcpUrl} label="주소 복사" />
            </div>
          </div>
        )}
      </div>
    </details>
  )
}
