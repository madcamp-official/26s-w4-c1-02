// 경로 평가기 — 어댑터 스펙의 `list` · `dedupe_key` · `fields[].path` 를 실제 값으로 바꾼다
// (기획서 11장 · 원칙 ②)
//
// 두 가지 문법만 있다. 어느 쪽이어야 하는지는 fetch.mode 가 정한다 (spec.ts 참조).
//
//   JSONPath : `$.data.items[*]` · `$.a[0]` · `$['키 이름']`
//   CSS      : `css:.contest-list > li` · `css:a@href`
//
// ── 왜 JSONPath 를 직접 파싱하는가 ──────────────────────────────────────
// 스펙이 쓰는 문법은 위 네 가지 형태가 전부다. 필터식(`?()`)·재귀 하강(`..`)·슬라이스는
// 애초에 스펙 문법에 없다. 외부 jsonpath 라이브러리는 그 전부를 들여오는데, 그중 상당수가
// 문자열을 eval 하는 경로를 가지고 있다. 원칙 ② 가 "임의 코드 실행 금지"인데 경로 평가기가
// 코드를 실행하면 앞문을 잠그고 뒷문을 여는 꼴이다. 그래서 부분집합만 직접 파싱한다.
//
// ── 왜 cheerio 를 직접 부르지 않는가 ────────────────────────────────────
// cheerio 는 apps/worker 의 의존성이지 core 의 의존성이 아니다. core 가 cheerio 를 import 하면
// 화면(web)에서 미리보기를 돌릴 때도 cheerio 가 딸려 와야 한다. 대신 HTML 평가를 `HtmlAdapter`
// 로 주입받는다. 그러면 미리보기(web)·정기 수집(worker)·테스트가 **같은 해석기**를 쓴다.
// 기획서 8장 "미리보기가 거짓말하지 않는다" 가 이 주입점 하나로 보장된다.

import { isCssPath, isJsonPath, parseCssPath } from './spec'

// ── HTML 평가 주입점 ───────────────────────────────────────────────────

/**
 * 선택된 노드 하나. cheerio 의 `Cheerio<Element>` 를 감싸면 그대로 맞는다.
 */
export interface HtmlNode {
  /** 노드의 텍스트 (자손 포함) */
  text(): string
  /** 속성값. 없으면 undefined */
  attr(name: string): string | undefined
  /**
   * 이 노드를 뿌리로 하는 HTML 조각.
   * 행(row)마다 필드 경로를 **행 안에서** 다시 평가해야 하므로 필요하다.
   * cheerio 로는 `$.html($(el))` (outerHTML) 이 맞다.
   */
  html(): string
}

/**
 * HTML 문자열에 CSS 선택자를 적용하는 능력. 호출자가 주입한다.
 *
 * worker: cheerio · web 미리보기: cheerio 또는 DOMParser · 테스트: 가짜 구현.
 */
export interface HtmlAdapter {
  select(html: string, selector: string): HtmlNode[]
}

// ── 경로 문법 오류 ─────────────────────────────────────────────────────

/**
 * 경로 문법 오류. 메시지는 **Gemini 재생성 프롬프트에 그대로 들어갈 한국어 문장**이다
 * (기획서 11장 "오류 내용을 붙여 재생성 1회").
 */
export class PathSyntaxError extends Error {
  readonly path: string
  constructor(path: string, message: string) {
    super(message)
    this.name = 'PathSyntaxError'
    this.path = path
  }
}

// ── JSONPath 부분집합 ──────────────────────────────────────────────────

/** `$.a` 의 `a` */
export interface JsonPathKeyStep {
  kind: 'key'
  name: string
}
/** `$.a[0]` 의 `[0]`. 음수는 뒤에서부터 (-1 = 마지막) */
export interface JsonPathIndexStep {
  kind: 'index'
  index: number
}
/** `$.a[*]` 의 `[*]`. 객체에 걸리면 값 전부로 펼친다 */
export interface JsonPathWildcardStep {
  kind: 'wildcard'
}

export type JsonPathStep = JsonPathKeyStep | JsonPathIndexStep | JsonPathWildcardStep

/** 파싱된 JSONPath. `steps` 가 비어 있으면 뿌리(`$`) 그 자체다 */
export interface ParsedJsonPath {
  source: string
  steps: JsonPathStep[]
  /** `[*]` 가 하나라도 있으면 결과가 여러 개일 수 있다 */
  multi: boolean
}

/**
 * 점 표기법에서 따옴표 없이 쓸 수 있는 키.
 * 한글 키(`$.공고명`)를 실제로 쓰는 국내 내부 API 가 있어서 유니코드 글자를 허용한다.
 * 공백·`.`·`[` 가 든 키는 여전히 `['키 이름']` 로 적어야 한다.
 */
const BARE_KEY = /^[\p{L}\p{N}_$][\p{L}\p{N}_$-]*/u

/**
 * `$.a.b[0][*]['키 이름']` 을 단계 배열로. 문법이 틀리면 PathSyntaxError.
 *
 * 지원하는 것이 전부다: `$` · `.key` · `[0]` · `[-1]` · `[*]` · `['키']` · `["키"]`.
 * 재귀 하강(`..`)·필터(`?()`)·슬라이스(`[1:3]`)는 스펙 문법에 없으므로 거부한다.
 */
export function parseJsonPath(path: string): ParsedJsonPath {
  if (!isJsonPath(path)) {
    throw new PathSyntaxError(path, `경로 '${path}' 는 '$' 로 시작하는 JSONPath 가 아닙니다`)
  }

  const steps: JsonPathStep[] = []
  let i = 1 // '$' 다음부터

  while (i < path.length) {
    const ch = path[i]

    if (ch === '.') {
      if (path[i + 1] === '.') {
        throw new PathSyntaxError(path, `경로 '${path}' 에 재귀 하강('..') 이 있습니다. 전체 경로를 하나씩 적어 주세요`)
      }
      if (path[i + 1] === '*') {
        steps.push({ kind: 'wildcard' })
        i += 2
        continue
      }
      const rest = path.slice(i + 1)
      const m = BARE_KEY.exec(rest)
      if (!m || m[0].length === 0) {
        throw new PathSyntaxError(
          path,
          `경로 '${path}' 의 '.' 다음에 키 이름이 없습니다. 공백이나 특수문자가 들어간 키는 ['키 이름'] 형태로 적어 주세요`,
        )
      }
      steps.push({ kind: 'key', name: m[0] })
      i += 1 + m[0].length
      continue
    }

    if (ch === '[') {
      const close = path.indexOf(']', i + 1)
      if (close === -1) {
        throw new PathSyntaxError(path, `경로 '${path}' 의 대괄호가 닫히지 않았습니다`)
      }
      const inner = path.slice(i + 1, close).trim()

      if (inner === '*') {
        steps.push({ kind: 'wildcard' })
      } else if (/^-?\d+$/.test(inner)) {
        steps.push({ kind: 'index', index: Number(inner) })
      } else if (
        (inner.startsWith("'") && inner.endsWith("'") && inner.length >= 2) ||
        (inner.startsWith('"') && inner.endsWith('"') && inner.length >= 2)
      ) {
        steps.push({ kind: 'key', name: inner.slice(1, -1) })
      } else if (inner.includes(':')) {
        throw new PathSyntaxError(path, `경로 '${path}' 에 슬라이스([1:3]) 가 있습니다. 지원하지 않습니다`)
      } else if (inner.startsWith('?')) {
        throw new PathSyntaxError(path, `경로 '${path}' 에 필터식(?()) 이 있습니다. 지원하지 않습니다`)
      } else {
        throw new PathSyntaxError(
          path,
          `경로 '${path}' 의 [${inner}] 를 이해할 수 없습니다. [0] · [*] · ['키 이름'] 만 쓸 수 있습니다`,
        )
      }
      i = close + 1
      continue
    }

    throw new PathSyntaxError(path, `경로 '${path}' 의 ${i}번째 글자('${ch ?? ''}') 를 이해할 수 없습니다`)
  }

  return { source: path, steps, multi: steps.some((s) => s.kind === 'wildcard') }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 파싱된 경로를 실제 값에 적용. 없는 곳은 조용히 빠진다 (부분 성공 — 원칙 ④) */
export function applyJsonPath(data: unknown, parsed: ParsedJsonPath): unknown[] {
  let current: unknown[] = [data]

  for (const step of parsed.steps) {
    const next: unknown[] = []
    for (const value of current) {
      if (value === null || value === undefined) continue

      switch (step.kind) {
        case 'key': {
          if (isPlainObject(value)) {
            const got = value[step.name]
            if (got !== undefined) next.push(got)
          }
          break
        }
        case 'index': {
          if (Array.isArray(value)) {
            const got = step.index < 0 ? value[value.length + step.index] : value[step.index]
            if (got !== undefined) next.push(got)
          }
          break
        }
        case 'wildcard': {
          if (Array.isArray(value)) {
            for (const el of value) if (el !== undefined) next.push(el)
          } else if (isPlainObject(value)) {
            for (const el of Object.values(value)) if (el !== undefined) next.push(el)
          }
          break
        }
      }
    }
    current = next
    if (current.length === 0) break
  }

  return current
}

/** `$.a[*].b` 에 걸리는 값 전부. 경로 문법이 틀리면 PathSyntaxError */
export function evaluateJsonPath(data: unknown, path: string): unknown[] {
  return applyJsonPath(data, parseJsonPath(path))
}

// ── CSS 경로 ───────────────────────────────────────────────────────────

/** `css:a@href` → 선택자와 속성. 문법이 틀리면 PathSyntaxError */
export function parseCssPathStrict(path: string): { selector: string; attr: string | null } {
  const parsed = parseCssPath(path)
  if (!parsed) {
    throw new PathSyntaxError(
      path,
      `경로 '${path}' 는 CSS 경로가 아닙니다. 'css:선택자' 또는 'css:선택자@속성' 형태로 적어 주세요`,
    )
  }
  return parsed
}

/** CSS 경로에 걸리는 노드 전부 (속성 추출 전) */
export function selectCssNodes(html: string, path: string, adapter: HtmlAdapter): HtmlNode[] {
  const { selector } = parseCssPathStrict(path)
  return adapter.select(html, selector)
}

/**
 * CSS 경로를 문자열 값으로. `@속성` 이 있으면 속성값, 없으면 텍스트.
 * 속성이 없는 노드는 결과에서 빠진다 (부분 성공 — 원칙 ④).
 */
export function evaluateCssPath(html: string, path: string, adapter: HtmlAdapter): string[] {
  const { selector, attr } = parseCssPathStrict(path)
  const out: string[] = []
  for (const node of adapter.select(html, selector)) {
    if (attr === null) {
      out.push(node.text())
    } else {
      const got = node.attr(attr)
      if (got !== undefined) out.push(got)
    }
  }
  return out
}

// ── 모드에 맞는지 검사 (실행 전 계약 검사에서 쓴다) ────────────────────

/**
 * 경로가 이 fetch 모드에서 쓸 수 있는 문법인지. 문제가 없으면 null,
 * 있으면 **재생성 프롬프트에 그대로 넣을 수 있는 한국어 문장**을 돌려준다.
 */
export function checkPathSyntax(path: string, mode: 'json' | 'html' | 'browser', at: string): string | null {
  if (mode === 'json') {
    if (!isJsonPath(path)) {
      return `${at}: json 모드에서는 경로가 '$.' 로 시작하는 JSONPath 여야 합니다 (받은 값: '${path}')`
    }
    try {
      parseJsonPath(path)
    } catch (e) {
      return `${at}: ${e instanceof Error ? e.message : String(e)}`
    }
    return null
  }

  if (!isCssPath(path)) {
    return `${at}: ${mode} 모드에서는 경로가 'css:' 로 시작하는 CSS 선택자여야 합니다 (받은 값: '${path}')`
  }
  try {
    const { selector } = parseCssPathStrict(path)
    if (selector.trim().length === 0) {
      return `${at}: CSS 선택자가 비어 있습니다 (받은 값: '${path}')`
    }
  } catch (e) {
    return `${at}: ${e instanceof Error ? e.message : String(e)}`
  }
  return null
}
