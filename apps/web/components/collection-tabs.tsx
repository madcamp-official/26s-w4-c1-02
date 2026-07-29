'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { cn } from '@/lib/utils'

/** 같은 컬렉션의 일곱 얼굴 (원본 콘솔 Sidebar) — 좁은 화면 전용 가로 탭 */
const TABS = [
  { suffix: '', label: '대시보드', manageOnly: false },
  { suffix: '/table', label: '표', manageOnly: false },
  { suffix: '/feed', label: '읽기 피드', manageOnly: false },
  { suffix: '/views', label: '뷰 · 알림', manageOnly: true },
  { suffix: '/sources', label: '소스', manageOnly: true },
  { suffix: '/connect', label: '연결', manageOnly: false },
  { suffix: '/settings', label: '설정', manageOnly: true },
] as const

export function CollectionTabs({ slug, manage = true }: { slug: string; manage?: boolean }) {
  const pathname = usePathname()
  const base = `/collections/${slug}`
  // 읽기 전용 멤버에겐 관리 탭을 그리지 않는다 (ADR A40) — 서버 쪽 차단은 각 페이지가 한다
  const tabs = TABS.filter((tab) => manage || !tab.manageOnly)

  return (
    <nav className="flex gap-5 overflow-x-auto border-b-[1.5px] border-border">
      {tabs.map((tab) => {
        const href = `${base}${tab.suffix}`
        const active = tab.suffix === '' ? pathname === base : pathname.startsWith(href)
        return (
          <Link
            key={tab.label}
            href={href}
            className={cn(
              '-mb-[1.5px] shrink-0 border-b-[2.5px] px-0.5 pb-3 text-[14px] font-bold hover:no-underline',
              active
                ? 'border-accent text-accent'
                : 'border-transparent text-faint hover:text-ink',
            )}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
