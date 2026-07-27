import { redirect } from 'next/navigation'

interface PageProps {
  params: Promise<{ slug: string }>
}

/** 구독 탭은 작업실로 개편됐다 (델타 3절). 옛 주소로 온 사람을 넘긴다 */
export default async function SubscribeRedirect({ params }: PageProps) {
  const { slug } = await params
  redirect(`/collections/${slug}/workshop`)
}
