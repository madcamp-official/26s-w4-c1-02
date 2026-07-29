import type { Metadata, Viewport } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { currentUser, isAuthReady } from '@/auth'
import { AppSidebar } from '@/components/app-sidebar'
import { SignInForm, SignOutForm } from '@/components/auth-actions'

import './globals.css'

export const metadata: Metadata = {
  title: 'Endpointer — 아무 목록 페이지나 내 표로',
  description:
    '목록이 있는 페이지 주소를 붙여넣으면 표가 됩니다. 여러 사이트를 붙여도 하나의 표에 같은 형식으로 담깁니다.',
}

export const viewport: Viewport = {
  themeColor: '#f4edda',
}

/**
 * 폰트: Pretendard Variable(한글·UI) + JetBrains Mono(경로·키·숫자) 를 CDN <link> 로 받는다.
 * next/font 를 쓰지 않는 이유는 빌드 때 외부 네트워크에 의존하게 되기 때문 — <link> 는
 * 런타임 로드라 빌드가 안 깨지고, CDN 이 죽어도 globals.css 의 시스템 폰트 스택으로 떨어진다.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await currentUser()

  // 로그인/로그아웃 영역은 서버 컴포넌트라 사이드바(클라이언트)에 노드로 주입한다
  const authSlot: ReactNode = user ? (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-[13px] font-semibold text-accent-ink"
      >
        {(user.name ?? '나').slice(0, 1)}
      </span>
      <div className="-ml-0.5 flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[12.5px] font-medium text-ink">{user.name ?? '내 계정'}</span>
        <div className="-ml-2 -mt-0.5">
          <SignOutForm />
        </div>
      </div>
    </div>
  ) : isAuthReady ? (
    <SignInForm />
  ) : null

  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap"
        />
      </head>
      <body className="min-h-dvh">
        <div className="flex min-h-dvh">
          <AppSidebar authSlot={authSlot} />

          <div className="flex min-w-0 flex-1 flex-col">
            {/* 모바일 상단바 — 사이드바가 숨는 좁은 화면용 (컬렉션 섹션 nav 는 가로 탭이 담당) */}
            <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-divider bg-surface px-5 py-3 md:hidden">
              <Link
                href="/"
                className="text-[17px] font-bold tracking-[-0.04em] text-ink hover:no-underline"
              >
                Endpointer<span className="text-accent">.</span>
              </Link>
              <div className="ml-auto">{authSlot}</div>
            </header>

            <main className="mx-auto w-full max-w-[1180px] flex-1 px-6 py-8 md:px-10">
              {children}
            </main>
            <footer className="mx-auto w-full max-w-[1180px] px-6 pt-4 pb-10 text-xs text-faint md:px-10">
              한 번 만들어 두면 표로도, 주소로도, 쓰시는 AI 에서도 같은 내용을 볼 수 있어요.
            </footer>
          </div>
        </div>
      </body>
    </html>
  )
}
