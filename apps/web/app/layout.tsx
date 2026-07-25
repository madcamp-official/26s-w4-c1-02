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
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfbf9' },
    { media: '(prefers-color-scheme: dark)', color: '#0f100e' },
  ],
}

/**
 * 폰트는 next/font 로 받아오지 않는다 — 빌드 때 외부 네트워크에 의존하게 되고,
 * 한국어 웹폰트는 용량도 크다. 시스템 폰트 스택은 globals.css 의 --font-sans 에 있다.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-dvh">
        <SiteHeader />
        <main className="mx-auto w-full max-w-5xl px-4 py-8">{children}</main>
        <footer className="mx-auto w-full max-w-5xl px-4 pt-4 pb-10 text-xs text-faint">
          한 번 만들어 두면 표로도, 주소로도, 쓰시는 AI 에서도 같은 내용을 볼 수 있어요.
        </footer>
      </body>
    </html>
  )
}
