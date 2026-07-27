'use client'

import { useActionState } from 'react'

import { Button } from '@/components/ui/button'
import { COPY } from '@/lib/labels'
import { cn } from '@/lib/utils'

// 상태 타입이 lib/subscriptions.ts 가 아니라 여기 있는 이유: 저 파일은 lib/db.ts 를 물고
// 있어서 클라이언트 컴포넌트가 import 하면 postgres 가 브라우저 번들로 딸려 온다 (db.ts 규칙).

/** 구독 폼의 서버 액션 결과. 클라이언트는 이 상태만 보고 문구를 고른다 */
export interface SubscribeState {
  status: 'idle' | 'done' | 'exists' | 'problem'
  message: string | null
}

const SUBSCRIBE_IDLE: SubscribeState = { status: 'idle', message: null }

/** 화면에 그릴 구독 한 줄. 시각 문구는 서버에서 만들어 넘긴다 (시간대가 흔들리지 않게) */
export interface SubscriptionView {
  id: string
  target: string
  sentCopy: string
}

/**
 * 새 항목 받아보기 (기획서 9-4 · G3 트랙 B).
 * 사용자가 입력하는 것은 받을 주소 하나뿐이다 — 필터·주기는 기본값으로 저장되고,
 * 신규 항목만 골라 보내는 일은 워커의 발송 잡이 한다.
 */
export function SubscribeForm({
  subscribe,
  stop,
  subscriptions,
}: {
  subscribe: (prev: SubscribeState, formData: FormData) => Promise<SubscribeState>
  stop: (formData: FormData) => Promise<void>
  subscriptions: SubscriptionView[]
}) {
  const [state, formAction, pending] = useActionState(subscribe, SUBSCRIBE_IDLE)

  return (
    <section className="flex flex-col gap-4 rounded-card border border-border bg-surface px-7 py-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-bold text-ink">{COPY.subscribeTitle}</h2>
        <p className="text-[13px] text-faint">{COPY.subscribeBody}</p>
      </div>

      <label
        htmlFor="subscribe-target"
        className="-mb-2 text-[13px] font-bold text-muted"
      >
        {COPY.subscribeTargetLabel}
      </label>
      <form action={formAction} className="flex w-full flex-col gap-2 sm:flex-row">
        <input
          id="subscribe-target"
          name="target"
          type="text"
          inputMode="url"
          autoComplete="url"
          placeholder={COPY.subscribePlaceholder}
          className={cn(
            'h-11 min-w-0 flex-1 rounded-[9px] border-[1.5px] border-border-strong bg-raised px-3.5',
            'font-mono text-[13.5px] text-ink placeholder:text-faint',
            'focus:border-accent focus:outline-2 focus:outline-offset-2 focus:outline-accent',
          )}
        />
        <Button type="submit" disabled={pending}>
          {COPY.subscribeSubmit}
        </Button>
      </form>
      <p className="-mt-1 text-xs text-faint">{COPY.subscribeSchedule}</p>

      {state.message !== null && (
        <p
          className={cn(
            'rounded-[10px] px-4 py-3 text-[13.5px]',
            state.status === 'problem'
              ? 'bg-attention-soft text-attention'
              : 'border border-ok-line bg-ok-soft font-semibold text-ok',
          )}
        >
          {state.message}
        </p>
      )}

      {subscriptions.length > 0 && (
        <ul className="flex flex-col divide-y divide-border">
          {subscriptions.map((subscription) => (
            <li key={subscription.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-xs text-ink">
                  {subscription.target}
                </span>
                <span className="block text-xs text-faint">{subscription.sentCopy}</span>
              </span>
              <form action={stop}>
                <input type="hidden" name="subscription" value={subscription.id} />
                <Button type="submit" variant="ghost" size="sm">
                  {COPY.subscribeStop}
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
