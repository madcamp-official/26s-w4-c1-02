// 어댑터 — (Source × Schema) 추출 스펙, 버전 관리. 기획서 10장 `adapters`
// 사용자에게는 절대 노출하지 않는 명사다 (보장선 B2)

import { z } from 'zod'
import type { AdapterSpec } from '../spec/spec'
import type { ValidationReport } from './run'

/**
 * 어댑터 수명. G0 계약 (1)
 * - `candidate` 만들어졌고 아직 승격 전
 * - `active`    이 소스가 지금 쓰는 버전 (소스당 하나)
 * - `retired`   내려간 버전. 롤백 대상으로 남긴다
 */
export const ADAPTER_STATUSES = ['active', 'candidate', 'retired'] as const
export type AdapterStatus = (typeof ADAPTER_STATUSES)[number]
export const AdapterStatusSchema = z.enum(ADAPTER_STATUSES)

/**
 * 어디서 나왔는지. G0 계약 (1)
 * - `llm`   최초 컴파일
 * - `heal`  자가 치유가 만든 것
 * - `human` 사람이 손댄 것
 */
export const ADAPTER_ORIGINS = ['llm', 'heal', 'human'] as const
export type AdapterOrigin = (typeof ADAPTER_ORIGINS)[number]
export const AdapterOriginSchema = z.enum(ADAPTER_ORIGINS)

/** 기획서 10장 `adapters` */
export interface Adapter {
  id: string
  source_id: string
  /** 소스 안에서 1 부터 증가 */
  version: number
  spec_json: AdapterSpec
  origin: AdapterOrigin
  status: AdapterStatus
  /** 이 버전이 통과한 검증 결과 — 승격 근거 */
  validation_json: ValidationReport | null
  created_at: Date
}

export type AdapterInput = Omit<Adapter, 'id' | 'created_at'>
