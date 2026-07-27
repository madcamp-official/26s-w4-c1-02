// 보호 경로 — 로그인이 실제로 붙어 있을 때만 막는다.
//
// 세션 검증을 여기서 하지 않고 쿠키 존재만 본다. 이유 두 가지:
//  1. 세션을 DB 에 두므로(Auth.js database 전략) 미들웨어가 세션을 읽으려면
//     Postgres 드라이버를 미들웨어 번들에 끌고 와야 한다.
//  2. 진짜 판정은 서버 컴포넌트에서 다시 한다. 여기는 "로그인 화면으로 돌려보내기" 만 담당한다.
//
// 자격증명이 없는 G0 상태에서는 아무것도 막지 않는다 — 그래야 미리 담아둔 예시를 볼 수 있다.

import { NextResponse, type NextRequest } from 'next/server'

const SESSION_COOKIES = [
  'authjs.session-token',
  '__Secure-authjs.session-token',
  // v4 호환 (배포 중간에 갈아탈 때 로그아웃되지 않게)
  'next-auth.session-token',
  '__Secure-next-auth.session-token',
]

const authEnabled =
  (process.env['AUTH_GOOGLE_ID']?.trim() ?? '') !== '' &&
  (process.env['AUTH_GOOGLE_SECRET']?.trim() ?? '') !== ''

export function middleware(request: NextRequest): NextResponse {
  if (!authEnabled) return NextResponse.next()

  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name))
  if (hasSession) return NextResponse.next()

  const url = request.nextUrl.clone()
  url.pathname = '/'
  url.search = ''
  return NextResponse.redirect(url)
}

export const config = {
  // 내 목록과 생성만 막는다. 컬렉션 상세(slug)는 로그인 없이 볼 수 있다 —
  // 추측 불가 slug 가 곧 접근 제어다 (O2 unlisted 의 화면 판. 델타 5-5 예시 컬렉션의 전제).
  // 쓰기(이름 변경·삭제·받아보기)는 각 서버 액션이 주인·로그인을 따로 확인한다.
  matcher: ['/collections', '/collections/new'],
}
