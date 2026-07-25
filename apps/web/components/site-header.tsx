import Link from 'next/link'

import { currentUser, isAuthReady } from '@/auth'
import { SignInForm, SignOutForm } from '@/components/auth-actions'

/** 전역 셸의 윗줄. 사용자가 배우는 명사는 "컬렉션" 하나뿐이다 (보장선 B2) */
export async function SiteHeader() {
  const user = await currentUser()

  return (
    <header className="border-b border-border bg-surface/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
        <Link href="/" className="text-base font-semibold tracking-tight text-ink">
          endpointer
        </Link>
        <span className="hidden text-xs text-faint sm:inline">아무 목록 페이지나 내 표로</span>

        <nav className="ml-auto flex items-center gap-3">
          <Link href="/collections" className="text-sm text-muted hover:text-ink">
            내 컬렉션
          </Link>
          {user ? (
            <>
              <span className="hidden text-sm text-muted sm:inline">{user.name ?? '내 계정'}</span>
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
