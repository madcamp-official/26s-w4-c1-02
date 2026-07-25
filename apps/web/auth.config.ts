// Auth.js v5 설정 중 **DB 가 필요 없는 부분** (P4 · ADR A10).
//
// auth.ts 와 나눠 둔 이유: 미들웨어처럼 가벼운 실행 환경에서 Postgres 드라이버를 끌고 가면
// 안 된다. 여기에는 provider 와 화면 경로만 있다.
//
// **자격증명이 없어도 앱은 뜬다.** G0 시점의 .env 는 비어 있고, 그 상태로도
// `pnpm dev` 와 `pnpm build` 가 성공해야 한다. 그래서 provider 를 조건부로 넣는다.

import type { NextAuthConfig } from 'next-auth'
import Google from 'next-auth/providers/google'

const googleId = process.env['AUTH_GOOGLE_ID']?.trim() ?? ''
const googleSecret = process.env['AUTH_GOOGLE_SECRET']?.trim() ?? ''

/** 구글 로그인을 실제로 붙일 수 있는 상태인가. 화면이 안내 문구를 띄울지 정하는 값 */
export const isGoogleConfigured: boolean = googleId !== '' && googleSecret !== ''

/**
 * AUTH_SECRET 이 없으면 개발용 임시 값을 쓴다. 운영에서는 절대 대체하지 않는다 —
 * 없는 채로 배포되면 그 자리에서 실패하는 편이 조용히 취약해지는 것보다 낫다.
 */
const secret =
  process.env['AUTH_SECRET']?.trim() ||
  (process.env.NODE_ENV === 'production' ? undefined : 'endpointer-local-dev-secret-not-for-production')

export const authConfig = {
  providers: isGoogleConfigured
    ? [
        Google({
          clientId: googleId,
          clientSecret: googleSecret,
          // 같은 메일 주소로 다시 들어와도 계정이 갈라지지 않게 한다
          allowDangerousEmailAccountLinking: true,
        }),
      ]
    : [],
  pages: {
    // 별도 로그인 화면을 만들지 않는다. 첫 화면의 주인공은 주소 입력창이다 (기획서 2장)
    signIn: '/',
    error: '/',
  },
  trustHost: true,
  ...(secret ? { secret } : {}),
} satisfies NextAuthConfig

/** 로그인한 사람만 볼 수 있는 경로 */
export const PROTECTED_PATH_PREFIXES = ['/collections'] as const
