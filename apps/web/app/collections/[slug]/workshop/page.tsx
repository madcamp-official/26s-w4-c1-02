import { redirect } from 'next/navigation'

interface PageProps {
  params: Promise<{ slug: string }>
}

/** 작업실은 뷰·알림과 소스로 나뉘었다 (원본 콘솔 구조). 옛 주소로 온 사람을 넘긴다 */
export default async function WorkshopRedirect({ params }: PageProps) {
  const { slug } = await params
  redirect(`/collections/${slug}/views`)
}
