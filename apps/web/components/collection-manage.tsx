'use client'

import { useState } from 'react'
import { useActionState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface ManageState {
  status: 'idle' | 'done' | 'problem'
  message: string | null
}

const MANAGE_IDLE: ManageState = { status: 'idle', message: null }

/**
 * 컬렉션 관리 — 이름 변경과 삭제. 접혀 있다가 필요할 때만 열린다.
 * 삭제는 두 번 눌러야 한다 (한 번에 지워지는 실수를 막는 최소 장치).
 */
export function CollectionManage({
  name,
  rename,
  remove,
}: {
  name: string
  rename: (prev: ManageState, formData: FormData) => Promise<ManageState>
  remove: (formData: FormData) => Promise<void>
}) {
  const [renameState, renameAction, renamePending] = useActionState(rename, MANAGE_IDLE)
  const [confirming, setConfirming] = useState(false)

  return (
    <details className="group relative">
      <summary className="cursor-pointer list-none rounded-lg border border-border bg-surface px-3.5 py-2 text-[13px] font-semibold text-muted select-none hover:border-accent hover:text-accent">
        관리
      </summary>

      <div className="absolute right-0 z-20 mt-2 flex w-[300px] flex-col gap-4 rounded-card border border-border bg-surface p-4 shadow-[0_8px_24px_rgba(35,48,63,0.12)]">
        <form action={renameAction} className="flex flex-col gap-2">
          <label htmlFor="manage-name" className="text-xs font-bold text-muted">
            컬렉션 이름
          </label>
          <input
            id="manage-name"
            name="name"
            defaultValue={name}
            className={cn(
              'h-9 rounded-lg border-[1.5px] border-border-strong bg-raised px-3 text-sm text-ink',
              'focus:border-accent focus:outline-none',
            )}
          />
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" variant="outline" disabled={renamePending}>
              이름 바꾸기
            </Button>
            {renameState.message !== null && (
              <span
                className={cn(
                  'text-xs',
                  renameState.status === 'problem' ? 'text-attention' : 'text-ok',
                )}
              >
                {renameState.message}
              </span>
            )}
          </div>
        </form>

        <div className="flex flex-col gap-2 border-t border-divider pt-3">
          {confirming ? (
            <>
              <p className="text-xs text-attention">
                정말 지울까요? 담긴 항목과 받아보기 설정까지 전부 지워지고, 되돌릴 수 없어요.
              </p>
              <div className="flex gap-2">
                <form action={remove}>
                  <Button
                    type="submit"
                    size="sm"
                    className="bg-attention text-white hover:bg-attention/90"
                  >
                    네, 지울게요
                  </Button>
                </form>
                <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                  아니요
                </Button>
              </div>
            </>
          ) : (
            <div>
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(true)}>
                이 컬렉션 지우기
              </Button>
            </div>
          )}
        </div>
      </div>
    </details>
  )
}
