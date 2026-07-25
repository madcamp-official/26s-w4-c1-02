// drizzle-kit 설정 (0.31 형식) — `pnpm db:generate` / `db:studio` 가 읽는다.
//
// 마이그레이션 SQL 은 이 패키지 안(`packages/core/drizzle`)에 떨어진다.
// 스키마·마이그레이션·시드가 한 패키지에 모여 있어야 트랙 A·B 가 같은 것을 본다 (트랙 계약 #2).
//
// .env 는 **레포 루트**에 있다. drizzle-kit 은 `packages/core` 를 cwd 로 실행되므로
// 아무것도 안 하면 루트 .env 를 못 읽는다. 그래서 워크스페이스 루트를 직접 찾아 올라간다.

import { existsSync } from 'node:fs'
import path from 'node:path'

import { config as loadDotenv } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

/** `pnpm-workspace.yaml` 이 있는 디렉터리가 레포 루트다 */
function findRepoRoot(start: string): string {
  let dir = path.resolve(start)
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  // packages/core 에서 실행됐다고 가정한 폴백
  return path.resolve(start, '../..')
}

const repoRoot = findRepoRoot(process.cwd())

loadDotenv({ path: path.join(repoRoot, '.env'), quiet: true })

/**
 * docker-compose.yml · .env.example 과 같은 값.
 * `.env` 없이도 `db:generate` 는 돌아야 하므로(SQL 생성은 DB 접속이 필요 없다) 여기서만 폴백을 둔다.
 * 실제 접속이 필요한 `db:migrate` 는 core 의 env 검증을 그대로 타서 값이 없으면 멈춘다.
 */
const FALLBACK_DATABASE_URL = 'postgres://endpointer:endpointer@localhost:5432/endpointer'

const databaseUrl = process.env['DATABASE_URL']?.trim() || FALLBACK_DATABASE_URL

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: databaseUrl },
  // 컬럼 이름을 스키마에 전부 명시해 뒀다. casing 을 켜면 런타임과 갈릴 여지가 생긴다 (client.ts 주석 참고)
  strict: true,
  verbose: true,
})
