// 스펙 검증 (실행 전) — 기획서 11장 "스펙 검증"
//
// > LLM이 만든 스펙은 실행 전에 형태 검사를 통과해야 한다.
// > 통과 못 하면 오류 내용을 붙여 재생성 1회. 이건 프롬프트 신뢰가 아니라 계약 검사다.
//
// 그래서 이 파일의 출력은 boolean 이 아니라 **문장 목록**이다. errors 의 각 줄은
// 그대로 Gemini 재생성 프롬프트에 붙는다. "invalid" 같은 말은 쓸모가 없다.
// 무엇이 · 어디서 · 어떻게 틀렸고 · 대신 뭘 해야 하는지가 한 줄에 들어가야 한다.
//
// 호스트 검사는 LLM 이 엉뚱한 사이트로 나가는 것을 막는 장치이면서
// 동시에 **SSRF 방어**다. 사용자가 준 URL 을 그대로 서버가 두드리는 구조이므로
// localhost·사설 IP·메타데이터 엔드포인트로 향하는 스펙은 여기서 끊는다.

import type { CollectionSchemaJson } from '../types/collection'
import { checkPathSyntax } from './paths'
import { isTransformOpName, TRANSFORM_OPS } from './ops'
import type { AdapterSpec } from './spec'
import { AdapterSpecSchema, MAX_PAGES, specTargetsHost } from './spec'

export interface SpecValidationOptions {
  /** 사용자가 준 호스트 (`sources.host`). 스펙의 fetch.url 이 여기를 향해야 한다 */
  host: string
  /** 컬렉션 스키마. 주면 required 필드가 스펙에 다 있는지까지 본다 */
  schema?: CollectionSchemaJson
  /**
   * 사설 주소를 허용할지. 기본 false.
   * 개발 중 로컬 픽스처 서버를 대상으로 돌릴 때만 true 로 연다.
   */
  allowPrivateHosts?: boolean
}

export type SpecValidationResult = { ok: true; spec: AdapterSpec } | { ok: false; errors: string[] }

/**
 * 실행 전 계약 검사. 통과하면 기본값이 채워진 스펙을, 아니면 재생성 프롬프트용 문장들을 돌려준다.
 */
export function validateSpec(input: unknown, opts: SpecValidationOptions): SpecValidationResult {
  const errors: string[] = []

  // ── 0. zod 이전에 사람이 읽을 수 있는 형태로 잡아둘 것들 ───────────────
  // zod 의 discriminatedUnion 실패 메시지는 "알 수 없는 op" 를 알려주지 않고
  // "어느 갈래에도 안 맞음" 으로만 말한다. 재생성 프롬프트에 그건 쓸모가 없다.
  errors.push(...findUnknownOps(input))

  // ── 1. 스키마 파싱 (zod 가 1차 관문) ───────────────────────────────────
  const parsed = AdapterSpecSchema.safeParse(input)
  if (!parsed.success) {
    errors.push(...formatZodIssues(parsed.error.issues))
    return { ok: false, errors: dedupe(errors) }
  }
  const spec = parsed.data

  // ── 2. fetch.url 의 호스트가 사용자가 준 호스트와 같은가 ───────────────
  errors.push(...checkTargetHost(spec, opts))

  // ── 3. 경로 문법 (zod 가 본 것보다 한 단계 더 — 실제로 파싱까지 해본다) ─
  const mode = spec.fetch.mode
  pushIf(errors, checkPathSyntax(spec.list, mode, "'list' 경로"))
  if (spec.dedupe_key !== undefined) {
    pushIf(errors, checkPathSyntax(spec.dedupe_key, mode, "'dedupe_key' 경로"))
  }
  for (const [key, field] of Object.entries(spec.fields)) {
    pushIf(errors, checkPathSyntax(field.path, mode, `'${key}' 필드의 경로`))
  }
  if (spec.pagination.kind === 'next_link') {
    pushIf(errors, checkPathSyntax(spec.pagination.path, mode, "'pagination.path' 경로"))
  }

  // ── 4. max_pages 상한 (ADR A12) ────────────────────────────────────────
  if (spec.pagination.kind === 'page_param' || spec.pagination.kind === 'next_link') {
    if (spec.pagination.max_pages > MAX_PAGES) {
      errors.push(`'pagination.max_pages' 는 ${MAX_PAGES} 이하여야 합니다 (받은 값: ${spec.pagination.max_pages})`)
    }
  }
  if (spec.pagination.kind === 'scroll' && spec.pagination.times > MAX_PAGES) {
    errors.push(`'pagination.times' 는 ${MAX_PAGES} 이하여야 합니다 (받은 값: ${spec.pagination.times})`)
  }

  // ── 5. 스키마의 required 필드가 스펙에 다 있는가 ───────────────────────
  if (opts.schema) {
    const specKeys = new Set(Object.keys(spec.fields))
    const known = new Set(opts.schema.map((f) => f.key))
    for (const field of opts.schema) {
      if (field.required && !specKeys.has(field.key)) {
        errors.push(`'${field.key}' 는 반드시 있어야 하는 필드입니다. 'fields' 에 '${field.key}' 를 추가해 주세요`)
      }
    }
    for (const key of specKeys) {
      if (!known.has(key)) {
        errors.push(
          `'${key}' 는 이 표에 없는 필드입니다. 쓸 수 있는 필드는 ${[...known].map((k) => `'${k}'`).join(', ')} 입니다`,
        )
      }
    }
    // 타입 불일치 — 스펙이 date 라고 했는데 표가 money 면 정규화가 어긋난다
    const typeByKey = new Map(opts.schema.map((f) => [f.key, f.type]))
    for (const [key, field] of Object.entries(spec.fields)) {
      const expected = typeByKey.get(key)
      if (expected !== undefined && expected !== field.type) {
        errors.push(`'${key}' 필드의 type 은 '${expected}' 여야 합니다 (받은 값: '${field.type}')`)
      }
    }
  }

  return errors.length === 0 ? { ok: true, spec } : { ok: false, errors: dedupe(errors) }
}

// ── 호스트 · SSRF ──────────────────────────────────────────────────────

function checkTargetHost(spec: AdapterSpec, opts: SpecValidationOptions): string[] {
  const errors: string[] = []
  const resolved = spec.fetch.url.replace('{page}', '1')

  let url: URL
  try {
    url = new URL(resolved)
  } catch {
    return [`'fetch.url' 이 올바른 주소가 아닙니다 (받은 값: '${spec.fetch.url}')`]
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    errors.push(`'fetch.url' 은 http:// 또는 https:// 로 시작해야 합니다 (받은 값: '${spec.fetch.url}')`)
  }
  if (url.username !== '' || url.password !== '') {
    errors.push("'fetch.url' 에 아이디·비밀번호를 넣을 수 없습니다")
  }
  if (!specTargetsHost(spec, opts.host)) {
    errors.push(
      `'fetch.url' 은 ${opts.host} 를 가리켜야 합니다. 다른 사이트 주소를 쓸 수 없습니다 (받은 값: '${spec.fetch.url}')`,
    )
  }
  if (!opts.allowPrivateHosts && isPrivateHost(url.hostname)) {
    errors.push(`'fetch.url' 이 내부망 주소를 가리키고 있습니다 (받은 값: '${url.hostname}')`)
  }

  return errors
}

/** localhost · 사설 IP · 링크 로컬 · 클라우드 메타데이터. SSRF 방어의 최소선 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')

  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa')) return true
  if (host === 'metadata.google.internal') return true
  if (host === '::1' || host === '::' || host === '0:0:0:0:0:0:0:1') return true
  // IPv6 유니크 로컬(fc00::/7) · 링크 로컬(fe80::/10)
  if (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)) return true

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (v4) {
    const octets = v4.slice(1, 5).map(Number)
    const [a, b] = octets
    if (a === undefined || b === undefined) return true
    if (octets.some((n) => n > 255)) return true
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true // 링크 로컬 + 169.254.169.254 메타데이터
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true // 캐리어 그레이드 NAT
    return false
  }

  return false
}

// ── 알 수 없는 op ──────────────────────────────────────────────────────

/**
 * zod 에 넣기 전에 `op` 이름만 먼저 훑는다.
 * discriminatedUnion 의 실패 메시지로는 "무엇을 대신 쓰라"를 말할 수 없기 때문이다.
 */
export function findUnknownOps(input: unknown): string[] {
  const errors: string[] = []
  if (typeof input !== 'object' || input === null) return errors
  const fields = (input as Record<string, unknown>)['fields']
  if (typeof fields !== 'object' || fields === null) return errors

  for (const [key, field] of Object.entries(fields as Record<string, unknown>)) {
    if (typeof field !== 'object' || field === null) continue
    const transform = (field as Record<string, unknown>)['transform']
    if (!Array.isArray(transform)) continue
    for (const op of transform) {
      if (typeof op !== 'object' || op === null) continue
      const name = (op as Record<string, unknown>)['op']
      if (typeof name !== 'string') {
        errors.push(`'${key}' 필드의 transform 에 'op' 이름이 없는 항목이 있습니다`)
        continue
      }
      if (!isTransformOpName(name)) {
        errors.push(
          `'${key}' 필드의 '${name}' 는 쓸 수 없는 변환입니다. 쓸 수 있는 변환은 ${TRANSFORM_OPS.map((o) => `'${o}'`).join(', ')} 뿐입니다`,
        )
      }
    }
  }
  return errors
}

// ── zod 오류를 사람 문장으로 ───────────────────────────────────────────

interface ZodLikeIssue {
  path: PropertyKey[]
  message: string
  code?: string
}

/** zod 의 issue 배열을 재생성 프롬프트에 넣을 수 있는 한국어 문장으로 */
export function formatZodIssues(issues: readonly ZodLikeIssue[]): string[] {
  return issues.map((issue) => {
    const where = formatPath(issue.path)
    if (issue.code === 'unrecognized_keys') {
      return `${where}: ${issue.message}. 스펙에 없는 항목은 넣지 마세요`
    }
    return where === '스펙' ? issue.message : `${where}: ${issue.message}`
  })
}

function formatPath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return '스펙'
  const parts: string[] = []
  for (const seg of path) {
    if (typeof seg === 'number') {
      const last = parts.pop()
      parts.push(`${last ?? ''}[${seg}]`)
    } else {
      parts.push(String(seg))
    }
  }
  return `'${parts.join('.')}'`
}

// ── 보조 ───────────────────────────────────────────────────────────────

function pushIf(errors: string[], message: string | null): void {
  if (message !== null) errors.push(message)
}

function dedupe(errors: string[]): string[] {
  return [...new Set(errors)]
}
