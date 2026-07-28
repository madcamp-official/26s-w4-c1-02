// 자연어 → 소스 후보 제안 (ADR A42 · 기능 ② 온보딩 보조)
//
//   입력: 사용자가 자연어로 쓴 요청 ("경기도 창업 지원사업")
//   출력: 후보 URL 목록 {url, title, why} — **제안일 뿐, 붙이지 않는다**
//
// A42 의 세 선:
//  ① 사용자가 요청했을 때만 호출 (자동·주기 없음)  ② 자동 추가 안 함 (사용자가 골라 붙임)
//  ③ LLM 은 컴파일 경로에만 (생성 시 사용자 클릭 1회 · 정기 수집엔 0)
//
// 파서가 관문이다 (match-fields·map-enums 선례 — worker 는 zod 를 안 문다):
//  - http(s) 로 파싱되는 URL 만 통과 · 사설/로컬 호스트 제거
//  - host+path 로 중복 제거 · 이미 넣은 주소 제거 · 개수 상한
//  - 지어낸 빈 값 버림. 살아남은 게 없으면 빈 목록 (그건 실패가 아니라 "못 찾음")

import { isPrivateHost } from '@endpointer/core/spec'

import { childLogger } from '../logger'
import { getConfig } from '../config'
import { generateJson, type GeminiFailureReason } from './gemini'
import {
  buildSuggestPrompt,
  buildSuggestResponseSchema,
  SUGGEST_SOURCES_SYSTEM,
} from './prompts/suggest-sources'

const log = childLogger({ mod: 'suggest' })

/** 한 번에 돌려줄 후보 상한 — 너무 많으면 고르기가 일이 된다 */
const MAX_CANDIDATES = 6

export interface SourceSuggestion {
  url: string
  title: string
  /** 왜 맞는지 — 없을 수 있다 */
  why: string | null
}

export interface SuggestInput {
  query: string
  ownerId: string
  already?: readonly string[]
}

export type SuggestOutcome =
  | { ok: true; candidates: SourceSuggestion[] }
  | { ok: false; reason: GeminiFailureReason | 'bad_output'; message: string }

export async function suggestSources(input: SuggestInput): Promise<SuggestOutcome> {
  const cfg = getConfig()
  const query = input.query.trim()
  if (query === '') {
    return { ok: false, reason: 'bad_output', message: '무엇을 모으고 싶은지 한 줄로 적어 주세요.' }
  }

  const out = await generateJson({
    model: cfg.geminiModelMatch,
    system: SUGGEST_SOURCES_SYSTEM,
    prompt: buildSuggestPrompt({ query, already: input.already ?? [] }),
    responseSchema: buildSuggestResponseSchema(),
    scope: { kind: 'suggest', owner_id: input.ownerId },
    purpose: 'suggest-sources',
  })

  if (!out.ok) return { ok: false, reason: out.reason, message: out.message }

  const candidates = parseSuggestOutput(out.text, input.already ?? [])
  log.info({ query: query.slice(0, 60), candidates: candidates.length }, '소스 후보 제안')
  return { ok: true, candidates }
}

/** URL 을 host+path 로 정규화 — 중복 판정 기준. 쿼리·프래그먼트·트레일링 슬래시를 턴다 */
function identityOf(url: URL): string {
  const path = url.pathname.replace(/\/+$/, '')
  return `${url.host.toLowerCase()}${path}`
}

/**
 * 모델 출력을 후보 목록으로 굳힌다. 관문을 통과한 것만 남긴다.
 * 실패(형태가 아예 아님)와 "없음"을 구분하지 않는다 — 둘 다 빈 목록으로 족하다
 * (호출부가 빈 목록을 "확실한 게 없어요" 로 말한다).
 */
export function parseSuggestOutput(raw: unknown, already: readonly string[]): SourceSuggestion[] {
  let input: unknown = raw
  if (typeof raw === 'string') {
    try {
      input = JSON.parse(stripFence(raw))
    } catch {
      return []
    }
  }
  if (input === null || typeof input !== 'object') return []
  const list = (input as Record<string, unknown>)['candidates']
  if (!Array.isArray(list)) return []

  const seen = new Set<string>()
  for (const raw of already) {
    try {
      seen.add(identityOf(new URL(raw)))
    } catch {
      // 이미 넣은 주소가 이상하면 무시
    }
  }

  const out: SourceSuggestion[] = []
  for (const entry of list) {
    if (out.length >= MAX_CANDIDATES) break
    if (entry === null || typeof entry !== 'object') continue
    const { url, title, why } = entry as Record<string, unknown>
    if (typeof url !== 'string' || typeof title !== 'string') continue

    let parsed: URL
    try {
      parsed = new URL(url.trim())
    } catch {
      continue // 완전한 http(s) 주소가 아니면 버린다
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue
    if (isPrivateHost(parsed.hostname)) continue // 사설/로컬은 제안하지 않는다

    const id = identityOf(parsed)
    if (seen.has(id)) continue
    seen.add(id)

    const cleanTitle = title.trim()
    if (cleanTitle === '') continue
    out.push({
      url: parsed.toString(),
      title: cleanTitle.slice(0, 120),
      why: typeof why === 'string' && why.trim() !== '' ? why.trim().slice(0, 200) : null,
    })
  }
  return out
}

/** ```json … ``` 울타리를 벗긴다 (map-enums 와 같은 손질) */
function stripFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  return (fenced?.[1] ?? text).trim()
}
