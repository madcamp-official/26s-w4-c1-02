'use client'

import { useActionState } from 'react'

import { Button } from '@/components/ui/button'
import { useActionToast } from '@/components/ui/toast'
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

/** 화면에 그릴 받을 곳 한 줄 */
export interface SubscriptionView {
  id: string
  target: string
  /** 부르는 이름 — 없으면 서버가 호스트로 채워 넘긴다 (subscriptionDisplayName) */
  displayName: string
  /** 체크 — 꺼진 주소로는 아무것도 안 간다 */
  enabled: boolean
}

/**
 * 알림 받을 곳 (07-30 개편 — 컬렉션 단위 주소록).
 * 주소를 등록해 두고 체크로 켜고 끈다. 알림을 켠 조건(뷰)에 새 항목이 들어오면
 * 체크된 주소 전부로 나간다 — 어느 뷰가 어디로 보낼지 고르는 단계는 없다.
 */
export function SubscribeForm({
  subscribe,
  stop,
  toggle,
  subscriptions,
}: {
  subscribe: (prev: SubscribeState, formData: FormData) => Promise<SubscribeState>
  stop: (formData: FormData) => Promise<void>
  toggle: (formData: FormData) => Promise<void>
  subscriptions: SubscriptionView[]
}) {
  const [state, formAction, pending] = useActionState(subscribe, SUBSCRIBE_IDLE)
  // 결과는 오른쪽 위 팝업으로. 등록 성공('done')은 목록에 바로 보이므로 알림까지 띄우지 않는다
  useActionToast(state, ['done'])

  const inputClass = cn(
    'h-9 min-w-0 rounded-lg border-[1.5px] border-border-strong bg-raised px-3',
    'text-[13px] text-ink placeholder:text-faint',
    'focus:border-accent focus:outline-2 focus:outline-offset-2 focus:outline-accent',
  )

  return (
    <section className="flex flex-col gap-2.5 rounded-card border border-border bg-surface px-4 py-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-[14px] font-bold text-ink">{COPY.subscribeTitle}</h2>
        <p className="text-xs leading-relaxed text-muted">{COPY.subscribeBody}</p>
      </div>

      {subscriptions.length > 0 && (
        <ul className="flex flex-col divide-y divide-border">
          {subscriptions.map((subscription) => (
            <li key={subscription.id} className="flex items-center gap-2.5 py-2">
              {/* 체크 = 이 주소로 보낸다. key 로 되그리기해서 서버 상태와 어긋나지 않게 */}
              <form action={toggle} key={subscription.enabled ? 'on' : 'off'} className="flex">
                <input type="hidden" name="subscription" value={subscription.id} />
                <input type="hidden" name="enabled" value={subscription.enabled ? 'off' : 'on'} />
                <input
                  type="checkbox"
                  defaultChecked={subscription.enabled}
                  onChange={(e) => e.currentTarget.form?.requestSubmit()}
                  aria-label={`${subscription.displayName}(으)로 보내기`}
                  className="size-4 cursor-pointer accent-accent"
                />
              </form>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    'block truncate text-[13px] font-semibold',
                    subscription.enabled ? 'text-ink' : 'text-faint',
                  )}
                >
                  {subscription.displayName}
                </span>
                <span className="block truncate font-mono text-[11px] text-faint">
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

      <form action={formAction} className="flex w-full flex-col gap-2 border-t border-divider pt-2.5">
        <input
          id="subscribe-name"
          name="name"
          type="text"
          maxLength={40}
          aria-label={COPY.subscribeNameLabel}
          placeholder={COPY.subscribeNamePlaceholder}
          className={inputClass}
        />
        <input
          id="subscribe-target"
          name="target"
          type="text"
          inputMode="url"
          autoComplete="url"
          aria-label={COPY.subscribeTargetLabel}
          placeholder={COPY.subscribePlaceholder}
          className={cn(inputClass, 'font-mono')}
        />
        <Button type="submit" size="sm" disabled={pending}>
          {COPY.subscribeSubmit}
        </Button>
      </form>
    </section>
  )
}
