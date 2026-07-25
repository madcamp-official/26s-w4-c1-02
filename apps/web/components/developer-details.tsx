import { CopyButton } from '@/components/copy-button'
import { COPY } from '@/lib/labels'

/**
 * 보장선 B5·B7 — **개발자를 위한 것은 빼는 게 아니라 접는다.**
 * 기본은 접혀 있고, 펼치면 주소가 언제든 보인다. 숨겨서 못 찾게 해도 위반이다.
 */
export function DeveloperDetails({ apiUrl, mcpUrl }: { apiUrl: string; mcpUrl: string }) {
  return (
    <details className="group rounded-card border border-border bg-surface">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-muted select-none hover:text-ink">
        <span className="mr-2 inline-block transition-transform group-open:rotate-90">›</span>
        {COPY.developerSummary}
      </summary>

      <div className="flex flex-col gap-5 border-t border-border px-4 py-4">
        <p className="text-xs text-faint">{COPY.developerNote}</p>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-muted">{COPY.apiLabel}</span>
          <div className="flex flex-wrap items-center gap-2">
            <code className="scroll-x rounded-lg bg-raised px-3 py-2 font-mono text-xs text-ink">
              GET {apiUrl}
            </code>
            <CopyButton value={apiUrl} />
          </div>
        </div>

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
      </div>
    </details>
  )
}
