'use client'

// 읽기 피드의 절 바로가기 칩 — 누른 쪽이 진해지고(toggle), 해당 절로 스크롤한다.
// 앵커 링크로는 눌린 상태를 표현할 수 없어 클라이언트 상태로 든다.

import { useState } from 'react'

import { COPY } from '@/lib/labels'
import { cn } from '@/lib/utils'

type SectionId = 'fresh' | 'closing'

export function FeedSectionChips({
  freshCount,
  closingCount,
}: {
  freshCount: number
  /** 날짜 필드가 없으면 마감 절 자체가 없다 — null 이면 칩을 그리지 않는다 */
  closingCount: number | null
}) {
  const [active, setActive] = useState<SectionId>('fresh')

  const go = (id: SectionId) => {
    setActive(id)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const chipClass = (id: SectionId) =>
    cn(
      'rounded-full border px-4 py-2 text-[13.5px] font-bold transition-colors',
      active === id
        ? 'border-accent bg-accent text-accent-ink'
        : 'border-border bg-surface text-muted hover:border-accent hover:text-accent',
    )

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => go('fresh')} className={chipClass('fresh')}>
        {COPY.feedFreshTitle} {freshCount}
      </button>
      {closingCount !== null && (
        <button type="button" onClick={() => go('closing')} className={chipClass('closing')}>
          {COPY.feedClosingTitle} {closingCount}
        </button>
      )}
    </div>
  )
}
