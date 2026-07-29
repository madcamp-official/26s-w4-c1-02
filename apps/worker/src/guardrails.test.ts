// 보장선 B2·B4 자동 점검 — 워커 판.
//
// 워커의 `message:` 값은 /internal/* 응답을 타고 **그대로 화면에 뜬다** (web 은 워커의
// 사람 문장을 신뢰해 재가공하지 않는다). 그런데 B2 자동 검사(apps/web/lib/guardrails.test.ts)는
// apps/web 만 훑어서, 워커가 만드는 사용자 문구는 무검사였다 — 실제로
// 'GEMINI_API_KEY 가 비어 있습니다' 가 화면 문구로 나가고 있었다. 그 구멍을 여기서 막는다.
//
// 검사 대상은 두 겹이다:
//  1. 소스 정적 스캔 — `message:` 에 붙은 문자열 리터럴 전부
//  2. 문구 상수 테이블 — heal 의 MESSAGES · gemini 의 RATE_LIMIT_MESSAGES (템플릿이라 1이 못 보는 것)
//
// 금지어 목록은 web 의 FORBIDDEN_UI_TERMS 를 워커 문맥에 맞게 옮긴 것이다 (앱 경계상 import 불가 —
// 목록이 갈라지면 두 파일을 같이 고쳐라).

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { RATE_LIMIT_MESSAGES } from './compile/gemini'
import { MESSAGES as HEAL_MESSAGES } from './jobs/heal'

const SRC_ROOT = path.dirname(fileURLToPath(import.meta.url))

/** 사용자 문구에 나오면 안 되는 말 (B2 · B4) */
const FORBIDDEN: readonly { term: string; pattern: RegExp }[] = [
  { term: '어댑터', pattern: /어댑터/ },
  { term: '스펙', pattern: /스펙/ },
  { term: '드리프트', pattern: /드리프트/ },
  { term: '파서', pattern: /파서/ },
  { term: '컴파일', pattern: /컴파일/ },
  { term: '셀렉터', pattern: /셀렉터/ },
  { term: '정규식', pattern: /정규식/ },
  { term: '크롤러/크롤링', pattern: /크롤러|크롤링/ },
  { term: '모델', pattern: /(?<![가-힣A-Za-z])모델(?![가-힣A-Za-z])/ },
  { term: 'probe', pattern: /\bprobes?\b/i },
  { term: 'adapter', pattern: /\badapters?\b/i },
  { term: 'drift', pattern: /\bdrift(ed|ing)?\b/i },
  { term: 'selector', pattern: /\bselectors?\b/i },
  { term: '환경변수 이름', pattern: /[A-Z][A-Z0-9]*(_[A-Z0-9]+){1,}/ },
  { term: 'HTTP 코드', pattern: /HTTP[ /]?\d{3}|응답 \d{3}|\b[45]\d{2}\s*(에러|오류|error)/i },
  { term: '스택 트레이스', pattern: /stack ?trace|스택 ?트레이스/i },
]

function violationsIn(text: string): string[] {
  return FORBIDDEN.filter((f) => f.pattern.test(text)).map((f) => f.term)
}

// ── 1. 소스 정적 스캔 — message: '...' 리터럴 ──────────────────────────

/** cli(터미널 전용)·테스트·프롬프트(LLM 이 읽는다)는 사용자 화면이 아니다 */
const SKIP_DIRS = new Set(['cli', 'prompts'])

function collectSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue
    const abs = path.join(dir, entry)
    if (statSync(abs).isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue
      out.push(...collectSourceFiles(abs))
      continue
    }
    if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue
    out.push(abs)
  }
  return out
}

/** `message: '…'` · `message: "…"` · `message: \`…\`` 의 리터럴 본문만 뽑는다 */
function extractMessages(source: string): string[] {
  const out: string[] = []
  const re = /message:\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g
  for (const m of source.matchAll(re)) out.push(m[2] ?? '')
  return out
}

const FILES = collectSourceFiles(SRC_ROOT)

describe('보장선 B2·B4 — 워커가 만드는 사용자 문구', () => {
  it('검사할 파일을 실제로 찾는다', () => {
    expect(FILES.length).toBeGreaterThan(10)
  })

  it.each(FILES.map((f) => [path.relative(SRC_ROOT, f), f] as const))('%s', (_rel, abs) => {
    const source = readFileSync(abs, 'utf8')
    const bad = extractMessages(source)
      .map((msg) => ({ msg, hits: violationsIn(msg) }))
      .filter((v) => v.hits.length > 0)
    const report = bad.map((v) => `  [${v.hits.join(', ')}] "${v.msg}"`).join('\n')
    expect(bad, `화면에 나가면 안 되는 말이 message 에 있습니다:\n${report}`).toEqual([])
  })
})

// ── 2. 문구 상수 테이블 ────────────────────────────────────────────────

describe('문구 테이블도 같은 잣대를 지킨다', () => {
  it.each(Object.entries(HEAL_MESSAGES))('치유 실패 문구 %s', (_reason, message) => {
    expect(violationsIn(message)).toEqual([])
  })

  it.each(Object.entries(RATE_LIMIT_MESSAGES))('한도 문구 %s', (_kind, message) => {
    expect(violationsIn(message)).toEqual([])
  })
})
