// 보장선 B2·B4 자동 점검.
//
// app/ · components/ · lib/ 의 .ts/.tsx 를 전부 읽어 사용자에게 보일 수 있는 문자열에
// 내부 명사가 섞였는지 본다. 기획서 15장 "보장선이 조용히 무너짐" 에 대한 방어이고,
// 이게 있으면 G4 의 전수 점검이 싸진다.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  extractUserFacingText,
  findViolations,
  SCAN_EXCLUDED_FILES,
  SCANNED_DIRS,
} from './guardrails'

/** apps/web */
const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const EXCLUDED = new Set<string>(SCAN_EXCLUDED_FILES)

function collectSourceFiles(dir: string): string[] {
  const abs = path.join(WEB_ROOT, dir)
  let entries: string[]
  try {
    entries = readdirSync(abs)
  } catch {
    return []
  }

  const out: string[] = []
  for (const entry of entries) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const absEntry = path.join(abs, entry)
    const rel = path.posix.join(dir, entry)
    if (statSync(absEntry).isDirectory()) {
      out.push(...collectSourceFiles(rel))
      continue
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue
    if (entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) continue
    if (EXCLUDED.has(rel)) continue
    out.push(rel)
  }
  return out
}

const FILES = SCANNED_DIRS.flatMap((dir) => collectSourceFiles(dir))

describe('보장선 B2 — 화면 문자열에 내부 명사가 없다', () => {
  it('검사할 화면 파일을 실제로 찾는다', () => {
    // 경로가 어긋나 0개를 훑고 "통과" 하는 것이 이 테스트의 유일한 실패 방식이다
    expect(FILES.length).toBeGreaterThan(0)
  })

  it.each(FILES)('%s', (rel) => {
    const source = readFileSync(path.join(WEB_ROOT, rel), 'utf8')
    const violations = findViolations(rel, source)
    const report = violations
      .map((v) => `  [${v.term}] ${v.excerpt}\n     → ${v.instead}`)
      .join('\n')
    expect(violations, `${rel} 에서 화면에 나오면 안 되는 말을 찾았습니다:\n${report}`).toEqual([])
  })
})

describe('extractUserFacingText', () => {
  it('주석은 개발자용이라 검사하지 않는다', () => {
    const chunks = extractUserFacingText('// 어댑터를 다시 만든다\nconst a = 1\n')
    expect(chunks.join(' ')).not.toContain('어댑터')
  })

  it('블록 주석도 뺀다', () => {
    const chunks = extractUserFacingText('/* 드리프트 판정 */\nexport const x = 1\n')
    expect(chunks.join(' ')).not.toContain('드리프트')
  })

  it('문자열 리터럴은 검사한다', () => {
    expect(findViolations('x.tsx', "const label = '어댑터 상태'")).toHaveLength(1)
  })

  it('JSX 텍스트도 검사한다', () => {
    expect(findViolations('x.tsx', '<p>드리프트가 감지됐습니다</p>')).toHaveLength(1)
  })

  it('사람 문장은 통과한다 (보장선 B4 의 정답 예시)', () => {
    expect(
      findViolations('x.tsx', '<p>이 사이트 구조가 바뀐 것 같아요. 다시 맞추는 중입니다</p>'),
    ).toEqual([])
  })

  it('HTTP 상태 코드 노출도 잡는다', () => {
    expect(findViolations('x.tsx', "const m = '500 에러가 났습니다'")).toHaveLength(1)
  })

  it('"그런" 같은 낱말을 런으로 오해하지 않는다', () => {
    expect(findViolations('x.tsx', '<p>그런 사이트도 붙일 수 있어요</p>')).toEqual([])
  })
})
