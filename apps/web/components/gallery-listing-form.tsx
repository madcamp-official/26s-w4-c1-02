'use client'

// 창작마당 전시 토글 (델타 §8). 켜면 공개 컬렉션이 창작마당 목록에 올라간다.
// 전시하려면 공개여야 한다 — 공개가 아니면 켜기를 막고 이유를 문장으로 낸다.

import { useActionState } from 'react'

import type { ManageState } from '@/components/collection-manage'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const IDLE: ManageState = { status: 'idle', message: null }

export function GalleryListingForm({
  listed,
  isPublic,
  save,
}: {
  listed: boolean
  isPublic: boolean
  save: (prev: ManageState, formData: FormData) => Promise<ManageState>
}) {
  const [state, action, pending] = useActionState(save, IDLE)

  return (
    <form action={action} className="flex flex-col gap-2">
      <label className="flex items-center gap-2.5 text-sm text-ink">
        <input
          type="checkbox"
          name="listed"
          defaultChecked={listed}
          disabled={!isPublic || pending}
          className="size-4 rounded border-border-strong text-accent focus:ring-accent disabled:opacity-40"
        />
        <span className={cn(!isPublic && 'text-faint')}>창작마당에 전시하기</span>
      </label>

      {!isPublic ? (
        <p className="text-[12.5px] text-faint">먼저 공개로 바꾸면 전시할 수 있어요.</p>
      ) : (
        <p className="text-[12.5px] text-faint">
          다른 사람이 이 표를 복제해 자기 것으로 가져갈 수 있어요.
        </p>
      )}

      <div className="flex items-center gap-2.5">
        <Button type="submit" size="sm" variant="outline" disabled={!isPublic || pending}>
          저장
        </Button>
        {state.message !== null && (
          <span className={cn('text-xs', state.status === 'problem' ? 'text-attention' : 'text-ok')}>
            {state.message}
          </span>
        )}
      </div>
    </form>
  )
}
