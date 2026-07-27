// views CLI — `pnpm --filter @endpointer/worker views <slug>`
//
// ── 이게 G3(A) 뷰 판정 도구다 ───────────────────────────────────────────
// gates.md G3(A) 의 `[Δ]` 셋을 눈으로 판정한다:
//   · enter 전이 감지 — 뷰별 매칭 집합 + run 차집합 (A34)
//   · 재진입 = 새 enter (계약 §7 결정 ①) — 두 번 돌리면 두 번째는 enter 0 이어야 한다
//   · 소스 침묵 감지 (델타 4-3)
//
// `--demo` 는 판정용 뷰("일주일 안 마감")를 하나 만든다 — B 의 "이 조건 저장" UI 가
// 만들 것과 같은 모양의 행이다. 화면이 생기면 이 플래그는 필요 없어진다.

// **이 줄이 첫 import 여야 한다** (ADR A29 — collect.ts 와 같은 이유)
import '../config'

import { suggestViewSlug, ViewDefinitionSchema, validateViewDefinition } from '@endpointer/core'

import { db, listViews, views } from '../db'
import { evaluateCollectionViews } from '../jobs/evaluate-views'
import { quietSources } from '../jobs/silence'

const USAGE = `사용법: pnpm --filter @endpointer/worker views <slug> [옵션]

  <slug>   평가할 표 (예: bizinfo)

옵션
  --demo   판정용 뷰("일주일 안 마감")가 없으면 만든다
  --json   결과 JSON 을 그대로 찍는다
`

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const slug = args.find((a) => !a.startsWith('-'))
  const demo = args.includes('--demo')
  const asJson = args.includes('--json')

  if (slug === undefined) {
    process.stdout.write(USAGE)
    process.exit(1)
  }

  const collection = await db.query.collections.findFirst({ where: (c, { eq }) => eq(c.slug, slug) })
  if (collection === undefined) {
    process.stdout.write(`\n  '${slug}' 이라는 표가 없습니다.\n\n`)
    process.exit(2)
  }

  if (demo) await ensureDemoView(collection.id, collection.owner_id, collection.schema_json)

  const evaluations = await evaluateCollectionViews(collection.id)
  const quiet = await quietSources(collection.id)

  if (asJson) {
    process.stdout.write(`${JSON.stringify({ evaluations, quiet }, null, 2)}\n`)
    process.exit(0)
  }

  const line = '─'.repeat(72)
  process.stdout.write(`\n${line}\n  ${collection.name} — 뷰 ${evaluations.length}개 평가\n${line}\n`)

  if (evaluations.length === 0) {
    process.stdout.write('  저장된 뷰가 없습니다. (--demo 로 판정용 뷰를 만들 수 있습니다)\n')
  }
  for (const v of evaluations) {
    process.stdout.write(
      `  ● ${v.name.padEnd(16, ' ')} 맞는 항목 ${String(v.matched).padStart(3)} · enter ${String(v.entered.length).padStart(3)} · exit ${String(v.exited.length).padStart(3)}${v.notified ? ' · 알림 큐에 넣음' : ''}\n`,
    )
  }

  if (quiet.length > 0) {
    process.stdout.write('\n  조용한 사이트\n')
    for (const q of quiet) process.stdout.write(`  ⚠ ${q.message}\n`)
  }

  process.stdout.write(`${line}\n\n`)
  process.exit(0)
}

/** B 의 "이 조건 저장" 이 만들 것과 같은 모양의 행 — 검증 경로도 같은 것을 태운다 */
async function ensureDemoView(collectionId: string, ownerId: string, schema: unknown): Promise<void> {
  const existing = await listViews(collectionId)
  if (existing.some((v) => v.slug === 'closing-soon')) return

  const def = ViewDefinitionSchema.parse({
    name: '일주일 안 마감',
    where: [{ field: 'deadline', op: 'd_within', value: 7 }],
    sort: [{ field: 'deadline', dir: 'asc' }],
  })
  // 저장 전 검증 — 화면과 같은 두 겹 (zod 모양 + 스키마 대조)
  const checked = validateViewDefinition(def, schema as Parameters<typeof validateViewDefinition>[1])
  if (!checked.ok) {
    process.stdout.write(`  판정용 뷰를 만들 수 없습니다: ${checked.errors.join(' / ')}\n`)
    return
  }

  await db.insert(views).values({
    collection_id: collectionId,
    slug: suggestViewSlug('Closing Soon') ?? 'view-1',
    name: def.name,
    where_json: def.where,
    sort_json: def.sort,
    columns_json: def.columns,
    notify_json: def.notify,
    owner_id: ownerId,
    pinned: def.pinned,
  })
  process.stdout.write(`  판정용 뷰를 만들었습니다: 일주일 안 마감 (closing-soon)\n`)
}

void main()
