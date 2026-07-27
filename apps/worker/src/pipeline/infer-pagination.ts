// 붙인 사이트의 페이지 넘김 추론 — LLM 없이, 경험적으로 (attach-source TODO(G3) 해소)
//
// ── 왜 필요한가 ─────────────────────────────────────────────────────────
// 첫 사이트는 LLM 이 페이지 HTML 을 보고 pagination 을 스펙에 적는다 (9-1②).
// 접합(9-2)은 LLM 에게 필드 매핑만 시키므로 두 번째 사이트는 1페이지만 붙었다 —
// bizinfo 45건 옆에 wevity 16건. 같은 표인데 커버리지가 한쪽만 얕다.
//
// ── 어떻게 아는가 — 페이지가 답이다 ─────────────────────────────────────
// 1페이지 HTML 의 링크들 중에 "지금 주소와 경로가 같고, 정수 파라미터 하나만 다른"
// 것들이 있으면 그게 페이지 넘김이다 (`?gp=2`, `?cpage=3`, …). 후보를 골라
// **실제로 2페이지를 받아 본다** — 항목이 정말 늘었으면 맞는 것이고,
// 서버가 파라미터를 무시했으면 2페이지 = 1페이지라서 (runAdapter 의 신원
// 중복 제거 덕에) 항목 수가 그대로다. 늘지 않으면 버린다.
// repair-empty·verify-link·stabilize-keys 와 같은 원리다: 추론하지 말고 돌려 본다.
//
// json 모드는 손대지 않는다 — API 의 페이지 규약은 링크 스캔으로 알 수 없다.

import type { AdapterSpec, InterpretedItem } from '@endpointer/core/spec'
import type { CollectionSchemaJson, ValidationReport } from '@endpointer/core'

import { runAdapter } from '../fetchers'
import { httpGet } from '../fetchers/http'
import { childLogger } from '../logger'

const log = childLogger({ mod: 'infer-pagination' })

/** 이 이름이면 후보 순위를 올린다 — 한국 게시판의 관행 */
const KNOWN_PAGE_PARAMS = new Set([
  'page',
  'cpage',
  'pageindex',
  'pageno',
  'pagenum',
  'currentpage',
  'curpage',
  'gp',
  'pg',
  'p',
  'cp',
])

/** 시도할 후보 수 상한 — 후보 하나가 페이지 fetch 하나다 */
const MAX_CANDIDATES = 3

export interface InferredPagination {
  spec: AdapterSpec
  items: InterpretedItem[]
  report: ValidationReport
  pagesFetched: number
  /** 사용자에게 보여줄 한 줄 (B2) */
  note: string
}

/**
 * 페이지 넘김을 찾으면 pagination 이 담긴 스펙과 **전체 페이지를 다시 뽑은 결과**를,
 * 못 찾으면 null 을 돌려준다. 못 찾는 것은 실패가 아니다 — 1페이지짜리 사이트도 많다.
 */
export async function inferPagination(input: {
  spec: AdapterSpec
  schema: CollectionSchemaJson
  baseItemCount: number
  now?: Date
}): Promise<InferredPagination | null> {
  const { spec } = input
  if (spec.fetch.mode === 'json') return null
  if (spec.pagination.kind !== 'none') return null // 이미 있으면 건드릴 것 없다

  // 1페이지 HTML — 방금 실행에서 캐시에 있으므로 거의 공짜다
  const page = await httpGet(spec.fetch.url)
  if (!page.ok) return null

  const candidates = findPagerParams(page.response.body, page.response.url)
  for (const candidate of candidates.slice(0, MAX_CANDIDATES)) {
    const pagedSpec: AdapterSpec = {
      ...spec,
      fetch: { ...spec.fetch, url: templateUrl(spec.fetch.url, candidate.param) },
      pagination: { kind: 'page_param', param: candidate.param, start: candidate.start, max_pages: 3 },
    }

    // ── 돌려 본다 — 2페이지가 진짜 다른 내용인가 ─────────────────────
    const trial = await runAdapter({ spec: pagedSpec, schema: input.schema, maxPages: 2, ...(input.now !== undefined ? { now: input.now } : {}) })
    if (trial.pagesFetched < 2) continue
    // 서버가 파라미터를 무시하면 2페이지 = 1페이지 → 신원 중복 제거 후 항목이 안 는다
    if (trial.items.length <= input.baseItemCount) {
      log.debug({ param: candidate.param }, '2페이지가 1페이지와 같다 — 페이지 파라미터가 아니다')
      continue
    }

    // 확정 — 전체 페이지로 한 번 더 (1·2페이지는 캐시)
    const full = await runAdapter({ spec: pagedSpec, schema: input.schema, ...(input.now !== undefined ? { now: input.now } : {}) })
    log.info({ param: candidate.param, pages: full.pagesFetched, items: full.items.length }, '페이지 넘김을 찾았다')
    return {
      spec: pagedSpec,
      items: full.items,
      report: full.report,
      pagesFetched: full.pagesFetched,
      note: `다음 페이지도 읽도록 설정했어요 — ${full.pagesFetched}페이지에서 ${full.items.length}개를 가져왔어요.`,
    }
  }

  return null
}

// ── 후보 찾기 (순수 · 테스트 대상) ──────────────────────────────────────

export interface PagerCandidate {
  param: string
  /** 지금 주소의 값. 없으면 1 — page_param 의 start 가 된다 */
  start: number
  /** 근거가 된 링크 수 */
  evidence: number
}

/**
 * "지금 주소와 경로가 같고 정수 파라미터 하나로 구분되는 링크"를 찾는다.
 * 파라미터별로 등장한 정수 값들을 모아, 2 이상의 값이 여럿 보이는 것을 후보로 삼는다.
 */
export function findPagerParams(html: string, entryUrl: string): PagerCandidate[] {
  let entry: URL
  try {
    entry = new URL(entryUrl)
  } catch {
    return []
  }

  const values = new Map<string, Set<number>>()
  /** 이름의 원래 대소문자 — 소문자로 합산하되 스펙에는 원형을 적는다 */
  const casing = new Map<string, string>()
  for (const href of extractHrefs(html)) {
    let url: URL
    try {
      url = new URL(href, entry)
    } catch {
      continue
    }
    // 페이지 넘김 링크는 같은 목록을 가리킨다 — 경로가 다르면 상세·메뉴다
    if (url.host !== entry.host || url.pathname !== entry.pathname) continue

    for (const [name, raw] of url.searchParams.entries()) {
      if (!/^\d{1,3}$/.test(raw)) continue
      const n = Number.parseInt(raw, 10)
      if (n < 2 || n > 500) continue // 1 은 지금 페이지일 수 있어 증거가 안 된다
      const set = values.get(name.toLowerCase()) ?? new Set<number>()
      set.add(n)
      values.set(name.toLowerCase(), set)
      // 원래 대소문자를 보존해야 하므로 이름을 따로 기억한다
      casing.set(name.toLowerCase(), name)
    }
  }

  const out: PagerCandidate[] = []
  for (const [lower, nums] of values) {
    // 값이 하나뿐이면(예: ?tab=2) 페이지라는 증거가 약하다 — 알려진 이름일 때만 봐준다
    if (nums.size < 2 && !KNOWN_PAGE_PARAMS.has(lower)) continue
    const name = casing.get(lower) ?? lower
    const currentRaw = entry.searchParams.get(name)
    const start = currentRaw !== null && /^\d+$/.test(currentRaw) ? Number.parseInt(currentRaw, 10) : 1
    out.push({ param: name, start, evidence: nums.size })
  }

  // 증거 많은 순 → 알려진 이름 우선
  return out.sort((a, b) => {
    const ka = KNOWN_PAGE_PARAMS.has(a.param.toLowerCase()) ? 1 : 0
    const kb = KNOWN_PAGE_PARAMS.has(b.param.toLowerCase()) ? 1 : 0
    if (ka !== kb) return kb - ka
    return b.evidence - a.evidence
  })
}

/** URL 에서 해당 파라미터를 `{page}` 자리표시자로 바꾼다. 없던 파라미터면 붙인다 */
export function templateUrl(rawUrl: string, param: string): string {
  const url = new URL(rawUrl)
  url.searchParams.delete(param)
  const base = url.toString()
  const sep = base.includes('?') ? '&' : '?'
  // URL API 로 넣으면 { } 가 %7B%7D 로 인코딩된다 — 자리표시자는 글자 그대로 있어야 한다
  return `${base}${sep}${param}={page}`
}

function extractHrefs(html: string): string[] {
  const out: string[] = []
  const re = /href\s*=\s*["']([^"']+)["']/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null && out.length < 2000) {
    const href = m[1]
    if (href !== undefined && !href.startsWith('javascript:') && !href.startsWith('#')) out.push(href)
  }
  return out
}
