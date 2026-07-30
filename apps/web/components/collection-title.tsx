import type { Visibility } from '@endpointer/core'

import { VISIBILITY_COPY } from '@/lib/labels'

/**
 * 밴드 제목 + 공개범위 알약. 컬렉션의 모든 탭이 같은 제목 줄을 쓴다 —
 * 한 탭에서만 배지가 빠지면 "여기선 공개가 아닌가?"로 읽힌다.
 */
export function CollectionTitle({ name, visibility }: { name: string; visibility: Visibility }) {
  return (
    <>
      <h1 className="text-[22px] font-bold tracking-[-0.03em] text-white">{name}</h1>
      <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11.5px] font-semibold text-white/90">
        {VISIBILITY_COPY[visibility]}
      </span>
    </>
  )
}
