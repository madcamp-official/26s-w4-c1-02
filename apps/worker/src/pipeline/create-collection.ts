// URL 하나 → 이미 채워진 표 (기획서 9-1 전체)
//
//   [URL] → ①PROBE → ②COMPILE → ③EXECUTE → ④INFER SCHEMA → ⑤NORMALIZE → [표]
//
// 기획서 9-1 의 다섯 단계가 이 파일 하나에서 끝난다. 각 단계의 알맹이는 전부 다른 곳에 있고
// (probe/ · compile/ · fetchers/ · core), 여기가 하는 일은 **순서와 실패 처리**뿐이다.
//
// ── 이 파일이 지키는 것 ─────────────────────────────────────────────────
//
//  1. **DB 를 모른다.** 저장은 `persist.ts` 가 한다. 그래서 이 함수는 키 없이도, DB 없이도
//     테스트할 수 있고, 화면의 "미리보기" 가 저장 없이 같은 코드를 부를 수 있다.
//
//  2. **던지지 않는다.** 실패는 전부 값이다 (`ok: false` + 사람이 읽는 `message`).
//     주소를 잘못 넣은 사용자에게 스택 트레이스를 보여주지 않는다 (보장선 B4).
//
//  3. **②와 ④가 한 번의 LLM 호출이다.** 기획서는 COMPILE 과 INFER SCHEMA 를 나눠 그렸지만,
//     "이 값이 마감일이다" 와 "마감일은 여기서 뽑는다" 는 같은 판단이다. 쪼개면 두 결과가
//     어긋나고 호출도 두 배가 된다 (무료 티어 · P6). `discoverSpec` 이 둘을 같이 낸다.
//
//  4. **⑤NORMALIZE 는 이미 해석기 안에 있다.** `runAdapter` → `interpretSpec` 이 스키마의
//     타입대로 값을 정규화해 내놓는다. 그래서 여기 별도 단계가 없다 — 있으면 두 번 하는 것이다.

import type { CollectionSchemaJson, ValidationReport } from '@endpointer/core'
import type { AdapterSpec, InterpretedItem } from '@endpointer/core/spec'

import { discoverSpec } from '../compile'
import { runAdapter } from '../fetchers'
import { childLogger } from '../logger'
import { probe } from '../probe'
import type { ProbePath, ProbeStep } from '../probe/types'
import { inferPagination } from './infer-pagination'
import { applyTransformDrop, dropColumns, planRepair, repairNotes } from './repair-empty'

const log = childLogger({ mod: 'create' })

export interface CreateCollectionInput {
  /** 사용자가 붙여넣은 주소. 이것 하나가 사용자 입력의 전부다 (보장선 B1) */
  url: string
  /** 브라우저 단계를 건너뛴다 (G1 강등 규칙 1) */
  skipBrowser?: boolean
  /** DOM 반복 구조 탐지를 건너뛴다 (G1 강등 규칙 2) */
  skipDom?: boolean
  /** 개발 중 로컬 픽스처를 대상으로 돌릴 때만 true */
  allowPrivateHosts?: boolean
  /** 미리보기에서 굳이 3페이지를 다 받을 이유가 없다. 기본 1 */
  maxPages?: number
  now?: Date
}

/** 어디서 어떻게 뚫렸는지 — G1 판정 조건이자 화면의 "이 사이트를 살펴봤어요" 근거 */
export interface CreatePreviewTrace {
  probe_path: ProbePath | null
  fetch_mode: AdapterSpec['fetch']['mode']
  /** 후보 겹침률 0~1 */
  overlap: number
  steps: ProbeStep[]
  /** LLM 을 몇 번 불렀는지 (무료 티어 감시용) */
  compile_attempts: number
  duration_ms: number
}

export type CreateCollectionOutcome =
  | {
      ok: true
      url: string
      final_url: string
      host: string
      /** 화면이 표의 열로 쓴다. 그대로 `collections.schema_json` 이 된다 */
      schema: CollectionSchemaJson
      /** 그대로 `adapters.spec_json` 이 된다 */
      spec: AdapterSpec
      /** 이미 정규화된 항목들 — 사용자는 이걸 첫 화면에서 본다 (보장선 B3) */
      items: InterpretedItem[]
      /** 드리프트 기준선의 첫 값이 된다 */
      report: ValidationReport
      /** 페이지 제목 — 컬렉션 이름의 기본값으로 쓴다 */
      page_title: string | null
      trace: CreatePreviewTrace
      /** 개발자용. 화면에 그대로 내보내지 않는다 */
      warnings: string[]
    }
  | {
      ok: false
      url: string
      /** 어느 단계에서 멈췄는가 */
      stage: 'url' | 'probe' | 'compile' | 'execute'
      /** 화면에 그대로 나갈 수 있는 문구 (보장선 B2 · B4) */
      message: string
      /** 개발자용 상세 */
      errors: string[]
      trace: Partial<CreatePreviewTrace>
    }

/** 사용자가 읽는 문구. 내부 명사 금지 (보장선 B2) */
const MESSAGES = {
  bad_url: '주소처럼 보이지 않아요. 브라우저 주소창의 내용을 그대로 붙여넣어 주세요.',
  not_http: '웹 주소(http 또는 https)만 붙여넣을 수 있어요.',
  no_list:
    '이 페이지에서 목록을 찾지 못했어요. 여러 항목이 줄지어 나오는 페이지의 주소를 붙여넣어 주세요.',
  empty: '목록을 찾았는데 항목을 하나도 읽어내지 못했어요. 다른 페이지 주소로 다시 시도해 주세요.',
} as const

export async function createCollectionFromUrl(
  input: CreateCollectionInput,
): Promise<CreateCollectionOutcome> {
  const startedAt = Date.now()
  const now = input.now ?? new Date()

  // ── ⓪ 주소 확인 ─────────────────────────────────────────────────────
  const normalized = normalizeUrl(input.url)
  if (normalized === null) {
    return { ok: false, url: input.url, stage: 'url', message: MESSAGES.bad_url, errors: [], trace: {} }
  }
  if (normalized.protocol !== 'http:' && normalized.protocol !== 'https:') {
    return { ok: false, url: input.url, stage: 'url', message: MESSAGES.not_http, errors: [], trace: {} }
  }

  // ── ① PROBE — 목록이 어디 있는지 찾는다 ──────────────────────────────
  const probed = await probe(normalized.toString(), {
    ...(input.skipBrowser !== undefined ? { skipBrowser: input.skipBrowser } : {}),
    ...(input.skipDom !== undefined ? { skipDom: input.skipDom } : {}),
  })

  const baseTrace = {
    probe_path: probed.probe_path,
    fetch_mode: probed.fetch_mode,
    steps: probed.steps,
  }

  if (probed.best === null) {
    log.info({ url: normalized.host, steps: probed.steps.length }, '목록 후보를 찾지 못함')
    return {
      ok: false,
      url: input.url,
      stage: 'probe',
      message: MESSAGES.no_list,
      errors: probed.warnings,
      trace: { ...baseTrace, overlap: 0, duration_ms: Date.now() - startedAt },
    }
  }

  // ── ②+④ COMPILE + INFER SCHEMA — 표 구성과 뽑는 방법을 한 번에 ──────
  const discovered = await discoverSpec({
    url: probed.final_url,
    host: probed.host,
    // 아직 소스 행이 없다. 예산 계정은 호스트 단위로 잡는다.
    scope_id: `new:${probed.host}`,
    candidate: probed.best,
    pageText: probed.page.text,
    ...(input.allowPrivateHosts !== undefined ? { allowPrivateHosts: input.allowPrivateHosts } : {}),
  })

  if (!discovered.ok) {
    return {
      ok: false,
      url: input.url,
      stage: 'compile',
      message: discovered.message,
      errors: discovered.errors,
      trace: {
        ...baseTrace,
        overlap: probed.best.overlap,
        compile_attempts: discovered.attempts.length,
        duration_ms: Date.now() - startedAt,
      },
    }
  }

  // ── ③ EXECUTE (+⑤ NORMALIZE) — 만든 방법으로 실제로 뽑아본다 ────────
  //
  // 여기서 뽑히지 않으면 그 스펙은 쓸모가 없다. **저장하기 전에** 확인한다 —
  // 안 되는 방법을 저장해 두면 첫 정기 수집에서야 드러나고, 그때는 사용자가 이미 떠났다.
  // timezone 을 넘기지 않는 것은 jobs/collect.ts 와 같다 — 해석기 기본값을 쓴다.
  // 미리보기와 정기 수집이 다른 시간대로 돌면 "미리보기가 거짓말한다" (기획서 8장).
  const maxPages = input.maxPages ?? 1
  let spec = discovered.spec
  let schema = discovered.schema
  let executed = await runAdapter({ spec, schema, now, maxPages })
  const repairNotesOut: string[] = []
  let compileAttempts = discovered.attempts.length

  // ── ③-a 0개면 실패를 문장으로 만들어 한 번 다시 컴파일한다 ──────────
  //
  // 검증(validateSpec)은 모양만 본다 — 모양이 맞는데 실제 페이지에서 0개가 뽑히는 스펙이
  // 실제로 나온다 (k-startup 실측 07-30: 5열 생성 성공 → 추출 0개 → 그대로 사용자 실패).
  // LLM 컴파일은 판마다 결과가 달라서, "그 경로로 0개였다"는 사실을 넣고 다시 부르면
  // 대부분 다른 경로를 내놓는다. 재시도는 한 번뿐이다 — 예산(원칙 ①)과 11장 규율.
  if (executed.items.length === 0) {
    const rediscovered = await discoverSpec({
      url: probed.final_url,
      host: probed.host,
      scope_id: `new:${probed.host}`,
      candidate: probed.best,
      pageText: probed.page.text,
      ...(input.allowPrivateHosts !== undefined ? { allowPrivateHosts: input.allowPrivateHosts } : {}),
      previousErrors: [
        `직전 스펙은 검증을 통과했지만 실제 페이지에서 항목이 0개 뽑혔다 (list: ${spec.list}). 목록 경로와 필드 경로를 후보의 HTML 표본에 실제로 있는 것으로 다시 골라라.`,
        ...(executed.failure !== null ? [executed.failure] : []),
      ],
    })
    if (rediscovered.ok) {
      compileAttempts += rediscovered.attempts.length
      const retried = await runAdapter({ spec: rediscovered.spec, schema: rediscovered.schema, now, maxPages })
      if (retried.items.length > 0) {
        spec = rediscovered.spec
        schema = rediscovered.schema
        executed = retried
        log.info({ host: probed.host }, '0개 추출 스펙을 다시 컴파일해 살렸다')
      }
    } else {
      compileAttempts += rediscovered.attempts.length
    }
  }

  // ── ③-b 항상 비는 칸 고치기 (보장선 B3) ──────────────────────────────
  //
  // LLM 이 값을 반드시 지우는 변환(`replace(/.*​/g,'')`)을 내는 일이 있다. 그러면 표는
  // 멀쩡해 보이는데 그 칸만 영원히 빈다. 여기서 안 잡으면 아무도 안 잡는다 (repair-empty.ts).
  if (executed.items.length > 0) {
    const plan = planRepair(spec, executed.items)

    if (plan.drop_transform.length > 0) {
      // 변환만 버리고 **다시 뽑는다.** 페이지는 캐시에서 나오므로 거의 공짜다.
      spec = applyTransformDrop(spec, plan.drop_transform)
      const retried = await runAdapter({ spec, schema, now, maxPages })
      if (retried.items.length > 0) executed = retried
      log.info({ fields: plan.drop_transform }, '값을 지우는 변환을 버리고 다시 뽑았다')
    }

    // 변환을 버려도 비는 칸과, 애초에 원값이 없던 칸은 표에서 뺀다
    const after = plan.drop_transform.length > 0 ? planRepair(spec, executed.items) : plan
    const remove = [...new Set([...plan.drop_column, ...after.drop_column, ...after.drop_transform])]
    if (remove.length > 0) {
      const trimmed = dropColumns(spec, schema, executed.items, executed.report, remove)
      if (trimmed.dropped.length > 0) {
        spec = trimmed.spec
        schema = trimmed.schema
        executed = { ...executed, items: trimmed.items, report: trimmed.report }
        repairNotesOut.push(...repairNotes(discovered.schema, trimmed.dropped))
        log.info({ fields: trimmed.dropped }, '값이 하나도 없어 칸을 뺐다')
      }
    }
  }

  // ── ③-c 페이지 넘김 검증 — LLM 이 적은 것도 돌려 본다 ────────────────
  //
  // 서울도서관 실측(2026-07-27): LLM 이 pagination 을 `page` 로 적었는데 진짜 파라미터는
  // `pn` 이었다. 서버는 `page` 를 무시하고 1페이지를 다시 내놓았고, 항목 링크에 그 번호가
  // 되박혀 같은 공지가 페이지마다 "신규"로 쌓였다. 접합(infer-pagination)과 같은 원리로
  // 저장하기 전에 2페이지를 실제로 받아 본다 — 항목이 늘지 않으면 그 파라미터는 가짜다.
  if (executed.items.length > 0 && spec.pagination.kind === 'page_param') {
    const single = await runAdapter({ spec, schema, now, maxPages: 1 }) // 1페이지는 캐시
    const trial = await runAdapter({ spec, schema, now, maxPages: 2 })
    // 2페이지를 받아보지도 못했으면(일시 오류) 판정하지 않는다 — 적힌 대로 둔다
    if (trial.pagesFetched >= 2 && trial.items.length <= single.items.length) {
      const bogus = spec.pagination.param
      spec = {
        ...spec,
        fetch: { ...spec.fetch, url: stripParam(spec.fetch.url, bogus) },
        pagination: { kind: 'none' },
      }
      executed = await runAdapter({ spec, schema, now, maxPages })
      log.info({ param: bogus }, '2페이지가 1페이지와 같다 — 적힌 페이지 파라미터를 버렸다')

      // 링크 스캔으로 진짜 페이지 넘김을 찾아본다. 못 찾으면 1페이지 그대로 — 그것도 정상이다.
      const paged = await inferPagination({ spec, schema, baseItemCount: executed.items.length, now })
      if (paged !== null) {
        spec = paged.spec
        executed = {
          items: paged.items,
          report: paged.report,
          pagesFetched: paged.pagesFetched,
          warnings: executed.warnings,
          failure: null,
        }
        repairNotesOut.push(paged.note)
      }
    }
  }

  const trace: CreatePreviewTrace = {
    ...baseTrace,
    overlap: probed.best.overlap,
    compile_attempts: compileAttempts,
    duration_ms: Date.now() - startedAt,
  }

  if (executed.items.length === 0) {
    return {
      ok: false,
      url: input.url,
      stage: 'execute',
      message: MESSAGES.empty,
      errors: [executed.failure, ...executed.warnings].filter((e): e is string => e !== null),
      trace,
    }
  }

  log.info(
    {
      host: probed.host,
      path: probed.probe_path,
      columns: schema.length,
      items: executed.items.length,
      ms: trace.duration_ms,
    },
    '표를 만들었다',
  )

  return {
    ok: true,
    url: input.url,
    final_url: probed.final_url,
    host: probed.host,
    schema,
    spec,
    items: executed.items,
    report: executed.report,
    page_title: probed.page.title,
    trace,
    warnings: [...repairNotesOut, ...executed.warnings],
  }
}

// ── 도우미 ─────────────────────────────────────────────────────────────

/**
 * 가짜로 판정된 페이지 파라미터를 주소에서 뗀다.
 * `?page={page}` 자리표시자째로 들어 있으므로 먼저 실제 값으로 바꿔 URL 로 읽는다.
 */
function stripParam(rawUrl: string, param: string): string {
  try {
    const url = new URL(rawUrl.replace('{page}', '1'))
    url.searchParams.delete(param)
    return url.toString()
  } catch {
    return rawUrl
  }
}

/**
 * 사용자가 붙여넣은 것을 주소로 만든다.
 * `k-startup.go.kr/...` 처럼 스킴을 빼고 붙여넣는 경우가 많아 https 를 채워 준다 —
 * 여기서 한 번 받아주는 것이 "주소가 틀렸다" 를 한 번 덜 보여준다 (보장선 B4).
 */
export function normalizeUrl(raw: string): URL | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  try {
    return new URL(trimmed)
  } catch {
    // 스킴이 없어서 실패한 경우만 한 번 더 시도한다
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null
    try {
      return new URL(`https://${trimmed}`)
    } catch {
      return null
    }
  }
}

/**
 * 페이지 제목에서 컬렉션 이름을 짓는다.
 * 사용자가 첫 화면에서 이름을 고칠 수 있으므로 완벽할 필요는 없고, **비어 있지만 않으면 된다** —
 * 빈 이름을 주면 사용자가 이름부터 지어야 하고 그건 B3 이 막으려던 그 시작이다.
 */
export function collectionNameFrom(title: string | null, host: string): string {
  // 빵부스러기(`기업마당>정책정보>지원사업 공고`)는 **끝**이 알맹이다. 앞을 쓰면 사이트 이름이 된다.
  const crumbs = (title ?? '').split('>')
  const last = crumbs[crumbs.length - 1] ?? ''

  // 사이트 이름은 " | " · " - " **뒤에** 붙는 관행이라 앞을 쓴다.
  // 구분자 양옆에 공백이 있어야 자른다 — 그냥 하이픈에서 자르면 `K-Startup` 이 `K` 가 되고
  // `e-나라도움` 이 `e` 가 된다. 실제로 k-startup 의 이름 기본값이 "K" 로 나왔다.
  const cleaned = last.split(/\s+[|·\-–—]\s+|[|·]/)[0]?.trim()

  // 너무 짧으면 이름 구실을 못 한다. 호스트가 낫다.
  if (cleaned !== undefined && cleaned.length >= 2 && cleaned.length <= 40) return cleaned
  return host.replace(/^www\./, '')
}

/**
 * 주소에서 slug 후보를 만든다. 충돌 처리는 저장하는 쪽의 몫이다.
 * `GET /api/v1/{slug}` 에 그대로 들어가므로 소문자·숫자·하이픈만 남긴다.
 */
export function slugFrom(host: string, title: string | null): string {
  const fromTitle = (title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '')
  // 한국어 제목이면 라틴 문자가 안 남는다. 그때는 호스트를 쓴다.
  const latin = fromTitle.replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-+|-+$/g, '')
  // **글자 수가 아니라 글자를 센다.** 길이만 보면 한국어 제목에서 남은 `---` 가
  // 3자라고 통과해 버린다 (실제로 bizinfo 가 그랬다 — 빵부스러기 제목이라 하이픈만 남았다).
  const alnum = latin.replace(/-/g, '').length
  if (alnum >= 3 && latin.length <= 40) return latin
  return (
    host
      .replace(/^www\./, '')
      .replace(/\.(go|co|or|ne|re)\.kr$/, '')
      .replace(/\.[a-z]+$/, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'collection'
  )
}
