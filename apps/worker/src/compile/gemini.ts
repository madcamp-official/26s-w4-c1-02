// Gemini 클라이언트 (@google/genai · 원칙 ① · P6 · ADR A1)
//
// **LLM 은 런타임이 아니라 컴파일러다.** 이 파일이 호출되는 곳은 세 군데뿐이다:
//   · 소스 최초 컴파일 (9-1②)   · 두 번째 소스 필드 매핑 (9-2②)   · 자가 치유 재컴파일 (9-3③)
// 정기 수집·API·MCP 경로에는 이 모듈이 등장하지 않는다. 그 사실이 이 설계의 전부다.
//
// ── 죽지 않는 규칙 ──────────────────────────────────────────────────────
// API 키가 없거나 한도를 넘겨도 **던지지 않는다.** 결과 객체로 상태를 돌려주고,
// 호출부는 그걸 `needs_attention` 으로 옮긴다 (원칙 ④ · 15장).

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { GoogleGenAI } from '@google/genai'

import { getConfig } from '../config'
import { childLogger } from '../logger'
import { consumeBudget, type BudgetScope } from './budget'

const log = childLogger({ mod: 'gemini' })

export type GeminiFailureReason =
  /** GEMINI_API_KEY 가 비어 있다 */
  | 'no_api_key'
  /** 오늘 예산을 다 썼다 (15장) */
  | 'budget_exhausted'
  /** 429 — 잠깐 몰림·하루 한도·결제 막힘 셋 중 하나 (아래 classifyRateLimit) */
  | 'quota'
  /** 안전 필터 등으로 응답이 비었다 */
  | 'empty'
  /** 그 밖의 오류 */
  | 'error'

export type GeminiOutcome =
  | { ok: true; text: string; cached: boolean; model: string }
  | { ok: false; reason: GeminiFailureReason; message: string }

export interface GeminiJsonRequest {
  /** 어느 모델을 쓸지 — 호출부가 config 에서 골라 넣는다 */
  model: string
  /** 시스템 지시. 프롬프트는 prompts/ 에 있다 */
  system?: string
  /** 사용자 프롬프트 */
  prompt: string
  /** 구조화 출력 스키마 (core 의 buildAdapterSpecResponseSchema 등) */
  responseSchema?: unknown
  /** 예산 계정 */
  scope: BudgetScope
  /** 로그·캐시 키에 쓰이는 이름 */
  purpose: string
  temperature?: number
}

// ── 클라이언트 ─────────────────────────────────────────────────────────

// note 는 부팅 로그·CLI 전용이다 — 화면으로 나가는 message 와 이름부터 갈라 둔다
// (guardrails.test 가 message: 리터럴만 검사하므로, 여기 환경변수 이름을 적어도 된다)
export type GeminiStatus = { ready: true; model: string } | { ready: false; note: string }

let client: GoogleGenAI | null = null

/** 키가 없으면 만들지 않는다. import 만으로는 아무 일도 일어나지 않는다 */
function getClient(): GoogleGenAI | null {
  const apiKey = getConfig().geminiApiKey
  if (apiKey === undefined) return null
  if (client === null) client = new GoogleGenAI({ apiKey })
  return client
}

/** 부팅 시 한 줄 로그와 CLI 안내에 쓴다 (화면용 아님) */
export function geminiStatus(): GeminiStatus {
  const cfg = getConfig()
  if (cfg.geminiApiKey === undefined) {
    return {
      ready: false,
      note: 'GEMINI_API_KEY 가 비어 있습니다. 새 사이트를 읽어내는 기능은 꺼진 채로 돕니다.',
    }
  }
  return { ready: true, model: cfg.geminiModelCompile }
}

// ── 호출 ───────────────────────────────────────────────────────────────

/**
 * 구조화 JSON 을 한 번 받아온다. 반환은 **문자열** 이다 —
 * 파싱과 검증은 core 의 `parseGeminiSpecOutput` 가 단독으로 책임진다 (관문을 한 곳에 모은다).
 */
export async function generateJson(req: GeminiJsonRequest): Promise<GeminiOutcome> {
  const cfg = getConfig()

  const ai = getClient()
  if (ai === null) {
    // 환경변수 이름(GEMINI_API_KEY)은 부팅 로그·CLI(geminiStatus)에만 남긴다.
    // 이 message 는 컴파일 실패를 타고 화면까지 가므로 사람 문장이어야 한다 (B2·B4).
    return {
      ok: false,
      reason: 'no_api_key',
      message: '지금은 새 사이트를 읽어내는 기능이 꺼져 있어요. 잠시 뒤 다시 시도해 주세요.',
    }
  }

  // 개발 중 쿼터 소진 방지 — 같은 입력이면 디스크 캐시에서 준다
  const key = cacheKeyOf(req)
  const cached = await readCache(key)
  if (cached !== null) {
    log.debug({ purpose: req.purpose }, '캐시에서 응답')
    return { ok: true, text: cached, cached: true, model: req.model }
  }

  const budget = await consumeBudget(req.scope)
  if (!budget.allowed) {
    return { ok: false, reason: 'budget_exhausted', message: budget.message ?? '오늘 시도 횟수를 다 썼어요.' }
  }

  const prompt =
    req.prompt.length > cfg.llmMaxInputChars
      ? `${req.prompt.slice(0, cfg.llmMaxInputChars)}\n\n(입력이 길어 이후는 생략했습니다)`
      : req.prompt

  try {
    const res = await ai.models.generateContent({
      model: req.model,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        ...(req.responseSchema !== undefined ? { responseSchema: req.responseSchema } : {}),
        ...(req.system !== undefined ? { systemInstruction: req.system } : {}),
        temperature: req.temperature ?? 0,
      },
    })

    const text = res.text
    if (text === undefined || text.trim() === '') {
      // "모델" 도 내부 명사다 — 화면에는 결과만 말한다 (B2)
      return { ok: false, reason: 'empty', message: '이 사이트를 읽어내지 못했어요. 잠시 뒤 다시 시도해 주세요.' }
    }

    await writeCache(key, text)
    log.info({ purpose: req.purpose, model: req.model, used: budget.used, limit: budget.limit }, 'Gemini 호출')
    return { ok: true, text, cached: false, model: req.model }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const quota = /429|quota|RESOURCE_EXHAUSTED/i.test(message)
    if (!quota) {
      log.warn({ purpose: req.purpose }, `Gemini 호출 실패: ${message}`)
      return { ok: false, reason: 'error', message: '지금은 이 사이트를 읽어내지 못했어요.' }
    }
    const kind = classifyRateLimit(message)
    // 원문을 로그에 남긴다 — 화면 문구는 원인을 단정하지 않으므로, 진짜 원인은 여기서만 보인다
    log.warn({ purpose: req.purpose, kind }, `Gemini 호출 거절(429): ${message}`)
    return { ok: false, reason: 'quota', message: RATE_LIMIT_MESSAGES[kind] }
  }
}

// ── 429 는 한 가지가 아니다 (2026-07-27 실측) ──────────────────────────
//
// 처음에는 429 를 전부 "오늘 쓸 수 있는 분량을 다 썼어요" 라고 말했다. 그런데 실제로
// 받은 429 는 **결제 잔액이 0 이 된 것**이었고, 그날 우리가 쓴 호출은 몇 건뿐이었다.
// 문구를 믿은 사람은 "내일 되겠지" 하고 기다리지만 다음 날도 그다음 날도 안 풀린다 —
// 사람이 손대야만 풀리는 종류였기 때문이다.
//
// **모르는 원인을 아는 척 말하는 것이 결함이다.** 429 의 원인은 셋이고 사람이 할 일이
// 각각 다르다: 잠깐 몰린 것(기다리면 됨) · 하루치를 다 쓴 것(내일) · 결제가 막힌 것(사람).
// 오류 본문에서 갈리는 만큼만 말하고, 안 갈리면 원인을 단정하지 않는다 (B4).

export type RateLimitKind = 'burst' | 'daily' | 'billing' | 'unknown'

export const RATE_LIMIT_MESSAGES: Record<RateLimitKind, string> = {
  burst: '요청이 잠깐 몰렸어요. 1~2분 뒤에 다시 시도해 주세요.',
  daily: '오늘 쓸 수 있는 분량을 다 썼어요. 내일 다시 시도하면 됩니다.',
  billing: '새 사이트를 읽어내는 기능이 지금 막혀 있어요. 시간이 지나도 저절로 풀리지 않는 종류라, 설정을 한 번 봐주셔야 합니다.',
  unknown: '지금은 새 사이트를 읽어내지 못했어요. 잠시 뒤 다시 해보고, 계속 같으면 설정을 한 번 봐주세요.',
}

/**
 * 429 본문에서 원인을 읽는다. 확실하지 않으면 `unknown` — 찍지 않는다.
 *
 * 순서가 중요하다. **무료 티어 하루 한도 본문에도 "billing details" 가 들어간다** —
 * `billing` 한 단어로 가르면 하루 한도를 결제 문제로 잘못 말한다. 그래서 결제 판정은
 * 잔액·결제수단을 직접 가리키는 말(prepayment credits / purchase / billing account)만 본다.
 */
export function classifyRateLimit(message: string): RateLimitKind {
  if (/prepay|credit|purchase|payment method|billing account/i.test(message)) return 'billing'
  if (/per\s?day|daily/i.test(message)) return 'daily'
  if (/per\s?minute|rate limit/i.test(message)) return 'burst'
  return 'unknown'
}

// ── 디스크 캐시 (LLM_CACHE_DIR) ────────────────────────────────────────

function cacheKeyOf(req: GeminiJsonRequest): string {
  const h = createHash('sha256')
  h.update(req.model)
  h.update(' ')
  h.update(req.system ?? '')
  h.update(' ')
  h.update(req.prompt)
  h.update(' ')
  h.update(JSON.stringify(req.responseSchema ?? null))
  return `${req.purpose}-${h.digest('hex').slice(0, 32)}.json`
}

async function readCache(name: string): Promise<string | null> {
  const cfg = getConfig()
  if (!cfg.llmCacheEnabled) return null
  try {
    return await readFile(join(cfg.llmCacheDir, name), 'utf8')
  } catch {
    return null
  }
}

async function writeCache(name: string, text: string): Promise<void> {
  const cfg = getConfig()
  if (!cfg.llmCacheEnabled) return
  try {
    await mkdir(cfg.llmCacheDir, { recursive: true })
    await writeFile(join(cfg.llmCacheDir, name), text, 'utf8')
  } catch {
    // 캐시는 있으면 좋은 것이지 필수가 아니다
  }
}
