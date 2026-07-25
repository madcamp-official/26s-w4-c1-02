// 마이그레이션 실행 — `pnpm db:migrate` (= `tsx src/db/migrate.ts`)
//
// drizzle-kit 이 만든 SQL(`packages/core/drizzle`)을 순서대로 적용한다.
//
// 두 가지가 이 파일의 전부다:
//  1. **.env 를 client.ts 보다 먼저 읽어야 한다.** client.ts 는 모듈 평가 시점에
//     `env.DATABASE_URL` 로 커넥션을 만든다. ESM 의 static import 는 본문보다 먼저 평가되므로
//     `./client` 는 dotenv 를 채운 뒤 **동적 import** 해야 한다. 순서가 뒤집히면 조용히 터진다.
//  2. **끝나고 커넥션을 닫아야 한다.** postgres.js 풀이 열려 있으면 프로세스가 안 죽는다.

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { config as loadDotenv } from 'dotenv'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** packages/core/src/db → 레포 루트 */
const REPO_ROOT = path.resolve(HERE, '../../../..')
/** drizzle.config.ts 의 `out` 과 같은 곳 */
const MIGRATIONS_DIR = path.resolve(HERE, '../../drizzle')

loadDotenv({ path: path.join(REPO_ROOT, '.env'), quiet: true })

// dotenv 이후에만 로드해야 한다 (위 주석 1번)
const { db, closeDb } = await import('./client')

async function main(): Promise<void> {
  if (!existsSync(MIGRATIONS_DIR)) {
    throw new Error(
      `적용할 마이그레이션 파일이 없습니다 (${MIGRATIONS_DIR}). 먼저 \`pnpm db:generate\` 를 실행하세요.`,
    )
  }

  const startedAt = Date.now()
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR })
  console.log(`데이터베이스 스키마를 최신 상태로 맞췄습니다 (${Date.now() - startedAt}ms)`)
}

try {
  await main()
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error)
  console.error(`데이터베이스를 준비하지 못했습니다 — ${reason}`)
  process.exitCode = 1
} finally {
  try {
    await closeDb()
  } catch {
    // 닫는 데 실패해도 판정에는 영향이 없다. 프로세스는 어차피 끝난다
  }
}
