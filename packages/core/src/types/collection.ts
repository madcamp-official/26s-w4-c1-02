// 컬렉션 — 사용자에게 노출되는 유일한 명사 (보장선 B2)
// 기획서 10장 `collections` 테이블 + `schema_json` 구조

import { z } from 'zod'

/** 공개 범위. G0 계약 (1) */
export const VISIBILITIES = ['private', 'unlisted', 'public'] as const
export type Visibility = (typeof VISIBILITIES)[number]
export const VisibilitySchema = z.enum(VISIBILITIES)

/**
 * 필드 타입. 정규화 파서와 검증기가 이 값으로 분기한다 (기획서 5장③ · 7장⑤).
 * G0 계약 (1)
 */
export const FIELD_TYPES = ['text', 'date', 'money', 'number', 'link', 'enum'] as const
export type FieldType = (typeof FIELD_TYPES)[number]
export const FieldTypeSchema = z.enum(FIELD_TYPES)

/** 필드 키는 REST 쿼리 파라미터로 그대로 쓰인다 (기획서 12장) — snake_case 소문자만 */
export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]*$/

/**
 * `collections.schema_json` 의 원소 (기획서 10장).
 * `mapping` 은 enum 타입일 때만 값을 가진다 — 예: `{ "R&D": "rnd", "기술개발": "rnd" }`
 */
export const FieldDefSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .regex(FIELD_KEY_PATTERN, '필드 키는 영어 소문자·숫자·밑줄만 쓸 수 있습니다'),
    label: z.string().min(1),
    type: FieldTypeSchema,
    required: z.boolean().default(false),
    mapping: z.record(z.string(), z.string()).nullable().default(null),
    /**
     * enum 값의 화면 표시 이름 — `{ 정규화키: 사람이 읽는 말 }`.
     * 예: `{ "rnd": "기술개발·R&D", "startup": "창업지원" }`
     *
     * **`mapping` 과 방향이 반대다.** mapping 은 여러 사이트의 원값을 하나의 키로 모으고(정규화),
     * 이건 그 키를 다시 사람 말로 돌려놓는다(표시). 둘 다 있어야 한다 —
     * API 는 안정적인 키를 내보내야 `?category=rnd` 가 성립하고(기획서 12장),
     * 화면은 `rnd` 가 아니라 "기술개발"을 보여줘야 한다(보장선 B2).
     * 없으면 화면은 키를 그대로 쓴다.
     */
    value_labels: z.record(z.string(), z.string()).nullable().default(null),
  })
  .refine((f) => f.type === 'enum' || f.mapping === null, {
    message: 'mapping 은 enum 타입 필드에만 쓸 수 있습니다',
    path: ['mapping'],
  })
  .refine((f) => f.type === 'enum' || f.value_labels === null, {
    message: 'value_labels 는 enum 타입 필드에만 쓸 수 있습니다',
    path: ['value_labels'],
  })

export type FieldDef = z.infer<typeof FieldDefSchema>

/** `collections.schema_json` 전체 — 필드 키는 컬렉션 안에서 유일해야 한다 */
export const CollectionSchemaJsonSchema = z
  .array(FieldDefSchema)
  .refine((fields) => new Set(fields.map((f) => f.key)).size === fields.length, {
    message: '필드 키가 중복됐습니다',
  })

export type CollectionSchemaJson = z.infer<typeof CollectionSchemaJsonSchema>

/** 기획서 10장 `collections` */
export interface Collection {
  id: string
  owner_id: string
  /** URL 과 API 경로에 쓰인다 (`GET /api/v1/{slug}`) */
  slug: string
  name: string
  schema_json: CollectionSchemaJson
  /** 필드 삭제 또는 타입 변경 시 증가 */
  schema_version: number
  visibility: Visibility
  /** 공개 API 호출용. visibility 가 private 일 때 필수 */
  api_key_hash: string | null
  created_at: Date
  updated_at: Date
}

/** 컬렉션 생성 입력 — 서버가 채우는 것(id·타임스탬프)을 뺀 형태 */
export type CollectionInput = Omit<Collection, 'id' | 'created_at' | 'updated_at'>
