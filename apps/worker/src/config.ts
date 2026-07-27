// 워커 설정 — .env 를 한 곳에서만 읽는다.
//
// core 의 `env.ts` 를 쓰지 않는 이유: `@endpointer/core/db` 진입점을 통해서만 재수출되는데,
// 그 모듈을 import 하는 순간 postgres 커넥션 풀이 만들어진다. probe CLI 는 DB 가 필요 없고
// DATABASE_URL 없이도 돌아야 하므로, 워커는 자기 설정을 자기가 읽는다.
// 키 이름과 기본값은 .env.example · core/env.ts 와 **반드시 같게 유지한다.**

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { config as loadDotenv } from 'dotenv'

const here = dirname(fileURLToPath(import.meta.url))
/** apps/worker/src → 레포 루트 */
export const REPO_ROOT = resolve(here, '../../..')

loadDotenv({ path: resolve(REPO_ROOT, '.env'), quiet: true })

function str(key: string): string | undefined {
  const v = process.env[key]
  return v === undefined || v.trim() === '' ? undefined : v
}

function strOr(key: string, fallback: string): string {
  return str(key) ?? fallback
}

function int(key: string, fallback: number): number {
  const raw = str(key)
  if (raw === undefined) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : fallback
}

function bool(key: string, fallback: boolean): boolean {
  const raw = str(key)
  if (raw === undefined) return fallback
  return raw === 'true' || raw === '1'
}

export interface WorkerConfig {
  nodeEnv: 'development' | 'test' | 'production'
  logLevel: string

  databaseUrl: string | undefined
  redisUrl: string

  /** 기획서 6장 기술적 예의 — 식별 가능한 User-Agent */
  crawlerUserAgent: string
  /** 소스별 최소 요청 간격 */
  crawlerMinIntervalMs: number
  /** ADR A12 — 상한 3 */
  crawlerMaxPages: number
  /** 같은 페이지를 반복해 때리지 않기 위한 캐시 TTL */
  crawlerCacheTtlS: number
  /**
   * 사설망 주소로 나가는 것을 허용한다. **개발용 탈출구다.**
   *
   * 호출부마다 넘기는 옵션으로 두지 않은 이유: 그러면 넘기는 걸 잊은 자리가 그대로 구멍이 된다.
   * 프로세스 하나에 스위치 하나면, 기본값이 막힘이고 여는 건 의식적인 한 번이다.
   */
  allowPrivateHosts: boolean

  /**
   * 화면이 파이프라인을 부르는 문 (ADR A30).
   *
   * 토큰이 비어 있으면 **문을 아예 열지 않는다.** 열어 두고 아무나 받으면 그 순간
   * 이 서버는 "아무 주소나 대신 열어 주는 공개 서비스" 가 된다 — 관문(guard.ts)이 사설망을
   * 막아도 공인 주소로는 얼마든지 남을 대신 때릴 수 있다.
   */
  workerHttpPort: number
  /** 기본은 로컬만. 배포에서 web 이 다른 컨테이너면 0.0.0.0 으로 연다 */
  workerHttpHost: string
  workerInternalToken: string | undefined

  /** 15장 Playwright 메모리 리스크 — 잡 동시성 */
  workerConcurrency: number
  /** 브라우저를 쓰는 잡의 동시성. 항상 workerConcurrency 이하 */
  browserConcurrency: number
  /** 15장 Gemini 무료 티어 리스크 — 소스별 하루 치유 시도 상한 */
  healMaxAttemptsPerDay: number

  geminiApiKey: string | undefined
  geminiModelCompile: string
  geminiModelMatch: string

  llmCacheDir: string
  llmCacheEnabled: boolean
  llmHtmlTrim: boolean
  llmMaxInputChars: number

  resendApiKey: string | undefined
  subscriptionFromEmail: string | undefined

  publicBaseUrl: string
}

function readConfig(): WorkerConfig {
  const nodeEnvRaw = strOr('NODE_ENV', 'development')
  const nodeEnv: WorkerConfig['nodeEnv'] =
    nodeEnvRaw === 'production' || nodeEnvRaw === 'test' ? nodeEnvRaw : 'development'

  const workerConcurrency = Math.max(1, int('WORKER_CONCURRENCY', 2))
  const browserConcurrency = Math.min(workerConcurrency, Math.max(1, int('BROWSER_CONCURRENCY', 1)))

  return {
    nodeEnv,
    logLevel: strOr('LOG_LEVEL', nodeEnv === 'production' ? 'info' : 'debug'),

    databaseUrl: str('DATABASE_URL'),
    redisUrl: strOr('REDIS_URL', 'redis://localhost:6379'),

    crawlerUserAgent: strOr('CRAWLER_USER_AGENT', 'endpointer/0.1'),
    crawlerMinIntervalMs: int('CRAWLER_MIN_INTERVAL_MS', 1500),
    crawlerMaxPages: Math.min(3, Math.max(1, int('CRAWLER_MAX_PAGES', 3))),
    crawlerCacheTtlS: int('CRAWLER_CACHE_TTL_S', 3600),
    allowPrivateHosts: bool('ALLOW_PRIVATE_HOSTS', false),

    workerHttpPort: int('WORKER_HTTP_PORT', 3003),
    workerHttpHost: strOr('WORKER_HTTP_HOST', '127.0.0.1'),
    workerInternalToken: str('WORKER_INTERNAL_TOKEN'),

    workerConcurrency,
    browserConcurrency,
    healMaxAttemptsPerDay: Math.max(0, int('HEAL_MAX_ATTEMPTS_PER_DAY', 3)),

    geminiApiKey: str('GEMINI_API_KEY'),
    geminiModelCompile: strOr('GEMINI_MODEL_COMPILE', 'gemini-3.1-flash-lite'),
    geminiModelMatch: strOr('GEMINI_MODEL_MATCH', 'gemini-3.1-flash-lite'),

    llmCacheDir: resolve(REPO_ROOT, strOr('LLM_CACHE_DIR', '.cache/llm')),
    llmCacheEnabled: bool('LLM_CACHE_ENABLED', true),
    llmHtmlTrim: bool('LLM_HTML_TRIM', true),
    llmMaxInputChars: int('LLM_MAX_INPUT_CHARS', 400_000),

    resendApiKey: str('RESEND_API_KEY'),
    subscriptionFromEmail: str('SUBSCRIPTION_FROM_EMAIL'),

    publicBaseUrl: strOr('PUBLIC_BASE_URL', 'http://localhost:3000'),
  }
}

let cached: WorkerConfig | null = null

export function getConfig(): WorkerConfig {
  if (cached === null) cached = readConfig()
  return cached
}

/** 테스트에서 process.env 를 바꾼 뒤 다시 읽게 할 때 */
export function resetConfigCache(): void {
  cached = null
}
