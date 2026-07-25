// 변환 연산자 — 닫힌 집합 (기획서 11장 · 원칙 ② · ADR A2)
//
// 임의 코드 실행이 없으므로 표현력은 이 목록이 전부다.
// 여기 없는 변환이 필요하면 **연산자를 추가한다.** 코드 실행을 허용하지 않는다.
// 이 선이 무너지면 샌드박스가 필요해지고, 그 순간 5일 안에 끝나지 않는다.
//
// 알 수 없는 op 는 zod 파싱 단계에서 거부된다 (discriminatedUnion + strictObject).

import { z } from 'zod'

/**
 * 연산자 이름의 닫힌 집합. 검증기와 Gemini 프롬프트가 이 배열을 그대로 참조한다.
 * 순서는 기획서 11장 표와 같다.
 */
export const TRANSFORM_OPS = [
  'trim',
  'collapse_space',
  'regex_extract',
  'replace',
  'split',
  'date_parse',
  'number_parse',
  'multiply',
  'absolute_url',
  'template',
  'map',
  'default',
  'join',
] as const

export type TransformOpName = (typeof TRANSFORM_OPS)[number]
export const TransformOpNameSchema = z.enum(TRANSFORM_OPS)

/** 정규식 문법이 실제로 컴파일되는지까지 본다 — LLM 이 만든 패턴을 실행 전에 거른다 */
const RegexPatternSchema = z
  .string()
  .min(1)
  .refine(
    (p) => {
      try {
        new RegExp(p)
        return true
      } catch {
        return false
      }
    },
    { message: '정규식 문법이 올바르지 않습니다' },
  )

/** JS 정규식 플래그만 허용 */
const RegexFlagsSchema = z
  .string()
  .max(8)
  .regex(/^[dgimsuvy]*$/, '지원하지 않는 정규식 플래그입니다')

// ── 개별 연산자 ────────────────────────────────────────────────────────

/** 앞뒤 공백 제거 */
export const TrimOpSchema = z.strictObject({ op: z.literal('trim') })

/** 연속 공백·개행을 스페이스 하나로 접는다 */
export const CollapseSpaceOpSchema = z.strictObject({ op: z.literal('collapse_space') })

/** 패턴으로 잘라내기. `group` 이 0 이면 매치 전체 */
export const RegexExtractOpSchema = z.strictObject({
  op: z.literal('regex_extract'),
  pattern: RegexPatternSchema,
  flags: RegexFlagsSchema.optional(),
  group: z.number().int().min(0).max(20).default(0),
})

/** 치환. `pattern` 은 정규식으로 해석한다 */
export const ReplaceOpSchema = z.strictObject({
  op: z.literal('replace'),
  pattern: RegexPatternSchema,
  replacement: z.string(),
  flags: RegexFlagsSchema.default('g'),
})

/** 구분자로 자르고 n 번째. 음수 인덱스는 뒤에서부터 (-1 = 마지막) */
export const SplitOpSchema = z.strictObject({
  op: z.literal('split'),
  separator: z.string().min(1),
  index: z.number().int(),
})

/**
 * 포맷 후보 배열로 시도. `D-7`, `상시`, `~2026-08-21` 같은
 * 한국 목록 사이트 관용 표현은 파서가 내장으로 처리한다 (formats 없이도 동작).
 */
export const DateParseOpSchema = z.strictObject({
  op: z.literal('date_parse'),
  formats: z.array(z.string().min(1)).max(8).optional(),
  /** IANA 타임존. 기본 Asia/Seoul */
  timezone: z.string().min(1).optional(),
})

/** 콤마·단위 제거 후 숫자 */
export const NumberParseOpSchema = z.strictObject({ op: z.literal('number_parse') })

/** 단위 승수 (천원 → ×1000, 만원 → ×10000, 억 → ×100000000) */
export const MultiplyOpSchema = z.strictObject({
  op: z.literal('multiply'),
  by: z.number().finite(),
})

/** 상대경로 → 절대 URL. `base` 를 안 주면 fetch.url 을 기준으로 삼는다 */
export const AbsoluteUrlOpSchema = z.strictObject({
  op: z.literal('absolute_url'),
  base: z.string().min(1).optional(),
})

/** `{value}` 를 끼워 URL 등을 조립 */
export const TemplateOpSchema = z.strictObject({
  op: z.literal('template'),
  value: z
    .string()
    .min(1)
    .refine((v) => v.includes('{value}'), {
      message: 'template 의 value 에는 {value} 자리표시자가 있어야 합니다',
    }),
})

/** enum 값 매핑 (`"기술개발" → "rnd"`). 컬렉션 필드의 `mapping` 과 같은 형태 */
export const MapOpSchema = z.strictObject({
  op: z.literal('map'),
  mapping: z.record(z.string(), z.string()),
  /** 매핑에 없을 때 쓸 값. 없으면 원값을 그대로 통과시킨다 */
  fallback: z.string().optional(),
})

/** 앞 단계가 실패했거나 값이 비었을 때 쓸 기본값 */
export const DefaultOpSchema = z.strictObject({
  op: z.literal('default'),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
})

/** 배열을 문자열로 */
export const JoinOpSchema = z.strictObject({
  op: z.literal('join'),
  separator: z.string().default(', '),
})

// ── 닫힌 판별 유니온 ───────────────────────────────────────────────────

/**
 * 알 수 없는 `op` 는 여기서 거부된다. 이게 원칙 ② 의 집행 지점이다.
 * strictObject 라서 알 수 없는 **파라미터**도 함께 거부된다.
 */
export const TransformOpSchema = z.discriminatedUnion('op', [
  TrimOpSchema,
  CollapseSpaceOpSchema,
  RegexExtractOpSchema,
  ReplaceOpSchema,
  SplitOpSchema,
  DateParseOpSchema,
  NumberParseOpSchema,
  MultiplyOpSchema,
  AbsoluteUrlOpSchema,
  TemplateOpSchema,
  MapOpSchema,
  DefaultOpSchema,
  JoinOpSchema,
])

export type TransformOp = z.infer<typeof TransformOpSchema>

/** 한 필드에 걸리는 변환 파이프라인. 위에서부터 순서대로 적용된다 */
export const TransformPipelineSchema = z.array(TransformOpSchema).max(8)
export type TransformPipeline = z.infer<typeof TransformPipelineSchema>

/** 특정 op 만 좁혀 쓰고 싶을 때 (`Extract<TransformOp, { op: 'multiply' }>` 축약) */
export type TransformOpOf<N extends TransformOpName> = Extract<TransformOp, { op: N }>

/** 이름이 닫힌 집합 안에 있는지 — zod 를 돌리기 전 값싼 사전 검사용 */
export function isTransformOpName(name: string): name is TransformOpName {
  return (TRANSFORM_OPS as readonly string[]).includes(name)
}
