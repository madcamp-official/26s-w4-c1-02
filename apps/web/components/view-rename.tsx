'use client'

// 뷰 이름 인라인 편집 — 연필을 누르면 제목 자리가 입력칸으로 바뀐다.
// slug 는 안 바뀌므로 표 주소(?view=)와 AI 도구 연결은 그대로다 (renameViewAction 참조).

import Link from 'next/link'
import { useActionState, useEffect, useState } from 'react'

import type { ManageState } from '@/components/collection-manage'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { useActionToast } from '@/components/ui/toast'

const IDLE: ManageState = { status: 'idle', message: null }

export function ViewName({
  viewId,
  name,
  href,
  pinned,
  rename,
}: {
  viewId: string
  name: string
  href: string
  pinned: boolean
  rename: (prev: ManageState, formData: FormData) => Promise<ManageState>
}) {
  const [editing, setEditing] = useState(false)
  const [state, action, pending] = useActionState(rename, IDLE)
  useActionToast(state)

  // 저장이 통과하면 편집을 닫는다 — 새 이름은 서버 되그리기로 내려온다
  useEffect(() => {
    if (state.status === 'done') setEditing(false)
  }, [state])

  if (editing) {
    return (
      <form action={action} className="flex min-w-0 flex-1 items-center gap-1.5">
        <input type="hidden" name="view_id" value={viewId} />
        <input
          name="name"
          defaultValue={name}
          maxLength={60}
          autoFocus
          aria-label="조건 이름"
          className="h-8 min-w-0 flex-1 rounded-lg border-[1.5px] border-border-strong bg-raised px-2.5 text-[13px] text-ink focus:border-accent focus:outline-none"
        />
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          저장
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
          취소
        </Button>
      </form>
    )
  }

  return (
    <span className="flex min-w-0 items-center gap-0.5">
      <Link
        href={href}
        className="truncate text-[14px] font-semibold text-ink hover:text-accent hover:no-underline"
      >
        {pinned && <span aria-hidden>★ </span>}
        {name}
      </Link>
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label="이름 바꾸기"
        className="shrink-0 rounded-md p-1 text-faint hover:text-accent"
      >
        <Icon name="pencil" size={13} strokeWidth={2} />
      </button>
    </span>
  )
}
