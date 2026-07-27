// collect CLI — `pnpm --filter @endpointer/worker collect <slug>`
//
// ── 이게 G3 판정 도구다 ─────────────────────────────────────────────────
// gates.md G3(A): **"두 번 연속 수집했을 때 두 번째의 신규가 0이다."**
// `external_key` 가 수집마다 흔들리면 매번 전량이 "신규"가 되고, 그 위에 선
// 구독 알림은 스팸이, 뷰의 enter 판정은 소음이 된다. 그래서 이 출력의
// 머리에 그 숫자 하나를 찍는다: **신규 N개.** 두 번째 실행에서 0 이어야 한다.
//
// 정기 수집과 **완전히 같은 경로**(runCollectJob)를 탄다 — 다른 경로로 재면
// 판정이 판정이 아니다. 나중에 "일부러 깨뜨리고 고치는" 데모도 이 문으로 돈다.

// **이 줄이 첫 import 여야 한다** (ADR A29). ESM 은 import 를 본문보다 먼저 평가하므로
// '../db' 가 먼저 평가되면 dotenv 를 읽기 전에 DATABASE_URL 을 찾다 죽는다.
// worker 에서는 config.ts 가 load-env 역할을 겸한다.
import '../config'

import { db } from '../db'
import { runCollectJob } from '../jobs/collect'

const USAGE = `사용법: pnpm --filter @endpointer/worker collect <slug> [옵션]

  <slug>   수집할 표 (예: bizinfo)

옵션
  --source=<host>   이 사이트만 수집한다 (예: --source=www.wevity.com)
  --json            결과 JSON 을 그대로 찍는다
`

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const slug = args.find((a) => !a.startsWith('-'))
  const onlyHost = args.find((a) => a.startsWith('--source='))?.slice('--source='.length)
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

  const sources = await db.query.sources.findMany({
    where: (s, { eq }) => eq(s.collection_id, collection.id),
  })
  const targets = onlyHost === undefined ? sources : sources.filter((s) => s.host === onlyHost)
  if (targets.length === 0) {
    process.stdout.write(`\n  수집할 사이트가 없습니다.\n\n`)
    process.exit(2)
  }

  const line = '─'.repeat(72)
  const results: { host: string; result: Awaited<ReturnType<typeof runCollectJob>> }[] = []

  for (const source of targets) {
    const result = await runCollectJob({
      source_id: source.id,
      collection_id: collection.id,
      host: source.host,
      reason: 'manual',
    })
    results.push({ host: source.host, result })
  }

  if (asJson) {
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`)
  } else {
    const totalNew = results.reduce((n, r) => n + r.result.items_new, 0)
    process.stdout.write(`\n${line}\n`)
    process.stdout.write(`  ${collection.name} — 수집 ${results.length}곳 · **신규 ${totalNew}개**\n`)
    process.stdout.write(`${line}\n`)
    for (const { host, result } of results) {
      const mark = result.status === 'ok' ? '●' : result.status === 'skipped' ? '─' : '✗'
      process.stdout.write(
        `  ${mark} ${host.padEnd(24, ' ')} ${result.status.padEnd(8, ' ')} 항목 ${String(result.items_found).padStart(3)} · 신규 ${String(result.items_new).padStart(3)} · 변경 ${String(result.items_changed).padStart(3)}\n`,
      )
      if (result.summary !== null) process.stdout.write(`      ${result.summary}\n`)
    }
    process.stdout.write(`${line}\n\n`)
  }

  // BullMQ 커넥션이 열려 있으면 프로세스가 안 끝난다 — 판정 도구는 여기서 닫는다
  process.exit(results.every((r) => r.result.status === 'ok' || r.result.status === 'skipped') ? 0 : 2)
}

void main()
