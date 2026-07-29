// 첫 소스 — 표를 발견하는 프롬프트 (기획서 9-1②④)
//
// `compile-spec.ts` 와의 차이는 하나다. 저쪽은 "이 칸들을 채워라" 이고 여기는 **"어떤 칸을 둘지도 정하라"** 다.
// 컬렉션이 처음 만들어지는 순간에는 채워야 할 칸이 없기 때문이다.
//
// ── 이 프롬프트가 짊어진 보장선 ────────────────────────────────────────
// B3 "빈 스키마 에디터를 주지 않는다" 가 여기서 지켜진다. 사용자는 주소 하나만 냈고,
// 첫 화면에 **이미 채워진 표**가 나와야 한다. 그 표의 칸을 정하는 게 이 프롬프트다.
// 그래서 "모르겠으면 빼라" 가 아니라 **"쓸 만한 칸을 반드시 찾아내라"** 쪽으로 민다 —
// 다만 지어내는 것과는 다르다. 표본에 있는 값만 쓴다.

import type { FetchMode } from '@endpointer/core'

import { jsonBlock, KOREAN_LIST_SITE_NOTES, PATH_SYNTAX, textBlock, transformOpsSection } from './shared'
import type { CompileCandidateBrief } from './compile-spec'

export const DISCOVER_SYSTEM = `
당신은 목록형 웹페이지를 보고 **표를 설계하는 사람**이다.
어떤 칸(열)을 둘지 정하고, 각 칸의 값을 어디서 어떻게 꺼낼지를 선언적으로 적는다.
코드는 쓰지 않는다.

지켜야 할 것:
1. 지어내지 않는다. 표본에 없는 경로는 쓰지 않는다.
2. 값이 아니라 **경로** 를 적는다. "2026-08-21" 이 아니라 그 값이 있던 자리를 적는다.
3. 사람이 이 표를 보고 바로 쓸 수 있어야 한다. 내부 식별자·순번·조회수처럼
   사람이 읽을 이유가 없는 값은 칸으로 두지 않는다.
4. dedupe_key 는 매번 바뀌지 않는 것으로 고른다. 안정적인 것이 없으면 넣지 않는다.
5. 페이지 수집 상한은 3이다. 그보다 크게 적지 않는다.
6. 설명 없이 JSON 객체 하나만 낸다.
`.trim()

export interface DiscoverPromptInput {
  url: string
  host: string
  candidate: CompileCandidateBrief
  pageText: string
  ops: readonly string[]
  /** 재생성일 때 붙는 이전 실패 사유 (기획서 11장 "오류 내용을 붙여 재생성 1회") */
  previousErrors?: string[]
}

/** 프롬프트에 "오늘 날짜로 보이는 값"의 예시를 준다 — LLM 이 본문에서 뭘 {today} 로 바꿀지 짚게 */
function todayHint(): string {
  const kst = new Date(Date.now() + 9 * 3_600_000)
  const y = kst.getUTCFullYear()
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0')
  const d = String(kst.getUTCDate()).padStart(2, '0')
  return `${y}${m}${d} 또는 ${y}-${m}-${d}`
}

const FETCH_MODE_HINT: Record<FetchMode, string> = {
  json: 'json — 아래 주소가 JSON 을 그대로 돌려준다. 모든 경로를 JSONPath 로 적는다.',
  html: 'html — 페이지 HTML 을 받아 파싱한다. 모든 경로를 css: 로 적는다.',
  browser: 'browser — 브라우저로 열어야 목록이 그려진다. 모든 경로를 css: 로 적고 wait_for 를 정한다.',
}

/**
 * 어떤 칸을 둘지 고르는 기준.
 * 이 문단이 표의 품질을 좌우한다 — 튜닝은 여기 문장을 고치는 것으로 한다.
 */
const COLUMN_GUIDANCE = `
# 어떤 칸을 둘 것인가

이 목록을 계속 지켜볼 사람에게 필요한 것만 고른다. 보통 4~7개면 충분하고, 많아야 12개다.

**거의 항상 필요한 것**
- 항목의 이름 (\`title\`) — 사람이 이 항목을 알아보는 값. 가장 긴 텍스트인 경우가 많다
- 원문으로 가는 링크 (\`link\`) — 타입은 link. 상대경로면 absolute_url 로 절대화한다.
  링크가 \`javascript:...\` 라 쓸 수 없으면, 항목의 id 를 잡아 template 로 상세 주소를 조립한다

**이 목록에 있으면 넣는 것**
- 마감일·모집기간 (\`deadline\`) — 타입 date. 시작일과 마감일이 한 칸에 있으면 **마감일 쪽**을 잡는다
- 주관·주최 기관 (\`organization\`) — 타입 text
- 금액·지원규모 (\`amount\`) — 타입 money. 한국식 단위는 multiply 로 편다
- 분류·카테고리 (\`category\`) — 타입 enum
- 등록일·공고일 (\`posted_at\`) — 타입 date

**두지 않는 것**
- 내부 식별자, 순번, 조회수, 정렬키, 썸네일 경로
- 항목마다 값이 같은 것 (전부 "진행중" 인 상태 칸 같은 것)
- 표본의 절반 이상이 비어 있는 것

칸 이름(\`key\`)은 영문 소문자로 짓고, 화면에 보일 이름(\`label\`)은 한국어로 짓는다.
위 괄호 안의 이름을 쓸 수 있으면 그대로 쓴다 — 나중에 다른 사이트를 같은 표에 붙일 때 맞추기 쉬워진다.
`.trim()

export function buildDiscoverPrompt(input: DiscoverPromptInput): string {
  const { candidate } = input

  const parts: string[] = [
    '# 할 일',
    '아래 목록 페이지를 보고 **표를 만들어라.** 어떤 칸을 둘지 정하고, 각 칸을 어디서 뽑는지 적는다.',
    '',
    `- 대상 주소: ${input.url}`,
    `- 호스트: ${input.host} (fetch.url 은 반드시 이 호스트여야 한다)`,
    `- 받아오는 방식: ${FETCH_MODE_HINT[candidate.fetch_mode]}`,
    `- 받아올 주소 후보: ${candidate.fetch_url}`,
    ...(candidate.method !== undefined && candidate.method !== 'GET'
      ? [`- 이 주소는 ${candidate.method} 로 불렸다. fetch.method 를 ${candidate.method} 로 둔다`]
      : []),
    ...(candidate.post_body !== undefined
      ? [
          `- 목격한 요청 본문: ${candidate.post_body}`,
          '  이 본문을 fetch.body 로 그대로 쓰되, **오늘 날짜로 보이는 값(예: ' +
            `${todayHint()})은 {today} 또는 {today_iso} 자리표시자로 바꾼다** — 매일 갱신되게. 절대 날짜를 박지 마라.`,
        ]
      : []),
    '',
    COLUMN_GUIDANCE,
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
    // 빈 줄을 하나 끼워 앞 블록(페이지 원문)과 확실히 떨어뜨린다.
    // 여기가 붙어 버리면 재생성이 이전 실패를 못 읽는다.
    parts.push(
      '',
      '# 직전 시도가 거절된 이유',
      '아래를 전부 고쳐서 다시 만들어라.',
      ...input.previousErrors.map((e) => `- ${e}`),
    )
  }

  return parts.join('\n')
}
