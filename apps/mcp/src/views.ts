// 저장된 뷰 로딩 — 뷰마다 MCP 도구 하나가 된다 (뷰 계약 §4 · 델타 2-4).
//
// 이 서버는 stateless 라 요청마다 다시 읽는다 (index.ts 머리말) —
// 그래서 화면에서 뷰를 만들면 **다음 요청부터 도구가 자동으로 생긴다.** 캐싱하지 않는 이유다.

import { queryClient } from '@endpointer/core/db'
import {
  ViewDefinitionSchema,
  validateViewDefinition,
  type FieldDef,
  type ViewCondition,
  type ViewSort,
} from '@endpointer/core'

export interface McpView {
  slug: string
  name: string
  where: ViewCondition[]
  sort: ViewSort[]
  /** 참조 칸이 사라진 뷰 — 도구는 등록하되 상태 문구로 답한다 (조용히 빼면 도구가 사라진 이유를 모른다) */
  broken: boolean
}

interface RawViewRow {
  slug: string
  name: string
  where_json: unknown
  sort_json: unknown
}

export async function loadViewsForMcp(
  collectionId: string,
  fields: readonly FieldDef[],
): Promise<McpView[]> {
  const rows = await queryClient<RawViewRow[]>`
    select slug, name, where_json, sort_json
    from views
    where collection_id = ${collectionId}
    order by pinned desc, created_at asc
  `
  return rows.map((row) => {
    const def = ViewDefinitionSchema.safeParse({
      name: row.name,
      where: row.where_json ?? [],
      sort: row.sort_json ?? [],
    })
    if (!def.success) {
      return { slug: row.slug, name: row.name, where: [], sort: [], broken: true }
    }
    const validation = validateViewDefinition(def.data, fields)
    return {
      slug: row.slug,
      name: def.data.name,
      where: def.data.where,
      sort: def.data.sort,
      broken: !validation.ok,
    }
  })
}
