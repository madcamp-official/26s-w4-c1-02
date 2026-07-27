// 컬렉션 생성 — 미리보기와 실제 저장 (기획서 9-1 · G2 트랙 B 몫).
//
// ── 지금은 미리보기가 목(mock)이다 ──────────────────────────────────────
// URL → 이미 채워진 표'를 만드는 진짜 파이프라인(probe→생성→해석→추론→정규화)은
// apps/worker(트랙 A)에 있고, 호출 방식(워커 HTTP vs 큐)은 두 트랙이 합의해야 한다
// (docs/day1-part-a.md §7-2 5번). 합의 전까지 이 파일의 buildMockPreview 가 그 자리를
// 지킨다 — 화면·저장 경로를 먼저 완성해 두고, 합의되면 TODO(G2) 한 곳만 갈아끼운다.
// G0 가 시드로 두 트랙을 병렬화한 것과 같은 수법이다.

import { randomUUID } from 'node:crypto'

import { CollectionSchemaJsonSchema, type CollectionSchemaJson, type FieldDef } from '@endpointer/core'

import { safeQuery, type Loaded } from './db'

/** 미리보기 한 벌 — 화면이 그리는 "이미 채워진 표" (보장선 B3) */
export interface CreatePreview {
  host: string
  entryUrl: string
  suggestedName: string
  fields: FieldDef[]
  /** 필드 키 → 표시 값. 지금은 예시 값이다 */
  rows: Record<string, string>[]
}

const field = (key: string, label: string, type: FieldDef['type']): FieldDef => ({
  key,
  label,
  type,
  required: false,
  mapping: null,
  value_labels: null,
})

/**
 * TODO(G2): 여기를 트랙 A 파이프라인 호출로 교체한다.
 * (probe → 스키마 추론 → 정규화까지 돌린 결과가 이 모양으로 돌아오면 화면은 그대로 산다)
 */
export function buildMockPreview(entryUrl: string): CreatePreview {
  const host = new URL(entryUrl).hostname.replace(/^www\./, '')
  return {
    host,
    entryUrl,
    suggestedName: `${host} 모음`,
    fields: [
      field('title', '공고명', 'text'),
      field('organization', '주관기관', 'text'),
      field('deadline', '마감일', 'date'),
      field('category', '분류', 'text'),
      field('amount', '지원 금액', 'money'),
    ],
    rows: [
      {
        title: '2026 예비창업패키지 2차 모집',
        organization: '창업진흥원',
        deadline: '2026-08-14',
        category: '창업지원',
        amount: '100,000,000',
      },
      {
        title: '중소기업 기술개발 상반기 지원',
        organization: '중소벤처기업부',
        deadline: '2026-08-29',
        category: 'R&D',
        amount: '500,000,000',
      },
      {
        title: '수출바우처 사업 3차 모집',
        organization: 'KOTRA',
        deadline: '2026-07-31',
        category: '바우처',
        amount: '30,000,000',
      },
    ],
  }
}

/** 로그인 설정 전 데모 경로 — 시드가 만든 첫 사용자를 주인으로 쓴다 */
export async function demoOwnerId(): Promise<Loaded<string | null>> {
  return safeQuery(async (core) => {
    const rows = await core.queryClient<{ id: string }[]>`select id from users order by "email" limit 1`
    return rows[0]?.id ?? null
  })
}

export interface CreateCollectionInput {
  ownerId: string
  name: string
  entryUrl: string
  host: string
  fields: CollectionSchemaJson
}

/**
 * 컬렉션 + 사이트 행을 실제로 만든다. 수집이 아직 연결되지 않았으므로
 * 사이트는 '잠시 멈춤' 상태로 시작한다 — 화면 문구도 그렇게 읽힌다 (B4).
 */
export async function createCollection(
  input: CreateCollectionInput,
): Promise<Loaded<{ slug: string }>> {
  return safeQuery(async (core) => {
    // 계약 검사 — 시드와 같은 원칙: 이 파일이 계약을 우회하면 계약이 아니다
    const fields = CollectionSchemaJsonSchema.parse(input.fields)

    // O2 기본값 unlisted — 추측 불가 slug 가 곧 접근 제어다
    const slug = `c-${randomUUID().replace(/-/g, '').slice(0, 10)}`
    const schemaJson = JSON.stringify(fields)

    const sql = core.queryClient
    const inserted = await sql<{ id: string }[]>`
      insert into collections (owner_id, slug, name, schema_json, schema_version, visibility)
      values (${input.ownerId}, ${slug}, ${input.name}, ${schemaJson}::jsonb, 1, 'unlisted')
      returning id
    `
    const collectionId = inserted[0]?.id
    if (collectionId === undefined) throw new Error('컬렉션 행이 만들어지지 않았습니다')

    await sql`
      insert into sources (collection_id, host, entry_url, status, fetch_mode)
      values (${collectionId}, ${input.host}, ${input.entryUrl}, 'paused', 'html')
    `
    return { slug }
  })
}
