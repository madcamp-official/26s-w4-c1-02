import Link from 'next/link'

import { currentUser, isAuthReady } from '@/auth'
import { SignInForm, SignOutForm } from '@/components/auth-actions'

/** 전역 셸의 윗줄. 사용자가 배우는 명사는 "컬렉션" 하나뿐이다 (보장선 B2) */
export async function SiteHeader() {
  const user = await currentUser()

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-surface">
      <div className="mx-auto flex h-[58px] w-full max-w-[1080px] items-center gap-7 px-6">
        <Link
          href="/"
          className="text-[17px] font-extrabold tracking-tight text-brand hover:no-underline"
        >
          endpointer
        </Link>
        <Link href="/collections" className="text-sm font-semibold text-ink hover:text-accent">
          내 컬렉션
        </Link>

        <nav className="ml-auto flex items-center gap-3">
          {user ? (
            <>
              <span className="hidden text-[13px] text-faint sm:inline">
                {user.name ?? '내 계정'}
              </span>
              <span
                aria-hidden
                className="flex size-8 items-center justify-center rounded-full bg-accent text-[13px] font-bold text-accent-ink"
              >
                {(user.name ?? '나').slice(0, 1)}
              </span>
              <SignOutForm />
            </>
          ) : (
            isAuthReady && <SignInForm />
          )}
        </nav>
      </div>
    </header>
  )
}
