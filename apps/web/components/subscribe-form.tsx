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

/** 화면에 그릴 구독 한 줄 */
export interface SubscriptionView {
  id: string
  target: string
  /** 부르는 이름 — 없으면 서버가 호스트로 채워 넘긴다 (subscriptionDisplayName) */
  displayName: string
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
    <section className="flex flex-col gap-2.5 rounded-card border border-border bg-surface px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-[14px] font-bold text-ink">{COPY.subscribeTitle}</h2>
        <span className="text-xs text-faint">{COPY.subscribeSchedule}</span>
      </div>

      <form action={formAction} className="flex w-full flex-col gap-2">
        <div className="flex w-full flex-col gap-2 sm:flex-row">
          <input
            id="subscribe-name"
            name="name"
            type="text"
            maxLength={40}
            aria-label={COPY.subscribeNameLabel}
            placeholder={COPY.subscribeNamePlaceholder}
            className={cn(
              'h-9 min-w-0 rounded-lg border-[1.5px] border-border-strong bg-raised px-3 sm:w-[220px]',
              'text-[13px] text-ink placeholder:text-faint',
              'focus:border-accent focus:outline-2 focus:outline-offset-2 focus:outline-accent',
            )}
          />
          <input
            id="subscribe-target"
            name="target"
            type="text"
            inputMode="url"
            autoComplete="url"
            aria-label={COPY.subscribeTargetLabel}
            placeholder={COPY.subscribePlaceholder}
            className={cn(
              'h-9 min-w-0 flex-1 rounded-lg border-[1.5px] border-border-strong bg-raised px-3',
              'font-mono text-[13px] text-ink placeholder:text-faint',
              'focus:border-accent focus:outline-2 focus:outline-offset-2 focus:outline-accent',
            )}
          />
          <Button type="submit" size="sm" disabled={pending}>
            {COPY.subscribeSubmit}
          </Button>
        </div>
      </form>

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
                <span className="block truncate text-[13px] font-semibold text-ink">
                  {subscription.displayName}
                </span>
                <span className="block truncate font-mono text-xs text-muted">
                  {subscription.target}
                </span>
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
