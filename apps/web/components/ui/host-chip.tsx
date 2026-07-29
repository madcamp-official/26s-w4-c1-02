import { Icon, type IconName } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

// 원본 콘솔의 EpHostChip — 상태별 색 + Lucide 아이콘이 붙은 컴팩트 mono 칩.
// 사이트 상태: ok(초록 체크) · healing(파랑 새로고침, 회전) · needs_attention(앰버 경고) · paused/기본(회색).

const STYLE: Record<string, { cls: string; icon?: IconName; spin?: boolean }> = {
  ok: { cls: 'border-ok-line bg-ok-soft text-ok', icon: 'check-circle' },
  healing: { cls: 'border-accent-line bg-accent-soft text-accent', icon: 'refresh', spin: true },
  needs_attention: { cls: 'border-healing-line bg-healing-soft text-healing', icon: 'alert-triangle' },
  paused: { cls: 'border-border bg-raised text-faint' },
}

export function HostChip({
  host,
  status,
  title,
}: {
  host: string
  status?: string
  title?: string
}) {
  const s = (status && STYLE[status]) || { cls: 'border-border bg-surface text-muted' }
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11.5px] whitespace-nowrap',
        s.cls,
      )}
    >
      {s.icon && (
        <Icon
          name={s.icon}
          size={11}
          strokeWidth={2.2}
          className={s.spin ? 'animate-spin' : undefined}
        />
      )}
      {host}
    </span>
  )
}
