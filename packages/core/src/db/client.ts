// DB 클라이언트 — postgres.js + Drizzle (ADR A7)
//
// server-only. Next dev 의 HMR 은 모듈을 매번 다시 평가하므로 globalThis 에 캐싱하지 않으면
// 커넥션이 새고 몇 분 안에 Postgres 의 max_connections 를 태운다.

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import { env } from '../env'
import * as schema from './schema'

type QueryClient = ReturnType<typeof postgres>

type GlobalWithDb = typeof globalThis & {
  __endpointer_pg?: QueryClient
  __endpointer_db?: ReturnType<typeof createDb>
}

const globalRef = globalThis as GlobalWithDb

function createQueryClient(): QueryClient {
  return postgres(env.DATABASE_URL, {
    max: 10,
    idle_timeout: 20,
    // Drizzle + PgBouncer 조합에서 prepared statement 가 문제를 일으킨다. 지금은 직접 붙지만
    // 배포에서 풀러가 끼어도 안 깨지게 미리 꺼둔다.
    prepare: false,
    onnotice: () => {},
  })
}

function createDb(client: QueryClient) {
  // casing 옵션은 쓰지 않는다. 모든 컬럼에 DB 이름을 명시해 뒀으므로
  // drizzle-kit(마이그레이션 생성)과 런타임의 설정이 갈릴 여지를 없앤다.
  return drizzle(client, { schema })
}

/** postgres.js 원시 클라이언트. 마이그레이션·raw SQL 에서 쓴다 */
export const queryClient: QueryClient = globalRef.__endpointer_pg ?? createQueryClient()

/** Drizzle 인스턴스 */
export const db = globalRef.__endpointer_db ?? createDb(queryClient)

if (process.env['NODE_ENV'] !== 'production') {
  globalRef.__endpointer_pg = queryClient
  globalRef.__endpointer_db = db
}

export type Db = typeof db

export { schema }

/** 워커·마이그레이션 스크립트처럼 프로세스를 끝내야 하는 쪽에서 호출한다 */
export async function closeDb(): Promise<void> {
  await queryClient.end({ timeout: 5 })
  delete globalRef.__endpointer_pg
  delete globalRef.__endpointer_db
}
