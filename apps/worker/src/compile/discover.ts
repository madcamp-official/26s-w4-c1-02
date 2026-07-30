// 첫 소스의 어댑터 스펙 + 표 구성을 한 번에 만든다 (기획서 9-1②④ · 원칙 ①②)
//
// `compile-spec.ts` 는 **채울 칸이 이미 있을 때** 쓴다. 이 파일은 그 칸조차 없을 때 —
// 즉 컬렉션이 처음 생길 때 쓴다. 기획서 9-1 의 ②COMPILE 과 ④INFER SCHEMA 가 한 번의
// 호출로 같이 끝난다.
//
// ── 왜 한 번인가 ────────────────────────────────────────────────────────
// 스펙을 먼저 만들고 스키마를 나중에 추론하면 두 번 부르게 되고, 무료 티어에서 호출 수는
// 그대로 비용이다 (P6 · 원칙 ①). 게다가 "이 값이 마감일이다" 라는 판단과 "마감일은 여기서
// 뽑는다" 라는 판단은 같은 판단이라, 쪼개면 두 결과가 어긋날 수 있다.
//
// ── 계약은 compileSpec 과 같다 ──────────────────────────────────────────
//   1. responseSchema 는 core 가 만든다 (`buildDiscoveryResponseSchema`)
//   2. 돌아온 것은 반드시 core 의 검증을 통과한다 (`parseDiscoveryOutput` → `validateSpec`)
//   3. 실패하면 오류 문장을 붙여 재생성 1회. 그 이상은 하지 않는다

import type { AdapterSpec, CollectionSchemaJson } from '@endpointer/core'
import { buildDiscoveryResponseSchema, parseDiscoveryOutput, PROMPTABLE_TRANSFORM_OPS } from '@endpointer/core/spec'

import { getConfig } from '../config'
import { childLogger } from '../logger'
import { sampleRows } from '../probe/scan'
import type { RankedCandidate } from '../probe/types'
import { generateJson, type GeminiFailureReason } from './gemini'
import { buildDiscoverPrompt, DISCOVER_SYSTEM, type CompileCandidateBrief } from './prompts'
import { repairSpecDraft } from './repair-draft'

const log = childLogger({ mod: 'discover' })

/** 프롬프트에 넣을 표본 개수. 많을수록 정확하지만 무료 티어 입력이 커진다 */
const SAMPLE_SIZE = 6

export interface DiscoverInput {
  url: string
  host: string
  /** 예산 계정용. 아직 소스 행이 없으므로 컬렉션 생성 흐름에서는 임시 키가 온다 */
  scope_id: string
  /** probe 가 고른 후보 (보통 `probeResult.best`) */
  candidate: RankedCandidate
  /** 페이지에 눈에 보이는 텍스트 */
  pageText: string
  /** 개발 중 로컬 픽스처를 대상으로 돌릴 때만 true */
  allowPrivateHosts?: boolean
}

export interface DiscoverAttempt {
  n: number
  ok: boolean
  errors: string[]
}

export type DiscoverResult =
  | {
      ok: true
      /** 표의 구성 — 그대로 `collections.schema_json` 이 된다 */
      schema: CollectionSchemaJson
      /** 뽑는 방법 — 그대로 `adapters.spec_json` 이 된다 */
      spec: AdapterSpec
      attempts: DiscoverAttempt[]
    }
  | {
      ok: false
      reason: GeminiFailureReason | 'invalid_spec'
      /** 화면에 그대로 나갈 수 있는 문구 (보장선 B2 · B4) */
      message: string
      /** 개발자용 상세 — 검증이 거절한 이유들 */
      errors: string[]
      attempts: DiscoverAttempt[]
    }

export async function discoverSpec(input: DiscoverInput): Promise<DiscoverResult> {
  const cfg = getConfig()
  const attempts: DiscoverAttempt[] = []
  const responseSchema = buildDiscoveryResponseSchema()
  const brief = toBrief(input.candidate)

  let previousErrors: string[] = []
  // 최초 시도 + 재생성 1회. 기획서 11장이 정한 횟수다.
  for (let n = 1; n <= 2; n += 1) {
    const prompt = buildDiscoverPrompt({
      url: input.url,
      host: input.host,
      candidate: brief,
      pageText: input.pageText,
      ops: PROMPTABLE_TRANSFORM_OPS,
      ...(previousErrors.length > 0 ? { previousErrors } : {}),
    })

    const out = await generateJson({
      model: cfg.geminiModelCompile,
      system: DISCOVER_SYSTEM,
      prompt,
      responseSchema,
      scope: { kind: 'compile', source_id: input.scope_id },
      purpose: 'discover-spec',
    })

    if (!out.ok) {
      attempts.push({ n, ok: false, errors: [out.message] })
      return { ok: false, reason: out.reason, message: out.message, errors: [out.message], attempts }
    }

    // 기계적 표기 실수(css: 누락 · {page} 누락)를 먼저 교정한다 — 관문은 그대로 통과해야 한다
    const parsed = parseDiscoveryOutput(repairSpecDraft(out.text), {
      host: input.host,
      ...(input.allowPrivateHosts !== undefined ? { allowPrivateHosts: input.allowPrivateHosts } : {}),
    })

    if (parsed.ok) {
      attempts.push({ n, ok: true, errors: [] })
      log.info(
        { host: input.host, attempt: n, mode: parsed.spec.fetch.mode, columns: parsed.schema.length },
        '표 구성 생성 성공',
      )
      return { ok: true, schema: parsed.schema, spec: parsed.spec, attempts }
    }

    attempts.push({ n, ok: false, errors: parsed.errors })
    previousErrors = parsed.errors
    log.warn({ host: input.host, attempt: n, errors: parsed.errors }, '표 구성 검증 실패')
  }

  return {
    ok: false,
    reason: 'invalid_spec',
    message: '이 사이트에서 목록을 읽어내는 방법을 만들지 못했어요. 잠시 뒤 다시 시도해 주세요.',
    errors: previousErrors,
    attempts,
  }
}

function toBrief(candidate: RankedCandidate): CompileCandidateBrief {
  const src = candidate.source
  const method = src.kind === 'network' ? src.method : undefined
  const postBody = src.kind === 'network' ? src.post_body : undefined
  return {
    origin: candidate.origin,
    where: candidate.where,
    list_path: candidate.list_path,
    fetch_mode: candidate.fetch_mode,
    fetch_url: candidate.fetch_url,
    ...(method !== undefined ? { method } : {}),
    ...(postBody !== undefined ? { post_body: postBody } : {}),
    keys: candidate.keys,
    // dom 후보는 행 HTML 을 보여줘야 `css:` 경로를 쓸 수 있다. 겹침률 판정에 쓰는
    // `rows`(행 텍스트)를 그대로 보여주면 LLM 이 짚을 자리가 없다.
    sample: sampleRows(candidate.row_html ?? candidate.rows, SAMPLE_SIZE),
    overlap: candidate.overlap,
  }
}
