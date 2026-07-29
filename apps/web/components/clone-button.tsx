'use client'

// "이 컬렉션 복제하기" 버튼 (창작마당 · 델타 §8).
// 성공하면 서버 액션이 새 컬렉션으로 redirect 하므로 여기선 pending 과 실패 문구만 다룬다.

import { useActionState } from 'react'

import { Icon } from '@/components/ui/icon'
import { Button, type ButtonSize, type ButtonVariant } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * 복제 액션의 상태. 액션 상태 타입은 클라이언트 컴포넌트에 두고 서버 액션이 import 한다
 * (이 레포의 ManageState 와 같은 관례) — 'use server' 파일은 async 함수만 내보내야 하므로.
 */
export interface CloneState {
  status: 'idle' | 'problem'
  message: string | null
}

const IDLE: CloneState = { status: 'idle', message: null }

export function CloneButton({
  clone,
  label = '이 컬렉션 복제하기',
  variant = 'primary',
  size = 'md',
  className,
}: {
  clone: (prev: CloneState, formData: FormData) => Promise<CloneState>
  label?: string
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
}) {
  const [state, action, pending] = useActionState(clone, IDLE)

  return (
    <form action={action} className={cn('flex flex-col gap-1.5', className)}>
      <Button type="submit" variant={variant} size={size} disabled={pending}>
        <Icon name={pending ? 'refresh' : 'copy'} size={15} strokeWidth={2.2} className={pending ? 'animate-spin' : undefined} />
        {pending ? '복제하는 중…' : label}
      </Button>
      {state.status === 'problem' && state.message !== null && (
        <span className="text-xs text-attention">{state.message}</span>
      )}
    </form>
  )
}
