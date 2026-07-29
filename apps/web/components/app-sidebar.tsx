'use client'

// 좌측 사이드바 (원본 콘솔 UI 키트의 정의적 레이아웃 — "사이드바 + 인디고 밴드").
//
// App Router 특성상 root 레이아웃의 사이드바는 현재 컬렉션 컨텍스트(이름·권한)를 모른다.
// 그래서 pathname 으로 섹션 nav 만 만들고, 컬렉션 이름은 히어로 밴드가 보여준다.
// 사용자 영역(로그인/로그아웃)은 서버 컴포넌트라 authSlot 으로 주입받는다.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

// ── Lucide 계열 인라인 아이콘 (의존성 없이 · 1.75 stroke) ──────────────
function Ic({ path, size = 17 }: { path: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0"
    >
      {path}
    </svg>
  )
}
const ICON = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /></>,
  table: <><path d="M12 3v18" /><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18" /></>,
  bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>,
  sliders: <><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></>,
  plug: <><path d="M12 22v-5" /><path d="M9 8V2" /><path d="M15 8V2" /><path d="M6 8h12v4a6 6 0 0 1-12 0Z" /></>,
  chevronLeft: <path d="M15 18l-6-6 6-6" />,
} as const

interface NavItem {
  label: string
  href: string
  icon: keyof typeof ICON
  active: boolean
}

export function AppSidebar({ authSlot }: { authSlot: ReactNode }) {
  const pathname = usePathname()
  const seg = pathname.split('/').filter(Boolean)
  const inCollections = seg[0] === 'collections'
  const slug = inCollections && seg[1] && seg[1] !== 'new' ? seg[1] : null
  const section = slug ? (seg[2] ?? '') : ''

  const items: NavItem[] = slug
    ? [
        { label: '표', href: `/collections/${slug}`, icon: 'table', active: section === '' },
        { label: '읽기 피드', href: `/collections/${slug}/feed`, icon: 'bell', active: section === 'feed' },
        { label: '작업실', href: `/collections/${slug}/workshop`, icon: 'sliders', active: section === 'workshop' },
        { label: '연결', href: `/collections/${slug}/connect`, icon: 'plug', active: section === 'connect' },
      ]
    : [
        {
          label: '내 컬렉션',
          href: '/collections',
          icon: 'grid',
          active: inCollections,
        },
      ]

  return (
    <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-divider bg-surface md:flex">
      <div className="px-5 pt-5 pb-3.5">
        <Link
          href="/"
          className="text-[19px] font-bold tracking-[-0.04em] text-ink hover:no-underline"
        >
          Endpointer<span className="text-accent">.</span>
        </Link>
      </div>

      {slug && (
        <Link
          href="/collections"
          className="mx-3 mb-1 flex items-center gap-1.5 px-3 py-1 text-[12.5px] text-faint hover:text-accent hover:no-underline"
        >
          <Ic path={ICON.chevronLeft} size={13} />내 컬렉션
        </Link>
      )}

      <nav className="flex flex-col gap-0.5 px-3">
        {items.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            className={cn(
              'flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-sm hover:no-underline',
              it.active
                ? 'bg-accent-soft font-semibold text-accent'
                : 'font-medium text-ink hover:bg-raised',
            )}
          >
            <Ic path={ICON[it.icon]} />
            <span className="flex-1">{it.label}</span>
          </Link>
        ))}
      </nav>

      <div className="mt-auto border-t border-divider p-4">{authSlot}</div>
    </aside>
  )
}
