'use client'

import { useState } from 'react'
import { useActionState } from 'react'

import { Button } from '@/components/ui/button'
import { useActionToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

export interface ManageState {
  status: 'idle' | 'done' | 'problem'
  message: string | null
}

const MANAGE_IDLE: ManageState = { status: 'idle', message: null }

/** 이름 바꾸기 폼 (원본 Settings 의 이름 패널 내용) */
export function RenameForm({
  name,
  rename,
}: {
  name: string
  rename: (prev: ManageState, formData: FormData) => Promise<ManageState>
}) {
  const [state, action, pending] = useActionState(rename, MANAGE_IDLE)
  useActionToast(state)

  return (
    <form action={action} className="flex flex-wrap items-center gap-2.5">
      <input
        name="name"
        defaultValue={name}
        aria-label="컬렉션 이름"
        className={cn(
          'h-9 max-w-[340px] flex-1 rounded-lg border-[1.5px] border-border-strong bg-raised px-3 text-sm text-ink',
          'focus:border-accent focus:outline-none',
        )}
      />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        저장
      </Button>
    </form>
  )
}

/**
 * 지우기 (원본 Settings 의 위험 구역) — 컬렉션 이름을 그대로 적어야 지워진다.
 * 표·뷰·주소·AI 연결이 모두 사라지므로 실수 한 번으로는 못 지운다.
 */
export function DeleteZone({
  name,
  remove,
}: {
  name: string
  remove: (formData: FormData) => Promise<void>
}) {
  const [confirming, setConfirming] = useState(false)
  const [typed, setTyped] = useState('')

  if (!confirming) {
    return (
      <div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-attention"
          onClick={() => setConfirming(true)}
        >
          이 컬렉션 지우기
        </Button>
      </div>
    )
  }

  return (
    <div className="flex max-w-[420px] flex-col gap-2.5">
      <p className="text-[13px] text-muted">
        정말 지우려면 컬렉션 이름(<b className="font-semibold text-ink">{name}</b>)을 그대로 적어
        주세요. 표·뷰·주소·AI 연결이 모두 사라져요.
      </p>
      <input
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        placeholder={name}
        aria-label="컬렉션 이름 확인"
        className="h-9 rounded-lg border-[1.5px] border-border-strong bg-raised px-3 text-sm text-ink focus:border-attention focus:outline-none"
      />
      <div className="flex gap-2">
        <form action={remove}>
          <Button
            type="submit"
            size="sm"
            disabled={typed !== name}
            className="bg-attention text-white hover:bg-attention/90 disabled:opacity-40"
          >
            영구 삭제
          </Button>
        </form>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setConfirming(false)
            setTyped('')
          }}
        >
          그만두기
        </Button>
      </div>
    </div>
  )
}
