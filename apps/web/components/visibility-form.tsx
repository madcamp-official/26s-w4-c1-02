'use client'

import { useActionState } from 'react'

import type { ManageState } from '@/components/collection-manage'
import { Button } from '@/components/ui/button'
import { useActionToast } from '@/components/ui/toast'

const IDLE: ManageState = { status: 'idle', message: null }

// 값 순서는 조심스러운 쪽부터 (원본 Settings 의 공개범위 셀렉트). 설명 없이 이름만 — 짧게
const OPTIONS = [
  { value: 'private', label: '비공개' },
  { value: 'unlisted', label: '주소를 아는 사람' },
  { value: 'public', label: '전체공개' },
] as const

/** 공개범위 한 줄 폼 — 고르고 저장. API 인증도 이 값을 따라간다 */
export function VisibilityForm({
  current,
  save,
}: {
  current: string
  save: (prev: ManageState, formData: FormData) => Promise<ManageState>
}) {
  const [state, action, pending] = useActionState(save, IDLE)
  useActionToast(state)

  return (
    <form action={action} className="flex flex-wrap items-center gap-2.5">
      <select
        name="visibility"
        defaultValue={current}
        className="h-9 max-w-[320px] flex-1 rounded-lg border-[1.5px] border-border-strong bg-raised px-3 text-sm text-ink focus:border-accent focus:outline-none"
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        저장
      </Button>
    </form>
  )
}
