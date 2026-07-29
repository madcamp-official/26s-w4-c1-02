import { redirect } from 'next/navigation'

import { currentUser, isAuthReady } from '@/auth'
import { SignInForm } from '@/components/auth-actions'
import { UnavailableState } from '@/components/empty-state'
import { acceptInvite } from '@/lib/share'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ token: string }>
}

function Notice({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="mx-auto my-16 w-[calc(100%-40px)] max-w-md rounded-card border border-border bg-surface p-8 text-center">
      <h1 className="mb-2 text-lg font-bold text-ink">{title}</h1>
      <p className="mb-5 text-[13.5px] leading-relaxed text-muted">{body}</p>
      {children}
    </div>
  )
}

/**
 * 초대 수락 (ADR A40). 로그인 → 멤버로 합류 → 컬렉션으로.
 * 못 쓰는 링크는 왜 못 쓰는지(없음·꺼짐)를 가르지 않는다 — 존재 여부도 정보다.
 */
export default async function InvitePage({ params }: PageProps) {
  const { token } = await params

  if (!isAuthReady) {
    return (
      <Notice
        title="지금은 초대를 받을 수 없어요"
        body="로그인이 아직 준비되지 않았어요. 잠시 뒤에 이 링크를 다시 열어봐 주세요."
      />
    )
  }

  const user = await currentUser()
  if (user === null) {
    return (
      <Notice
        title="초대를 받았어요"
        body="누가 왔는지 알아야 하니, 구글로 로그인하면 바로 이어서 보여드릴게요."
      >
        <SignInForm redirectTo={`/invite/${token}`} />
      </Notice>
    )
  }

  const accepted = await acceptInvite(token, user.id)
  if (!accepted.ok) return <UnavailableState message={accepted.message} />
  if (accepted.data === null) {
    return (
      <Notice
        title="이 초대 링크는 쓸 수 없어요"
        body="링크가 바뀌었거나 꺼졌을 수 있어요. 링크를 보낸 사람에게 새 링크를 요청해 주세요."
      />
    )
  }

  redirect(`/collections/${accepted.data.slug}`)
}
