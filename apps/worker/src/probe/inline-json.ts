// probe 2단계 — 인라인 JSON 스캔 (기획서 9-1①-2 · ADR A3)
//
//   __NEXT_DATA__ / __NUXT__ / window.__INITIAL_STATE__ / <script type="application/ld+json">(ItemList)
//
// **이 파일은 실제로 동작한다.** 브라우저도 LLM 도 필요 없다 — 정적 HTML 한 장이면 된다.
// 여기서 뚫리면 그 사이트는 비용이 거의 0 인 소스가 된다.

import type { ArrayCandidate } from './scan'
import { findRecordArrays, joinJsonPath } from './scan'
import type { StaticPage } from './static'
import type { ProbeCandidate } from './types'

/** 어떤 그릇에서 나왔는지 */
type Holder = { label: string; data: unknown }

export interface InlineJsonInput {
  page: StaticPage
  minRows: number
}

/**
 * 정적 HTML 에서 인라인 JSON 후보를 뽑는다.
 * 그릇 하나에서 목록 배열이 여러 개 나올 수 있으므로 후보도 여러 개 나온다.
 */
export function scanInlineJson(input: InlineJsonInput): ProbeCandidate[] {
  const { page, minRows } = input
  const holders = collectHolders(page)
  const out: ProbeCandidate[] = []

  for (const holder of holders) {
    // ld+json 의 ItemList 는 구조가 정해져 있으므로 먼저 특별 대우한다
    const itemList = pickItemList(holder.data)
    const arrays: ArrayCandidate[] =
      itemList !== null ? [itemList] : findRecordArrays(holder.data, { minRows, maxCandidates: 6 })

    for (const arr of arrays) {
      out.push({
        id: `${holder.label}${arr.path}`,
        origin: 'inline_json',
        source: { kind: 'inline_json', script: holder.label, json_path: arr.path },
        list_path: arr.list_path,
        // 인라인 JSON 은 페이지 안에 들어 있으므로 재수집도 페이지를 받아서 한다.
        // (아래 파일 끝 메모 참조 — 스펙에 "html 안의 JSON" 모드가 아직 없다)
        fetch_mode: 'html',
        fetch_url: page.url,
        rows: arr.rows,
        keys: arr.keys,
        where: `${holder.label} 안 ${arr.path} (${arr.size}개)`,
      })
    }
  }

  return out
}

// ── 그릇 모으기 ────────────────────────────────────────────────────────

function collectHolders(page: StaticPage): Holder[] {
  const holders: Holder[] = []

  for (const script of page.page.scripts) {
    const type = (script.type ?? '').toLowerCase()

    // ① <script id="__NEXT_DATA__" type="application/json">
    if (script.id === '__NEXT_DATA__') {
      const data = tryParse(script.content)
      if (data !== undefined) holders.push({ label: '__NEXT_DATA__', data })
      continue
    }

    // ② <script type="application/ld+json"> — 배열일 수도, @graph 일 수도 있다
    if (type.includes('ld+json')) {
      const data = tryParse(script.content)
      if (data !== undefined) holders.push({ label: 'ld+json', data })
      continue
    }

    // ③ window.__NUXT__ = {...} / window.__INITIAL_STATE__ = {...} / __APOLLO_STATE__
    for (const name of ASSIGNED_GLOBALS) {
      const data = extractAssignedObject(script.content, name)
      if (data !== undefined) holders.push({ label: name, data })
    }
  }

  return holders
}

const ASSIGNED_GLOBALS = [
  '__NUXT__',
  '__INITIAL_STATE__',
  '__PRELOADED_STATE__',
  '__APOLLO_STATE__',
  '__remixContext',
] as const

function tryParse(text: string): unknown | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    return undefined
  }
}

/**
 * `window.__NUXT__ = { … }` 처럼 대입된 객체 리터럴을 꺼낸다.
 *
 * Nuxt 3 는 `window.__NUXT__=(function(a,b){…})(…)` 형태라 JSON 이 아니다. 그런 건 포기한다 —
 * 그 경우 네트워크 관찰(3단계)이 잡아준다. 여기서 코드를 실행할 생각은 하지 않는다 (원칙 ②의 정신).
 */
export function extractAssignedObject(source: string, name: string): unknown | undefined {
  const idx = source.indexOf(name)
  if (idx < 0) return undefined

  const eq = source.indexOf('=', idx + name.length)
  if (eq < 0) return undefined

  let i = eq + 1
  while (i < source.length && /\s/.test(source[i] ?? '')) i += 1
  const open = source[i]
  if (open !== '{' && open !== '[') return undefined

  const end = matchBracket(source, i)
  if (end < 0) return undefined

  return tryParse(source.slice(i, end + 1))
}

/** 문자열 리터럴과 이스케이프를 건너뛰며 짝이 되는 괄호를 찾는다 */
function matchBracket(source: string, start: number): number {
  const open = source[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let quote: string | null = null

  for (let i = start; i < source.length; i += 1) {
    const ch = source[i]
    if (quote !== null) {
      if (ch === '\\') i += 1
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      continue
    }
    if (ch === open) depth += 1
    else if (ch === close) {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

// ── ld+json ItemList ───────────────────────────────────────────────────

/**
 * schema.org ItemList 를 찾아 `itemListElement` 를 목록으로 돌려준다.
 * ListItem 래퍼(`{ @type: 'ListItem', position, item: {…} }`)는 벗겨서 알맹이를 쓴다.
 */
export function pickItemList(data: unknown): ArrayCandidate | null {
  const nodes = flattenLdJson(data)

  for (const { node, path } of nodes) {
    if (typeOf(node).includes('ItemList')) {
      const raw = node['itemListElement']
      if (!Array.isArray(raw) || raw.length < 3) continue

      const rows: Record<string, unknown>[] = []
      let unwrapped = true
      for (const el of raw) {
        if (el === null || typeof el !== 'object' || Array.isArray(el)) {
          unwrapped = false
          break
        }
        const obj = el as Record<string, unknown>
        const inner = obj['item']
        if (inner !== null && typeof inner === 'object' && !Array.isArray(inner)) {
          rows.push(inner as Record<string, unknown>)
        } else {
          rows.push(obj)
          unwrapped = false
        }
      }
      if (rows.length < 3) continue

      const base = joinJsonPath(path, 'itemListElement')
      const listPath = unwrapped ? `${base}[*].item` : `${base}[*]`
      const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].sort()

      return { path: base, list_path: listPath, rows, keys, size: rows.length }
    }
  }

  return null
}

function typeOf(node: Record<string, unknown>): string[] {
  const t = node['@type']
  if (typeof t === 'string') return [t]
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === 'string')
  return []
}

/** ld+json 은 객체 하나일 수도, 배열일 수도, `@graph` 안에 들어 있을 수도 있다 */
function flattenLdJson(data: unknown): { node: Record<string, unknown>; path: string }[] {
  const out: { node: Record<string, unknown>; path: string }[] = []

  const walk = (node: unknown, path: string, depth: number): void => {
    if (depth > 4) return
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, joinJsonPath(path, i), depth + 1))
      return
    }
    if (node === null || typeof node !== 'object') return
    const obj = node as Record<string, unknown>
    out.push({ node: obj, path })
    const graph = obj['@graph']
    if (graph !== undefined) walk(graph, joinJsonPath(path, '@graph'), depth + 1)
  }

  walk(data, '$', 0)
  return out
}

// ── 메모 (G1 에서 결정해야 하는 것) ────────────────────────────────────
//
// 인라인 JSON 후보는 **후보 순위 판정과 필드 발견에는 최고**지만, 그대로 어댑터 스펙이 되지는
// 못한다. core 의 FetchSpec 에는 "HTML 을 받아서 그 안의 script 에서 JSON 을 꺼낸다" 모드가 없다
// (json = 응답 자체가 JSON, html/browser = 모든 경로가 CSS).
//
// 그래서 지금 이 단계의 결과는 두 가지로 쓰인다:
//   1. "이 페이지의 진짜 목록이 무엇인가" 를 확정하는 근거 (겹침률 판정 · 필드 값 원본)
//   2. 컴파일 프롬프트의 입력 — LLM 은 이 값들을 보고 **CSS 경로로** 같은 값을 집어내면 된다
//
// core 에 `fetch.mode: 'json'` + `inline_script` 를 추가하면 1급 경로가 된다. G1 에서 결정한다.
