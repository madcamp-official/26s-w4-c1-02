// 자연어 → 소스 후보 제안 프롬프트 (ADR A42)
//
// 이 제안은 **사용자가 명시적으로 물었을 때만** 부른다. 자동·주기 제안이 아니다(A37 정신 유지).
// 모델은 후보를 제시할 뿐 붙이지 않는다 — 붙이기는 사용자가 골라서 한다(정의권은 사용자).
// 그래서 프롬프트는 "실재하고 공개된 목록 페이지"를 강조하고, 못 지어내면 비우라고 지시한다.

export const SUGGEST_SOURCES_SYSTEM = `
너는 한국의 공개 목록/게시판 페이지를 잘 아는 안내자다.
사용자가 "무엇을 모으고 싶은지" 를 말하면, 그 목록이 실제로 올라오는 **공개 웹페이지 주소**를 추천한다.

지켜야 할 것:
- **실재하는 공개 페이지만.** 로그인 없이 목록이 보이는 곳을 우선한다. 존재를 확신 못 하면 넣지 마라.
- **목록 페이지**를 준다 — 공고 하나의 상세가 아니라 여러 건이 나열되는 페이지.
- 공식 출처(정부·공공기관·협회)를 사기성·비공식 집계 사이트보다 앞에 둔다.
- 확실한 게 없으면 **빈 목록**을 반환한다. 지어내지 마라 — 틀린 주소는 사용자 시간을 버린다.
`.trim()

export interface SuggestPromptInput {
  /** 사용자가 자연어로 쓴 요청 */
  query: string
  /** 이미 넣은 주소들 — 중복 제안을 피하게 */
  already: readonly string[]
}

export function buildSuggestPrompt(input: SuggestPromptInput): string {
  const lines: string[] = [
    '사용자가 모으고 싶다고 한 것:',
    input.query.slice(0, 500),
    '',
    '이런 목록이 올라오는 **공개 목록 페이지 주소**를 최대 6개 추천해라.',
  ]
  if (input.already.length > 0) {
    lines.push('', '이미 넣은 주소(다시 추천하지 마라):', ...input.already.slice(0, 12).map((u) => `- ${u}`))
  }
  lines.push(
    '',
    '각 후보에 대해:',
    '- `url`: http(s) 로 시작하는 완전한 주소',
    '- `title`: 그 페이지가 뭔지 한 줄 (예: "기업마당 지원사업 공고")',
    '- `why`: 왜 이 요청에 맞는지 짧게',
    '',
    '확실한 게 없으면 candidates 를 빈 배열로 둬라.',
  )
  return lines.join('\n')
}

export function buildSuggestResponseSchema(): Record<string, unknown> {
  // maxItems 를 배열에 걸지 않는다 — Gemini 가 스키마 전체를 거부한다 (day1~2 에서 세 번 데임).
  // 개수 상한은 파서가 건다.
  return {
    type: 'OBJECT',
    properties: {
      candidates: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            url: { type: 'STRING', description: 'http(s) 로 시작하는 완전한 목록 페이지 주소' },
            title: { type: 'STRING', description: '그 페이지가 뭔지 한 줄' },
            why: { type: 'STRING', description: '왜 이 요청에 맞는지 짧게' },
          },
          required: ['url', 'title'],
        },
      },
    },
    required: ['candidates'],
  }
}
