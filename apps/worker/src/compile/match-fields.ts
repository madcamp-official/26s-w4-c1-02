// 두 번째 소스 필드 매핑 (기획서 9-2② · 기능 ② — 제품의 정체성)
//
//   출력: 필드별 경로 + 확신도 + **못 찾은 필드 목록**
//   → 전부 찾음: 바로 표에 합류
//   → 일부 못 찾음: 그 필드만 사용자에게 물어봄 → 붙여넣은 값을 trace-value.ts 가 역추적
//
// **못 찾은 필드 목록이 이 함수의 절반이다.** "전부 찾음" 을 자주 내야 제품을 쓸 이유가 있고,
// 못 찾았을 때 정직해야 보장선 B1 이 성립한다.
//
// TODO(G2): 확신도 기준선을 실제 사이트로 조정한다 (G2 강등 규칙 1 — 기준을 낮춰 더 많이 시도).

import type { CollectionSchemaJson } from '@endpointer/core'

import { getConfig } from '../config'
import { childLogger } from '../logger'
import { sampleRows } from '../probe/scan'
import type { RankedCandidate } from '../probe/types'
import { generateJson, type GeminiFailureReason } from './gemini'
import { buildMatchPrompt, buildMatchResponseSchema, MATCH_SYSTEM } from './prompts'

const log = childLogger({ mod: 'match' })

/** 이 값 미만이면 "찾았다" 로 치지 않고 사용자에게 물어본다 */
export const DEFAULT_MIN_CONFIDENCE = 0.6

export interface FieldMatch {
  /** 항목 하나를 기준으로 한 경로 */
  path: string
  /**
   * 뽑은 값을 그 칸의 모양으로 바꾸는 변환.
   * 경로만으로 안 되는 칸이 실제로 있다 — href 가 `javascript:go_view(178642);` 인 사이트에서
   * 링크 칸은 번호를 뽑아 주소 틀에 끼워야 값이 된다. 없으면 undefined.
   *
   * 검증은 하지 않고 그대로 실어 보낸다. **닫힌 연산자 집합 검사는 `validateSpec` 이 한다** —
   * 관문을 두 벌 만들면 한쪽에만 있는 구멍이 생긴다 (ADR A2).
   */
  transform?: unknown[]
  /** 0~1 */
  confidence: number
  /** 왜 이게 그 값이라고 판단했는지 (한국어 한 문장) */
  why: string | null
}

export interface MatchResult {
  /** 항목을 집는 경로 */
  list: string
  dedupe_key: string | null
  /** 확신도 기준을 넘긴 것만 */
  matched: Record<string, FieldMatch>
  /**
   * 못 찾았거나 확신도가 모자란 필드 키.
   * 화면은 **이 목록에 든 칸만** 사용자에게 물어본다 (보장선 B1).
   */
  missing: string[]
}

export type MatchOutcome =
  | { ok: true; result: MatchResult }
  | { ok: false; reason: GeminiFailureReason | 'bad_output'; message: string }

export interface MatchInput {
  collection_id: string
  schema: CollectionSchemaJson
  /** 이미 표에 들어 있는 아이템 표본 — "이 칸에는 이런 값" 의 실례 */
  existingSample: unknown[]
  /** 새 사이트의 probe 결과 후보 */
  candidate: RankedCandidate
  url: string
  minConfidence?: number
}

export async function matchFields(input: MatchInput): Promise<MatchOutcome> {
  const cfg = getConfig()
  const minConfidence = input.minConfidence ?? DEFAULT_MIN_CONFIDENCE

  const prompt = buildMatchPrompt({
    schema: input.schema,
    existingSample: sampleRows(input.existingSample, 4),
    // **`rows` 를 넘기면 안 된다.** html·browser 후보의 `rows` 는 화면에 보이는 **글자**라서
    // (probe/types.ts 의 rows 주석) 그걸 보여주면 LLM 이 CSS 경로를 짚을 자리가 없다 —
    // 그럼 `.tit`·`.organ` 같은 그럴듯한 선택자를 **지어내고**, 확신도는 1.0 으로 적는다.
    // 실제로 그래서 매핑이 "6개 전부 찾음" 인데 항목은 0개였다. discover.ts 와 같은 규칙이다.
    candidateSample: sampleRows(input.candidate.row_html ?? input.candidate.rows, 6),
    url: input.url,
    fetchMode: input.candidate.fetch_mode,
  })

  const out = await generateJson({
    // 두 번째 소스 매핑은 flash 계열 (기획서 8장 모델 배분 · .env 의 GEMINI_MODEL_MATCH)
    model: cfg.geminiModelMatch,
    system: MATCH_SYSTEM,
    prompt,
    responseSchema: buildMatchResponseSchema(input.schema),
    scope: { kind: 'match', collection_id: input.collection_id },
    purpose: 'match-fields',
  })

  if (!out.ok) return { ok: false, reason: out.reason, message: out.message }

  const parsed = parseMatchOutput(out.text, input.schema, input.candidate.list_path, minConfidence)
  if (parsed === null) {
    return {
      ok: false,
      reason: 'bad_output',
      message: '이 사이트의 값을 표의 칸에 맞추지 못했어요. 값을 직접 알려주시면 붙일 수 있어요.',
    }
  }

  log.info(
    { url: input.url, matched: Object.keys(parsed.matched).length, missing: parsed.missing.length },
    '필드 매핑',
  )
  return { ok: true, result: parsed }
}

/**
 * 모델 출력을 MatchResult 로 굳힌다.
 * 확신도가 모자라거나 경로가 비어 있으면 **matched 가 아니라 missing 으로 보낸다** —
 * 억지로 채운 매핑보다 "모르겠다" 가 낫다는 원칙이 여기서 실행된다.
 */
export function parseMatchOutput(
  raw: unknown,
  schema: CollectionSchemaJson,
  fallbackList: string,
  minConfidence: number,
): MatchResult | null {
  let input: unknown = raw
  if (typeof raw === 'string') {
    try {
      input = JSON.parse(stripFence(raw))
    } catch {
      return null
    }
  }
  if (input === null || typeof input !== 'object') return null
  const obj = input as Record<string, unknown>

  // **probe 가 찾은 경로가 이긴다.** probe 는 선택자를 실제로 돌려서 몇 행이 나오는지,
  // 화면 글자와 얼마나 겹치는지까지 보고 고른 것이다. LLM 의 것은 검증되지 않은 추측이라
  // 덮게 두면 확인된 값을 추측으로 바꾸는 꼴이 된다 (실제로 `css:.list_item` 이라는
  // 없는 선택자로 덮어써서 항목이 0개가 됐다).
  // TODO(G3): 그러면 애초에 물어보지 않는 게 맞다 — 응답 스키마에서 `list` 를 빼라.
  const llmList = typeof obj['list'] === 'string' ? obj['list'].trim() : ''
  const list = fallbackList.trim() !== '' ? fallbackList : llmList
  const dedupeRaw = obj['dedupe_key']
  const dedupe_key = typeof dedupeRaw === 'string' && dedupeRaw.trim() !== '' ? dedupeRaw : null

  const matchedRaw = obj['matched']
  const matchedObj =
    matchedRaw !== null && typeof matchedRaw === 'object' ? (matchedRaw as Record<string, unknown>) : {}

  const matched: Record<string, FieldMatch> = {}
  const missing: string[] = []

  for (const field of schema) {
    const entry = matchedObj[field.key]
    if (entry === null || typeof entry !== 'object') {
      missing.push(field.key)
      continue
    }
    const e = entry as Record<string, unknown>
    const path = typeof e['path'] === 'string' ? e['path'].trim() : ''
    const confidence = typeof e['confidence'] === 'number' ? e['confidence'] : 0
    if (path === '' || confidence < minConfidence) {
      missing.push(field.key)
      continue
    }
    const transform = Array.isArray(e['transform']) && e['transform'].length > 0 ? e['transform'] : undefined
    matched[field.key] = {
      path,
      ...(transform !== undefined ? { transform } : {}),
      confidence,
      why: typeof e['why'] === 'string' ? e['why'] : null,
    }
  }

  return { list, dedupe_key, matched, missing }
}

function stripFence(text: string): string {
  const trimmed = text.trim()
  const m = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/.exec(trimmed)
  return m?.[1] ?? trimmed
}
