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
// TODO(G1): 시그니처 계산과 컨테이너 선정을 실제 사이트 3곳으로 조정한다.
//           지금은 시그니처 함수만 진짜고, 컨테이너 탐색은 자리만 잡아둔 상태다.

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

/**
 * 반복 컨테이너를 찾아 후보로 만든다.
 *
 * 결과 후보의 `list_path` 는 core 가 읽을 수 있는 CSS 경로여야 한다 — `css:.contest-list > li`.
 * `rows` 에는 행의 HTML 조각을 넣는다 (컴파일 프롬프트가 이걸 보고 필드 경로를 만든다).
 */
export function probeDom(input: DomProbeInput): DomProbeResult {
  // TODO(G1): 구현.
  //   1. cheerio 로 파싱하고 모든 요소를 훑는다
  //   2. 부모별로 자식들의 structureSignature() 를 세어, 같은 시그니처가 minRows 회 이상이면 후보
  //   3. 컨테이너 선택자를 만든다 (id > 고유 class > 태그 + nth-of-type 순)
  //   4. 행 HTML 을 rows 에 담는다 → rank.ts 가 겹침률로 순위를 매긴다
  //   5. 후보가 여럿이면 전부 낸다. 고르는 건 rank.ts 의 몫이다
  void input
  return { candidates: [], note: 'DOM 반복 구조 탐지는 G1에서 채운다' }
}

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
