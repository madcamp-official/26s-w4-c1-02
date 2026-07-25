import type { SourceStatus } from '@endpointer/core'

import { Badge, Dot } from '@/components/ui/badge'
import { SOURCE_STATUS_COPY } from '@/lib/labels'

/**
 * 사이트 상태 알약 (보장선 B4).
 * 색으로 먼저 읽히고, 글자는 사람 말이며, 자세한 사정은 마우스를 올리면 한 문장으로 나온다.
 */
export function StatusPill({ status, className }: { status: SourceStatus; className?: string }) {
  const copy = SOURCE_STATUS_COPY[status]
  return (
    <Badge tone={copy.tone} className={className}>
      <Dot />
      <span title={copy.sentence}>{copy.short}</span>
    </Badge>
  )
}

/** 알약 + 문장을 한 줄로. 상세 화면 상단의 커버리지 줄에서 쓴다 */
export function StatusLine({ status }: { status: SourceStatus }) {
  const copy = SOURCE_STATUS_COPY[status]
  return (
    <span className="flex flex-wrap items-center gap-2">
      <StatusPill status={status} />
      <span className="text-xs text-muted">{copy.sentence}</span>
    </span>
  )
}
