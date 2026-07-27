// 소스 침묵 — 상단 상태 줄의 ⚠ (델타 4-3).
//
// **판정의 정본은 apps/worker/src/jobs/silence.ts 다** (능동 알림이 그걸 쓴다).
// 화면은 트랙 경계 때문에 worker 를 import 할 수 없어 같은 판정을 SQL 로 다시 센다 —
// 임계값(14일)·조건(성공 수집 2회 이상·status ok)을 바꿀 때는 반드시 양쪽을 같이 바꾼다.
// 침묵은 고장이 아니다: 관찰만 말하고 진단하지 않는다 (A37).

import { safeQuery, type Loaded } from './db'
import { asDate } from './collections'

/** worker/jobs/silence.ts 의 QUIET_THRESHOLD_DAYS 와 같아야 한다 */
const QUIET_THRESHOLD_DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000

export interface QuietSourceLine {
  host: string
  quiet_days: number
  /** 상태 줄에 들어가는 짧은 형 — "⚠ 씽굿 3주째 조용함" 의 뒷부분 */
  short: string
  /** 마우스를 올리면 보이는 문장 */
  sentence: string
}

interface RawQuietRow {
  host: string
  baseline: Date | string | null
  run_count: number
}

export async function quietSourceLines(collectionId: string): Promise<Loaded<QuietSourceLine[]>> {
  return safeQuery(async (core) => {
    const rows = await core.queryClient<RawQuietRow[]>`
      select s.host,
        coalesce(
          (select max(r.started_at) from runs r
             where r.source_id = s.id and r.status in ('ok','healed') and r.items_new > 0),
          (select min(r.started_at) from runs r
             where r.source_id = s.id and r.status in ('ok','healed'))
        ) as baseline,
        (select count(*)::int from runs r
           where r.source_id = s.id and r.status in ('ok','healed')) as run_count
      from sources s
      where s.collection_id = ${collectionId} and s.status = 'ok'
    `
    const now = Date.now()
    const out: QuietSourceLine[] = []
    for (const row of rows) {
      if (Number(row.run_count) < 2) continue // 수집이 한 번뿐이면 "추이"가 없다
      const baseline = asDate(row.baseline)
      if (baseline === null) continue
      const quietDays = Math.floor((now - baseline.getTime()) / DAY_MS)
      if (quietDays < QUIET_THRESHOLD_DAYS) continue
      const weeks = Math.floor(quietDays / 7)
      const span = weeks >= 2 ? `${weeks}주째` : `${quietDays}일째`
      out.push({
        host: row.host,
        quiet_days: quietDays,
        short: `${row.host} ${span} 조용함`,
        sentence: `${row.host} 에서 ${span} 새 항목이 없어요. 사이트가 바뀌었거나 시즌이 끝났을 수 있어요.`,
      })
    }
    return out.sort((a, b) => b.quiet_days - a.quiet_days)
  })
}
