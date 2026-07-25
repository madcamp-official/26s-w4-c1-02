import { signIn, signOut } from '@/auth'
import { Button } from '@/components/ui/button'
import { COPY } from '@/lib/labels'

/** 구글 로그인 (P4). 자격증명이 없으면 이 버튼 대신 안내가 뜬다 */
export function SignInForm({ redirectTo = '/collections' }: { redirectTo?: string }) {
  return (
    <form
      action={async () => {
        'use server'
        await signIn('google', { redirectTo })
      }}
    >
      <Button type="submit" size="lg">
        {COPY.signIn}
      </Button>
    </form>
  )
}

export function SignOutForm() {
  return (
    <form
      action={async () => {
        'use server'
        await signOut({ redirectTo: '/' })
      }}
    >
      <Button type="submit" variant="ghost" size="sm">
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
