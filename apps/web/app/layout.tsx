import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'

import { SiteHeader } from '@/components/site-header'

import './globals.css'

export const metadata: Metadata = {
  title: 'endpointer — 아무 목록 페이지나 내 표로',
  description:
    '목록이 있는 페이지 주소를 붙여넣으면 표가 됩니다. 여러 사이트를 붙여도 하나의 표에 같은 형식으로 담깁니다.',
}

export const viewport: Viewport = {
  themeColor: '#f6f0e1',
}

/**
 * 폰트: Pretendard Variable 을 CDN <link> 로 받는다. next/font 를 쓰지 않는 이유는
 * 빌드 때 외부 네트워크에 의존하게 되기 때문 — <link> 는 런타임 로드라 빌드가 안 깨지고,
 * CDN 이 죽어도 globals.css 의 시스템 폰트 스택으로 떨어진다.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="min-h-dvh">
        <SiteHeader />
        <main className="mx-auto w-full max-w-[1080px] px-6 py-9">{children}</main>
        <footer className="mx-auto w-full max-w-[1080px] px-6 pt-4 pb-10 text-xs text-faint">
          한 번 만들어 두면 표로도, 주소로도, 쓰시는 AI 에서도 같은 내용을 볼 수 있어요.
        </footer>
      </body>
    </html>
  )
}
