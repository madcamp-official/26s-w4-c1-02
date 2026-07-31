// 붙여넣은 값을 원본 데이터에서 역추적해 경로를 확정한다 (기획서 9-2② · 보장선 B1)
//
//   "이 사이트에서 '마감일'에 해당하는 값을 하나 복사해 붙여넣어 주세요"
//   → 붙여넣은 값을 원본 데이터에서 역추적해 경로 확정 → 스펙에 반영
//
// ── 여기에 LLM 이 없는 이유 ─────────────────────────────────────────────
// 이건 추론이 아니라 **탐색**이다. 값이 어디 있는지는 트리를 훑으면 알 수 있고,
// 그 답은 결정론적이며 언제나 같아야 한다. LLM 을 부르면 느리고 비싸고 가끔 틀린다.
// 보장선 B1("사용자는 셀렉터를 입력하지 않는다")의 실제 구현체가 이 파일이다.
// **스텁이 아니다.**

import { evaluateCssPath, evaluateJsonPath } from '@endpointer/core/spec'
import { load } from 'cheerio'

import { tagWithClasses } from '../css-ident'
import { cheerioAdapter } from '../fetchers/cheerio-adapter'
import { joinJsonPath } from '../probe/scan'

export type MatchKind =
  /** 공백·대소문자를 맞추면 완전히 같다 */
  | 'exact'
  /** 원본 값 안에 붙여넣은 값이 들어 있다 (예: "접수기간 2026.08.21" 안의 "2026.08.21") */
  | 'contains'
  /** 붙여넣은 값 안에 원본 값이 들어 있다 (사용자가 앞뒤를 더 긁어온 경우) */
  | 'contained_by'

export interface TraceHit {
  /** 항목 하나를 기준으로 한 경로. 그대로 스펙의 fields[key].path 가 된다 */
  path: string
  /** 몇 번째 항목에서 찾았는지 */
  row_index: number
  /** 그 자리에 실제로 있던 값 */
  found: string
  kind: MatchKind
  /**
   * 이 경로가 **다른 항목에서도** 값을 내는 비율 0~1.
   * 1번 항목에만 있는 경로는 우연이고, 전부에 있는 경로는 진짜 칸이다.
   */
  coverage: number
  /** 최종 점수 (정렬 기준) */
  score: number
}

export interface TraceInput {
  /** 후보의 fetch 모드. json 이면 JSONPath, 아니면 CSS 경로를 만든다 */
  mode: 'json' | 'html' | 'browser'
  /**
   * 항목들. json 모드면 항목 객체 배열, html·browser 모드면 **행 HTML 조각** 배열.
   * probe 후보의 `rows` 를 그대로 넣으면 된다.
   */
  rows: readonly unknown[]
  /** 사용자가 붙여넣은 값 */
  needle: string
  /** 최대 몇 개까지 돌려줄지 */
  maxHits?: number
  /** 훑을 항목 수 상한 */
  maxRows?: number
}

/**
 * 붙여넣은 값이 있는 경로를 찾는다. 점수 내림차순.
 * 비어 있으면 못 찾은 것이고, 화면은 "그 값을 못 찾았어요" 로 되물으면 된다.
 */
export function traceValue(input: TraceInput): TraceHit[] {
  const needle = squash(input.needle)
  if (needle.length < 2) return []

  const maxRows = input.maxRows ?? 20
  const rows = input.rows.slice(0, maxRows)
  const isJson = input.mode === 'json'

  const hits: TraceHit[] = []
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]
    if (row === undefined) continue
    const found = isJson ? traceInJson(row, needle, i) : traceInHtml(rowHtml(row), needle, i)
    hits.push(...found)
    // 앞쪽 항목에서 찾았으면 충분하다. 뒤 항목은 coverage 계산에만 쓴다.
    if (hits.length > 0 && i >= 2) break
  }

  if (hits.length === 0) return []

  // 같은 경로가 여러 항목에서 나오면 하나로 합친다
  const byPath = new Map<string, TraceHit>()
  for (const hit of hits) {
    const prev = byPath.get(hit.path)
    if (prev === undefined || hit.score > prev.score) byPath.set(hit.path, hit)
  }

  const out: TraceHit[] = []
  for (const hit of byPath.values()) {
    const coverage = coverageOf(hit.path, rows, isJson)
    out.push({ ...hit, coverage, score: round(hit.score * (0.5 + 0.5 * coverage)) })
  }

  out.sort((a, b) => b.score - a.score || a.path.length - b.path.length)
  return out.slice(0, input.maxHits ?? 5)
}

// ── JSON 쪽 ────────────────────────────────────────────────────────────

const MAX_DEPTH = 8

/** 항목 객체 안을 훑어 값이 있는 JSONPath 를 찾는다. 경로는 `$` = 항목 하나 기준이다 */
export function traceInJson(row: unknown, needle: string, rowIndex: number): TraceHit[] {
  const hits: TraceHit[] = []

  const walk = (node: unknown, path: string, depth: number): void => {
    if (depth > MAX_DEPTH || hits.length > 30) return

    if (node === null || node === undefined) return

    if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
      const raw = String(node)
      const kind = compare(squash(raw), needle)
      if (kind !== null) {
        hits.push({
          path,
          row_index: rowIndex,
          found: raw,
          kind,
          coverage: 0,
          score: baseScore(kind, squash(raw), needle),
        })
      }
      return
    }

    if (Array.isArray(node)) {
      for (let i = 0; i < Math.min(node.length, 20); i += 1) walk(node[i], joinJsonPath(path, i), depth + 1)
      return
    }

    if (typeof node === 'object') {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        walk(value, joinJsonPath(path, key), depth + 1)
      }
    }
  }

  walk(row, '$', 0)
  return hits
}

// ── HTML 쪽 ────────────────────────────────────────────────────────────

/**
 * 행 HTML 안을 훑어 값이 있는 CSS 경로를 찾는다.
 * 텍스트뿐 아니라 **속성값**(href·title·data-*)도 본다 — 링크는 거의 항상 속성에 있다.
 */
export function traceInHtml(html: string, needle: string, rowIndex: number): TraceHit[] {
  if (html.trim() === '') return []

  let $: ReturnType<typeof load>
  try {
    $ = load(html, null, false)
  } catch {
    return []
  }

  const hits: TraceHit[] = []

  $('*').each((_i, el) => {
    if (hits.length > 40) return
    const node = $(el)

    // ① 속성값
    const attribs = 'attribs' in el ? el.attribs : {}
    for (const [name, value] of Object.entries(attribs)) {
      if (typeof value !== 'string' || value.length < 2) continue
      const kind = compare(squash(value), needle)
      if (kind === null) continue
      const selector = selectorFor($, el)
      if (selector === null) continue
      hits.push({
        path: `css:${selector}@${name}`,
        row_index: rowIndex,
        found: value,
        kind,
        coverage: 0,
        // 속성은 텍스트보다 안정적이다 (링크·id 가 여기 있다)
        score: baseScore(kind, squash(value), needle) + 0.05,
      })
    }

    // ② 텍스트 — 자손을 포함한 텍스트가 맞아도, 더 깊은 요소가 있으면 그쪽이 정답이다.
    //    깊은 것부터 보게 하려고 자식이 있는 요소는 점수를 깎는다.
    const text = node.text()
    if (text.trim().length >= 2) {
      const kind = compare(squash(text), needle)
      if (kind !== null) {
        const selector = selectorFor($, el)
        if (selector !== null) {
          const childPenalty = node.children().length > 0 ? 0.1 : 0
          hits.push({
            path: `css:${selector}`,
            row_index: rowIndex,
            found: text.trim(),
            kind,
            coverage: 0,
            score: baseScore(kind, squash(text), needle) - childPenalty,
          })
        }
      }
    }
  })

  return hits
}

/**
 * 요소 하나를 가리키는 선택자를 만든다. 행 안에서 유일해질 때까지 조상을 붙인다.
 * 클래스 → 태그+nth-of-type 순으로 시도한다.
 */
function selectorFor($: ReturnType<typeof load>, el: unknown): string | null {
  if (el === null || typeof el !== 'object' || !('tagName' in el)) return null

  const chain: string[] = []
  let current: unknown = el

  for (let depth = 0; depth < 5; depth += 1) {
    if (current === null || typeof current !== 'object' || !('tagName' in current)) break
    const node = current as { tagName: string; attribs?: Record<string, string>; parent?: unknown }
    const tag = String(node.tagName).toLowerCase()
    if (tag === 'html' || tag === 'body' || tag === 'root') break

    const classes = (node.attribs?.['class'] ?? '')
      .split(/\s+/)
      .filter((c) => c !== '' && !/\d/.test(c)) // 해시·인덱스가 붙은 클래스는 불안정하다
      .slice(0, 2)

    // Tailwind 의 `sm:w-auto` 처럼 콜론이 든 클래스는 이스케이프해야 한다 —
    // 안 하면 CSS 파서가 가상클래스로 읽고 던진다 (css-ident.ts 머리말)
    let part = tagWithClasses(tag, classes)
    if (classes.length === 0) {
      const n = nthOfType($, current)
      if (n !== null && n > 1) part = `${tag}:nth-of-type(${n})`
    }

    chain.unshift(part)

    const candidate = chain.join(' ')
    // 그래도 파서가 거절하는 모양이 남을 수 있다. 역추적 하나 때문에 요청 전체를 죽이지 않는다.
    let matched = -1
    try {
      matched = $(candidate).length
    } catch {
      matched = -1
    }
    if (matched === 1) return candidate

    current = node.parent
  }

  const fallback = chain.join(' ')
  return fallback === '' ? null : fallback
}

function nthOfType($: ReturnType<typeof load>, el: unknown): number | null {
  try {
    const node = $(el as never)
    const index = node.prevAll(String((el as { tagName: string }).tagName).toLowerCase()).length
    return index + 1
  } catch {
    return null
  }
}

// ── 공통 ───────────────────────────────────────────────────────────────

/** 행이 문자열(HTML 조각)이 아니면 문자열로 만든다 */
function rowHtml(row: unknown): string {
  if (typeof row === 'string') return row
  if (row !== null && typeof row === 'object' && '_html' in row) {
    const v = (row as Record<string, unknown>)['_html']
    if (typeof v === 'string') return v
  }
  return ''
}

/**
 * 공백을 전부 지우고 소문자로. 한국어 사이트는 렌더링과 원본의 띄어쓰기가 자주 다르고,
 * 사용자가 복사해 붙여넣을 때도 앞뒤 공백이 섞여 들어온다.
 */
function squash(text: string): string {
  return text.replace(/\s+/g, '').toLowerCase()
}

function digitsOnly(text: string): string {
  return text.replace(/\D/g, '')
}

/** `2026.09.30` `2026-09-30` `20260930` 처럼 구분자만 다른 날짜 표기 */
const DATE_LIKE = /^\d{4}[.\-/]?\d{1,2}[.\-/]?\d{1,2}\.?$/

function compare(haystack: string, needle: string): MatchKind | null {
  if (haystack === '' || needle === '') return null
  if (haystack === needle) return 'exact'
  // 날짜는 구분자만 다른 경우가 대부분이다. 사용자가 화면에서 `2026.09.30` 을 복사했는데
  // 내부 API 는 `20260930` 으로 들고 있는 상황이 한국 공공 사이트의 기본값에 가깝다.
  if (DATE_LIKE.test(haystack) && DATE_LIKE.test(needle) && digitsOnly(haystack) === digitsOnly(needle)) {
    return 'exact'
  }
  if (haystack.includes(needle)) return 'contains'
  // 사용자가 앞뒤를 더 긁어온 경우. 너무 짧은 조각이 우연히 걸리는 걸 막는다.
  if (needle.includes(haystack) && haystack.length >= Math.max(4, needle.length * 0.5)) return 'contained_by'
  return null
}

function baseScore(kind: MatchKind, haystack: string, needle: string): number {
  switch (kind) {
    case 'exact':
      return 1
    case 'contains': {
      // 원본이 길수록 "그 칸" 이 아닐 확률이 높다 (행 전체 텍스트가 걸린 경우)
      const ratio = needle.length / haystack.length
      return 0.4 + 0.45 * ratio
    }
    case 'contained_by':
      return 0.45
  }
}

/** 이 경로가 다른 항목에서도 값을 내는가 */
function coverageOf(path: string, rows: readonly unknown[], isJson: boolean): number {
  if (rows.length === 0) return 0
  let hit = 0
  for (const row of rows) {
    try {
      if (isJson) {
        const values = evaluateJsonPath(row, path)
        if (values.some((v) => v !== null && v !== undefined && String(v).trim() !== '')) hit += 1
      } else {
        const values = evaluateCssPath(rowHtml(row), path, cheerioAdapter)
        if (values.some((v) => v.trim() !== '')) hit += 1
      }
    } catch {
      // 경로 문법이 core 가 받아주지 않는 형태면 그 경로는 쓸 수 없다
      return 0
    }
  }
  return hit / rows.length
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}
