// 소스 침묵 감지 (델타 4-3 — 3층 능동성의 최우선)
//
// > "씽굿이 3주째 새 항목이 없습니다. 사이트가 바뀌었거나 시즌이 끝난 것 같습니다."
//
// 사이트 3곳을 직접 보던 사람은 한 곳이 조용히 죽은 걸 몇 주 뒤에나 알아챈다 —
// **사용자가 알 수 없는 것을 시스템만 알 수 있다.** 재료는 이미 있다: runs 의 신규 건수 추이.
//
// 여기서 중요한 구분 — 침묵은 **고장이 아니다.** 고장(드리프트)은 검증이 잡고 치유가 돈다.
// 침묵은 "수집은 멀쩡히 도는데 새 항목이 안 나오는" 상태다. 시즌이 끝났을 수도,
// 목록 첫 페이지 밖으로 밀렸을 수도, 사이트가 조용히 개편됐을 수도 있다.
// 그래서 판단은 사용자 몫이고 우리는 **관찰만 말한다** (A37 — 정의는 사용자가, 관찰은 시스템이).

import { db } from '../db'

/** 이 일수 이상 신규가 없으면 말한다. 공공 공고 사이트의 정상 주기(주 단위)보다 넉넉하게 */
export const QUIET_THRESHOLD_DAYS = 14

const DAY_MS = 24 * 60 * 60 * 1000

export interface QuietSource {
  source_id: string
  host: string
  /** 마지막으로 신규가 나온 날. 한 번도 없었으면 첫 수집일 */
  last_new_at: Date
  quiet_days: number
  /** 화면에 그대로 나갈 수 있는 문장 (B2 · A37 — 관찰만, 진단하지 않는다) */
  message: string
}

/**
 * 컬렉션에서 오래 조용한 소스들. **성공 수집이 쌓여 있는데** 신규가 없는 경우만 잡는다 —
 * 수집 자체가 실패하는 소스는 침묵이 아니라 고장이고, 그건 드리프트·치유의 몫이다.
 */
export async function quietSources(collectionId: string, now: Date = new Date()): Promise<QuietSource[]> {
  const sources = await db.query.sources.findMany({
    where: (s, { eq }) => eq(s.collection_id, collectionId),
  })

  const out: QuietSource[] = []
  for (const source of sources) {
    if (source.status !== 'ok') continue // 고장난 소스는 침묵 판정 대상이 아니다

    const runs = await db.query.runs.findMany({
      where: (r, { and, eq, inArray }) => and(eq(r.source_id, source.id), inArray(r.status, ['ok', 'healed'])),
      orderBy: (r, { desc }) => [desc(r.started_at)],
      limit: 60, // 하루 1회 수집 기준 두 달치 — 그 이상은 볼 이유가 없다
    })
    if (runs.length < 2) continue // 수집이 한 번뿐이면 "추이"가 없다

    const lastNew = runs.find((r) => r.items_new > 0)
    const baseline = lastNew?.started_at ?? runs[runs.length - 1]?.started_at
    if (baseline === undefined) continue

    const quietDays = Math.floor((now.getTime() - baseline.getTime()) / DAY_MS)
    if (quietDays < QUIET_THRESHOLD_DAYS) continue

    const weeks = Math.floor(quietDays / 7)
    const span = weeks >= 2 ? `${weeks}주째` : `${quietDays}일째`
    out.push({
      source_id: source.id,
      host: source.host,
      last_new_at: baseline,
      quiet_days: quietDays,
      message: `${source.host} 에서 ${span} 새 항목이 없어요. 사이트가 바뀌었거나 시즌이 끝났을 수 있어요.`,
    })
  }

  return out.sort((a, b) => b.quiet_days - a.quiet_days)
}
