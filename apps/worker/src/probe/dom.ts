// probe 4단계 — DOM 반복 구조 탐지 (기획서 9-1①-4 · ADR A3 의 마지막 폴백)
//
// "같은 구조 시그니처가 N회 반복되는 컨테이너를 찾음."
//
// 시그니처란 자식 요소의 태그·클래스 구성을 문자열로 요약한 것이다. 목록의 행들은
// 서로 시그니처가 같고, 그 행들을 담은 부모가 곧 리스트 컨테이너다.
//
// 입력 HTML 은 두 곳에서 온다 — 정적 GET(1단계) 또는 브라우저 렌더 결과(3단계).
// 그래서 `origin` 을 인자로 받는다: 브라우저가 렌더한 DOM 에서 찾았으면 'browser_render' 다.
//
// ── 이 단계가 다른 셋과 다른 점 ────────────────────────────────────────
// 앞의 세 경로는 **이미 있는 데이터**(JSON)를 찾는다. 여기는 데이터가 없어서
// 화면 구조에서 **만들어낸다.** 그래서 두 가지를 더 해야 한다:
//
//   1. **선택자를 검증한다.** 반복 묶음을 찾는 것과 "그 묶음을 다시 집는 CSS 선택자"
//      를 만드는 것은 다른 일이다. 만든 선택자를 실제로 돌려 같은 행이 잡히는지 보고,
//      안 잡히면 후보에서 뺀다. 검증 안 된 선택자를 스펙에 넣으면 수집이 조용히 0개가 된다.
//   2. **메뉴·페이지 번호를 걸러낸다.** 반복 구조는 목록 말고도 많다. 겹침률은
//      이걸 못 거른다 — DOM 후보는 페이지에서 뽑았으니 화면 텍스트와 100% 겹치는 게 당연하다.
//      그래서 걸러내는 일을 rank.ts 에 떠넘기지 않고 여기서 한다.

import { load, type CheerioAPI } from 'cheerio'

import { tagWithClasses } from '../css-ident'
import { clip } from '../html'
import type { ProbeCandidate, ProbePath } from './types'

export interface DomProbeInput {
  html: string
  /** 상대 링크의 기준 · 스펙의 fetch.url 후보 */
  url: string
  minRows: number
  /** 정적 HTML 이면 'dom', 브라우저가 렌더한 DOM 이면 'browser_render' */
  origin: Extract<ProbePath, 'dom' | 'browser_render'>
}

export interface DomProbeResult {
  candidates: ProbeCandidate[]
  note: string
}

/** 후보로 낼 최대 개수. 더 내봐야 프롬프트만 커지고 판단은 rank.ts 몫이다 */
const MAX_CANDIDATES = 6
/** 행 하나의 글자가 이보다 짧으면 목록이 아니라 메뉴·페이지 번호로 본다 */
const MIN_ROW_TEXT = 8
/** 훑을 요소 수 상한. 아주 큰 페이지에서 시간을 잡아먹지 않게 */
const MAX_ELEMENTS = 12_000
/** 프롬프트에 실릴 행 HTML 길이 상한 */
const MAX_ROW_HTML = 1_200
/**
 * 겹침률 판정에 쓰는 행 텍스트 길이 상한.
 * core 의 `isComparable` 이 200자를 넘는 값을 비교에서 빼므로 그 아래로 담는다.
 */
const MAX_ROW_TEXT = 190

type Selection = ReturnType<CheerioAPI>

/**
 * 반복 컨테이너를 찾아 후보로 만든다.
 *
 * 결과 후보의 `list_path` 는 core 가 읽을 수 있는 CSS 경로다 — `css:.contest-list > li`.
 * 이 선택자는 **실제로 돌려 본 것만** 나간다.
 */
export function probeDom(input: DomProbeInput): DomProbeResult {
  let $: CheerioAPI
  try {
    $ = load(input.html)
  } catch {
    return { candidates: [], note: 'HTML 을 읽지 못했습니다' }
  }

  // 화면에 안 보이는 것은 목록일 수 없다. 지우고 시작하면 시그니처 계산도 같이 싸진다.
  $('script, style, noscript, svg, template, head').remove()

  const all = $('*').toArray()
  const scanned = all.length > MAX_ELEMENTS ? all.slice(0, MAX_ELEMENTS) : all

  const groups = findRepeatedGroups($, scanned, input.minRows)
  if (groups.length === 0) {
    return {
      candidates: [],
      note: `요소 ${scanned.length}개를 봤지만 ${input.minRows}회 이상 반복되는 묶음이 없습니다`,
    }
  }

  const kept: { candidate: ProbeCandidate; volume: number }[] = []
  const seen = new Set<string>()
  let rejectedShort = 0
  let rejectedChrome = 0
  let rejectedSelector = 0

  for (const group of groups) {
    // 화면 꾸밈 영역(내비게이션·푸터·머리말) 안의 반복은 목록이 아니라 메뉴다.
    // cse.snu.ac.kr 에서 <footer> 의 링크 묶음이 텍스트가 길어 looksLikeContent 를
    // 통과하고 진짜 공지 목록을 이겼다 (07-30) — 태그·role 로 원천 제외한다.
    if (insideChrome(group.parent)) {
      rejectedChrome += 1
      continue
    }

    const texts = group.rows.map((r) => collapse(r.text()))
    if (!looksLikeContent(texts)) {
      rejectedShort += 1
      continue
    }

    const listPath = buildVerifiedSelector($, group)
    if (listPath === null) {
      rejectedSelector += 1
      continue
    }
    if (seen.has(listPath)) continue
    seen.add(listPath)

    const matched = $(listPath).toArray().map((el) => $(el))
    // 자를 때 말줄임표를 붙이지 않는다. 이 값은 **페이지 원문과 글자로 비교되는 값**이라
    // `…` 한 글자가 붙으면 그 행은 "화면에 없는 값" 으로 세어진다.
    const rows = matched.map((row) => collapse(row.text()).slice(0, MAX_ROW_TEXT))
    const rowHtml = matched.map((row) => clip(outerHtml($, row), MAX_ROW_HTML))

    kept.push({
      candidate: {
        id: `dom:${listPath}`,
        origin: input.origin,
        source: { kind: 'dom', selector: listPath },
        list_path: `css:${listPath}`,
        fetch_mode: input.origin === 'browser_render' ? 'browser' : 'html',
        fetch_url: input.url,
        rows,
        row_html: rowHtml,
        keys: sharedKeys($, matched),
        where: `화면에서 ${rows.length}번 반복되는 묶음 (${listPath})`,
      },
      volume: texts.reduce((sum, t) => sum + t.length, 0),
    })
  }

  // 글자를 가장 많이 담은 묶음이 본문 목록일 확률이 높다.
  // 점수를 매기는 건 rank.ts 의 일이므로, 여기서는 **낼 것을 고르는 순서**로만 쓴다.
  kept.sort((a, b) => b.volume - a.volume)

  const notes = [`반복 묶음 ${groups.length}개`]
  if (rejectedChrome > 0) notes.push(`메뉴·푸터 영역이라 제외 ${rejectedChrome}개`)
  if (rejectedShort > 0) notes.push(`글자가 짧아 제외 ${rejectedShort}개`)
  if (rejectedSelector > 0) notes.push(`선택자를 못 만들어 제외 ${rejectedSelector}개`)
  notes.push(`후보 ${Math.min(kept.length, MAX_CANDIDATES)}개`)

  return {
    candidates: kept.slice(0, MAX_CANDIDATES).map((k) => k.candidate),
    note: notes.join(' · '),
  }
}

// ── ① 반복 묶음 찾기 ───────────────────────────────────────────────────

interface RepeatGroup {
  parent: Selection
  rows: Selection[]
}

/**
 * 부모별로 자식들의 시그니처를 세어, 같은 시그니처가 minRows 회 이상이면 묶음으로 본다.
 *
 * 한 부모에서 시그니처가 여럿 나올 수 있다 (본문 행 사이에 배너 줄이 끼는 게시판이 그렇다).
 * 그럴 땐 **가장 많이 반복된 것 하나만** 낸다 — 나머지는 대개 머리글이나 광고 줄이다.
 */
function findRepeatedGroups($: CheerioAPI, elements: readonly unknown[], minRows: number): RepeatGroup[] {
  const groups: RepeatGroup[] = []

  for (const node of elements) {
    const parent = $(node as never)
    const children = parent.children().toArray()
    if (children.length < minRows) continue

    const bySignature = new Map<string, Selection[]>()
    for (const child of children) {
      const sel = $(child)
      const signature = groupSignature($, sel)
      const bucket = bySignature.get(signature)
      if (bucket === undefined) bySignature.set(signature, [sel])
      else bucket.push(sel)
    }

    let best: Selection[] | null = null
    for (const rows of bySignature.values()) {
      if (rows.length < minRows) continue
      if (best === null || rows.length > best.length) best = rows
    }
    if (best !== null) groups.push({ parent, rows: best })
  }

  return groups
}

/**
 * 형제끼리 견주는 시그니처의 깊이 — 자신과 **직계 자식까지만** 본다.
 *
 * 더 깊이 보면 안 묶인다. 실제 사이트에서 확인한 것:
 *   · wevity 의 공모전 16행은 `span.dday.ing` / `.soon` / `.end` 라는 **마감 상태 클래스**가
 *     손자 자리에 있어서, 손자까지 보면 7 + 4 + 4 + 1 로 쪼개진다. 같은 목록인데도.
 *   · 직계 자식까지만 보면 `li(div.tit,div.organ,div.day,div.read)` 하나로 묶인다.
 *
 * 얕게 봐서 엉뚱한 것이 섞이는 위험은 뒤의 두 관문이 막는다 —
 * `looksLikeContent` 가 메뉴를 걷어내고, 선택자 검증이 "그 행들만 잡히는가" 를 실제로 돌려 본다.
 */
const GROUP_SIGNATURE_DEPTH = 1

/**
 * 형제끼리 견주는 시그니처. **클래스는 전부 빼고 태그 구성만 본다.**
 *
 * 클래스는 같은 목록 안에서도 갈라지는 축이다. 실제 사이트에서 확인한 것:
 *   · 행 자신의 클래스 — `on` · `active` · `notice` · `bg` · `even` 처럼 한 행에만 붙는다.
 *   · 자식의 클래스 — 서울도서관 공지는 상시 공지 행이 `td.alwaysNum`, 일반 행이 `td.num` 이라
 *     10행이 5 + 5 로 쪼개진다. 반쪽으로 선택자를 검증하면 `tbody > tr` 이 "남의 행까지
 *     집는다" 며 기각되어 **표 전체를 놓친다.** 고정 공지 + 일반 글 게시판의 전형이다.
 *
 * 태그 구성만 봐도 머리글·광고 줄은 안 섞인다 — 머리글 행은 `th`, 배너 줄은 colspan 한 칸이라
 * 태그 구성 자체가 다르다. 그래도 섞이는 것은 `looksLikeContent` 와 선택자 검증이 거른다.
 */
function groupSignature($: CheerioAPI, sel: Selection): string {
  const node = signatureNode($, sel, GROUP_SIGNATURE_DEPTH + 1)
  return structureSignature(stripClasses(node), GROUP_SIGNATURE_DEPTH)
}

/** 시그니처 계산에서 클래스를 전부 지운다 — 태그 구성만 남긴다 */
function stripClasses(node: SignatureNode): SignatureNode {
  return { tag: node.tag, classes: [], children: node.children.map(stripClasses) }
}

/** 요소 하나를 시그니처 계산용 노드로 바꾼다. 깊이는 `structureSignature` 가 보는 만큼만 */
function signatureNode($: CheerioAPI, sel: Selection, depth = 3): SignatureNode {
  const children =
    depth <= 0
      ? []
      : sel
          .children()
          .toArray()
          .map((c) => signatureNode($, $(c), depth - 1))
  return { tag: tagOf(sel), classes: classesOf(sel), children }
}

// ── ② 목록 같은가 ──────────────────────────────────────────────────────

/** 목록이 있을 리 없는 꾸밈 영역의 태그와 role */
const CHROME_TAGS = new Set(['nav', 'footer', 'header'])
const CHROME_ROLES = new Set(['navigation', 'contentinfo', 'banner'])

/** 이 요소(컨테이너)가 내비게이션·푸터·머리말 안에 있는가 — 자신 포함 조상을 따라 올라가며 본다 */
function insideChrome(sel: Selection): boolean {
  let current = sel
  // 루트에 닿으면 parent() 가 빈 셀렉션이 된다. 깊이 상한은 비정상 문서의 무한 루프 안전판.
  for (let depth = 0; current.length > 0 && depth < 60; depth += 1) {
    if (CHROME_TAGS.has(tagOf(current))) return true
    const role = current.attr('role')
    if (role !== undefined && CHROME_ROLES.has(role.toLowerCase())) return true
    current = current.parent()
  }
  return false
}

/**
 * 메뉴·페이지 번호·아이콘 줄을 걸러낸다.
 *
 * 겹침률로는 못 거른다 — DOM 후보는 화면에서 뽑았으니 화면 텍스트와 겹치는 게 당연하다.
 * 그래서 "목록의 행이라면 이렇지 않다" 를 여기서 본다.
 */
function looksLikeContent(texts: readonly string[]): boolean {
  const filled = texts.filter((t) => t.length > 0)
  if (filled.length < texts.length / 2) return false

  const average = filled.reduce((sum, t) => sum + t.length, 0) / filled.length
  if (average < MIN_ROW_TEXT) return false

  // 행마다 내용이 같으면 목록이 아니라 반복된 장식이다 (버튼 줄·배너 슬라이드).
  const distinct = new Set(filled).size
  return distinct >= Math.max(2, Math.ceil(filled.length * 0.6))
}

// ── ③ 선택자 만들고 검증하기 ───────────────────────────────────────────

/**
 * 이 묶음을 다시 집는 CSS 선택자를 만들어 **실제로 돌려 본다.**
 *
 * 후보를 여럿 만들어 좁은 것부터 시도하고, 우리가 찾은 행을 빠짐없이 집으면서
 * 남의 행까지 끌어오지 않는 첫 번째를 쓴다. 하나도 통과 못 하면 null —
 * 검증 못 한 선택자를 스펙에 넣느니 후보를 버리는 편이 낫다.
 */
function buildVerifiedSelector($: CheerioAPI, group: RepeatGroup): string | null {
  const rowPart = rowSelector(group.rows)
  const wanted = new Set(group.rows.map((r) => r.get(0)))

  for (const containerPart of containerSelectors($, group.parent)) {
    const selector = `${containerPart} > ${rowPart}`
    let matched: unknown[]
    try {
      matched = $(selector).toArray()
    } catch {
      continue
    }
    if (matched.length === 0) continue

    let covered = 0
    for (const el of matched) if (wanted.has(el as never)) covered += 1

    // 우리 행을 전부 집어야 하고, 다른 목록까지 쓸어오면 안 된다.
    if (covered !== wanted.size) continue
    if (matched.length > wanted.size + 2) continue
    return selector
  }
  return null
}

/** 행 쪽 선택자 — 태그 + **모든 행이 공유하는** 클래스. 한 행에만 있는 클래스(`active`)를 쓰면 그 행만 잡힌다 */
function rowSelector(rows: readonly Selection[]): string {
  const first = rows[0]
  if (first === undefined) return '*'

  let shared = classesOf(first).filter(isSafeIdent)
  for (const row of rows.slice(1)) {
    const has = new Set(classesOf(row))
    shared = shared.filter((c) => has.has(c))
    if (shared.length === 0) break
  }

  const tag = tagOf(first)
  // 콜론이 든 Tailwind 클래스를 그대로 이으면 CSS 파서가 던진다 (css-ident.ts 머리말)
  return tagWithClasses(tag, shared.slice(0, 2))
}

/** 컨테이너 쪽 선택자 후보들 — 좁은 것부터 */
function containerSelectors($: CheerioAPI, container: Selection): string[] {
  const out: string[] = []

  const id = container.attr('id')
  if (id !== undefined && isSafeIdent(id)) out.push(`#${id}`)

  for (const cls of classesOf(container).filter(isSafeIdent)) {
    if ($(`.${cls}`).length === 1) out.push(`.${cls}`)
  }

  const local = localSelector(container)
  out.push(local)

  // 조상을 하나씩 붙여 좁힌다. `tbody > tr` 처럼 컨테이너 자체에 표시가 없는 경우가 이 길로 풀린다.
  let chain = local
  let current = container.parent()
  for (let up = 0; up < 3 && current.length > 0; up += 1) {
    const tag = tagOf(current)
    if (tag === 'html' || tag === '') break

    const parentId = current.attr('id')
    if (parentId !== undefined && isSafeIdent(parentId)) {
      out.push(`#${parentId} ${chain}`)
      break
    }
    chain = `${localSelector(current)} > ${chain}`
    out.push(chain)
    current = current.parent()
  }

  return out
}

/** 요소 하나를 가리키는 `태그.클래스` */
function localSelector(sel: Selection): string {
  const tag = tagOf(sel)
  const classes = classesOf(sel).filter(isSafeIdent).slice(0, 2)
  return classes.length > 0 ? `${tag}.${classes.join('.')}` : tag
}

/**
 * 선택자에 그대로 넣어도 되는 이름인가.
 *
 * 이스케이프가 필요한 이름(`w-1/2`, `md:flex`, 숫자로 시작)은 아예 안 쓴다.
 * 이스케이프를 붙이기 시작하면 스펙에 실려 나가는 문자열이 사이트마다 달라지고,
 * 그걸 사람이 읽고 고칠 수 없게 된다.
 */
function isSafeIdent(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(name) && name.length <= 40
}

// ── ④ 행 안에 무엇이 있는지 ────────────────────────────────────────────

/** 키 하나를 몇 개 행에서 봤는지 셀 때 쓰는 문턱 — 대부분의 행에 있어야 진짜 칸이다 */
const KEY_PRESENCE = 0.8
/** 프롬프트와 rank 에 넘길 키 개수 상한 */
const MAX_KEYS = 8

/**
 * 행마다 공통으로 나타나는 자리 이름. JSON 후보의 `keys` 에 해당하는 것을 DOM 에서 만든 것이다.
 *
 * 두 곳이 이걸 읽는다 — rank.ts 는 `title`·`date` 같은 이름이 보이면 목록다움에 가산점을 주고,
 * 컴파일 프롬프트는 "항목의 키" 로 보여줘서 LLM 이 경로를 짚기 쉽게 한다.
 */
function sharedKeys($: CheerioAPI, rows: readonly Selection[]): string[] {
  if (rows.length === 0) return []

  const counts = new Map<string, number>()
  for (const row of rows) {
    const inRow = new Set<string>()
    row.find('*').each((_i, el) => {
      const node = $(el)
      for (const cls of classesOf(node)) if (isSafeIdent(cls)) inRow.add(`.${cls}`)
      if (tagOf(node) === 'a' && node.attr('href') !== undefined) inRow.add('a@href')
    })
    for (const key of inRow) counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const threshold = rows.length * KEY_PRESENCE
  return [...counts.entries()]
    .filter(([, n]) => n >= threshold)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_KEYS)
    .map(([key]) => key)
}

// ── 시그니처 ───────────────────────────────────────────────────────────

/**
 * 요소 하나의 구조 시그니처. 같은 목록의 행들은 이 값이 같다.
 * 태그 이름과 클래스 목록을 깊이 2까지만 본다 — 더 깊이 보면 행마다 미세하게 달라져서 안 묶인다.
 */
export function structureSignature(node: SignatureNode, depth = 2): string {
  const self = `${node.tag}${node.classes.length > 0 ? `.${[...node.classes].sort().join('.')}` : ''}`
  if (depth <= 0 || node.children.length === 0) return self
  const children = node.children.map((c) => structureSignature(c, depth - 1)).join(',')
  return `${self}(${children})`
}

/** 시그니처 계산에 필요한 최소한의 노드 모양. cheerio 든 DOM 이든 여기에 맞춰 넣는다 */
export interface SignatureNode {
  tag: string
  classes: string[]
  children: SignatureNode[]
}

// ── cheerio 다루기 ─────────────────────────────────────────────────────
//
// 노드 타입을 `domhandler` 에서 가져오지 않는다 — cheerio 의 전이 의존이라
// worker 의 package.json 에 없고, pnpm 의 엄격한 격리 때문에 타입이 안 잡힌다.
// (`cheerio-adapter.ts` 에 같은 사정이 적혀 있다)

function tagOf(sel: Selection): string {
  const tag: unknown = sel.prop('tagName')
  return typeof tag === 'string' ? tag.toLowerCase() : ''
}

function classesOf(sel: Selection): string[] {
  const raw = sel.attr('class')
  if (raw === undefined) return []
  return raw.split(/\s+/).filter((c) => c !== '')
}

function outerHtml($: CheerioAPI, sel: Selection): string {
  try {
    return $.html(sel)
  } catch {
    return ''
  }
}

function collapse(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}
