// 어댑터 스펙 최초 생성 프롬프트 (기획서 9-1② · 11장)
//
// 출력 형태는 responseSchema 가 강제하므로 프롬프트가 형태를 설명할 필요는 없다.
// 프롬프트가 할 일은 **판단** 을 돕는 것이다 — 어느 배열이 진짜 목록인가, 어느 값이 마감일인가.

import type { CollectionSchemaJson, FetchMode } from '@endpointer/core'

import { jsonBlock, KOREAN_LIST_SITE_NOTES, PATH_SYNTAX, textBlock, transformOpsSection } from './shared'

export const COMPILE_SYSTEM = `
당신은 목록형 웹페이지에서 표를 뽑아내는 **추출 방법 설계자**다.
코드를 쓰지 않는다. 어디서 무엇을 어떻게 꺼낼지를 선언적으로 적기만 한다.

지켜야 할 것:
1. 지어내지 않는다. 표본에 없는 경로는 쓰지 않는다. 못 찾은 항목은 아예 빼는 게 낫다.
2. 값이 아니라 **경로** 를 적는다. "2026-08-21" 이 아니라 그 값이 있던 자리를 적는다.
3. dedupe_key 는 매번 바뀌지 않는 것으로 고른다. 세션 토큰·조회수·순번이 섞인 값은 피한다.
   안정적인 것이 없으면 넣지 않는다 (제목 해시로 대체된다).
4. 페이지 수집 상한은 3이다. 그보다 크게 적지 않는다.
5. 설명 없이 JSON 객체 하나만 낸다.
`.trim()

export interface CompileCandidateBrief {
  origin: string
  where: string
  list_path: string
  fetch_mode: FetchMode
  fetch_url: string
  /** 이 후보를 목격했을 때의 HTTP 메서드 (network 후보면 실제 관찰값) */
  method?: string
  /** POST 였으면 그 요청 본문 — 날짜 파라미터를 {today} 로 바꾸는 근거 */
  post_body?: string
  keys: string[]
  /** 항목 표본 몇 개 */
  sample: unknown[]
  overlap: number
}

export interface CompilePromptInput {
  url: string
  host: string
  /** 컬렉션 스키마 — 어떤 칸을 채워야 하는지 */
  schema: CollectionSchemaJson
  candidate: CompileCandidateBrief
  /** 페이지에 눈에 보이는 텍스트 (일부) */
  pageText: string
  /** 쓸 수 있는 변환 연산자 */
  ops: readonly string[]
  /** 재생성일 때 붙는 이전 실패 사유 (기획서 11장 "오류 내용을 붙여 재생성 1회") */
  previousErrors?: string[]
}

const FETCH_MODE_HINT: Record<FetchMode, string> = {
  json: 'json — 아래 주소가 JSON 을 그대로 돌려준다. 모든 경로를 JSONPath 로 적는다.',
  html: 'html — 페이지 HTML 을 받아 파싱한다. 모든 경로를 css: 로 적는다.',
  browser: 'browser — 브라우저로 열어야 목록이 그려진다. 모든 경로를 css: 로 적고 wait_for 를 정한다.',
}

export function buildCompilePrompt(input: CompilePromptInput): string {
  const { candidate } = input

  const fieldLines = input.schema
    .map((f) => {
      const mapping =
        f.type === 'enum' && f.mapping !== null && f.mapping !== undefined
          ? ` · 값 후보: ${Object.values(f.mapping).join(', ')}`
          : ''
      return `- \`${f.key}\` (${f.label}) · 타입 ${f.type}${f.required ? ' · 필수' : ''}${mapping}`
    })
    .join('\n')

  const parts: string[] = [
    '# 할 일',
    '아래 목록 페이지에서 표를 뽑아내는 방법을 만들어라.',
    '',
    `- 대상 주소: ${input.url}`,
    `- 호스트: ${input.host} (fetch.url 은 반드시 이 호스트여야 한다)`,
    `- 받아오는 방식: ${FETCH_MODE_HINT[candidate.fetch_mode]}`,
    `- 받아올 주소 후보: ${candidate.fetch_url}`,
    '',
    '# 채워야 할 칸',
    fieldLines,
    '',
    KOREAN_LIST_SITE_NOTES,
    '',
    PATH_SYNTAX,
    '',
    transformOpsSection(input.ops),
    '',
    '# 이 페이지에서 찾아낸 목록 후보',
    '',
    `- 어디서 찾았나: ${candidate.where} (${candidate.origin})`,
    `- 항목을 집는 경로(list) 후보: \`${candidate.list_path}\``,
    `- 화면에 보이는 글자와의 겹침: ${Math.round(candidate.overlap * 100)}%`,
    // 빈 배열을 펼쳐 없애는 방식으로 뺀다. `''` 를 넣고 뒤에서 filter 하면
    // **의도한 빈 줄 구분자까지 같이 지워져** 섹션 제목이 앞 블록에 달라붙는다.
    ...(candidate.keys.length > 0 ? [`- 항목의 키: ${candidate.keys.join(', ')}`] : []),
    '',
    jsonBlock('항목 표본', candidate.sample),
    '',
    textBlock('페이지에 보이는 글자 (일부)', input.pageText, 4_000),
  ]

  if (input.previousErrors !== undefined && input.previousErrors.length > 0) {
    parts.push(
      '',
      '# 직전 시도가 거절된 이유',
      '아래를 전부 고쳐서 다시 만들어라.',
      ...input.previousErrors.map((e) => `- ${e}`),
    )
  }

  return parts.join('\n')
}

/**
 * 자가 치유 재컴파일 프롬프트 (기획서 9-3③).
 * 최초 생성과 다른 점은 단 하나 — **무엇이 깨졌는지**와 **이전 스펙**이 들어간다는 것이다.
 * 깨진 내용 문장은 core 의 `healPrompt` 가 만든다.
 */
export function buildHealPrompt(
  input: CompilePromptInput & { previousSpec: unknown; brokenSummary: string },
): string {
  return [
    '# 할 일',
    '전에 잘 돌던 추출 방법이 더 이상 맞지 않는다. 무엇이 바뀌었는지 보고 고쳐라.',
    '',
    input.brokenSummary,
    '',
    jsonBlock('지금까지 쓰던 방법', input.previousSpec),
    '',
    buildCompilePrompt(input),
  ].join('\n')
}
