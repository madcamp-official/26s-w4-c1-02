import { UrlPasteForm } from '@/components/url-paste-form'
import { COPY } from '@/lib/labels'

/**
 * 보장선 B3 — 빈 표를 주지 않는다.
 * 아무것도 없을 때 보여줄 것은 "비었습니다" 가 아니라 주소 입력창이다.
 */
export function EmptyState({ title, body }: { title?: string; body?: string }) {
  return (
    <section className="flex flex-col gap-4 rounded-card border border-dashed border-border-strong bg-surface px-5 py-8">
      <h2 className="text-lg font-semibold text-ink">{title ?? COPY.emptyTitle}</h2>
      <p className="text-sm text-muted">{body ?? COPY.emptyBody}</p>
      <UrlPasteForm className="max-w-2xl" />
    </section>
  )
}

/** 저장해 둔 내용을 못 읽었을 때. 빨간 에러가 아니라 상태 문구다 (보장선 B4) */
export function UnavailableState({ message }: { message: string }) {
  return (
    // 밴드 없이 단독으로 그려질 수 있으므로 자기 여백을 갖는다 (main 은 패딩이 없다)
    <section className="m-5 rounded-card border border-border bg-raised px-5 py-6 md:mx-10 md:my-8">
      <p className="text-sm text-muted">{message}</p>
    </section>
  )
}
