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
  merge: <><circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M6 21V9a9 9 0 0 0 9 9" /></>,
  table: <><path d="M12 3v18" /><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18" /></>,
  bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>,
  filter: <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />,
  link2: <><path d="M9 17H7A5 5 0 0 1 7 7h2" /><path d="M15 7h2a5 5 0 1 1 0 10h-2" /><line x1="8" y1="12" x2="16" y2="12" /></>,
  plug: <><path d="M12 22v-5" /><path d="M9 8V2" /><path d="M15 8V2" /><path d="M6 8h12v4a6 6 0 0 1-12 0Z" /></>,
  settings: <><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></>,
  chevronLeft: <path d="M15 18l-6-6 6-6" />,
  sparkles: <><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /><path d="M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1M18.4 18.4l-2.1-2.1M7.7 7.7L5.6 5.6" /></>,
} as const

interface NavItem {
  label: string
  href: string
  icon: keyof typeof ICON
  active: boolean
}

export function AppSidebar({ authSlot }: { authSlot: ReactNode }) {
  const pathname = usePathname()

  // 랜딩(/)은 웹사이트다 — 콘솔 사이드바 없이 자기 nav 를 그린다 (원본 ui_kits/website)
  if (pathname === '/') return null

  const seg = pathname.split('/').filter(Boolean)
  const inCollections = seg[0] === 'collections'
  const inGallery = seg[0] === 'gallery'
  const slug = inCollections && seg[1] && seg[1] !== 'new' ? seg[1] : null
  const section = slug ? (seg[2] ?? '') : ''

  // 원본 콘솔 Sidebar.jsx 의 7항목 — 대시보드 · 표 · 읽기 피드 · 뷰·알림 · 소스 · 연결 · 설정
  const items: NavItem[] = slug
    ? [
        { label: '대시보드', href: `/collections/${slug}`, icon: 'merge', active: section === '' },
        { label: '표', href: `/collections/${slug}/table`, icon: 'table', active: section === 'table' },
        { label: '읽기 피드', href: `/collections/${slug}/feed`, icon: 'bell', active: section === 'feed' },
        { label: '뷰 · 알림', href: `/collections/${slug}/views`, icon: 'filter', active: section === 'views' || section === 'workshop' },
        { label: '소스', href: `/collections/${slug}/sources`, icon: 'link2', active: section === 'sources' || section === 'attach' },
        { label: '연결', href: `/collections/${slug}/connect`, icon: 'plug', active: section === 'connect' },
        { label: '설정', href: `/collections/${slug}/settings`, icon: 'settings', active: section === 'settings' },
      ]
    : [
        {
          label: '내 컬렉션',
          href: '/collections',
          icon: 'grid',
          active: inCollections,
        },
        {
          label: '모두의 컬렉션',
          href: '/gallery',
          icon: 'sparkles',
          active: inGallery,
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

      {/* 컬렉션 이름은 밴드 제목이 맡는다 — 여기서는 돌아가는 길만.
          아래 nav 항목들과 같은 구조(px-3 래퍼 + px-3 링크 + 17px 아이콘 + text-sm)라 시작 x·글자 크기가 정확히 맞는다 */}
      {slug && (
        <div className="px-3">
          <Link
            href="/collections"
            className="flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-sm font-medium text-muted hover:bg-raised hover:text-ink hover:no-underline"
          >
            <Ic path={ICON.chevronLeft} />내 컬렉션
          </Link>
        </div>
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
