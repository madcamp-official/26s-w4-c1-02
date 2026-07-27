// .env 를 **다른 어떤 모듈보다 먼저** 읽는다
//
// ── 왜 파일을 따로 두는가 ───────────────────────────────────────────────
// `index.ts` 안에서 `loadDotenv()` 를 맨 위에 적어도 소용이 없다.
// ESM 은 `import` 선언을 전부 끌어올려 **본문 코드보다 먼저** 평가한다.
// 그래서 아래처럼 적으면
//
//     loadDotenv({ path: ... })                      // ② 두 번째로 실행된다
//     import { db } from '@endpointer/core/db'       // ① 먼저 평가된다
//
// `core/db/client.ts` 가 모듈 최상단에서 DATABASE_URL 을 읽다가 죽는다.
// 실제로 그래서 `pnpm dev:mcp` 가 "DATABASE_URL: expected string, received undefined" 로 뜨지 않았다.
//
// 모듈로 빼면 순서가 보장된다 — ESM 은 import 선언이 **적힌 순서대로** 의존 모듈을 평가하므로,
// `index.ts` 의 첫 줄에서 이 파일을 import 하면 그 안의 코드가 다른 import 보다 먼저 돈다.
// (worker 는 `config.ts` 가 우연히 이 역할을 하고 있다)

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { config as loadDotenv } from 'dotenv'

/** apps/mcp/src → 레포 루트. .env 는 앱마다 두지 않고 루트에 하나만 둔다 */
loadDotenv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../..', '.env'), quiet: true })
