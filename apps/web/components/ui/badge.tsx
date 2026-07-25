import type { ReactNode } from 'react'

import type { Tone } from '@/lib/labels'
import { cn } from '@/lib/utils'

const TONE: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok',
  healing: 'bg-healing-soft text-healing',
  attention: 'bg-attention-soft text-attention',
  paused: 'bg-paused-soft text-paused',
  accent: 'bg-accent-soft text-accent',
  neutral: 'bg-raised text-muted',
}

export interface BadgeProps {
  tone?: Tone
  className?: string
  children: ReactNode
}

/** 알약 하나. 색으로 먼저 읽히고, 글자는 사람 말이다 (보장선 B4) */
export function Badge({ tone = 'neutral', className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap',
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

/** 알약 앞의 점. 색맹 대비가 아니라 시선 유도용이라 크기를 작게 둔다 */
export function Dot({ className }: { className?: string }) {
  return <span aria-hidden className={cn('size-1.5 rounded-full bg-current', className)} />
}
