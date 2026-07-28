// 항목 신원(external_key)에서 목록 상태를 뺀다
//
// ── 실제로 겪은 결함이 이 파일의 이유다 (2026-07-27) ─────────────────────
// bizinfo 의 상세 링크에는 **목록의 현재 상태가 통째로** 박혀 있다:
//
//   /sii/siia/selectSIIA200Detail.do?…&rows=15&cpage=1&keyword=&pblancId=PBLN_…124727
//
// 공고가 새 글에 밀려 3페이지로 내려가면 같은 공고의 링크가 `cpage=3` 으로 바뀌고,
// 링크가 곧 external_key 라서 **같은 공고가 "신규"로 다시 계수됐다** — 실측으로
// 한 오후에 5건이 두 벌씩 쌓였다. 그 위에 선 구독 알림은 스팸이 되고,
// 뷰의 enter 판정(계약 A34)은 소음이 된다.
//
// ── 어느 파라미터가 신원인지 어떻게 아는가 — 행들이 답이다 ──────────────
// "pblancId 가 신원이고 cpage 는 목록 상태다"는 사이트 지식이라 하드코딩할 수 없다.
// 그런데 우리는 이번 수집의 **행 전부**를 들고 있다:
//
//   행마다 값이 다른 파라미터(pblancId 45/45) = 항목을 가리키는 것 → 남긴다
//   행 대부분에서 값이 같은 파라미터(cpage 3/45 · rows=15 · keyword=) = 목록 상태 → 뺀다
//
// 정적으로 못 푸는 것을 돌려 보고 판단한다 — repair-empty·verify-link 와 같은 원리다.
//
// ── 안전판: 확신이 없으면 그대로 둔다 ───────────────────────────────────
// 뺀 뒤 서로 **다른** 항목의 키가 겹치면(제목이 다른데 키가 같으면) 전부 원래대로
// 되돌린다. 키가 흔들리는 것(중복 계수)보다 키가 겹치는 것(항목 소실)이 나쁘다.

import type { InterpretedItem } from '@endpointer/core/spec'

/**
 * 이 비율 이상 행마다 값이 다르면 "항목을 가리키는" 파라미터로 본다.
 * 1.0 이 아닌 이유: 수집 중 목록이 밀리면 같은 항목이 두 페이지에 잡혀 고유값이
 * 행 수보다 조금 적어진다. 0.5 가 아닌 이유: 2페이지×2행 같은 작은 표본에서
 * cpage(2/4 = 0.5)가 신원으로 살아남는다.
 */
const IDENTITY_RATIO = 0.7

/** 이보다 행이 적으면 판단 근거가 없다 — 손대지 않는다 */
const MIN_ROWS = 3

export interface StabilizeResult {
  items: InterpretedItem[]
  /** 실제로 뺐을 때만 채워진다 — 조용히 고치면 고쳤는지도 모른다 */
  note: string | null
}

export function stabilizeExternalKeys(items: readonly InterpretedItem[]): StabilizeResult {
  // dedupe_key 만 본다 — 스펙이 링크 경로를 신원으로 지정한 경우가 이것이다.
  // title_hash·row_hash 는 URL 이 아니라 뺄 파라미터도 없다.
  const linkKeyed = items.filter((i) => i.external_key_origin === 'dedupe_key')
  if (linkKeyed.length < MIN_ROWS) return { items: [...items], note: null }

  // ── 파라미터별 고유값 세기 ───────────────────────────────────────────
  const parsed = new Map<string, ReturnType<typeof parseKey>>()
  const valuesByParam = new Map<string, Set<string>>()
  for (const item of linkKeyed) {
    const p = parseKey(item.external_key)
    parsed.set(item.external_key, p)
    if (p === null) continue
    for (const [name, value] of p.params) {
      const set = valuesByParam.get(name) ?? new Set<string>()
      set.add(value)
      valuesByParam.set(name, set)
    }
  }

  const keep = new Set<string>()
  let droppedAny = false
  for (const [name, values] of valuesByParam) {
    if (values.size >= linkKeyed.length * IDENTITY_RATIO) keep.add(name)
    else droppedAny = true
  }
  if (!droppedAny) return { items: [...items], note: null }
  // 남길 파라미터가 0개여도 미리 포기하지 않는다 — 신원이 **경로**에 있는 사이트가 있다.
  // 서울도서관 실측(2026-07-27): `/bbs/content/3_67487?page=1&` 처럼 항목 경로가 다 다르고
  // 쿼리는 목록 위치뿐이라, 전부 빼는 것이 정답이었다. 여기서 포기하면 페이지마다 같은
  // 공지가 "신규"로 3벌씩 쌓인다. 정말 키가 겹치는 경우는 아래 재조립의 안전판이
  // (제목이 다른데 키가 같으면 전부 원래대로) 실측으로 잡는다.

  // ── 다시 조립 + 안전판 ───────────────────────────────────────────────
  const out: InterpretedItem[] = []
  const byNewKey = new Map<string, InterpretedItem>()
  for (const item of items) {
    if (item.external_key_origin !== 'dedupe_key') {
      out.push(item)
      continue
    }
    const p = parsed.get(item.external_key) ?? null
    const rebuilt = p === null ? item.external_key : rebuildKey(p, keep)
    const prev = byNewKey.get(rebuilt)
    if (prev !== undefined) {
      // 키가 겹쳤다. 같은 항목이 두 페이지에 걸쳐 두 번 잡힌 것이면(수집 중 목록이
      // 밀린 경우) 중복 제거가 맞고, **다른** 항목이면 신원을 뭉갠 것이므로 중단한다.
      if (titleOf(prev) !== titleOf(item)) {
        return { items: [...items], note: null }
      }
      continue // 같은 항목의 중복 — 첫 번째 것을 남긴다
    }
    const next = { ...item, external_key: rebuilt }
    byNewKey.set(rebuilt, next)
    out.push(next)
  }

  return {
    items: out,
    note: '주소에 섞인 목록 위치(페이지 번호 등)를 항목 구분에서 뺐어요 — 페이지가 밀려도 같은 항목으로 봅니다.',
  }
}

// ── 거들 ───────────────────────────────────────────────────────────────

interface ParsedKey {
  /** 원래 키가 절대 주소였으면 origin, 상대였으면 '' */
  origin: string
  pathname: string
  params: [string, string][]
}

function parseKey(key: string): ParsedKey | null {
  const absolute = /^https?:\/\//i.test(key)
  try {
    const url = new URL(key, 'http://relative.invalid')
    if (url.search === '') return null // 쿼리가 없으면 뺄 것도 없다
    return {
      origin: absolute ? url.origin : '',
      pathname: url.pathname,
      params: [...url.searchParams.entries()],
    }
  } catch {
    return null
  }
}

function rebuildKey(p: ParsedKey, keep: ReadonlySet<string>): string {
  const kept = p.params.filter(([name]) => keep.has(name))
  // 이름순 정렬 — 사이트가 파라미터 순서를 바꿔도 키가 흔들리지 않게
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const query = kept.map(([n, v]) => `${n}=${v}`).join('&')
  return query === '' ? `${p.origin}${p.pathname}` : `${p.origin}${p.pathname}?${query}`
}

function titleOf(item: InterpretedItem): string {
  const t = item.data['title']
  return typeof t === 'string' ? t : JSON.stringify(item.data)
}
