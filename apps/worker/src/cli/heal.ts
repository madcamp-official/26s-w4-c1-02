// heal CLI — `pnpm --filter @endpointer/worker heal <slug> <host>`
//
// ── 이게 기능 ④ 의 판정·데모 도구다 ─────────────────────────────────────
// 큐를 타지 않고 치유를 **내 앞에서** 돌린다. 대기 없이 결과(healed /
// needs_attention + 이유)를 바로 본다 — 백그라운드 워커의 치유는 로그가
// 저쪽 터미널에 남아 판정 근거로 쓰기 어렵다.
//
// 데모 절차 (G5 의 "일부러 깨뜨리기" 장면):
//   ① psql 로 active 어댑터의 list 셀렉터를 부러뜨린다
//   ② collect <slug> --source=<host>  → 감지 + 격리 (healing)
//   ③ heal <slug> <host>              → 재컴파일 → 겹침 관문 → 승격
//   ④ collect 한 번 더                → 정상 수집 (healed 후)

// **이 줄이 첫 import 여야 한다** (ADR A29)
import '../config'

import { db } from '../db'
import { runHealJob } from '../jobs/heal'

const USAGE = `사용법: pnpm --filter @endpointer/worker heal <slug> <host>

  <slug>  표 (예: bizinfo)
  <host>  고칠 사이트 (예: www.wevity.com)
`

async function main(): Promise<void> {
  const [slug, host] = process.argv.slice(2).filter((a) => !a.startsWith('-'))
  if (slug === undefined || host === undefined) {
    process.stdout.write(USAGE)
    process.exit(1)
  }

  const collection = await db.query.collections.findFirst({ where: (c, { eq }) => eq(c.slug, slug) })
  if (collection === undefined) {
    process.stdout.write(`\n  '${slug}' 이라는 표가 없습니다.\n\n`)
    process.exit(2)
  }
  const source = await db.query.sources.findMany({
    where: (s, { eq }) => eq(s.collection_id, collection.id),
  })
  const target = source.find((s) => s.host === host)
  if (target === undefined) {
    process.stdout.write(`\n  이 표에 '${host}' 사이트가 없습니다.\n\n`)
    process.exit(2)
  }

  // 무엇이 깨졌는지는 가장 최근의 실패/드리프트 run 이 안다
  const brokenRun = await db.query.runs.findFirst({
    where: (r, { and, eq, inArray }) => and(eq(r.source_id, target.id), inArray(r.status, ['failed', 'drift'])),
    orderBy: (r, { desc }) => [desc(r.started_at)],
  })
  if (brokenRun === undefined) {
    process.stdout.write(`\n  이 사이트에는 실패한 수집 기록이 없습니다. 먼저 collect 로 깨짐을 잡아야 합니다.\n\n`)
    process.exit(2)
  }

  const result = await runHealJob({
    source_id: target.id,
    collection_id: collection.id,
    run_id: brokenRun.id,
    attempt: 1,
  })

  const line = '─'.repeat(72)
  process.stdout.write(`\n${line}\n`)
  if (result.outcome === 'healed') {
    process.stdout.write(`  ✔ 자동 복구 성공 — 어댑터 v${result.adapter_version} 로 승격 · 항목 ${result.items_found}개\n`)
  } else if (result.outcome === 'needs_attention') {
    process.stdout.write(`  ✗ 자동 복구 실패 (${result.reason})\n  안내 문구  ${result.message}\n`)
  } else {
    process.stdout.write(`  ─ 건너뜀${result.message !== null ? ` — ${result.message}` : ''}\n`)
  }
  process.stdout.write(`${line}\n\n`)
  process.exit(result.outcome === 'healed' ? 0 : 2)
}

void main()
