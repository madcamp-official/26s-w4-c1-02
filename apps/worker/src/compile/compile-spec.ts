// 어댑터 스펙 최초 생성 (기획서 9-1② · 11장 · 원칙 ①②)
//
// ── 이 파일의 계약 ──────────────────────────────────────────────────────
//   1. responseSchema 는 **core 가 만든다** (`buildAdapterSpecResponseSchema`).
//      스펙 타입의 단일 출처가 코드·프롬프트·검증에 동시에 걸린다 (기획서 14장 실무 노트).
//   2. 돌아온 것은 **반드시 core 의 `validateSpec` 을 통과해야 한다.**
//      이건 프롬프트 신뢰가 아니라 계약 검사다 (기획서 11장).
//   3. 실패하면 오류 문장을 붙여 **재생성 1회.** 그 이상은 하지 않는다 (무료 티어 · 15장).
//
// TODO(G1): 실제 사이트 3곳으로 돌려 프롬프트를 조정한다. 구조는 여기서 고정이다.

import type { AdapterSpec, CollectionSchemaJson } from '@endpointer/core'
import {
  buildAdapterSpecResponseSchema,
  parseGeminiSpecOutput,
  PROMPTABLE_TRANSFORM_OPS,
  type SpecValidationOptions,
} from '@endpointer/core/spec'

import { getConfig } from '../config'
import { childLogger } from '../logger'
import { sampleRows } from '../probe/scan'
import type { RankedCandidate } from '../probe/types'
import { generateJson, type GeminiFailureReason } from './gemini'
import { buildCompilePrompt, buildHealPrompt, COMPILE_SYSTEM, type CompileCandidateBrief } from './prompts'

const log = childLogger({ mod: 'compile' })

export interface CompileInput {
  url: string
  host: string
  source_id: string
  schema: CollectionSchemaJson
  /** probe 가 고른 후보 (보통 `probeResult.best`) */
  candidate: RankedCandidate
  /** 페이지에 눈에 보이는 텍스트 */
  pageText: string
  /** 개발 중 로컬 픽스처를 대상으로 돌릴 때만 true */
  allowPrivateHosts?: boolean
}

export interface CompileAttempt {
  n: number
  ok: boolean
  errors: string[]
}

export type CompileResult =
  | { ok: true; spec: AdapterSpec; attempts: CompileAttempt[] }
  | {
      ok: false
      reason: GeminiFailureReason | 'invalid_spec'
      /** 화면에 그대로 나갈 수 있는 문구 (보장선 B2 · B4) */
      message: string
      /** 개발자용 상세 — 검증이 거절한 이유들 */
      errors: string[]
      attempts: CompileAttempt[]
    }

/** 프롬프트에 넣을 표본 개수. 많을수록 정확하지만 무료 티어 입력이 커진다 */
const SAMPLE_SIZE = 6

export async function compileSpec(input: CompileInput): Promise<CompileResult> {
  const cfg = getConfig()
  const attempts: CompileAttempt[] = []

  const responseSchema = buildAdapterSpecResponseSchema({ schema: input.schema })
  const validateOpts: SpecValidationOptions = {
    host: input.host,
    schema: input.schema,
    allowPrivateHosts: input.allowPrivateHosts ?? false,
  }

  const brief = toBrief(input.candidate)

  // 최초 시도 + 재생성 1회. 기획서 11장이 정한 횟수다.
  let previousErrors: string[] = []
  for (let n = 1; n <= 2; n += 1) {
    const prompt = buildCompilePrompt({
      url: input.url,
      host: input.host,
      schema: input.schema,
      candidate: brief,
      pageText: input.pageText,
      ops: PROMPTABLE_TRANSFORM_OPS,
      ...(previousErrors.length > 0 ? { previousErrors } : {}),
    })

    const out = await generateJson({
      model: cfg.geminiModelCompile,
      system: COMPILE_SYSTEM,
      prompt,
      responseSchema,
      scope: { kind: 'compile', source_id: input.source_id },
      purpose: 'compile-spec',
    })

    if (!out.ok) {
      attempts.push({ n, ok: false, errors: [out.message] })
      return { ok: false, reason: out.reason, message: out.message, errors: [out.message], attempts }
    }

    const parsed = parseGeminiSpecOutput(out.text, validateOpts)
    if (parsed.ok) {
      attempts.push({ n, ok: true, errors: [] })
      log.info({ host: input.host, attempt: n, mode: parsed.spec.fetch.mode }, '스펙 생성 성공')
      return { ok: true, spec: parsed.spec, attempts }
    }

    attempts.push({ n, ok: false, errors: parsed.errors })
    previousErrors = parsed.errors
    log.warn({ host: input.host, attempt: n, errors: parsed.errors }, '스펙 검증 실패')
  }

  return {
    ok: false,
    reason: 'invalid_spec',
    message: '이 사이트에서 목록을 읽어내는 방법을 만들지 못했어요. 잠시 뒤 다시 시도해 주세요.',
    errors: previousErrors,
    attempts,
  }
}

/**
 * 자가 치유 재컴파일 (기획서 9-3③).
 * 최초 생성과 같은 관문(validateSpec)을 쓰되, 프롬프트에 **무엇이 깨졌는지**를 넣는다.
 * 예산 계정이 `heal` 이라 하루 상한(HEAL_MAX_ATTEMPTS_PER_DAY)이 여기 걸린다.
 */
export async function recompileSpec(
  input: CompileInput & { previousSpec: AdapterSpec; brokenSummary: string },
): Promise<CompileResult> {
  const cfg = getConfig()
  const attempts: CompileAttempt[] = []

  const responseSchema = buildAdapterSpecResponseSchema({ schema: input.schema })
  const validateOpts: SpecValidationOptions = {
    host: input.host,
    schema: input.schema,
    allowPrivateHosts: input.allowPrivateHosts ?? false,
  }

  const prompt = buildHealPrompt({
    url: input.url,
    host: input.host,
    schema: input.schema,
    candidate: toBrief(input.candidate),
    pageText: input.pageText,
    ops: PROMPTABLE_TRANSFORM_OPS,
    previousSpec: input.previousSpec,
    brokenSummary: input.brokenSummary,
  })

  const out = await generateJson({
    model: cfg.geminiModelCompile,
    system: COMPILE_SYSTEM,
    prompt,
    responseSchema,
    scope: { kind: 'heal', source_id: input.source_id },
    purpose: 'heal-spec',
  })

  if (!out.ok) {
    attempts.push({ n: 1, ok: false, errors: [out.message] })
    return { ok: false, reason: out.reason, message: out.message, errors: [out.message], attempts }
  }

  const parsed = parseGeminiSpecOutput(out.text, validateOpts)
  if (parsed.ok) {
    attempts.push({ n: 1, ok: true, errors: [] })
    return { ok: true, spec: parsed.spec, attempts }
  }

  attempts.push({ n: 1, ok: false, errors: parsed.errors })
  return {
    ok: false,
    reason: 'invalid_spec',
    message: '이 사이트 구조가 바뀐 것 같아요. 자동으로 고쳐보려 했지만 아직 못 맞췄습니다.',
    errors: parsed.errors,
    attempts,
  }
}

function toBrief(candidate: RankedCandidate): CompileCandidateBrief {
  return {
    origin: candidate.origin,
    where: candidate.where,
    list_path: candidate.list_path,
    fetch_mode: candidate.fetch_mode,
    fetch_url: candidate.fetch_url,
    keys: candidate.keys,
    // dom 후보는 행 HTML 을 보여줘야 `css:` 경로를 쓸 수 있다. 겹침률 판정에 쓰는
    // `rows`(행 텍스트)를 그대로 보여주면 LLM 이 짚을 자리가 없다.
    sample: sampleRows(candidate.row_html ?? candidate.rows, SAMPLE_SIZE),
    overlap: candidate.overlap,
  }
}
