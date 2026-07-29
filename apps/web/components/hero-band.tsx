import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

// 원본 콘솔의 EpBand — 인디고 밴드 위 흰 제목 + 다이아몬드 모티프 + 큰 mono 지표.
// children 은 밴드 아래로 겹쳐 올라온다(overlap). root main 의 좌우·상단 패딩을 음수 마진으로
// 상쇄해 콘텐츠 영역 가장자리까지 꽉 채운다(-mx-6 md:-mx-10 / -mt-8).

export interface BandMetric {
  label: string
  value: string
}

export function HeroBand({
  title,
  sub,
  action,
  metrics,
  children,
  overlap = true,
}: {
  title: ReactNode
  sub?: ReactNode
  action?: ReactNode
  metrics?: BandMetric[]
  children?: ReactNode
  /** 자식을 밴드 위로 겹쳐 올릴지 */
  overlap?: boolean
}) {
  return (
    <div className="-mx-6 -mt-8 md:-mx-10">
      <div
        className={cn(
          'relative overflow-hidden bg-accent px-6 pt-7 text-white md:px-10',
          overlap ? 'pb-20' : 'pb-7',
        )}
      >
        <img
          src="/diamond-motif.svg"
          alt=""
          aria-hidden
          className="pointer-events-none absolute -top-10 right-8 hidden h-[280px] opacity-25 sm:block"
        />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">{title}</div>
            {sub && <div className="mt-1.5 text-[13px] text-white/75">{sub}</div>}
            {metrics && metrics.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-x-14 gap-y-3">
                {metrics.map((m) => (
                  <div key={m.label}>
                    <div className="text-[12px] font-medium text-white/65">{m.label}</div>
                    <div className="font-mono text-[32px] leading-tight font-semibold tracking-[-0.01em] text-white">
                      {m.value}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </div>
      </div>

      {children &&
        (overlap ? (
          <div className="relative z-[1] -mt-12 px-6 md:px-10">{children}</div>
        ) : (
          <div className="px-6 pt-6 md:px-10">{children}</div>
        ))}
    </div>
  )
}
