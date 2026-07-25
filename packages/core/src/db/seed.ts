// 시드 — `pnpm db:seed` (= `tsx src/db/seed.ts`), 지우고 다시 넣으려면 `pnpm db:seed -- --reset`
//
// **G0 의 핵심 산출물이다** (기획서 13장 G0 · 14장 트랙 계약 #4).
// 트랙 B(표면)가 트랙 A(파이프라인)의 코드 없이 화면을 만들 수 있게 하는 장치.
// 여기서 만드는 것: 컬렉션 1개 · 사이트 2개 · 항목 20개 · 수집 기록 6개 · 구독 1개.
//
// 이 시드가 미리 보여주는 것 세 가지 —
//  1. **G2 판정**("두 출처가 한 표에 같은 형식으로 섞인다"):
//     두 사이트의 원문 표기가 서로 다르다(`"20260814"` vs `"~2026-08-21"`,
//     `"최대 100,000천원"` vs `"최대 3,000만원"`). data_json 에서는 같은 형식이 된다.
//  2. **5장③ 타입 정규화**: A 사이트의 "기술개발"과 B 사이트의 "R&D" 가 같은 `rnd` 로 들어간다.
//  3. **원문 대조**: raw_json 의 키가 provenance_json 의 경로와 같다. 값에 마우스를 올리면
//     그 경로로 원문 조각을 바로 꺼낼 수 있다 (기획서 10장).
//
// 그리고 **계약이 살아 있다는 증거**: 아래 두 수집 설정(기획서 11장의 JSON/HTML 예시)은
// core 의 zod 스펙 스키마를 통과해야만 저장된다. 통과 못 하면 시드가 실패한다.
//
// 멱등: 두 번 돌려도 중복이 생기지 않는다 (UNIQUE 제약 + onConflictDoUpdate).
// 재실행 시 first_seen_at 은 덮어쓰지 않는다 — 신규 판정의 기준이기 때문 (ADR A13).

import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { config as loadDotenv } from 'dotenv'
import { and, eq, gte, inArray, sql } from 'drizzle-orm'

import { AdapterSpecSchema, specTargetsHost, type AdapterSpec, type AdapterSpecInput } from '../spec/spec'
import type { CollectionFilter } from '../types/api'
import { CollectionSchemaJsonSchema, type CollectionSchemaJson } from '../types/collection'
import type { ItemData, ItemProvenance, ItemRaw } from '../types/item'
import type { RunStatus, ValidationReport } from '../types/run'
import {
  adapters,
  collections,
  items,
  runs,
  sources,
  subscriptions,
  users,
  type NewItemRow,
  type NewRunRow,
} from './schema'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** packages/core/src/db → 레포 루트 */
const REPO_ROOT = path.resolve(HERE, '../../../..')

loadDotenv({ path: path.join(REPO_ROOT, '.env'), quiet: true })

// migrate.ts 와 같은 이유로 dotenv 이후 동적 import 해야 한다
const { db, closeDb } = await import('./client')

// ════════════════════════════════════════════════════════════════════════
// 작은 도구들
// ════════════════════════════════════════════════════════════════════════

const DAY_MS = 86_400_000
const now = new Date()

const daysAgo = (days: number): Date => new Date(now.getTime() - days * DAY_MS)
const daysFromNow = (days: number): Date => new Date(now.getTime() + days * DAY_MS)

/** 정규화된 날짜 표현 — `YYYY-MM-DD` (Asia/Seoul 기준) */
function isoDate(d: Date): string {
  return new Date(d.getTime() + 9 * 3_600_000).toISOString().slice(0, 10)
}

/** 1234567 → "1,234,567" (로케일에 의존하지 않게 직접 찍는다) */
function withCommas(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * 같은 키에서 항상 같은 UUID. runs·subscriptions 처럼 자연 UNIQUE 키가 없는 테이블의
 * 멱등성을 여기에 기댄다 (id 충돌 → 갱신).
 */
function seedUuid(key: string): string {
  const digest = createHash('sha256').update(`endpointer-seed:${key}`).digest()
  const bytes = new Uint8Array(digest.subarray(0, 16))
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40 // version 4
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80 // variant
  const hex = Buffer.from(bytes).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** data_json 의 안정 직렬화 해시 — 변경 감지용 (기획서 10장 content_hash) */
function contentHash(data: ItemData): string {
  const stable = Object.entries(data)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join('')
  return createHash('sha256').update(stable).digest('hex').slice(0, 32)
}

/** 수집 설정의 필드 경로가 그대로 원본 경로가 된다 — 어긋날 수 없게 스펙에서 뽑는다 */
function provenanceOf(spec: AdapterSpec): ItemProvenance {
  const out: ItemProvenance = {}
  for (const [key, field] of Object.entries(spec.fields)) out[key] = field.path
  return out
}

/** 필드 키로 적은 원문 조각을 원본 경로 키로 바꿔 담는다 */
function rawByPath(provenance: ItemProvenance, byField: Record<string, string>): ItemRaw {
  const out: ItemRaw = {}
  for (const [key, value] of Object.entries(byField)) {
    const p = provenance[key]
    if (p !== undefined) out[p] = value
  }
  return out
}

/**
 * 실행 전 형태 검사 (기획서 11장 "스펙 검증").
 * 시드에서도 똑같이 돌린다 — 이 파일이 계약을 우회하면 계약이 아니다.
 */
function parseSpec(host: string, input: AdapterSpecInput): AdapterSpec {
  const parsed = AdapterSpecSchema.safeParse(input)
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    throw new Error(`${host} 의 수집 설정이 규격을 통과하지 못했습니다.\n${lines.join('\n')}`)
  }
  if (!specTargetsHost(parsed.data, host)) {
    throw new Error(`${host} 의 수집 설정이 다른 사이트를 가리키고 있습니다.`)
  }
  return parsed.data
}

// ════════════════════════════════════════════════════════════════════════
// 컬렉션 (G0 계약 (4))
// ════════════════════════════════════════════════════════════════════════

const SEED_USER_ID = seedUuid('user:demo')
const SEED_USER_EMAIL = 'demo@endpointer.local'
const COLLECTION_SLUG = 'contest'

/**
 * enum 매핑 — 기능 ③ 이 시드로 증명되는 지점.
 * 왼쪽은 두 사이트가 실제로 쓰는 말, 오른쪽은 표에 들어가는 하나의 값이다.
 * A 의 "기술개발" 과 B 의 "R&D" 가 같은 `rnd` 가 된다.
 */
const CATEGORY_MAPPING: Record<string, string> = {
  기술개발: 'rnd',
  'R&D': 'rnd',
  연구개발: 'rnd',
  창업지원: 'startup',
  창업: 'startup',
  예비창업: 'startup',
  사업화: 'commercialize',
  '판로·해외진출': 'market',
  수출지원: 'market',
  판로개척: 'market',
  자금지원: 'fund',
  융자: 'fund',
  인력양성: 'talent',
  교육: 'talent',
}

/** 매핑에 없는 표기는 버리지 않고 `etc` 로 받는다 (원칙 ④ 부분 성공) */
const CATEGORY_FALLBACK = 'etc'

const COLLECTION_SCHEMA: CollectionSchemaJson = CollectionSchemaJsonSchema.parse([
  { key: 'title', label: '사업명', type: 'text', required: true, mapping: null },
  { key: 'organization', label: '주관기관', type: 'text', required: false, mapping: null },
  { key: 'deadline', label: '마감일', type: 'date', required: false, mapping: null },
  { key: 'amount', label: '지원금액', type: 'money', required: false, mapping: null },
  { key: 'category', label: '분야', type: 'enum', required: false, mapping: CATEGORY_MAPPING },
  { key: 'link', label: '원문 보기', type: 'link', required: true, mapping: null },
])

// ════════════════════════════════════════════════════════════════════════
// 사이트 2개와 수집 설정 (기획서 11장의 두 예시가 원본)
// ════════════════════════════════════════════════════════════════════════

const KSTARTUP_HOST = 'k-startup.go.kr'
const KSTARTUP_ENTRY = 'https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do'
const KSTARTUP_LINK_BASE = 'https://www.k-startup.go.kr/web/contents/detail?sn='

const BIZINFO_HOST = 'bizinfo.go.kr'
const BIZINFO_ORIGIN = 'https://www.bizinfo.go.kr'
const BIZINFO_ENTRY = 'https://www.bizinfo.go.kr/web/lay1/bbs/S1T122C128/AS/74/list.do'

/** JSON 모드 — 내부 엔드포인트를 찾은 경우 (원칙 ③ · 기획서 11장 첫 예시) */
const KSTARTUP_SPEC_INPUT: AdapterSpecInput = {
  spec_version: 1,
  fetch: {
    mode: 'json',
    url: 'https://www.k-startup.go.kr/api/pbanc/list?page={page}&size=50',
    method: 'GET',
    headers: { Accept: 'application/json' },
  },
  list: '$.data.items[*]',
  dedupe_key: '$.pbancSn',
  fields: {
    title: { path: '$.pbancNm', type: 'text', transform: [{ op: 'trim' }, { op: 'collapse_space' }] },
    organization: { path: '$.jrsdInsttNm', type: 'text', transform: [{ op: 'trim' }] },
    deadline: {
      path: '$.reqstEndDe',
      type: 'date',
      transform: [{ op: 'date_parse', formats: ['YYYYMMDD', 'YYYY.MM.DD'], timezone: 'Asia/Seoul' }],
    },
    amount: {
      path: '$.sportAmount',
      type: 'money',
      transform: [
        { op: 'regex_extract', pattern: '[\\d,]+' },
        { op: 'number_parse' },
        { op: 'multiply', by: 1000 },
      ],
    },
    category: {
      path: '$.supportBizClsfcNm',
      type: 'enum',
      transform: [{ op: 'trim' }, { op: 'map', mapping: CATEGORY_MAPPING, fallback: CATEGORY_FALLBACK }],
    },
    link: {
      path: '$.pbancSn',
      type: 'link',
      transform: [{ op: 'template', value: `${KSTARTUP_LINK_BASE}{value}` }],
    },
  },
  pagination: { kind: 'page_param', param: 'page', start: 1, max_pages: 3 },
}

/** HTML 모드 — 폴백 (기획서 11장 두 번째 예시) */
const BIZINFO_SPEC_INPUT: AdapterSpecInput = {
  spec_version: 1,
  fetch: { mode: 'html', url: BIZINFO_ENTRY },
  list: 'css:table.table_list tbody > tr',
  dedupe_key: 'css:td.txt_l a@href',
  fields: {
    title: { path: 'css:td.txt_l a', type: 'text', transform: [{ op: 'trim' }, { op: 'collapse_space' }] },
    organization: { path: 'css:td.organ', type: 'text', transform: [{ op: 'trim' }] },
    deadline: {
      path: 'css:td.period',
      type: 'date',
      transform: [
        { op: 'regex_extract', pattern: '\\d{4}[.-]\\d{2}[.-]\\d{2}\\s*$' },
        { op: 'trim' },
        { op: 'date_parse', timezone: 'Asia/Seoul' },
      ],
    },
    amount: {
      path: 'css:td.amount',
      type: 'money',
      transform: [
        { op: 'regex_extract', pattern: '[\\d,]+' },
        { op: 'number_parse' },
        { op: 'multiply', by: 10_000 },
      ],
    },
    category: {
      path: 'css:td.category',
      type: 'enum',
      transform: [{ op: 'trim' }, { op: 'map', mapping: CATEGORY_MAPPING, fallback: CATEGORY_FALLBACK }],
    },
    link: {
      path: 'css:td.txt_l a@href',
      type: 'link',
      transform: [{ op: 'absolute_url', base: BIZINFO_ORIGIN }],
    },
  },
  pagination: { kind: 'next_link', path: 'css:a.next@href', max_pages: 3 },
}

// ════════════════════════════════════════════════════════════════════════
// 항목 20개 (10 / 10)
// ════════════════════════════════════════════════════════════════════════

/** 금액 원문 표기 스타일 — 실제 사이트가 이렇게 제각각이다 */
type AmountStyle = 'max' | 'within' | 'scale'

interface SeedItemSpec {
  /** 소스 내 고유 식별자 (ADR A13) */
  externalKey: string
  title: string
  organization: string
  /** 원문에 적힌 분야 표기. 두 사이트가 서로 다른 낱말을 쓴다 */
  rawCategory: string
  /** 마감까지 남은 일수 */
  deadlineInDays: number
  /** 원문 금액의 단위 수치. k-startup 은 천원, bizinfo 는 만원 */
  amountUnits: number
  amountStyle: AmountStyle
  /** 처음 발견된 시점 (며칠 전). 3일 이내면 화면에서 "새로 올라온 것" */
  firstSeenDaysAgo: number
}

const KSTARTUP_ITEMS: SeedItemSpec[] = [
  {
    externalKey: '174801',
    title: '2026년 창업도약패키지 창업기업 모집 공고',
    organization: '중소벤처기업부',
    rawCategory: '창업지원',
    deadlineInDays: 19,
    amountUnits: 300_000,
    amountStyle: 'max',
    firstSeenDaysAgo: 0.5,
  },
  {
    externalKey: '174802',
    title: '2026년 초기창업패키지 주관기관 모집 공고',
    organization: '창업진흥원',
    rawCategory: '창업지원',
    deadlineInDays: 26,
    amountUnits: 100_000,
    amountStyle: 'max',
    firstSeenDaysAgo: 2,
  },
  {
    externalKey: '174803',
    title: '2026년 창업성장기술개발사업 디딤돌 과제 공고',
    organization: '중소기업기술정보진흥원',
    rawCategory: '기술개발',
    deadlineInDays: 12,
    amountUnits: 120_000,
    amountStyle: 'within',
    firstSeenDaysAgo: 3,
  },
  {
    externalKey: '174804',
    title: '2026년 민관공동 창업자 발굴육성사업 신규과제 공고',
    organization: '창업진흥원',
    rawCategory: '기술개발',
    deadlineInDays: 33,
    amountUnits: 500_000,
    amountStyle: 'max',
    firstSeenDaysAgo: 8,
  },
  {
    externalKey: '174805',
    title: '2026년 아기유니콘 육성사업 참여기업 모집',
    organization: '중소벤처기업부',
    rawCategory: '사업화',
    deadlineInDays: 9,
    amountUnits: 300_000,
    amountStyle: 'max',
    firstSeenDaysAgo: 15,
  },
  {
    externalKey: '174806',
    title: '2026년 예비창업패키지 예비창업자 모집 공고',
    organization: '창업진흥원',
    rawCategory: '예비창업',
    deadlineInDays: 5,
    amountUnits: 50_000,
    amountStyle: 'max',
    firstSeenDaysAgo: 22,
  },
  {
    externalKey: '174807',
    title: '2026년 글로벌 창업사관학교 해외 진출기업 모집',
    organization: '창업진흥원',
    rawCategory: '판로·해외진출',
    deadlineInDays: 40,
    amountUnits: 80_000,
    amountStyle: 'within',
    firstSeenDaysAgo: 30,
  },
  {
    externalKey: '174808',
    title: '2026년 소재·부품·장비 기술개발 지원과제 공고',
    organization: '한국산업기술진흥원',
    rawCategory: '기술개발',
    deadlineInDays: 23,
    amountUnits: 250_000,
    amountStyle: 'scale',
    firstSeenDaysAgo: 41,
  },
  {
    externalKey: '174809',
    title: '2026년 청년창업사관학교 입교기업 모집 공고',
    organization: '중소벤처기업진흥공단',
    rawCategory: '창업지원',
    deadlineInDays: 16,
    amountUnits: 100_000,
    amountStyle: 'max',
    firstSeenDaysAgo: 52,
  },
  {
    externalKey: '174810',
    title: '2026년 스마트공장 구축 및 고도화 지원사업 공고',
    organization: '중소벤처기업부',
    rawCategory: '사업화',
    deadlineInDays: 30,
    amountUnits: 60_000,
    amountStyle: 'max',
    firstSeenDaysAgo: 60,
  },
]

const BIZINFO_ITEMS: SeedItemSpec[] = [
  {
    externalKey: 'PBLN_000000000098231',
    title: '2026년 중소기업 수출바우처 지원사업 참여기업 모집',
    organization: '중소벤처기업부',
    rawCategory: '수출지원',
    deadlineInDays: 26,
    amountUnits: 3_000,
    amountStyle: 'max',
    firstSeenDaysAgo: 1.5,
  },
  {
    externalKey: 'PBLN_000000000098244',
    title: '2026년 지역주력산업 육성 R&D 과제 공고',
    organization: '한국산업기술진흥원',
    rawCategory: 'R&D',
    deadlineInDays: 14,
    amountUnits: 20_000,
    amountStyle: 'within',
    firstSeenDaysAgo: 6,
  },
  {
    externalKey: 'PBLN_000000000098259',
    title: '2026년 소상공인 정책자금 융자 신청 안내',
    organization: '소상공인시장진흥공단',
    rawCategory: '융자',
    deadlineInDays: 50,
    amountUnits: 7_000,
    amountStyle: 'max',
    firstSeenDaysAgo: 9,
  },
  {
    externalKey: 'PBLN_000000000098271',
    title: '2026년 중소기업 기술사업화 역량강화 지원사업 공고',
    organization: '중소기업기술정보진흥원',
    rawCategory: '사업화',
    deadlineInDays: 21,
    amountUnits: 5_000,
    amountStyle: 'max',
    firstSeenDaysAgo: 11,
  },
  {
    externalKey: 'PBLN_000000000098288',
    title: '2026년 스마트 제조혁신 인력양성 교육생 모집',
    organization: '한국산업단지공단',
    rawCategory: '교육',
    deadlineInDays: 7,
    amountUnits: 1_000,
    amountStyle: 'within',
    firstSeenDaysAgo: 19,
  },
  {
    externalKey: 'PBLN_000000000098302',
    title: '2026년 여성기업 해외 전시회 참가 지원사업 모집',
    organization: '한국여성경제인협회',
    rawCategory: '판로개척',
    deadlineInDays: 11,
    amountUnits: 2_000,
    amountStyle: 'max',
    firstSeenDaysAgo: 27,
  },
  {
    externalKey: 'PBLN_000000000098317',
    title: '2026년 뿌리기업 공정개선 연구개발 지원 공고',
    organization: '한국생산기술연구원',
    rawCategory: '연구개발',
    deadlineInDays: 35,
    amountUnits: 15_000,
    amountStyle: 'scale',
    firstSeenDaysAgo: 34,
  },
  {
    externalKey: 'PBLN_000000000098325',
    title: '2026년 창업기업 제품 공공기관 우선구매 지원사업',
    organization: '중소벤처기업진흥공단',
    rawCategory: '창업',
    deadlineInDays: 18,
    amountUnits: 4_000,
    amountStyle: 'max',
    firstSeenDaysAgo: 45,
  },
  {
    externalKey: 'PBLN_000000000098340',
    title: '2026년 중소기업 혁신바우처 지원사업 공고',
    organization: '중소벤처기업진흥공단',
    rawCategory: '사업화',
    deadlineInDays: 28,
    amountUnits: 5_000,
    amountStyle: 'within',
    firstSeenDaysAgo: 55,
  },
  {
    externalKey: 'PBLN_000000000098356',
    title: '2026년 지역 중소기업 운전자금 특별융자 안내',
    organization: '신용보증기금',
    rawCategory: '자금지원',
    deadlineInDays: 45,
    amountUnits: 10_000,
    amountStyle: 'max',
    firstSeenDaysAgo: 63,
  },
]

/** "3일 이내에 처음 보인 것" = 화면의 "새로 올라온 것" */
const NEW_WINDOW_DAYS = 3

// ── 원문 표기 만들기 (두 사이트가 다른 말을 쓴다) ─────────────────────

function kstartupAmountText(units: number, style: AmountStyle): string {
  const n = withCommas(units)
  if (style === 'within') return `${n}천원 이내`
  if (style === 'scale') return `총 ${n}천원 규모`
  return `최대 ${n}천원`
}

function bizinfoAmountText(units: number, style: AmountStyle): string {
  const n = withCommas(units)
  if (style === 'within') return `${n}만원 이내`
  if (style === 'scale') return `총 ${n}만원 규모`
  return `최대 ${n}만원`
}

/** k-startup 은 구분자 없는 8자리 */
const kstartupDeadlineText = (d: Date): string => isoDate(d).replaceAll('-', '')
/**
 * bizinfo 는 기간 문자열이고, 같은 사이트 안에서도 표기가 섞인다.
 * `~2026-08-21` 과 `2026.07.01 ~ 2026.08.21` 둘 다 같은 마감일로 정리돼야 한다.
 */
function bizinfoDeadlineText(deadline: Date, opened: Date, withStart: boolean): string {
  const dot = (d: Date): string => isoDate(d).replaceAll('-', '.')
  return withStart ? `${dot(opened)} ~ ${dot(deadline)}` : `~${isoDate(deadline)}`
}

// ════════════════════════════════════════════════════════════════════════
// 수집 기록 (runs)
// ════════════════════════════════════════════════════════════════════════

interface SeedRunSpec {
  key: string
  status: RunStatus
  startedDaysAgo: number
  durationSeconds: number
  itemsFound: number
  itemsNew: number
  /** 사용자에게 보여줄 상태 문구. 내부 용어 금지 (보장선 B4) */
  errorSummary: string | null
}

/**
 * "이번 달 자동 복구 N회" 카운터가 시드로도 0 이 아니어야 한다.
 * 2일 전이 지난달로 넘어가는 달초에는 이달 초로 당긴다.
 */
function healedAtWithinThisMonth(): Date {
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const candidate = daysAgo(2)
  return candidate >= startOfMonth ? candidate : new Date(startOfMonth.getTime() + 6 * 3_600_000)
}

const HEALED_AT = healedAtWithinThisMonth()

const KSTARTUP_RUNS: SeedRunSpec[] = [
  {
    key: 'k-startup:1',
    status: 'ok',
    startedDaysAgo: 4,
    durationSeconds: 12,
    itemsFound: 10,
    itemsNew: 3,
    errorSummary: null,
  },
  {
    key: 'k-startup:2',
    status: 'healed',
    startedDaysAgo: (now.getTime() - HEALED_AT.getTime()) / DAY_MS,
    durationSeconds: 41,
    itemsFound: 10,
    itemsNew: 1,
    errorSummary: '사이트 화면이 바뀌어 잠시 값이 비었지만 스스로 다시 맞췄습니다.',
  },
  {
    key: 'k-startup:3',
    status: 'ok',
    startedDaysAgo: 0.2,
    durationSeconds: 11,
    itemsFound: 10,
    itemsNew: 1,
    errorSummary: null,
  },
]

const BIZINFO_RUNS: SeedRunSpec[] = [
  {
    key: 'bizinfo:1',
    status: 'ok',
    startedDaysAgo: 4,
    durationSeconds: 18,
    itemsFound: 10,
    itemsNew: 2,
    errorSummary: null,
  },
  {
    key: 'bizinfo:2',
    status: 'ok',
    startedDaysAgo: 1,
    durationSeconds: 17,
    itemsFound: 10,
    itemsNew: 1,
    errorSummary: null,
  },
  {
    key: 'bizinfo:3',
    status: 'ok',
    startedDaysAgo: 0.2,
    durationSeconds: 16,
    itemsFound: 10,
    itemsNew: 0,
    errorSummary: null,
  },
]

/** 마지막 수집 시각 — 두 사이트 모두 방금 성공한 것으로 둔다 */
const LAST_RUN_AT = daysAgo(0.2)
const LAST_OK_AT = new Date(LAST_RUN_AT.getTime() + 20_000)

function validationReport(itemsFound: number, notes: string[]): ValidationReport {
  const clean = { null_ratio: 0, type_fail_ratio: 0, samples: [] }
  return {
    checked_at: LAST_OK_AT.toISOString(),
    items_found: itemsFound,
    fields: {
      title: clean,
      organization: clean,
      deadline: clean,
      amount: clean,
      category: clean,
      link: clean,
    },
    passed: true,
    notes,
  }
}

// ════════════════════════════════════════════════════════════════════════
// 넣기
// ════════════════════════════════════════════════════════════════════════

type SeedSourceKind = 'kstartup' | 'bizinfo'

function buildItemRows(
  kind: SeedSourceKind,
  collectionId: string,
  sourceId: string,
  spec: AdapterSpec,
  specs: SeedItemSpec[],
): NewItemRow[] {
  const provenance = provenanceOf(spec)

  return specs.map((it) => {
    const deadline = daysFromNow(it.deadlineInDays)
    const firstSeen = daysAgo(it.firstSeenDaysAgo)
    const category = CATEGORY_MAPPING[it.rawCategory] ?? CATEGORY_FALLBACK

    // 원문 표기는 사이트마다 다르고, data_json 은 두 사이트가 같다. 이게 G2 판정의 핵심이다
    const isKstartup = kind === 'kstartup'
    const amountWon = isKstartup ? it.amountUnits * 1_000 : it.amountUnits * 10_000
    const link = isKstartup
      ? `${KSTARTUP_LINK_BASE}${it.externalKey}`
      : `${BIZINFO_ORIGIN}/web/lay1/bbs/S1T122C128/AS/74/view.do?pblancId=${it.externalKey}`
    const href = `/web/lay1/bbs/S1T122C128/AS/74/view.do?pblancId=${it.externalKey}`

    const data: ItemData = {
      title: it.title,
      organization: it.organization,
      deadline: isoDate(deadline),
      amount: amountWon,
      category,
      link,
    }

    const rawByFieldKey: Record<string, string> = isKstartup
      ? {
          title: it.title,
          organization: it.organization,
          deadline: kstartupDeadlineText(deadline),
          amount: kstartupAmountText(it.amountUnits, it.amountStyle),
          category: it.rawCategory,
          link: it.externalKey,
        }
      : {
          title: it.title,
          organization: it.organization,
          deadline: bizinfoDeadlineText(deadline, firstSeen, it.deadlineInDays % 2 === 0),
          amount: bizinfoAmountText(it.amountUnits, it.amountStyle),
          category: it.rawCategory,
          link: href,
        }

    return {
      collection_id: collectionId,
      source_id: sourceId,
      // bizinfo 는 링크 경로가 소스 안에서 안정적인 키다 (기획서 11장 dedupe_key)
      external_key: isKstartup ? it.externalKey : href,
      data_json: data,
      raw_json: rawByPath(provenance, rawByFieldKey),
      provenance_json: provenance,
      content_hash: contentHash(data),
      first_seen_at: firstSeen,
      last_seen_at: LAST_OK_AT,
    }
  })
}

function buildRunRows(sourceId: string, adapterId: string, specs: SeedRunSpec[]): NewRunRow[] {
  return specs.map((r) => {
    const startedAt = daysAgo(r.startedDaysAgo)
    return {
      id: seedUuid(`run:${r.key}`),
      source_id: sourceId,
      adapter_id: adapterId,
      started_at: startedAt,
      finished_at: new Date(startedAt.getTime() + r.durationSeconds * 1000),
      status: r.status,
      items_found: r.itemsFound,
      items_new: r.itemsNew,
      validation_json: validationReport(
        r.itemsFound,
        r.status === 'healed'
          ? ['잠시 비었던 마감일과 금액을 다시 읽어냈습니다.']
          : ['사업명과 원문 링크를 모든 항목에서 찾았습니다.', '마감일과 금액이 같은 형식으로 정리됐습니다.'],
      ),
      error_summary: r.errorSummary,
    }
  })
}

async function reset(): Promise<void> {
  // collections → sources → adapters/items/runs, subscriptions → deliveries 까지 ON DELETE CASCADE 로 따라 지워진다
  await db.delete(collections).where(eq(collections.slug, COLLECTION_SLUG))
  await db.delete(users).where(eq(users.id, SEED_USER_ID))
}

async function seed(): Promise<void> {
  // 계약 검사가 먼저다. 통과 못 하면 아무것도 안 넣는다
  const kstartupSpec = parseSpec(KSTARTUP_HOST, KSTARTUP_SPEC_INPUT)
  const bizinfoSpec = parseSpec(BIZINFO_HOST, BIZINFO_SPEC_INPUT)

  // ── 사용자 ──────────────────────────────────────────────────────────
  const [user] = await db
    .insert(users)
    .values({
      id: SEED_USER_ID,
      name: '데모 사용자',
      email: SEED_USER_EMAIL,
      emailVerified: daysAgo(90),
      image: null,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: { name: '데모 사용자', email: SEED_USER_EMAIL },
    })
    .returning()
  if (!user) throw new Error('데모 사용자를 만들지 못했습니다.')

  // ── 컬렉션 ──────────────────────────────────────────────────────────
  const [collection] = await db
    .insert(collections)
    .values({
      owner_id: user.id,
      slug: COLLECTION_SLUG,
      name: '공모전·지원사업',
      schema_json: COLLECTION_SCHEMA,
      schema_version: 1,
      visibility: 'unlisted',
      api_key_hash: null,
      updated_at: now,
    })
    .onConflictDoUpdate({
      target: collections.slug,
      set: {
        owner_id: user.id,
        name: '공모전·지원사업',
        schema_json: COLLECTION_SCHEMA,
        schema_version: 1,
        visibility: 'unlisted',
        updated_at: now,
      },
    })
    .returning()
  if (!collection) throw new Error('컬렉션을 만들지 못했습니다.')

  // ── 사이트 2개 ──────────────────────────────────────────────────────
  const [kstartupSource] = await db
    .insert(sources)
    .values({
      collection_id: collection.id,
      host: KSTARTUP_HOST,
      entry_url: KSTARTUP_ENTRY,
      status: 'ok',
      schedule: '0 6 * * *',
      last_run_at: LAST_RUN_AT,
      last_ok_at: LAST_OK_AT,
      fetch_mode: 'json',
    })
    .onConflictDoUpdate({
      target: [sources.collection_id, sources.entry_url],
      set: { host: KSTARTUP_HOST, status: 'ok', last_run_at: LAST_RUN_AT, last_ok_at: LAST_OK_AT, fetch_mode: 'json' },
    })
    .returning()
  if (!kstartupSource) throw new Error(`${KSTARTUP_HOST} 사이트를 등록하지 못했습니다.`)

  const [bizinfoSource] = await db
    .insert(sources)
    .values({
      collection_id: collection.id,
      host: BIZINFO_HOST,
      entry_url: BIZINFO_ENTRY,
      status: 'ok',
      schedule: '30 6 * * *',
      last_run_at: LAST_RUN_AT,
      last_ok_at: LAST_OK_AT,
      fetch_mode: 'html',
    })
    .onConflictDoUpdate({
      target: [sources.collection_id, sources.entry_url],
      set: { host: BIZINFO_HOST, status: 'ok', last_run_at: LAST_RUN_AT, last_ok_at: LAST_OK_AT, fetch_mode: 'html' },
    })
    .returning()
  if (!bizinfoSource) throw new Error(`${BIZINFO_HOST} 사이트를 등록하지 못했습니다.`)

  // ── 수집 설정 (사이트당 1개) ────────────────────────────────────────
  const [kstartupAdapter] = await db
    .insert(adapters)
    .values({
      source_id: kstartupSource.id,
      version: 1,
      spec_json: kstartupSpec,
      origin: 'llm',
      status: 'active',
      validation_json: validationReport(10, ['내부 목록 응답에서 10개를 읽었습니다.']),
    })
    .onConflictDoUpdate({
      target: [adapters.source_id, adapters.version],
      set: { spec_json: kstartupSpec, origin: 'llm', status: 'active' },
    })
    .returning()
  if (!kstartupAdapter) throw new Error(`${KSTARTUP_HOST} 의 수집 설정을 저장하지 못했습니다.`)

  const [bizinfoAdapter] = await db
    .insert(adapters)
    .values({
      source_id: bizinfoSource.id,
      version: 1,
      spec_json: bizinfoSpec,
      origin: 'llm',
      status: 'active',
      validation_json: validationReport(10, ['목록 화면에서 10개를 읽었습니다.']),
    })
    .onConflictDoUpdate({
      target: [adapters.source_id, adapters.version],
      set: { spec_json: bizinfoSpec, origin: 'llm', status: 'active' },
    })
    .returning()
  if (!bizinfoAdapter) throw new Error(`${BIZINFO_HOST} 의 수집 설정을 저장하지 못했습니다.`)

  // ── 항목 20개 ───────────────────────────────────────────────────────
  const itemRows = [
    ...buildItemRows('kstartup', collection.id, kstartupSource.id, kstartupSpec, KSTARTUP_ITEMS),
    ...buildItemRows('bizinfo', collection.id, bizinfoSource.id, bizinfoSpec, BIZINFO_ITEMS),
  ]

  await db
    .insert(items)
    .values(itemRows)
    .onConflictDoUpdate({
      target: [items.source_id, items.external_key],
      set: {
        data_json: sql`excluded.data_json`,
        raw_json: sql`excluded.raw_json`,
        provenance_json: sql`excluded.provenance_json`,
        content_hash: sql`excluded.content_hash`,
        // first_seen_at 은 덮지 않는다 — 신규 판정의 기준이다 (ADR A13)
        last_seen_at: sql`excluded.last_seen_at`,
      },
    })

  // ── 수집 기록 ───────────────────────────────────────────────────────
  const runRows = [
    ...buildRunRows(kstartupSource.id, kstartupAdapter.id, KSTARTUP_RUNS),
    ...buildRunRows(bizinfoSource.id, bizinfoAdapter.id, BIZINFO_RUNS),
  ]

  await db
    .insert(runs)
    .values(runRows)
    .onConflictDoUpdate({
      target: runs.id,
      set: {
        adapter_id: sql`excluded.adapter_id`,
        started_at: sql`excluded.started_at`,
        finished_at: sql`excluded.finished_at`,
        status: sql`excluded.status`,
        items_found: sql`excluded.items_found`,
        items_new: sql`excluded.items_new`,
        validation_json: sql`excluded.validation_json`,
        error_summary: sql`excluded.error_summary`,
      },
    })

  // ── 구독 1개 ────────────────────────────────────────────────────────
  // 표에서 건 필터를 그대로 저장한다 (기획서 10장 subscriptions.filter_json)
  const filter: CollectionFilter = {
    eq: { category: 'rnd' },
    gte: { amount: 50_000_000 },
    lte: {},
    sort: 'deadline',
  }

  await db
    .insert(subscriptions)
    .values({
      id: seedUuid('subscription:demo-webhook'),
      collection_id: collection.id,
      user_id: user.id,
      channel: 'webhook',
      target: 'https://hooks.example.com/endpointer/contest',
      filter_json: filter,
      schedule: '0 9 * * *',
      last_sent_at: daysAgo(1),
    })
    .onConflictDoUpdate({
      target: subscriptions.id,
      set: {
        collection_id: collection.id,
        user_id: user.id,
        channel: 'webhook',
        target: 'https://hooks.example.com/endpointer/contest',
        filter_json: filter,
        schedule: '0 9 * * *',
      },
    })

  // ── 요약 (사람이 읽는 한 줄) ────────────────────────────────────────
  const sourceIds = [kstartupSource.id, bizinfoSource.id]

  const storedItems = await db
    .select({ id: items.id })
    .from(items)
    .where(eq(items.collection_id, collection.id))

  const freshItems = await db
    .select({ id: items.id })
    .from(items)
    .where(
      and(eq(items.collection_id, collection.id), gte(items.first_seen_at, daysAgo(NEW_WINDOW_DAYS))),
    )

  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const healedRuns = await db
    .select({ id: runs.id })
    .from(runs)
    .where(and(inArray(runs.source_id, sourceIds), eq(runs.status, 'healed'), gte(runs.started_at, startOfMonth)))

  console.log(
    [
      `컬렉션 1(${collection.name} · /${collection.slug})`,
      `사이트 ${sourceIds.length}`,
      `항목 ${storedItems.length}(신규 ${freshItems.length})`,
      `이번 달 자동 복구 ${healedRuns.length}회`,
      `구독 1`,
    ].join(' · '),
  )
  console.log(
    `공개 주소로 확인: GET /api/v1/${collection.slug}  (원문 대조는 ?include=provenance)`,
  )
}

// ════════════════════════════════════════════════════════════════════════

const shouldReset = process.argv.slice(2).includes('--reset')

try {
  if (shouldReset) {
    await reset()
    console.log('기존 예시 데이터를 지웠습니다.')
  }
  await seed()
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error)
  console.error(`예시 데이터를 넣지 못했습니다 — ${reason}`)
  process.exitCode = 1
} finally {
  try {
    await closeDb()
  } catch {
    // 닫는 데 실패해도 판정에는 영향이 없다
  }
}
