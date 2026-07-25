// date 정규화 — 이 프로젝트에서 가장 중요한 파서 (기획서 5장③)
//
// "타입이 없으면 `2026.08.14 18:00` 과 `~2026-08-21` 과 `08/14` 가 한 컬럼에 뒤섞여
//  스키마가 하나라는 말이 거짓이 된다." — 그 거짓을 여기서 막는다.
//
// ── 출력 형태 ──────────────────────────────────────────────────────────
//   { iso, kind }
//     kind 'exact'    문자열이 특정 날짜를 가리킨다.            iso = 'YYYY-MM-DD' 또는 'YYYY-MM-DDTHH:mm:00+09:00'
//     kind 'relative' 기준일에 대한 상대 표기(D-7 · 오늘 마감). iso = 계산된 날짜
//     kind 'rolling'  상시·수시 — 마감이 없다.                  iso = null
//     kind 'closed'   이미 끝났다.                              iso = null
//
// ── 규칙 ───────────────────────────────────────────────────────────────
//   1. **기준일(now)을 인자로 받는다.** 전역 시계를 읽지 않는다 — 테스트가 재현 가능해야 한다.
//   2. 시각이 없으면 날짜만(`YYYY-MM-DD`) 낸다. 없는 정밀도를 지어내지 않는다.
//      두 형태를 섞어도 문자열 정렬 결과는 날짜 순서와 같다.
//   3. 범위(`2026-08-14 ~ 2026-09-01`)는 **끝날짜**를 취한다. 목록 사이트의 날짜 컬럼은
//      거의 항상 마감일이고, 사용자가 정렬·필터로 알고 싶은 것도 끝이다.
//      구현은 "문자열 안의 마지막 날짜 표기"를 고르는 방식이라 `~2026-08-21` 도 같은 코드로 처리된다.
//   4. **연도가 없는 표기(`08/14`)는 기준일 기준으로 가장 가까운 미래 연도를 고른다.**
//      기준일 2026-07-26 에서 `08/14` → 2026-08-14, `01/05` → 2027-01-05.
//      오늘과 같은 날이면 올해로 본다(아직 안 지났다고 본다). 2/29 처럼 그 해에 없는 날짜는
//      다음 유효 연도까지 밀어본다.
//   5. **외부 날짜 라이브러리를 쓰지 않는다.** 한국은 서머타임이 없어 KST 는 고정 +09:00 이므로
//      오프셋 산술만으로 정확하다.

import type { ParseResult } from './result'
import { EMPTY_REASON, fail, ok } from './result'
import { cleanText, coerceToString } from './text'

export const DATE_KINDS = ['exact', 'rolling', 'closed', 'relative'] as const
export type DateKind = (typeof DATE_KINDS)[number]

export interface DateValue {
  /** ISO 8601. rolling·closed 는 가리킬 날짜가 없으므로 null */
  iso: string | null
  kind: DateKind
}

export interface DateParseOptions {
  /** 기준일. 상대 표기와 연도 추론이 전부 여기에 걸린다 */
  now: Date
  /** 스펙의 `date_parse.formats` (기획서 11장). 먼저 시도하고, 안 맞으면 내장 규칙으로 넘어간다 */
  formats?: string[]
  /** 스펙의 `date_parse.timezone`. 기본 Asia/Seoul */
  timezone?: string
}

/** 서머타임이 없는 지역만 고정 오프셋으로 다룬다. 모르는 값은 KST 로 본다 */
const FIXED_OFFSET_MINUTES: Record<string, number> = {
  'Asia/Seoul': 540,
  'Asia/Tokyo': 540,
  'Asia/Shanghai': 480,
  'Asia/Taipei': 480,
  UTC: 0,
  'Etc/UTC': 0,
  GMT: 0,
}

export const DEFAULT_TIMEZONE = 'Asia/Seoul'
const DEFAULT_OFFSET_MINUTES = 540
const MS_PER_DAY = 86_400_000

export function resolveOffsetMinutes(timezone?: string): number {
  if (!timezone) return DEFAULT_OFFSET_MINUTES
  return FIXED_OFFSET_MINUTES[timezone] ?? DEFAULT_OFFSET_MINUTES
}

interface Ymd {
  y: number
  m: number
  d: number
}

interface Hm {
  h: number
  mi: number
}

// ── 달력 산술 (라이브러리 없음) ────────────────────────────────────────

export function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

function isValidYmd({ y, m, d }: Ymd): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false
  if (y < 1900 || y > 2999) return false
  if (m < 1 || m > 12) return false
  return d >= 1 && d <= lastDayOfMonth(y, m)
}

/** 기준 시각을 해당 타임존의 벽시계로 본 값 */
function partsInZone(at: Date, offsetMinutes: number): Ymd & Hm {
  const shifted = new Date(at.getTime() + offsetMinutes * 60_000)
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
    h: shifted.getUTCHours(),
    mi: shifted.getUTCMinutes(),
  }
}

function addDays(base: Ymd, days: number): Ymd {
  const t = Date.UTC(base.y, base.m - 1, base.d) + days * MS_PER_DAY
  const shifted = new Date(t)
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() }
}

function compareYmd(a: Ymd, b: Ymd): number {
  return a.y - b.y || a.m - b.m || a.d - b.d
}

function pad(n: number, width: number): string {
  return String(Math.abs(n)).padStart(width, '0')
}

function formatOffset(offsetMinutes: number): string {
  if (offsetMinutes === 0) return 'Z'
  const sign = offsetMinutes > 0 ? '+' : '-'
  const abs = Math.abs(offsetMinutes)
  return `${sign}${pad(Math.floor(abs / 60), 2)}:${pad(abs % 60, 2)}`
}

/** 시각이 없으면 날짜만. 있으면 오프셋까지 붙인 완전한 ISO 8601 */
export function formatIsoDate(ymd: Ymd, time: Hm | null, offsetMinutes: number): string {
  const date = `${pad(ymd.y, 4)}-${pad(ymd.m, 2)}-${pad(ymd.d, 2)}`
  if (!time) return date
  return `${date}T${pad(time.h, 2)}:${pad(time.mi, 2)}:00${formatOffset(offsetMinutes)}`
}

// ── 관용 표현 사전 ─────────────────────────────────────────────────────

/** 마감이 없는 것들 — 상시·수시·연중 */
const ROLLING_KEYWORDS = [
  '상시',
  '수시',
  '연중',
  '연중무휴',
  '기간없음',
  '제한없음',
  '기한없음',
  '예산소진시까지',
  '충원시까지',
  '채용시까지',
  '소진시까지',
] as const

/** 이미 끝난 것들 */
const CLOSED_KEYWORDS = [
  '접수마감',
  '모집마감',
  '마감완료',
  '마감됨',
  '접수종료',
  '모집종료',
  '기간만료',
  '마감',
  '종료',
] as const

/** 기준일에 붙어 있는 표기. 값이 곧 며칠 뒤인가 */
const DAY_WORDS: ReadonlyArray<readonly [string, number]> = [
  ['오늘', 0],
  ['금일', 0],
  ['당일', 0],
  ['내일', 1],
  ['명일', 1],
  ['모레', 2],
  ['내일모레', 2],
  ['어제', -1],
  ['전일', -1],
]

/** 키워드 대조용 축약형 — 공백·구두점을 털어 `상시 모집` 과 `상시모집` 을 같게 만든다 */
function compact(text: string): string {
  return text.replace(/[\s·・.,()[\]{}<>~∼\-_/|:]+/g, '')
}

// ── 문자열 안의 날짜 표기 스캔 ─────────────────────────────────────────
//
// 하나의 정규식에 구체적인 표기부터 순서대로 넣는다. 정규식 엔진은 각 위치에서
// 왼쪽 대안부터 시도하므로, 이 순서가 곧 우선순위가 된다.
//   A  2026.08.14 · 2026-08-14 · 2026/08/14 · 2026년 8월 14일
//   B  20260814
//   C  08/14 · 8월 14일 · 08.14           (연도 없음 → 규칙 4)
//   D  2026년 8월 · 2026-08               (일이 없음 → 그 달의 말일)
const DATE_SCAN_PATTERN = new RegExp(
  [
    String.raw`(?<!\d)(?<ya>\d{4})\s*[./\-년]\s*(?<ma>\d{1,2})\s*[./\-월]\s*(?<da>\d{1,2})\s*일?`,
    String.raw`(?<!\d)(?<yb>\d{4})(?<mb>\d{2})(?<db>\d{2})(?!\d)`,
    String.raw`(?<!\d)(?<mc>\d{1,2})\s*[./\-월]\s*(?<dc>\d{1,2})\s*일?(?!\d)`,
    String.raw`(?<!\d)(?<yd>\d{4})\s*[./\-년]\s*(?<md>\d{1,2})\s*월?(?![\s./\-]*\d)`,
  ].join('|'),
  'g',
)

/** 날짜 뒤에 붙는 시각. `(목)` 같은 요일 표기와 `까지` 를 건너뛴다 */
const TIME_TAIL_PATTERN =
  /^\s*(?:\([^)]{0,6}\))?\s*(?:까지|마감|부터)?\s*(?<h>\d{1,2})\s*(?::\s*(?<mi>\d{2})|시\s*(?:(?<mi2>\d{1,2})\s*분)?)/

interface ScanHit {
  ymd: Ymd | null
  /** 연도가 없어 추론이 필요한 경우 */
  monthDay: { m: number; d: number } | null
  end: number
}

function collectDateHits(text: string): ScanHit[] {
  const hits: ScanHit[] = []
  DATE_SCAN_PATTERN.lastIndex = 0
  for (const match of text.matchAll(DATE_SCAN_PATTERN)) {
    const g = match.groups
    if (!g) continue
    const end = (match.index ?? 0) + match[0].length
    const num = (key: string): number | null => {
      const v = g[key]
      return v === undefined ? null : Number.parseInt(v, 10)
    }

    if (g['ya'] !== undefined) {
      hits.push({ ymd: { y: num('ya') ?? 0, m: num('ma') ?? 0, d: num('da') ?? 0 }, monthDay: null, end })
    } else if (g['yb'] !== undefined) {
      hits.push({ ymd: { y: num('yb') ?? 0, m: num('mb') ?? 0, d: num('db') ?? 0 }, monthDay: null, end })
    } else if (g['mc'] !== undefined) {
      hits.push({ ymd: null, monthDay: { m: num('mc') ?? 0, d: num('dc') ?? 0 }, end })
    } else if (g['yd'] !== undefined) {
      const y = num('yd') ?? 0
      const m = num('md') ?? 0
      // 일이 없는 표기는 그 달의 말일로 본다 — 목록 사이트의 "2026년 8월" 은 그 달까지라는 뜻이다
      const d = m >= 1 && m <= 12 ? lastDayOfMonth(y, m) : 0
      hits.push({ ymd: { y, m, d }, monthDay: null, end })
    }
  }
  return hits
}

/**
 * 연도 없는 표기의 연도 추론 (규칙 4).
 * 기준일과 같은 날이면 아직 안 지난 것으로 본다. 그 해에 없는 날짜(2/29)는 다음 해로 민다.
 */
function inferYear(monthDay: { m: number; d: number }, today: Ymd): Ymd | null {
  if (monthDay.m < 1 || monthDay.m > 12 || monthDay.d < 1) return null
  for (let offset = 0; offset <= 4; offset += 1) {
    const candidate: Ymd = { y: today.y + offset, m: monthDay.m, d: monthDay.d }
    if (!isValidYmd(candidate)) continue
    if (compareYmd(candidate, today) >= 0) return candidate
  }
  return null
}

function readTimeTail(text: string, from: number): Hm | null {
  const m = TIME_TAIL_PATTERN.exec(text.slice(from))
  const rawHour = m?.groups?.['h']
  if (!m || rawHour === undefined) return null
  const h = Number.parseInt(rawHour, 10)
  const rawMinute = m.groups?.['mi'] ?? m.groups?.['mi2']
  const mi = rawMinute === undefined ? 0 : Number.parseInt(rawMinute, 10)
  if (h > 24 || mi > 59) return null
  // `24:00` 은 자정 마감의 관용 표기다. 하루의 끝으로 눌러둔다
  return { h: h === 24 ? 23 : h, mi: h === 24 ? 59 : mi }
}

// ── 명시 포맷 (스펙의 date_parse.formats) ──────────────────────────────

const FORMAT_TOKEN_PATTERN = /YYYY|YY|MM|M|DD|D|HH|H|mm|ss/g

const FORMAT_TOKEN_SOURCE: Record<string, string> = {
  YYYY: String.raw`(?<y>\d{4})`,
  YY: String.raw`(?<y2>\d{2})`,
  MM: String.raw`(?<m>\d{2})`,
  M: String.raw`(?<m>\d{1,2})`,
  DD: String.raw`(?<d>\d{2})`,
  D: String.raw`(?<d>\d{1,2})`,
  HH: String.raw`(?<h>\d{2})`,
  H: String.raw`(?<h>\d{1,2})`,
  mm: String.raw`(?<mi>\d{2})`,
  ss: String.raw`(?<s>\d{2})`,
}

function escapeRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** `YYYYMMDD` 같은 포맷 문자열을 정규식으로. 토큰이 겹치면(같은 토큰 두 번) null */
export function compileDateFormat(format: string): RegExp | null {
  let source = ''
  let cursor = 0
  FORMAT_TOKEN_PATTERN.lastIndex = 0
  for (const match of format.matchAll(FORMAT_TOKEN_PATTERN)) {
    const index = match.index ?? 0
    source += escapeRegex(format.slice(cursor, index))
    const token = match[0]
    source += FORMAT_TOKEN_SOURCE[token] ?? escapeRegex(token)
    cursor = index + token.length
  }
  source += escapeRegex(format.slice(cursor))
  if (source === '') return null
  try {
    return new RegExp(`^\\s*${source}\\s*$`)
  } catch {
    return null
  }
}

function tryFormats(text: string, formats: string[], today: Ymd): { ymd: Ymd; time: Hm | null } | null {
  for (const format of formats) {
    const re = compileDateFormat(format)
    if (!re) continue
    const m = re.exec(text)
    if (!m?.groups) continue
    const g = m.groups
    const rawMonth = g['m']
    const rawDay = g['d']
    if (rawMonth === undefined) continue
    const month = Number.parseInt(rawMonth, 10)
    const day = rawDay === undefined ? 1 : Number.parseInt(rawDay, 10)
    let year: number
    if (g['y'] !== undefined) {
      year = Number.parseInt(g['y'], 10)
    } else if (g['y2'] !== undefined) {
      // 두 자리 연도는 2000년대로 본다 — 목록 사이트에 1900년대 마감은 없다
      year = 2000 + Number.parseInt(g['y2'], 10)
    } else {
      const inferred = inferYear({ m: month, d: day }, today)
      if (!inferred) continue
      year = inferred.y
    }
    const ymd: Ymd = { y: year, m: month, d: day }
    if (!isValidYmd(ymd)) continue
    const rawHour = g['h']
    const time: Hm | null =
      rawHour === undefined
        ? null
        : { h: Number.parseInt(rawHour, 10), mi: g['mi'] === undefined ? 0 : Number.parseInt(g['mi'], 10) }
    if (time && (time.h > 23 || time.mi > 59)) continue
    return { ymd, time }
  }
  return null
}

// ── 본체 ───────────────────────────────────────────────────────────────

/** `D-7` · `D-7일` · `D-DAY` · `DDAY`. 대문자 D 만 본다 — 소문자까지 허용하면 오탐이 는다 */
const DDAY_PATTERN = /D\s*[-−–—]?\s*(?:(?<n>\d{1,4})|(?:DAY|Day|day|데이))(?!\d)/
const DPLUS_PATTERN = /D\s*\+\s*(?<n>\d{1,4})(?!\d)/

/**
 * 한국 목록 사이트의 날짜 표기를 ISO 8601 로 정규화한다. 절대 throw 하지 않는다.
 *
 * @param raw   원값. 문자열·숫자·Date·문자열 배열을 받는다
 * @param options `now` 는 필수 — 상대 표기와 연도 추론의 기준일
 */
export function parseDate(raw: unknown, options: DateParseOptions): ParseResult<DateValue> {
  const offsetMinutes = resolveOffsetMinutes(options.timezone)

  if (Number.isNaN(options.now.getTime())) return fail('기준일이 올바르지 않습니다')
  const nowParts = partsInZone(options.now, offsetMinutes)
  const today: Ymd = { y: nowParts.y, m: nowParts.m, d: nowParts.d }

  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return fail('날짜 값이 유효하지 않습니다')
    const p = partsInZone(raw, offsetMinutes)
    const hasTime = p.h !== 0 || p.mi !== 0
    return ok({
      iso: formatIsoDate(p, hasTime ? { h: p.h, mi: p.mi } : null, offsetMinutes),
      kind: 'exact',
    })
  }

  const text = cleanText(coerceToString(raw))
  if (text === '') return fail(EMPTY_REASON)

  // ① 스펙이 준 포맷 후보를 먼저 시도한다 (기획서 11장 date_parse.formats)
  if (options.formats && options.formats.length > 0) {
    const hit = tryFormats(text, options.formats, today)
    if (hit) return ok({ iso: formatIsoDate(hit.ymd, hit.time, offsetMinutes), kind: 'exact' })
    // 안 맞으면 실패시키지 않고 내장 규칙으로 넘어간다 — 포맷은 힌트지 계약이 아니다
  }

  // ② 문자열 안의 날짜 표기. 여러 개면 마지막 것 = 범위의 끝날짜 (규칙 3)
  const hits = collectDateHits(text)
  if (hits.length > 0) {
    for (let i = hits.length - 1; i >= 0; i -= 1) {
      const hit = hits[i]
      if (!hit) continue
      const ymd = hit.ymd ?? (hit.monthDay ? inferYear(hit.monthDay, today) : null)
      if (!ymd || !isValidYmd(ymd)) continue
      return ok({ iso: formatIsoDate(ymd, readTimeTail(text, hit.end), offsetMinutes), kind: 'exact' })
    }
    return fail('날짜 값이 유효하지 않습니다')
  }

  // ③ 기준일 상대 표기
  const dday = DDAY_PATTERN.exec(text)
  if (dday?.groups) {
    const n = dday.groups['n']
    const days = n === undefined ? 0 : Number.parseInt(n, 10)
    return ok({ iso: formatIsoDate(addDays(today, days), null, offsetMinutes), kind: 'relative' })
  }
  const dplus = DPLUS_PATTERN.exec(text)
  if (dplus?.groups?.['n'] !== undefined) {
    // D+n 은 "그날로부터 n일 지났다" 는 뜻이다. 가리키는 날짜는 기준일보다 과거다
    const days = Number.parseInt(dplus.groups['n'], 10)
    return ok({ iso: formatIsoDate(addDays(today, -days), null, offsetMinutes), kind: 'relative' })
  }

  const packed = compact(text)
  for (const [word, delta] of DAY_WORDS) {
    if (packed.includes(word)) {
      return ok({ iso: formatIsoDate(addDays(today, delta), null, offsetMinutes), kind: 'relative' })
    }
  }

  // ④ 마감이 없는 것 / 이미 끝난 것.
  //    날짜도 상대 표기도 없을 때만 본다 — `2026-08-14 마감` 은 ② 에서 exact 로 잡혀야 한다
  if (ROLLING_KEYWORDS.some((k) => packed.includes(k))) return ok({ iso: null, kind: 'rolling' })
  if (CLOSED_KEYWORDS.some((k) => packed.includes(k))) return ok({ iso: null, kind: 'closed' })

  return fail('날짜로 읽을 수 없습니다')
}
