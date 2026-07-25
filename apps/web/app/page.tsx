import Link from 'next/link'
import { redirect } from 'next/navigation'

import { currentUser, isAuthReady } from '@/auth'
import { AuthNotice } from '@/components/auth-actions'
import { UrlPasteForm } from '@/components/url-paste-form'
import { COPY } from '@/lib/labels'

// 로그인 상태에 따라 갈라지므로 미리 만들어두지 않는다
export const dynamic = 'force-dynamic'

const STEPS = [
  {
    title: '주소를 붙여넣어요',
    body: '목록이 보이는 페이지면 됩니다. 다른 건 물어보지 않아요.',
  },
  {
    title: '이미 채워진 표가 나와요',
    body: '이름을 고치거나 필요 없는 칸을 지우기만 하면 됩니다.',
  },
  {
    title: '사이트를 더 붙여요',
    body: '두 번째 사이트부터는 같은 표에 같은 형식으로 담깁니다.',
  },
] as const

export default async function HomePage() {
  const user = await currentUser()
  if (user) redirect('/collections')

  return (
    <div className="flex flex-col gap-12">
      {/* 첫 화면의 주인공은 입력창 하나다 (기획서 2장 설계 원칙) */}
      <section className="flex flex-col gap-4 pt-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          {COPY.heroTitle}
        </h1>
        <p className="max-w-2xl text-base text-muted">{COPY.heroSubtitle}</p>
        <UrlPasteForm className="max-w-2xl" autoFocus />
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <div key={step.title} className="rounded-card border border-border bg-surface p-4">
            <span className="text-xs font-semibold text-accent">{index + 1}</span>
            <h2 className="mt-1 text-sm font-semibold text-ink">{step.title}</h2>
            <p className="mt-1 text-sm text-muted">{step.body}</p>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        {isAuthReady ? (
          <p className="text-sm text-muted">
            만든 표를 계속 보시려면 로그인해 주세요. 오른쪽 위 버튼 하나면 됩니다.
          </p>
        ) : (
          <AuthNotice />
        )}
        <Link href="/collections" className="text-sm text-accent underline underline-offset-2">
          미리 담아둔 예시 표 보기
        </Link>
      </section>
    </div>
  )
}
