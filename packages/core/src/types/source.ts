// 소스 — 사용자에게는 "사이트" 또는 "출처"로 부른다 (보장선 B2)
// 기획서 10장 `sources` 테이블

import { z } from 'zod'

/**
 * 소스 상태. G0 계약 (1) · 트랙 계약 #5.
 * - `ok`               마지막 수집이 정상
 * - `healing`          깨진 것을 스스로 고치는 중 (마지막 성공 데이터를 계속 낸다 — 원칙 ④)
 * - `needs_attention`  자동으로 못 고쳤다. 사람이 봐야 한다
 * - `paused`           사용자가 멈춰둔 상태
 */
export const SOURCE_STATUSES = ['ok', 'healing', 'needs_attention', 'paused'] as const
export type SourceStatus = (typeof SOURCE_STATUSES)[number]
export const SourceStatusSchema = z.enum(SOURCE_STATUSES)

/**
 * 어느 경로로 뚫렸는지. probe 순서 = 내부 JSON → HTML → 브라우저 (ADR A3 · 원칙 ③).
 * G0 계약 (1)
 */
export const FETCH_MODES = ['json', 'html', 'browser'] as const
export type FetchMode = (typeof FETCH_MODES)[number]
export const FetchModeSchema = z.enum(FETCH_MODES)

/** 기본 스케줄 — 하루 1회 (기획서 10장) */
export const DEFAULT_SOURCE_SCHEDULE = '0 6 * * *'

/** 기획서 10장 `sources` */
export interface Source {
  id: string
  collection_id: string
  /** 호스트명. 공개 API 응답의 `sources` 키가 된다 */
  host: string
  entry_url: string
  status: SourceStatus
  /** cron 표현식 (기본 하루 1회) */
  schedule: string
  last_run_at: Date | null
  last_ok_at: Date | null
  fetch_mode: FetchMode
  created_at: Date
}

export type SourceInput = Omit<Source, 'id' | 'created_at'>
