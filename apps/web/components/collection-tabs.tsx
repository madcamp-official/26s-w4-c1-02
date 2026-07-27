'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { cn } from '@/lib/utils'

/** 같은 컬렉션의 네 얼굴 (기획서 3장). 탭이지 페이지가 아니다 — 명사는 늘지 않는다 (B2) */
const TABS = [
  { suffix: '', label: '표' },
  { suffix: '/feed', label: '읽기 피드' },
  { suffix: '/subscribe', label: '구독' },
  { suffix: '/connect', label: '연결' },
] as const

export function CollectionTabs({ slug }: { slug: string }) {
  const pathname = usePathname()
  const base = `/collections/${slug}`

  return (
    <nav className="flex gap-6 border-b-[1.5px] border-border">
      {TABS.map((tab) => {
        const href = `${base}${tab.suffix}`
        const active = tab.suffix === '' ? pathname === base : pathname.startsWith(href)
        return (
          <Link
            key={tab.label}
            href={href}
            className={cn(
              '-mb-[1.5px] border-b-[2.5px] px-0.5 pb-3 text-[15px] font-bold hover:no-underline',
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
