'use client'

// "값 붙여넣어 다시 맞추기" — 자가 치유가 실패한 사이트에서 사용자가 직접 고치는 길 (보장선 B1).
//
// 사용자가 하는 일은 둘뿐이다: **어느 칸인지 고르기**(한국어 라벨 드롭다운) + **값 붙여넣기**.
// 셀렉터·경로·타입 코드를 입력받는 칸은 없다 — 있으면 그 자체로 B1 위반이다.

import { useActionState } from 'react'

import type { ManageState } from '@/components/collection-manage'
import { Button } from '@/components/ui/button'
import { useActionToast } from '@/components/ui/toast'

const IDLE: ManageState = { status: 'idle', message: null }

export interface RepairFieldOption {
  key: string
  label: string
}

export function RepairForm({
  sourceId,
  host,
  fields,
  repair,
}: {
  sourceId: string
  host: string
  fields: RepairFieldOption[]
  repair: (prev: ManageState, formData: FormData) => Promise<ManageState>
}) {
  const [state, action, pending] = useActionState(repair, IDLE)
  useActionToast(state)

  if (fields.length === 0) return null

  return (
    <form action={action} className="mt-2.5 flex flex-col gap-2 rounded-[10px] border border-border bg-raised px-4 py-3.5">
      <input type="hidden" name="source_id" value={sourceId} />
      <p className="text-[12.5px] break-keep text-muted">
        <b className="font-semibold text-ink">{host}</b> 에서 값을 하나 복사해 붙여넣어 주세요. 그
        값이 있는 자리를 찾아 이 칸을 다시 맞춰요.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          name="key"
          defaultValue={fields[0]?.key}
          className="h-9 rounded-lg border border-border-strong bg-surface px-2.5 text-[13px] text-ink focus:border-accent focus:outline-none"
        >
          {fields.map((field) => (
            <option key={field.key} value={field.key}>
              {field.label}
            </option>
          ))}
        </select>
        <input
          name="value"
          required
          maxLength={200}
          placeholder="목록에 보이는 값 (예: 2026/7/28)"
          className="h-9 min-w-[220px] flex-1 rounded-lg border border-border-strong bg-surface px-3 text-[13px] text-ink placeholder:text-faint focus:border-accent focus:outline-none"
        />
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? '맞춰보는 중…' : '다시 맞추기'}
        </Button>
      </div>
    </form>
  )
}
