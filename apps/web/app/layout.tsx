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
  themeColor: '#ffffff',
}

/**
 * 폰트: Pretendard Variable(한글·UI) + JetBrains Mono(경로·키·숫자) 를 CDN <link> 로 받는다.
 * next/font 를 쓰지 않는 이유는 빌드 때 외부 네트워크에 의존하게 되기 때문 — <link> 는
 * 런타임 로드라 빌드가 안 깨지고, CDN 이 죽어도 globals.css 의 시스템 폰트 스택으로 떨어진다.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await currentUser()

  // 로그인/로그아웃 영역은 서버 컴포넌트라 사이드바(클라이언트)에 노드로 주입한다.
  // 한 줄 배치: [사진][이름] ── [로그아웃] — 이름은 남는 폭을 차지하고 버튼은 오른쪽에 붙는다
  const authSlot: ReactNode = user ? (
    <div className="flex items-center gap-2.5">
      {user.image !== null ? (
        // eslint-disable-next-line @next/next/no-img-element -- 아바타 하나에 next/image 설정(원격 도메인 허용)을 열 이유가 없다
        <img src={user.image} alt="" className="size-8 shrink-0 rounded-full" />
      ) : (
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-[13px] font-semibold text-accent-ink"
        >
          {(user.name ?? '나').slice(0, 1)}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">
        {user.name ?? '내 계정'}
      </span>
      <SignOutForm />
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
      {/* 원본 콘솔 셸 — 사이드바 + 스크롤 main, 바닥은 흰색. 밴드가 main 전폭을 가로지른다 */}
      <body className="h-dvh overflow-hidden">
        <div className="flex h-dvh">
          <AppSidebar authSlot={authSlot} />

          <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
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

            {/* 패딩 없음 — 밴드(HeroBand)가 자기 패딩을 갖고 전폭으로 깔린다 */}
            <main className="flex-1">{children}</main>
          </div>
        </div>
      </body>
    </html>
  )
}
