// 환경변수 — .env.example 의 키를 zod 로 검증해 읽는다
//
// **server-only 전제.** 브라우저 번들에 들어가면 안 된다.
// Next 클라이언트 컴포넌트에서는 절대 import 하지 않는다 (`NEXT_PUBLIC_` 접두사가 없으므로
// 어차피 값이 비지만, 번들에 들어가는 것 자체를 막는 게 규약이다).
//
// 검증은 **lazy** 하다. 모듈 로드 시점이 아니라 첫 접근 시점에 돈다 —
// Next 빌드가 DATABASE_URL 없이도 통과해야 하기 때문.

import { z } from 'zod'

/** 빈 문자열은 "안 넣은 것"으로 본다. .env.example 이 키만 두고 값을 비워두기 때문 */
const optionalString = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().optional(),
)

const optionalNumber = (fallback: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.coerce.number().int().default(fallback),
  )

export const EnvSchema = z.object({
  // ── 인프라 ───────────────────────────────────────────────────────────
  /** 유일한 필수 값 */
  DATABASE_URL: z.string().min(1, 'DATABASE_URL 이 필요합니다 (.env.example 참고)'),
  REDIS_URL: optionalString,

  // ── 인증 (P4 · ADR A10) ──────────────────────────────────────────────
  AUTH_SECRET: optionalString,
  AUTH_URL: optionalString,
  AUTH_GOOGLE_ID: optionalString,
  AUTH_GOOGLE_SECRET: optionalString,

  // ── LLM (P6 · ADR A1) ────────────────────────────────────────────────
  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL_COMPILE: z.string().default('gemini-2.5-pro'),
  GEMINI_MODEL_MATCH: z.string().default('gemini-2.5-flash'),

  // ── 구독 발송 (P7 · ADR A11) ─────────────────────────────────────────
  RESEND_API_KEY: optionalString,
  SUBSCRIPTION_FROM_EMAIL: optionalString,

  // ── 공개 주소 ────────────────────────────────────────────────────────
  PUBLIC_BASE_URL: z.string().default('http://localhost:3000'),
  PUBLIC_API_BASE_URL: z.string().default('http://localhost:3000/api/v1'),
  PUBLIC_MCP_BASE_URL: z.string().default('http://localhost:3002'),

  // ── 수집 안정성 (기획서 6장 기술적 예의) ─────────────────────────────
  CRAWLER_USER_AGENT: z.string().default('endpointer/0.1'),
  CRAWLER_MIN_INTERVAL_MS: optionalNumber(1500),
  /** ADR A12 — 상한 3 */
  CRAWLER_MAX_PAGES: optionalNumber(3),
  CRAWLER_CACHE_TTL_S: optionalNumber(3600),

  // ── 워커 ─────────────────────────────────────────────────────────────
  WORKER_CONCURRENCY: optionalNumber(2),
  BROWSER_CONCURRENCY: optionalNumber(1),
  HEAL_MAX_ATTEMPTS_PER_DAY: optionalNumber(3),

  // ── 포트 ─────────────────────────────────────────────────────────────
  WEB_PORT: optionalNumber(3000),
  MCP_PORT: optionalNumber(3002),

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

export type Env = z.infer<typeof EnvSchema>

let cached: Env | null = null

/** 첫 호출에서만 검증하고 이후에는 캐시를 준다 */
export function getEnv(): Env {
  if (cached !== null) return cached
  const parsed = EnvSchema.safeParse(process.env)
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    throw new Error(`환경 설정이 올바르지 않습니다.\n${lines.join('\n')}`)
  }
  cached = parsed.data
  return cached
}

/** 테스트에서 process.env 를 바꾼 뒤 다시 읽게 할 때 쓴다 */
export function resetEnvCache(): void {
  cached = null
}

/**
 * `env.DATABASE_URL` 처럼 쓰되 검증은 접근 시점에 돈다.
 * 모듈을 import 하는 것만으로는 터지지 않는다.
 */
export const env: Env = new Proxy({} as Env, {
  get(_target, prop) {
    return getEnv()[prop as keyof Env]
  },
  has(_target, prop) {
    return prop in getEnv()
  },
  ownKeys() {
    return Reflect.ownKeys(getEnv())
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Reflect.getOwnPropertyDescriptor(getEnv(), prop)
  },
})
