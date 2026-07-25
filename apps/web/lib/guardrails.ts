// 보장선 B2·B4 를 코드로 지키는 장치.
//
// 기획서 4-1 은 "사용자가 배우는 명사는 컬렉션 하나" 라고 못 박았고, 15장은 이 보장선이
// **조용히 무너지는 것**을 리스크로 꼽는다. 사람 눈으로만 지키면 반드시 샌다 —
// 급할 때 붙인 상태 문구 한 줄이 보장선을 깨고, 그건 G4 전수 점검 때나 발견된다.
//
// 그래서 금지어를 상수로 두고 테스트가 화면 코드를 훑는다 (guardrails.test.ts).
// 이 파일 자체와 테스트 파일은 검사 대상에서 뺀다 (여기엔 금지어가 당연히 들어 있다).

/** 검사 대상 디렉터리 — 레포의 apps/web 기준 상대 경로 */
export const SCANNED_DIRS = ['app', 'components', 'lib'] as const

/** 검사에서 빼는 파일 (레포의 apps/web 기준 상대 경로) */
export const SCAN_EXCLUDED_FILES = ['lib/guardrails.ts', 'lib/guardrails.test.ts'] as const

export interface ForbiddenTerm {
  /** 사람이 읽을 이름 */
  term: string
  /** 실제 판정 규칙 */
  pattern: RegExp
  /** 대신 써야 하는 말 */
  instead: string
}

/**
 * 화면에 나오면 안 되는 내부 명사 (보장선 B2).
 *
 * `런` 은 한국어에서 다른 낱말의 조각으로 자주 등장하므로("그런", "런칭") 앞뒤가
 * 한글/영문이 아닐 때만 잡는다. 나머지는 오탐이 사실상 없어 부분 문자열로 본다.
 */
export const FORBIDDEN_UI_TERMS: readonly ForbiddenTerm[] = [
  { term: '어댑터', pattern: /어댑터/, instead: '이 사이트에서 값을 읽어오는 방법 — 화면에서는 아예 언급하지 않는다' },
  { term: '런', pattern: /(?<![가-힣A-Za-z])런(?![가-힣A-Za-z])/, instead: '수집 · 마지막으로 확인한 시각' },
  { term: '런타임', pattern: /런타임/, instead: '화면에서 쓸 말이 아니다' },
  { term: '스펙', pattern: /스펙/, instead: '설정 · 표의 모양' },
  { term: '드리프트', pattern: /드리프트/, instead: '사이트 구조가 바뀐 것 같아요' },
  { term: '파서', pattern: /파서/, instead: '값을 정리하는 규칙 — 화면에서는 언급하지 않는다' },
  { term: '컴파일', pattern: /컴파일/, instead: '표를 만드는 중이에요' },
  { term: '셀렉터', pattern: /셀렉터/, instead: '보장선 B1 — 사용자에게 물어볼 수 없는 것' },
  { term: '정규식', pattern: /정규식/, instead: '보장선 B1 — 사용자에게 물어볼 수 없는 것' },
  { term: '크롤러', pattern: /크롤러|크롤링/, instead: '수집' },
  { term: 'probe', pattern: /\bprobes?\b/i, instead: '사이트를 살펴보는 중이에요' },
  { term: 'adapter', pattern: /\badapters?\b/i, instead: '화면에서 쓸 말이 아니다' },
  { term: 'drift', pattern: /\bdrift(ed|ing)?\b/i, instead: '사이트 구조가 바뀐 것 같아요' },
  { term: 'selector', pattern: /\bselectors?\b/i, instead: '보장선 B1' },
  { term: 'XPath', pattern: /\bx-?path\b/i, instead: '보장선 B1' },
  { term: 'JSONPath', pattern: /\bjson-?path\b/i, instead: '보장선 B1' },
  { term: 'stack trace', pattern: /\bstack ?trace\b|스택 ?트레이스/i, instead: '보장선 B4 — 사람 문장으로 바꿔라' },
]

/**
 * HTTP 상태 코드가 사용자에게 그대로 노출되는 것도 보장선 B4 위반이다.
 * `HTTP 404` · `500 에러` 같은 모양만 잡는다 (연도나 금액과 헷갈리지 않게).
 */
export const FORBIDDEN_HTTP_CODE_PATTERN = /(HTTP[ /]?\d{3})|(\b[45]\d{2}\s*(에러|오류|error))/i

// ── 사용자에게 보이는 문자열만 뽑아내기 ─────────────────────────────────

/** 주석을 지운다. 주석은 개발자용이라 내부 명사를 써도 된다 */
export function stripComments(source: string): string {
  return (
    source
      // /* ... */ 와 {/* ... */}
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      // // ...  — URL 의 `https://` 를 주석으로 오해하지 않게 앞에 `:` 가 오면 건너뛴다
      .replace(/(^|[^:'"`\\])\/\/[^\n]*/gm, '$1')
  )
}

/**
 * 문자열 리터럴 + JSX 텍스트 노드. 완벽한 파서가 아니라 **의도적으로 넉넉한** 그물이다 —
 * 코드 식별자가 몇 개 섞여 들어와도 식별자는 전부 영어라서 한국어 금지어와 부딪히지 않는다.
 */
export function extractUserFacingText(source: string): string[] {
  const body = stripComments(source)
  const out: string[] = []

  // 따옴표 세 종류
  for (const m of body.matchAll(/'([^'\\\n]*(?:\\.[^'\\\n]*)*)'/g)) out.push(m[1] ?? '')
  for (const m of body.matchAll(/"([^"\\\n]*(?:\\.[^"\\\n]*)*)"/g)) out.push(m[1] ?? '')
  for (const m of body.matchAll(/`([^`\\]*(?:\\.[^`\\]*)*)`/g)) out.push(m[1] ?? '')

  // JSX 텍스트 노드 — `>` 와 `<` 사이. 중괄호 표현식은 위 리터럴 규칙이 이미 훑었다
  for (const m of body.matchAll(/>([^<>{}]+)</g)) {
    const text = (m[1] ?? '').trim()
    if (text !== '') out.push(text)
  }

  return out.filter((s) => s.trim() !== '')
}

export interface GuardrailViolation {
  file: string
  term: string
  instead: string
  excerpt: string
}

/** 한 파일 분량의 소스에서 위반을 찾는다 */
export function findViolations(file: string, source: string): GuardrailViolation[] {
  const violations: GuardrailViolation[] = []

  for (const chunk of extractUserFacingText(source)) {
    for (const rule of FORBIDDEN_UI_TERMS) {
      if (rule.pattern.test(chunk)) {
        violations.push({ file, term: rule.term, instead: rule.instead, excerpt: chunk.slice(0, 120) })
      }
    }
    if (FORBIDDEN_HTTP_CODE_PATTERN.test(chunk)) {
      violations.push({
        file,
        term: 'HTTP 상태 코드',
        instead: '보장선 B4 — 코드 대신 사람 문장',
        excerpt: chunk.slice(0, 120),
      })
    }
  }

  return violations
}
