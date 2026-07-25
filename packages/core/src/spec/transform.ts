// 변환 연산자 실행기 — 닫힌 집합의 집행 지점 (기획서 11장 · 원칙 ② · ADR A2)
//
// ops.ts 가 "무엇이 있는가"를 정하고, 이 파일이 "그게 무슨 뜻인가"를 정한다.
// 판별 유니온을 exhaustive switch 로 받고 `default: assertNever(op)` 로 닫는다.
// 연산자를 추가하면 **여기서 컴파일이 깨진다.** 그게 의도다.
//
// 실패는 throw 가 아니라 결과 객체다. 아이템 하나의 필드 하나가 안 뽑혔다고
// 수집 전체가 죽으면 안 된다 (원칙 ④ 부분 성공). `default` 연산자가 실패를 흡수한다.

import type { DateParseOptions } from '../normalize'
import { parseDate, parseNumber } from '../normalize'
import type { TransformOp, TransformOpName, TransformPipeline } from './ops'

// ── 정규화 파서 ────────────────────────────────────────────────────────
//
// `date_parse` · `number_parse` 는 normalize/ 의 파서를 **그대로** 부른다. 여기서 다시 구현하지 않는다.
// 두 곳에 파서가 있으면 화면과 수집이 다른 값을 내고, 그 순간 "미리보기가 거짓말하지 않는다"가 깨진다.
// normalize/ 는 spec/ 을 모르므로 순환 참조도 없다.

// ── 실행 문맥 ──────────────────────────────────────────────────────────

export interface TransformContext {
  /** `absolute_url` 의 기준. 보통 spec.fetch.url */
  baseUrl?: string
  /** `date_parse` 의 기본 타임존. 기본 Asia/Seoul */
  timezone?: string
  /** 기준일 — `D-7` 같은 상대 표기를 푸는 기준. 기본 호출 시각 */
  now?: Date
}

// ── 결과 ───────────────────────────────────────────────────────────────

export type TransformOutcome =
  | { ok: true; value: unknown }
  | { ok: false; value: unknown; error: string }

export interface PipelineOutcome {
  ok: boolean
  value: unknown
  /** 실패했을 때의 사람이 읽을 수 있는 사유 (보장선 B4 — 화면에 그대로 못 쓰더라도 스택은 아니다) */
  error: string | null
  /** 어느 연산자에서 멈췄는지 */
  failedOp: TransformOpName | null
  /** `default` 연산자가 실패를 흡수했는지 */
  recoveredByDefault: boolean
}

// ── 보조 ───────────────────────────────────────────────────────────────

/** 새 연산자가 생기면 여기서 컴파일이 깨진다 — 닫힌 집합의 집행 */
function assertNever(x: never): never {
  throw new Error(`처리하지 않은 변환 연산자입니다: ${JSON.stringify(x)}`)
}

function fail(value: unknown, error: string): TransformOutcome {
  return { ok: false, value, error }
}

/** 비어 있다고 볼 값 — `default` 가 끼어드는 조건 */
export function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'number') return Number.isNaN(value)
  return false
}

/** 문자열 연산자의 입력 강제. 배열은 첫 원소를 쓴다 (`[*]` 로 하나만 걸린 경우) */
function asText(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    const first = value[0]
    return first === undefined ? null : asText(first)
  }
  return null
}

// ── 연산자 하나 ────────────────────────────────────────────────────────

/**
 * 연산자 하나를 값에 적용한다. `default` 는 파이프라인 문맥이 있어야 뜻이 서므로
 * 여기서는 "값이 비었으면 채운다"까지만 하고, 실패 흡수는 `runTransformPipeline` 이 맡는다.
 */
export function applyTransformOp(value: unknown, op: TransformOp, ctx: TransformContext = {}): TransformOutcome {
  switch (op.op) {
    case 'trim': {
      const text = asText(value)
      if (text === null) return fail(value, '값이 없어 공백을 정리하지 못했습니다')
      return { ok: true, value: text.trim() }
    }

    case 'collapse_space': {
      const text = asText(value)
      if (text === null) return fail(value, '값이 없어 공백을 정리하지 못했습니다')
      return { ok: true, value: text.replace(/\s+/g, ' ').trim() }
    }

    case 'regex_extract': {
      const text = asText(value)
      if (text === null) return fail(value, '값이 없어 패턴을 찾지 못했습니다')
      let re: RegExp
      try {
        re = new RegExp(op.pattern, op.flags)
      } catch {
        return fail(value, `정규식 '${op.pattern}' 을 쓸 수 없습니다`)
      }
      const m = re.exec(text)
      if (!m) return fail(value, `'${truncate(text)}' 에서 '${op.pattern}' 에 맞는 부분을 찾지 못했습니다`)
      const got = m[op.group]
      if (got === undefined) {
        return fail(value, `정규식 '${op.pattern}' 에 ${op.group}번 그룹이 없습니다`)
      }
      return { ok: true, value: got }
    }

    case 'replace': {
      const text = asText(value)
      if (text === null) return fail(value, '값이 없어 치환하지 못했습니다')
      let re: RegExp
      try {
        re = new RegExp(op.pattern, op.flags)
      } catch {
        return fail(value, `정규식 '${op.pattern}' 을 쓸 수 없습니다`)
      }
      return { ok: true, value: text.replace(re, op.replacement) }
    }

    case 'split': {
      const text = asText(value)
      if (text === null) return fail(value, '값이 없어 자르지 못했습니다')
      const parts = text.split(op.separator)
      const got = op.index < 0 ? parts[parts.length + op.index] : parts[op.index]
      if (got === undefined) {
        return fail(value, `'${truncate(text)}' 를 '${op.separator}' 로 잘랐을 때 ${op.index}번째 조각이 없습니다`)
      }
      return { ok: true, value: got }
    }

    case 'date_parse': {
      const text = asText(value)
      if (text === null) return fail(value, '값이 없어 날짜를 읽지 못했습니다')
      const opts: DateParseOptions = { now: ctx.now ?? new Date() }
      if (op.formats !== undefined) opts.formats = op.formats
      const timezone = op.timezone ?? ctx.timezone
      if (timezone !== undefined) opts.timezone = timezone
      const out = parseDate(text, opts)
      if (!out.ok) return fail(value, out.reason)
      // `상시`·`접수마감` 처럼 가리킬 날짜가 없는 표현은 iso 가 null 이다.
      // 실패가 아니라 "날짜가 없음" 이므로 null 을 그대로 흘린다.
      return { ok: true, value: out.value.iso }
    }

    case 'number_parse': {
      const text = asText(value)
      if (text === null) return fail(value, '값이 없어 숫자를 읽지 못했습니다')
      const out = parseNumber(text)
      if (!out.ok) return fail(value, out.reason)
      return { ok: true, value: out.value }
    }

    case 'multiply': {
      const n = toNumber(value)
      if (n === null) return fail(value, '숫자가 아니어서 단위를 곱하지 못했습니다')
      return { ok: true, value: n * op.by }
    }

    case 'absolute_url': {
      const text = asText(value)
      if (text === null) return fail(value, '값이 없어 주소를 만들지 못했습니다')
      const base = op.base ?? ctx.baseUrl
      if (base === undefined) {
        return fail(value, '기준 주소가 없어 상대 주소를 절대 주소로 바꾸지 못했습니다')
      }
      try {
        return { ok: true, value: new URL(text, base).toString() }
      } catch {
        return fail(value, `'${truncate(text)}' 로 주소를 만들지 못했습니다`)
      }
    }

    case 'template': {
      const text = asText(value)
      if (text === null) return fail(value, '값이 없어 주소를 조립하지 못했습니다')
      return { ok: true, value: op.value.replaceAll('{value}', text) }
    }

    case 'map': {
      const text = asText(value)
      if (text === null) return fail(value, '값이 없어 변환표를 적용하지 못했습니다')
      const mapped = op.mapping[text] ?? op.mapping[text.trim()]
      if (mapped !== undefined) return { ok: true, value: mapped }
      if (op.fallback !== undefined) return { ok: true, value: op.fallback }
      // fallback 이 없으면 원값을 통과시킨다 (ops.ts 주석의 약속)
      return { ok: true, value: text }
    }

    case 'default': {
      // 값이 이미 있으면 건드리지 않는다. 실패 흡수는 파이프라인이 처리한다.
      return isEmptyValue(value) ? { ok: true, value: op.value } : { ok: true, value }
    }

    case 'join': {
      if (Array.isArray(value)) {
        const parts = value.map((v) => asText(v)).filter((v): v is string => v !== null)
        return { ok: true, value: parts.join(op.separator) }
      }
      const text = asText(value)
      if (text === null) return fail(value, '값이 없어 이어붙이지 못했습니다')
      return { ok: true, value: text }
    }

    default:
      return assertNever(op)
  }
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const text = asText(value)
  if (text === null) return null
  const out = parseNumber(text)
  return out.ok ? out.value : null
}

function truncate(text: string, max = 40): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

// ── 파이프라인 ─────────────────────────────────────────────────────────

/**
 * 위에서부터 순서대로. 한 번 실패하면 뒤 연산자는 건너뛰되,
 * `default` 를 만나면 거기서 되살아난다 (기획서 11장 "`default` 실패 시 기본값").
 */
export function runTransformPipeline(
  input: unknown,
  pipeline: TransformPipeline | undefined,
  ctx: TransformContext = {},
): PipelineOutcome {
  let value: unknown = input
  let error: string | null = null
  let failedOp: TransformOpName | null = null
  let recoveredByDefault = false

  for (const op of pipeline ?? []) {
    if (error !== null) {
      // 실패 상태에서는 `default` 만 의미가 있다
      if (op.op === 'default') {
        value = op.value
        error = null
        failedOp = null
        recoveredByDefault = true
      }
      continue
    }

    const outcome = applyTransformOp(value, op, ctx)
    if (outcome.ok) {
      value = outcome.value
      if (op.op === 'default' && value === op.value) recoveredByDefault = true
    } else {
      error = outcome.error
      failedOp = op.op
      value = null
    }
  }

  return { ok: error === null, value: error === null ? value : null, error, failedOp, recoveredByDefault }
}
