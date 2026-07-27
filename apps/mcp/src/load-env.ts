// .env 로딩 전용 모듈 — **반드시 index.ts 의 첫 import 여야 한다.**
//
// ESM 은 import 를 호이스팅하므로, index.ts 본문에서 loadDotenv() 를 불러도
// `@endpointer/core/db` 가 그보다 먼저 평가되어 DATABASE_URL 검증에서 죽는다.
// import 순서는 호이스팅돼도 보존되므로, 로딩을 모듈로 빼서 맨 앞에 두면 해결된다.
//
// .env 는 **레포 루트**에 있다. `dotenv/config` 는 cwd(=apps/mcp) 기준이라 못 읽는다.

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { config as loadDotenv } from 'dotenv'

/** apps/mcp/src → 레포 루트 */
loadDotenv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../..', '.env'), quiet: true })
