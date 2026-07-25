// 실행 기록 — 기획서 10장 `runs`
// 스키마가 곧 검증기다 (원칙 ⑤): 수집 결과를 스키마에 통과시키는 것만으로 드리프트가 감지된다.

import { z } from 'zod'

/**
 * 실행 결과. G0 계약 (1)
 * - `ok`      스키마 검증 통과
 * - `drift`   뽑히긴 했는데 기준선에서 벗어났다 (null 비율 급증 등)
 * - `healed`  깨졌다가 스스로 고쳐서 다시 통과했다
 * - `failed`  못 뽑았다
 */
export const RUN_STATUSES = ['ok', 'drift', 'healed', 'failed'] as const
export type RunStatus = (typeof RUN_STATUSES)[number]
export const RunStatusSchema = z.enum(RUN_STATUSES)

/** 필드 하나에 대한 검증 통계 */
export const FieldValidationSchema = z.object({
  /** 값이 비어 있던 비율 0~1 */
  null_ratio: z.number().min(0).max(1),
  /** 타입 정규화에 실패한 비율 0~1 */
  type_fail_ratio: z.number().min(0).max(1),
  /** 실패한 원본 값 예시 (정규화 파서 개선과 치유 프롬프트에 쓴다) */
  samples: z.array(z.string()).max(5).default([]),
})

export type FieldValidation = z.infer<typeof FieldValidationSchema>

/**
 * `runs.validation_json` · `adapters.validation_json` 이 공유하는 형태.
 * 어댑터 승격의 근거이자 드리프트 판정의 입력이다.
 */
export const ValidationReportSchema = z.object({
  checked_at: z.string(),
  items_found: z.number().int().min(0),
  /** 키는 컬렉션 스키마의 필드 키 */
  fields: z.record(z.string(), FieldValidationSchema).default({}),
  /** 전체 판정 */
  passed: z.boolean(),
  /** 판정 근거를 사람 말로. 화면 노출 가능해야 한다 (보장선 B4) */
  notes: z.array(z.string()).default([]),
})

export type ValidationReport = z.infer<typeof ValidationReportSchema>

/** 기획서 10장 `runs` */
export interface Run {
  id: string
  source_id: string
  /** 어댑터를 고르기도 전에 실패할 수 있으므로 null 을 허용한다 */
  adapter_id: string | null
  started_at: Date
  finished_at: Date | null
  status: RunStatus
  items_found: number
  items_new: number
  validation_json: ValidationReport | null
  /** 사용자에게 보여줄 상태 문구. 내부 용어·HTTP 코드·스택 금지 (보장선 B4) */
  error_summary: string | null
}

export type RunInput = Omit<Run, 'id'>
