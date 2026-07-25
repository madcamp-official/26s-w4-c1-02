// 아이템 — 기획서 10장 `items`
// 컬렉션별 테이블로 쪼개지 않는다. JSONB 하나 + GIN 인덱스 (ADR A6)

import { z } from 'zod'

/**
 * 정규화된 값. 필드 타입별 표현은 이 하나로 고정한다:
 * - text / enum → string
 * - date        → `YYYY-MM-DD` (ISO 날짜 문자열)
 * - money       → number (원 단위 정수)
 * - number      → number
 * - link        → string (절대 URL)
 * 정규화에 실패하면 null. 부분 성공이 1급 시민이다 (원칙 ④)
 */
export const ItemValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
export type ItemValue = z.infer<typeof ItemValueSchema>

/** `items.data_json` — 키는 컬렉션 스키마의 필드 키 그대로 */
export const ItemDataSchema = z.record(z.string(), ItemValueSchema)
export type ItemData = z.infer<typeof ItemDataSchema>

/** `items.raw_json` — 원문 대조용 원본 조각 */
export type ItemRaw = Record<string, unknown>

/**
 * `items.provenance_json` — 필드별 원본 경로.
 * 예) `{ "deadline": "$.reqstEndDe" }`. 화면에서 값에 마우스를 올리면
 * raw_json 의 이 경로를 꺼내 보여준다 (기획서 10장).
 */
export const ItemProvenanceSchema = z.record(z.string(), z.string())
export type ItemProvenance = z.infer<typeof ItemProvenanceSchema>

/** 기획서 10장 `items` */
export interface Item {
  id: string
  collection_id: string
  source_id: string
  /** 소스 내 고유 식별자 (원문 링크 또는 원본 id). 신규 판정의 전부다 (ADR A13) */
  external_key: string
  data_json: ItemData
  raw_json: ItemRaw | null
  provenance_json: ItemProvenance | null
  /** 변경 감지용 — data_json 의 안정 직렬화 해시 */
  content_hash: string
  /** 신규 판정 기준. 구독의 "새 항목만"이 여기 걸려 있다 */
  first_seen_at: Date
  last_seen_at: Date
}

export type ItemInput = Omit<Item, 'id' | 'first_seen_at' | 'last_seen_at'>
