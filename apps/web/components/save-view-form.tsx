'use client'

import { useState } from 'react'
import { useActionState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface SaveViewState {
  status: 'idle' | 'problem'
  message: string | null
}

const SAVE_IDLE: SaveViewState = { status: 'idle', message: null }

/**
 * "이 조건 저장" (델타 2-10). 결과를 보면서 정의하므로 빈 뷰를 만들 일이 없다.
 * 이름은 조건에서 자동 제안되고, 사용자는 고치기만 한다 (B3 와 같은 정신).
 */
export function SaveViewForm({
  conditionsJson,
  summary,
  suggestedName,
  save,
}: {
  conditionsJson: string
  summary: string
  suggestedName: string
  save: (prev: SaveViewState, formData: FormData) => Promise<SaveViewState>
}) {
  const [state, formAction, pending] = useActionState(save, SAVE_IDLE)
  const [name, setName] = useState(suggestedName)

  return (
    <form
      action={formAction}
      className="flex flex-wrap items-center gap-2.5 rounded-xl border border-accent-line bg-accent-soft px-4 py-3"
    >
      <input type="hidden" name="conditions" value={conditionsJson} />
      <span className="text-[13px] font-semibold text-brand">지금 조건: {summary}</span>
      <label htmlFor="save-view-name" className="sr-only">
        저장할 이름
      </label>
      <input
        id="save-view-name"
        name="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className={cn(
          'h-9 min-w-0 flex-1 rounded-lg border-[1.5px] border-accent-line bg-surface px-3',
          'text-[13px] font-semibold text-ink focus:border-accent focus:outline-none',
        )}
      />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? '저장하는 중…' : '이 조건 저장'}
      </Button>
      {state.status === 'problem' && state.message !== null && (
        <p className="w-full text-[13px] text-attention">{state.message}</p>
      )}
    </form>
  )
}
