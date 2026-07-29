// fetchers — 스펙의 fetch.mode 별 실행기 (기획서 9-3① EXECUTE 의 앞쪽 절반)
//
// ── 경계 ────────────────────────────────────────────────────────────────
//   fetchers  네트워크를 탄다. "무엇을 받아왔는가" 까지.
//   core      순수 함수다. "그게 무슨 뜻인가" 는 전부 여기.
// 이 경계 덕분에 화면의 미리보기와 워커의 정기 수집이 **같은 해석기** 를 쓴다 (기획서 8장).
//
// 페이지네이션 상한은 ADR A12 로 3페이지다. 스펙이 더 크게 적어도 여기서 한 번 더 자른다.

import type { CollectionSchemaJson, FieldValidation, ValidationReport } from '@endpointer/core'
import type { AdapterSpec, InterpretedItem } from '@endpointer/core/spec'
import { evaluateCssPath, evaluateJsonPath, interpretSpec } from '@endpointer/core/spec'
import { kstToday } from '@endpointer/core/query'

import { getConfig } from '../config'
import { childLogger } from '../logger'
import { fetchBrowserPayload } from './browser'
import { cheerioAdapter } from './cheerio-adapter'
import { fetchHtmlPayload } from './html'
import { fetchJsonPayload } from './json'
import { stabilizeExternalKeys } from './stabilize-keys'
import type { PageFetchOutcome } from './types'

export { cheerioAdapter, resetHtmlCache } from './cheerio-adapter'
export { httpGet, throttleHost, clearHttpCache, isJsonContentType } from './http'
export { fetchJsonPayload } from './json'
export { fetchHtmlPayload } from './html'
export { fetchBrowserPayload, browsersInUse } from './browser'
export type { PageFetchOutcome } from './types'

const log = childLogger({ mod: 'fetch' })

/**
 * 날짜 자리표시자를 그 순간의 오늘(KST)로 바꾼다.
 * `{today}` → YYYYMMDD · `{today_iso}` → YYYY-MM-DD. 상영시간표·예약 API 가 요구하는 날짜 파라미터.
 * 한 수집(run) 안에서는 같은 `now` 를 써 페이지마다 날짜가 어긋나지 않게 한다.
 */
export function applyDatePlaceholders(template: string, now: Date): string {
  const iso = kstToday(now)
  const compact = iso.replace(/-/g, '')
  return template.replaceAll('{today}', compact).replaceAll('{today_iso}', iso)
}

/** 페이지 하나를 스펙대로 받아온다. url 은 이미 {page}·{today} 가 치환된 상태로 들어온다 */
export async function fetchPage(spec: AdapterSpec, url: string, now: Date = new Date()): Promise<PageFetchOutcome> {
  switch (spec.fetch.mode) {
    case 'json': {
      // body 의 {today} 는 여기서 푼다 (url 은 호출부가 이미 풀어서 넘긴다)
      const body =
        spec.fetch.body === undefined ? undefined : applyDatePlaceholders(spec.fetch.body, now)
      return fetchJsonPayload(spec.fetch, url, body)
    }
    case 'html':
      return fetchHtmlPayload(spec.fetch, url)
    case 'browser': {
      const scrollTimes = spec.pagination.kind === 'scroll' ? spec.pagination.times : 0
      return fetchBrowserPayload(spec.fetch, url, { scrollTimes })
    }
  }
}

export interface RunAdapterInput {
  spec: AdapterSpec
  /** 컬렉션 스키마 — enum mapping 과 사람용 라벨에 쓰인다 */
  schema?: CollectionSchemaJson
  timezone?: string
  now?: Date
  /** 스펙보다 더 줄이고 싶을 때 */
  maxPages?: number
}

export interface RunAdapterResult {
  items: InterpretedItem[]
  /** 그대로 `runs.validation_json` 이 된다. 드리프트 검증기의 입력 (원칙 ⑤) */
  report: ValidationReport
  pagesFetched: number
  warnings: string[]
  /** 한 페이지도 못 받아왔을 때의 사유. 성공하면 null */
  failure: string | null
}

/**
 * 스펙 하나를 끝까지 실행한다 — 페이지를 넘겨가며 받아서 해석기에 넣고 합친다.
 *
 * **부분 성공이 1급이다** (원칙 ④): 2페이지에서 실패해도 1페이지의 아이템은 살아서 나간다.
 */
export async function runAdapter(input: RunAdapterInput): Promise<RunAdapterResult> {
  const cfg = getConfig()
  const { spec } = input
  const now = input.now ?? new Date()

  const specMax = 'max_pages' in spec.pagination ? spec.pagination.max_pages : 1
  const maxPages = Math.max(1, Math.min(input.maxPages ?? cfg.crawlerMaxPages, cfg.crawlerMaxPages, specMax))

  const items: InterpretedItem[] = []
  const warnings: string[] = []
  const perPageStats: { count: number; fields: Record<string, FieldValidation> }[] = []
  const seenKeys = new Set<string>()

  let url: string | null = firstUrl(spec)
  let pagesFetched = 0
  let failure: string | null = null

  for (let page = 0; page < maxPages && url !== null; page += 1) {
    // {page} 는 firstUrl/nextUrl 이 이미 풀었다. {today} 는 여기서 이 run 의 now 로 푼다
    const outcome = await fetchPage(spec, applyDatePlaceholders(url, now), now)
    if (!outcome.ok) {
      if (page === 0) failure = outcome.message
      else warnings.push(`${page + 1}번째 페이지는 받아오지 못했습니다`)
      break
    }
    pagesFetched += 1

    const ctx = {
      html: cheerioAdapter,
      baseUrl: outcome.finalUrl,
      now,
      ...(input.schema !== undefined ? { schema: input.schema } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
    }
    const result = interpretSpec(spec, outcome.payload, ctx)

    for (const item of result.items) {
      // 페이지가 겹쳐 같은 항목이 두 번 나오는 사이트가 있다
      if (seenKeys.has(item.external_key)) continue
      seenKeys.add(item.external_key)
      items.push(item)
    }
    warnings.push(...result.warnings)
    perPageStats.push({ count: result.items.length, fields: result.fieldStats })

    // 이번 페이지에서 아무것도 안 나왔으면 더 넘길 이유가 없다
    if (result.items.length === 0) break

    url = nextUrl(spec, page, outcome.payload, outcome.finalUrl)
  }

  // 링크에 목록 상태(페이지 번호 등)가 박힌 사이트에서 키가 흔들리지 않게 (stabilize-keys.ts).
  // 모든 페이지의 행을 모아야 판단할 수 있어서 페이지 루프 **뒤**에 있다.
  const stabilized = stabilizeExternalKeys(items)
  if (stabilized.note !== null) warnings.push(stabilized.note)
  const finalItems = stabilized.items

  const report: ValidationReport = {
    checked_at: now.toISOString(),
    items_found: finalItems.length,
    fields: mergeFieldStats(perPageStats),
    // 진짜 판정은 core 의 evaluateReport 가 한다. 여기서는 "일단 뽑히긴 했는가" 만 적는다.
    passed: finalItems.length > 0,
    notes: failure !== null ? [failure] : [],
  }

  log.debug({ mode: spec.fetch.mode, pages: pagesFetched, items: items.length }, '수집 실행')

  return { items: finalItems, report, pagesFetched, warnings: dedupe(warnings), failure }
}

// ── 페이지 넘기기 ──────────────────────────────────────────────────────

function firstUrl(spec: AdapterSpec): string {
  const start = spec.pagination.kind === 'page_param' ? spec.pagination.start : 1
  return spec.fetch.url.replace('{page}', String(start))
}

function nextUrl(spec: AdapterSpec, pageIndex: number, payload: unknown, baseUrl: string): string | null {
  const pagination = spec.pagination

  if (pagination.kind === 'page_param') {
    return spec.fetch.url.replace('{page}', String(pagination.start + pageIndex + 1))
  }

  if (pagination.kind === 'next_link') {
    const raw =
      spec.fetch.mode === 'json'
        ? evaluateJsonPath(payload, pagination.path).map((v) => (typeof v === 'string' ? v : ''))
        : evaluateCssPath(typeof payload === 'string' ? payload : '', pagination.path, cheerioAdapter)
    const href = raw.find((v) => v.trim() !== '')
    if (href === undefined) return null
    try {
      return new URL(href, baseUrl).toString()
    } catch {
      return null
    }
  }

  // none · scroll 은 한 번의 fetch 로 끝난다
  return null
}

// ── 통계 합치기 ────────────────────────────────────────────────────────

/**
 * 페이지별 필드 통계를 **아이템 수로 가중평균** 한다.
 * 단순 평균을 내면 3개짜리 마지막 페이지가 50개짜리 첫 페이지와 같은 무게가 되어
 * 드리프트 판정이 흔들린다.
 */
export function mergeFieldStats(
  pages: readonly { count: number; fields: Record<string, FieldValidation> }[],
): Record<string, FieldValidation> {
  const out: Record<string, FieldValidation> = {}
  const totals = new Map<string, { weight: number; nulls: number; fails: number; samples: string[] }>()

  for (const page of pages) {
    const weight = Math.max(1, page.count)
    for (const [key, stat] of Object.entries(page.fields)) {
      const acc = totals.get(key) ?? { weight: 0, nulls: 0, fails: 0, samples: [] }
      acc.weight += weight
      acc.nulls += stat.null_ratio * weight
      acc.fails += stat.type_fail_ratio * weight
      for (const s of stat.samples) {
        if (acc.samples.length < 5 && !acc.samples.includes(s)) acc.samples.push(s)
      }
      totals.set(key, acc)
    }
  }

  for (const [key, acc] of totals) {
    out[key] = {
      null_ratio: acc.weight === 0 ? 0 : clamp01(acc.nulls / acc.weight),
      type_fail_ratio: acc.weight === 0 ? 0 : clamp01(acc.fails / acc.weight),
      samples: acc.samples,
    }
  }
  return out
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

function dedupe(list: readonly string[]): string[] {
  return [...new Set(list)].slice(0, 10)
}
