'use client'

import { usePathname } from 'next/navigation'

/** 콘솔 하단 한 줄. 랜딩(/)은 자기 푸터(원본 website Footer)를 가지므로 그리지 않는다 */
export function ConsoleFooter() {
  const pathname = usePathname()
  if (pathname === '/') return null

  return (
    <footer className="px-6 pt-4 pb-10 text-xs text-faint md:px-10">
      한 번 만들어 두면 표로도, 주소로도, 쓰시는 AI 에서도 같은 내용을 볼 수 있어요.
    </footer>
  )
}
