// map-enums CLI — `pnpm --filter @endpointer/worker map-enums <slug> [--field <key>] [--apply]`
//
// ── G2 마지막 체크박스의 판정 도구다 ────────────────────────────────────
// gates.md G2: "분류값 매핑이 동작한다 — 지금 category 에 사업화(k-startup)·내수(bizinfo)가
// 그대로 섞여 있다". 이 CLI 가 그 섞임을 풀어낸다:
//
//   ① 소스별 관찰값을 items 에서 센다 (지어낸 목록이 아니라 실제 값)
//   ② LLM 이 뜻이 같은 값끼리 묶은 **제안**을 만든다 (여기까지가 기본 실행)
//   ③ 사람이 제안을 보고 --apply 를 다시 친다 — 이것이 "사용자가 확인하게 한다" 의 실체다.
//      정의는 사용자가, 관찰과 제안은 시스템이 (델타 4-4).
//   ④ --apply: schema_json 에 mapping·value_labels 를 앉히고, **이미 앉아 있는 항목도**
//      같은 매핑으로 재정규화한다. 앞으로의 수집은 LLM 없이 이 테이블만으로 돈다 (원칙 ①).
//
// 재정규화가 ④의 절반이다 — 스키마만 고치면 새 수집분은 `export` 인데
// 기존 행은 `수출` 로 남아, 같은 분류가 필터에서 두 갈래로 갈라진다.

// **이 줄이 첫 import 여야 한다** (ADR A29). ESM 은 import 를 본문보다 먼저 평가하므로
// '../db' 가 먼저 평가되면 dotenv 를 읽기 전에 DATABASE_URL 을 찾다 죽는다.
import '../config'

import type { FieldDef, ItemData } from '@endpointer/core'
import { parseEnum } from '@endpointer/core/normalize'

import { mapEnumValues } from '../compile/map-enum-values'
import { contentHashOf, db, queryClient } from '../db'

const USAGE = `사용법: pnpm --filter @endpointer/worker map-enums <slug> [옵션]

  <slug>   분류값을 묶을 표 (예: bizinfo)

옵션
  --field=<key>   이 분류 칸만 다룬다 (예: --field=category). 없으면 enum 칸 전부
  --apply         제안을 실제로 앉힌다. 없으면 제안만 보여준다 (확인 단계)
`

const line = '─'.repeat(72)

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const slug = args.find((a) => !a.startsWith('-'))
  const onlyField = args.find((a) => a.startsWith('--field='))?.slice('--field='.length)
  const apply = args.includes('--apply')

  if (slug === undefined) {
    process.stdout.write(USAGE)
    process.exit(1)
  }

  const collection = await db.query.collections.findFirst({ where: (c, { eq }) => eq(c.slug, slug) })
  if (collection === undefined) {
    process.stdout.write(`\n  '${slug}' 이라는 표가 없습니다.\n\n`)
    process.exit(2)
  }

  const enumFields = collection.schema_json.filter(
    (f) => f.type === 'enum' && (onlyField === undefined || f.key === onlyField),
  )
  if (enumFields.length === 0) {
    process.stdout.write(`\n  묶을 분류 칸이 없습니다.\n\n`)
    process.exit(2)
  }

  let failed = false
  for (const field of enumFields) {
    const done = await mapOneField(collection.id, collection.name, collection.schema_json, field, apply)
    if (!done) failed = true
  }

  process.exit(failed ? 2 : 0)
}

async function mapOneField(
  collectionId: string,
  collectionName: string,
  schema: FieldDef[],
  field: FieldDef,
  apply: boolean,
): Promise<boolean> {
  // ① 소스별 관찰값 — 매핑이 이미 있으면 그 결과값(키)이 섞여 있을 수 있으므로
  //    이미 키로 매핑된 값은 제안 입력에서 뺀다 (키를 또 묶으라고 시키면 혼란만 준다)
  const observedRows = await queryClient<{ host: string; value: string; count: string }[]>`
    select s.host as host, i.data_json ->> ${field.key} as value, count(*) as count
    from items i join sources s on s.id = i.source_id
    where i.collection_id = ${collectionId}
      and nullif(i.data_json ->> ${field.key}, '') is not null
    group by 1, 2
    order by 1, 3 desc`

  const alreadyKeys = new Set(Object.values(field.mapping ?? {}))
  const observed = observedRows
    .map((r) => ({ host: r.host, value: r.value, count: Number(r.count) }))
    .filter((o) => !alreadyKeys.has(o.value))

  process.stdout.write(`\n${line}\n  ${collectionName} — "${field.label}" 칸 · 값 ${observed.length}종\n${line}\n`)

  if (observed.length === 0) {
    process.stdout.write('  묶을 값이 없습니다. (전부 이미 정리됐거나 비어 있음)\n')
    return true
  }

  // ② LLM 제안 (만들 때만 부른다 — 앉힌 뒤의 수집·API 는 LLM 을 모른다)
  const out = await mapEnumValues({
    collection_id: collectionId,
    collectionName,
    fieldKey: field.key,
    fieldLabel: field.label,
    observed,
  })
  if (!out.ok) {
    process.stdout.write(`  ${out.message}\n`)
    return false
  }

  // 제안을 사람이 읽는 표로 — 어느 사이트의 어떤 값이 어디로 묶이는지가 판단 근거다
  const byValue = new Map(observed.map((o) => [o.value, o]))
  const groups = new Map<string, string[]>()
  for (const [value, key] of Object.entries(out.result.mapping)) {
    const list = groups.get(key) ?? []
    list.push(value)
    groups.set(key, list)
  }

  for (const [key, values] of groups) {
    const label = out.result.value_labels[key] ?? key
    const memberText = values
      .map((v) => {
        const o = byValue.get(v)
        return o === undefined ? v : `${v}(${o.count}건·${o.host})`
      })
      .join(' · ')
    process.stdout.write(`  ${key.padEnd(16, ' ')} ${label}\n      ← ${memberText}\n`)
  }
  if (out.result.unmapped.length > 0) {
    process.stdout.write(`  묶이지 않은 값: ${out.result.unmapped.join(' · ')} (원값 그대로 남습니다)\n`)
  }

  if (!apply) {
    process.stdout.write(`\n  제안입니다. 이대로 앉히려면 --apply 를 붙여 다시 실행하세요.\n`)
    return true
  }

  // ④-1 스키마에 앉힌다 — 기존 매핑이 있으면 합친다 (새 제안이 이긴다)
  const mapping = { ...(field.mapping ?? {}), ...out.result.mapping }
  const value_labels = { ...(field.value_labels ?? {}), ...out.result.value_labels }
  const nextSchema = schema.map((f) => (f.key === field.key ? { ...f, mapping, value_labels } : f))
  await queryClient`
    update collections set schema_json = ${JSON.stringify(nextSchema)}, updated_at = now()
    where id = ${collectionId}`

  // ④-2 이미 앉아 있는 항목을 같은 매핑으로 재정규화한다.
  //     값과 지문(content_hash)을 같이 바꾼다 — 지문을 안 바꾸면 다음 수집이
  //     전 항목을 "변경됨" 으로 오판한다. raw_json 은 손대지 않는다 (원문은 원문대로).
  const rows = await queryClient<{ id: string; data_json: ItemData }[]>`
    select id, data_json from items
    where collection_id = ${collectionId}
      and nullif(data_json ->> ${field.key}, '') is not null`

  let rewritten = 0
  for (const row of rows) {
    const current = row.data_json[field.key]
    if (typeof current !== 'string') continue
    const parsed = parseEnum(current, { mapping })
    if (!parsed.ok || parsed.value.unmapped || parsed.value.value === current) continue

    const nextData: ItemData = { ...row.data_json, [field.key]: parsed.value.value }
    await queryClient`
      update items set data_json = ${JSON.stringify(nextData)}, content_hash = ${contentHashOf(nextData)}
      where id = ${row.id}`
    rewritten += 1
  }

  process.stdout.write(`\n  앉혔습니다 — 분류 ${groups.size}종 · 기존 항목 ${rewritten}건을 새 분류로 정리\n`)
  return true
}

void main()
