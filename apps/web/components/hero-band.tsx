import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

// 원본 콘솔의 EpBand 를 그대로 이식 — 인디고 밴드 + 다이아몬드 모티프 + 큰 mono 지표.
// root main 은 패딩이 없으므로 밴드가 사이드바를 제외한 전폭을 그대로 가로지른다.
// 패딩 값은 원본 Chrome.jsx 수치: 기본 34/40/84 · dense 28/40/72 · overlap 시 children -48px.

export interface BandMetric {
  label: string
  value: string
}

export function HeroBand({
  title,
  sub,
  status,
  action,
  metrics,
  children,
  overlap = true,
  dense = false,
}: {
  title: ReactNode
  sub?: ReactNode
  /** 밴드 안 상태 줄 (원본 status) — sub 아래 흰 반투명 텍스트 */
  status?: ReactNode
  action?: ReactNode
  metrics?: BandMetric[]
  children?: ReactNode
  /** 자식을 밴드 위로 겹쳐 올릴지 */
  overlap?: boolean
  /** 상세 화면용 얇은 밴드 */
  dense?: boolean
}) {
  return (
    <div>
      <div
        className={cn(
          'relative overflow-hidden bg-accent text-white',
          'px-5 md:px-10',
          dense ? 'pt-7' : 'pt-[34px]',
          overlap ? (dense ? 'pb-[72px]' : 'pb-[84px]') : dense ? 'pb-7' : 'pb-9',
        )}
      >
        <img
          src="/diamond-motif.svg"
          alt=""
          aria-hidden
          className="pointer-events-none absolute -top-10 right-8 hidden h-[280px] opacity-25 sm:block"
        />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              {typeof title === 'string' ? (
                <h1
                  className={cn(
                    'font-bold tracking-[-0.03em] text-white',
                    dense ? 'text-[22px]' : 'text-[26px]',
                  )}
                >
                  {title}
                </h1>
              ) : (
                title
              )}
            </div>
            {sub && <p className="mt-1.5 text-[13px] text-white/72">{sub}</p>}
            {status && (
              <div className="mt-3 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[12.5px] text-white/85">
                {status}
              </div>
            )}
            {metrics && metrics.length > 0 && (
              <div className="mt-[22px] flex flex-wrap gap-x-14 gap-y-3">
                {metrics.map((m) => (
                  <div key={m.label}>
                    <div className="text-[12px] font-medium text-white/65">{m.label}</div>
                    <div className="font-mono text-[34px] leading-tight font-semibold tracking-[-0.01em] text-white">
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
          <div className="relative z-[1] -mt-12 flex flex-col gap-5 px-5 pb-10 md:px-10">
            {children}
          </div>
        ) : (
          <div className="flex flex-col gap-5 px-5 pt-7 pb-10 md:px-10">{children}</div>
        ))}
    </div>
  )
}
