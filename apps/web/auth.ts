// Auth.js v5 본체 (P4 · ADR A10).
//
// 저장소를 못 붙여도 앱은 뜬다. `@endpointer/core/db` 는 모듈을 읽는 순간 DATABASE_URL 을
// 검증하므로 정적 import 로 두면 .env 가 빈 상태에서 빌드가 통째로 깨진다.
// 그래서 동적 import + top-level await 로 감싸고, 실패하면 세션만 쿠키로 유지한다.

import NextAuth from 'next-auth'
import type { Adapter } from 'next-auth/adapters'

import { authConfig, isGoogleConfigured } from './auth.config'
import { loadCore } from './lib/db'

async function createAdapter(): Promise<Adapter | null> {
  const core = await loadCore()
  if (core === null) return null
  try {
    const { DrizzleAdapter } = await import('@auth/drizzle-adapter')
    return DrizzleAdapter(core.db, {
      usersTable: core.users,
      accountsTable: core.accounts,
      sessionsTable: core.sessions,
      verificationTokensTable: core.verificationTokens,
      authenticatorsTable: core.authenticators,
    })
  } catch (cause) {
    console.warn('[endpointer/web] 로그인 저장소를 붙이지 못했습니다', cause)
    return null
  }
}

const adapter = await createAdapter()

/** 로그인이 실제로 동작할 수 있는 상태인가 — 화면의 안내 문구가 이 값을 본다 */
export const isAuthReady: boolean = isGoogleConfigured && adapter !== null

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  ...(adapter
    ? { adapter, session: { strategy: 'database' as const } }
    : { session: { strategy: 'jwt' as const } }),
  callbacks: {
    session({ session, user }) {
      // database 전략일 때만 user 가 온다. 화면이 owner_id 로 쓰는 값
      if (user?.id) session.user.id = user.id
      return session
    },
  },
})

/**
 * 세션을 읽되 절대 던지지 않는다. 설정이 덜 된 상태에서 첫 화면이 500 이 되면
 * 보장선 B4 이전에 제품이 없다.
 */
export async function currentUser(): Promise<{ id: string; name: string | null; image: string | null } | null> {
  try {
    const session = await auth()
    const user = session?.user
    if (!user?.id) return null
    return { id: user.id, name: user.name ?? null, image: user.image ?? null }
  } catch (cause) {
    console.warn('[endpointer/web] 로그인 상태를 확인하지 못했습니다', cause)
    return null
  }
}
