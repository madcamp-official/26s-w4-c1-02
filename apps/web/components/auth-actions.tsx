import { signIn, signOut } from '@/auth'
import { Button, type ButtonSize, type ButtonVariant } from '@/components/ui/button'
import { COPY } from '@/lib/labels'

/** 구글 로그인 (P4). 자격증명이 없으면 이 버튼 대신 안내가 뜬다 */
export function SignInForm({
  redirectTo = '/collections',
  size = 'md',
  variant = 'outline',
}: {
  redirectTo?: string
  size?: ButtonSize
  variant?: ButtonVariant
}) {
  return (
    <form
      action={async () => {
        'use server'
        await signIn('google', { redirectTo })
      }}
    >
      <Button type="submit" size={size} variant={variant}>
        {COPY.signIn}
      </Button>
    </form>
  )
}

/** 랜딩 히어로의 큰 CTA — 흰 원 안의 G 가 디자인 시안의 장식이다 */
export function SignInHero({ redirectTo = '/collections' }: { redirectTo?: string }) {
  return (
    <form
      action={async () => {
        'use server'
        await signIn('google', { redirectTo })
      }}
    >
      <button
        type="submit"
        className="inline-flex cursor-pointer items-center gap-2.5 rounded-[10px] bg-accent px-7 py-3.5 text-base font-bold text-accent-ink shadow-[0_2px_8px_rgba(30,86,200,0.25)] transition-colors hover:bg-accent-hover"
      >
        <span
          aria-hidden
          className="flex size-[22px] items-center justify-center rounded-full bg-surface text-[13px] font-extrabold text-ink"
        >
          G
        </span>
        {COPY.signIn}
      </button>
    </form>
  )
}

export function SignOutForm() {
  return (
    <form
      className="shrink-0"
      action={async () => {
        'use server'
        await signOut({ redirectTo: '/' })
      }}
    >
      {/* ghost 는 글자처럼 보여 버튼인 줄 모른다 — 테두리 있는 outline 으로 */}
      <Button type="submit" variant="outline" size="sm">
        {COPY.signOut}
      </Button>
    </form>
  )
}

/** 설정이 덜 됐을 때. 실패가 아니라 안내다 (보장선 B4) */
export function AuthNotice({ className }: { className?: string }) {
  return (
    <p className={className ?? 'rounded-xl border border-border bg-raised px-4 py-3 text-sm text-muted'}>
      {COPY.googleNotConfigured}
    </p>
  )
}
