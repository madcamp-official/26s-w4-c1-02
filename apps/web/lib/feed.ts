// 읽기 피드 조회 (기획서 3장 "읽기 피드" · G3 트랙 B).
//
// 표·공개 API 와 같은 계약 코드(core 의 buildCollectionResponse)를 그대로 쓴다 —
// 피드가 따로 조회를 짜면 표와 피드가 서서히 갈라진다 (기획서 8장과 같은 원칙).
// "새로 올라온 것"은 내장 정렬 `-first_seen_at`, "마감 임박"은 스키마의 첫 날짜
// 필드를 기준으로 `?{key}_gte=오늘&sort={key}` 를 거는 것뿐이다.

import type { ApiItem, FieldDef } from '@endpointer/core'

import { fetchCollectionPage, type CollectionRecord } from './collections'
import type { Loaded } from './db'

export interface FeedData {
  /** 새로 올라온 순 (first_seen_at 내림차순) */
  fresh: ApiItem[]
  /** 날짜 필드가 가까운 순. 날짜 필드가 없는 컬렉션이면 빈 배열 */
  closing: ApiItem[]
  /** "마감 임박" 판정에 쓴 날짜 필드. 없으면 null — 그 절은 그리지 않는다 */
  dateField: FieldDef | null
}

/** 스키마에서 첫 번째 날짜 필드 — "마감 임박"의 기준 */
export function dateFieldOf(fields: readonly FieldDef[]): FieldDef | null {
  return fields.find((f) => f.type === 'date') ?? null
}

/** 정규화된 날짜(YYYY-MM-DD · Asia/Seoul)와 같은 기준의 오늘 */
function todayKst(): string {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10)
}

export async function fetchFeed(
  collection: Pick<CollectionRecord, 'id' | 'schema_json' | 'schema_version'>,
): Promise<Loaded<FeedData>> {
  const dateField = dateFieldOf(collection.schema_json)

  const [fresh, closing] = await Promise.all([
    fetchCollectionPage(collection, 'sort=-first_seen_at&limit=30'),
    dateField === null
      ? Promise.resolve(null)
      : fetchCollectionPage(
          collection,
          `sort=${dateField.key}&${dateField.key}_gte=${todayKst()}&limit=20`,
        ),
  ])

  if (!fresh.ok) return fresh
  if (closing !== null && !closing.ok) return closing

  return {
    ok: true,
    data: {
      fresh: fresh.data.items,
      closing: closing === null ? [] : closing.data.items,
      dateField,
    },
  }
}
