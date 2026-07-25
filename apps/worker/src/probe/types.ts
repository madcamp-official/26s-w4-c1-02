// probe 의 공통 타입 (기획서 9-1① · ADR A3)
//
// **`probe_path` 가 G1 판정 조건이다** — "probe 가 어느 경로로 뚫렸는지가 로그에 구분돼 남는다".
// 그래서 후보 하나하나가 자기가 어디서 왔는지를 들고 다닌다.

import type { FetchMode } from '@endpointer/core'

/** ADR A3 의 순서 그대로. 앞에 있을수록 싸다 */
export const PROBE_PATHS = ['inline_json', 'network', 'dom', 'browser_render'] as const
export type ProbePath = (typeof PROBE_PATHS)[number]

/** 로그·CLI 출력용 한국어 라벨 (사용자 화면 문구가 아니라 개발자용이다) */
export const PROBE_PATH_LABELS: Record<ProbePath, string> = {
  inline_json: '인라인 JSON',
  network: '네트워크 관찰',
  dom: 'DOM 반복 구조',
  browser_render: '브라우저 렌더',
}

/** 후보를 어디서 집었는지 — 컴파일 프롬프트와 CLI 출력이 이걸 읽는다 */
export type CandidateSource =
  | {
      kind: 'inline_json'
      /** `__NEXT_DATA__` · `__NUXT__` · `window.__INITIAL_STATE__` · `ld+json` */
      script: string
      /** 스크립트 안에서의 위치 */
      json_path: string
    }
  | {
      kind: 'network'
      /** 브라우저가 실제로 부른 URL. 이게 곧 fetch.url 후보다 (원칙 ③) */
      url: string
      method: string
      json_path: string
    }
  | {
      kind: 'dom'
      /** 반복 컨테이너의 CSS 선택자 */
      selector: string
    }

export interface ProbeCandidate {
  /** 후보 식별자. 로그와 CLI 에서 사람이 가리키기 위한 것 */
  id: string
  origin: ProbePath
  source: CandidateSource
  /** 어댑터 스펙의 `list` 로 그대로 쓸 수 있는 경로 */
  list_path: string
  /** 이 후보를 쓰면 스펙의 fetch.mode 가 무엇이 되는지 */
  fetch_mode: FetchMode
  /** 스펙의 fetch.url 후보 */
  fetch_url: string
  /** 후보 목록의 원소들. json 후보면 객체, dom 후보면 행 HTML */
  rows: unknown[]
  /** 원소들에 반복해서 나타나는 키 (json 후보만) */
  keys: string[]
  /** 사람이 읽는 한 줄 설명 */
  where: string
}

export interface RankedCandidate extends ProbeCandidate {
  /** 페이지에 눈에 보이는 텍스트와의 겹침률 0~1 (기획서 9-1 주석 · 15장) */
  overlap: number
  /** 순위 점수. 겹침률이 주인이고 나머지는 보정이다 */
  score: number
  /** 점수 근거 — CLI 에서 사람이 판단할 수 있게 (14장 "사람이 판단할 것") */
  reasons: string[]
}

/** 단계별 실행 기록. 이게 G1 판정의 로그다 */
export interface ProbeStep {
  path: ProbePath
  ran: boolean
  candidates: number
  duration_ms: number
  /** 왜 건너뛰었는지 / 무엇을 봤는지 */
  note: string
}

export interface ProbePage {
  title: string | null
  /** 눈에 보이는 텍스트. 후보 순위 판정의 기준이다 */
  text: string
  html_bytes: number
}

export interface ProbeResult {
  url: string
  final_url: string
  host: string
  /** 아이템으로 볼 만한 후보가 하나라도 나왔는지 */
  ok: boolean
  /** **어느 경로로 뚫렸는지.** 못 뚫었으면 null (G1 판정 조건) */
  probe_path: ProbePath | null
  /** 뚫린 경로가 함의하는 fetch 모드. 못 뚫었으면 폴백인 'html' */
  fetch_mode: FetchMode
  best: RankedCandidate | null
  /** 점수 내림차순 */
  candidates: RankedCandidate[]
  steps: ProbeStep[]
  page: ProbePage
  /** 사람이 읽는 경고. 화면에 그대로 내보내지는 않는다 (보장선 B2 는 화면 문구에만 적용) */
  warnings: string[]
  duration_ms: number
}

export interface ProbeOptions {
  /** 이 겹침률 미만이면 "그 목록이 맞다"고 보지 않고 다음 단계로 내려간다 */
  minOverlap?: number
  /** 후보 원소가 이 개수 미만이면 목록으로 치지 않는다 (기획서 9-1 "배열 길이 ≥ 3") */
  minRows?: number
  /** 브라우저를 쓰는 단계를 건너뛴다 (G1 강등 규칙 1) */
  skipBrowser?: boolean
  /** DOM 반복 구조 탐지를 건너뛴다 (G1 강등 규칙 2) */
  skipDom?: boolean
  /** 네트워크 관찰 타임아웃 */
  browserTimeoutMs?: number
}

export const PROBE_DEFAULTS = {
  minOverlap: 0.3,
  minRows: 3,
  browserTimeoutMs: 15_000,
} as const
