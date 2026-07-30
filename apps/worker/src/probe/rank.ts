// 후보 순위 판정 (기획서 9-1 주석 · 15장 첫 번째 리스크의 유일한 대응책)
//
//   ※ 후보 순위 판정: 페이지에 눈으로 보이는 텍스트와 후보 데이터의 값이 얼마나 겹치는가.
//     "이게 그 목록이 맞다" 를 이 겹침률로 판정한다.
//
// 겹침률 계산 자체는 core 의 `textOverlapRatio` 다 (치유 승격의 겹침률과 같은 모듈에 둔 이유는
// 둘 다 "이게 그 목록이 맞나" 를 묻기 때문이다). 여기서 하는 일은 그 값에 몇 가지 보정을 얹어
// 후보를 줄 세우고, **왜 그렇게 줄 세웠는지를 사람이 읽을 수 있게 남기는 것**이다.
// 사람이 판단할 것 = "후보 목록이 맞는가" (기획서 14장). 그 판단의 재료를 만드는 게 이 파일이다.

import { textOverlapRatio } from '@endpointer/core/validate'

import type { ProbeCandidate, RankedCandidate } from './types'

export interface RankInput {
  /** 페이지에 눈에 보이는 텍스트 */
  pageText: string
  candidates: readonly ProbeCandidate[]
}

/** 경로별 신뢰 가산점 — 내부 API 가 가장 안정적이다 (원칙 ③ · ADR A3) */
const ORIGIN_BONUS = {
  network: 0.1,
  inline_json: 0.06,
  dom: 0,
  browser_render: 0,
} as const

export function rankCandidates(input: RankInput): RankedCandidate[] {
  const ranked = input.candidates.map((c) => score(input.pageText, c))
  ranked.sort((a, b) => b.score - a.score)
  return ranked
}

function score(pageText: string, candidate: ProbeCandidate): RankedCandidate {
  const reasons: string[] = []

  // ① 본체 — 화면에 보이는 글자와 후보 값의 겹침률
  const overlap = textOverlapRatio(pageText, candidate.rows)
  reasons.push(`화면 텍스트와 ${pct(overlap)} 겹침`)

  let total = overlap

  // ② 경로 가산점
  const bonus = ORIGIN_BONUS[candidate.origin]
  if (bonus > 0) {
    total += bonus
    reasons.push(candidate.origin === 'network' ? '내부 API 응답' : '페이지에 심긴 데이터')
  }

  // ③ 원소 수 — 3개는 겨우 목록이고 20개는 확실히 목록이다. 아주 작은 가산점만.
  const sizeBonus = Math.min(0.05, candidate.rows.length / 400)
  total += sizeBonus
  reasons.push(`${candidate.rows.length}개 항목`)

  // ④ 키 구성 — 목록스러운 키(제목·날짜·링크류)가 있으면 가산
  const hint = keyHint(candidate.keys)
  if (hint.length > 0) {
    total += 0.05
    reasons.push(`목록다운 항목 이름: ${hint.join(', ')}`)
  }

  // ⑤ 감점 — 페이지네이션·메뉴처럼 값이 죄다 짧은 후보
  if (candidate.rows.length > 0 && averageValueLength(candidate.rows) < 4) {
    total -= 0.15
    reasons.push('값이 지나치게 짧습니다 (메뉴나 페이지 번호일 수 있음)')
  }

  return { ...candidate, overlap, score: round(Math.max(0, total)), reasons }
}

/** 한국 목록 사이트에서 실제로 자주 보이는 키 이름들 */
const KEY_HINTS = [
  'title',
  'name',
  'nm',
  'subject',
  'pbancnm',
  'date',
  'de',
  'dt',
  'deadline',
  'end',
  'start',
  'url',
  'link',
  'href',
  'sn',
  'seq',
  'idx',
  'no',
  'id',
  'org',
  'instt',
  'amount',
  'category',
]

/**
 * 키를 camelCase·구분자 경계로 쪼갠다 — "startDt" → [start, dt] · "whitespace-nowrap" → [whitespace, nowrap].
 * 힌트는 **토큰 정확 일치**로만 인정한다. 부분 문자열로 보면 'no' 가 "nowrap" 에, 'id' 가 "grid" 에
 * 걸려서, 키가 CSS 클래스인 DOM 후보가 가짜 보너스를 받는다 — cse.snu.ac.kr 에서 푸터 메뉴가
 * 이 보너스로 진짜 공지 목록을 0.01 차로 이겼다 (07-30).
 */
function keyTokens(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0)
}

function keyHint(keys: readonly string[]): string[] {
  const hits: string[] = []
  for (const key of keys) {
    const tokens = keyTokens(key)
    if (KEY_HINTS.some((h) => tokens.includes(h))) hits.push(key)
    if (hits.length >= 4) break
  }
  return hits
}

function averageValueLength(rows: readonly unknown[]): number {
  let total = 0
  let count = 0
  for (const row of rows.slice(0, 20)) {
    if (typeof row === 'string') {
      total += row.trim().length
      count += 1
      continue
    }
    if (row === null || typeof row !== 'object') continue
    for (const value of Object.values(row as Record<string, unknown>)) {
      if (typeof value === 'string') {
        total += value.trim().length
        count += 1
      }
    }
  }
  return count === 0 ? 0 : total / count
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}

export function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}
