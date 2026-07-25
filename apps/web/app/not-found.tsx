import Link from 'next/link'

/** 없는 주소도 실패가 아니라 안내로 받는다 (보장선 B4) */
export default function NotFound() {
  return (
    <div className="flex flex-col gap-4 pt-8">
      <h1 className="text-xl font-semibold text-ink">찾으시는 화면이 없어요</h1>
      <p className="text-sm text-muted">주소가 바뀌었거나, 아직 만들어지지 않은 표일 수 있어요.</p>
      <Link href="/" className="text-sm text-accent underline underline-offset-2">
        처음 화면으로
      </Link>
    </div>
  )
}
