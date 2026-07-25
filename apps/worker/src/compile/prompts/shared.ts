// 프롬프트 공통 조각
//
// 프롬프트를 코드에서 분리해 파일로 두는 이유: 이게 제품의 품질을 좌우하는 **튜닝 대상**이고,
// 튜닝은 코드 수정이 아니라 문장 수정이어야 한다. G1~G3 에서 여기만 고치게 된다.

/**
 * 한국 목록 사이트의 특성. 컴파일·매핑 프롬프트가 공유한다.
 * 여기 적힌 것들은 전부 실제로 자주 깨지는 지점이다 (기획서 11장 변환 연산자 표의 배경).
 */
export const KOREAN_LIST_SITE_NOTES = `
# 대상 사이트의 특성 (한국 공공·민간 목록 사이트)

- **날짜 표기가 제각각이다.** \`20260821\` \`2026.08.21\` \`2026-08-21\` \`26.08.21\`
  \`~2026-08-21\` \`2026.08.01 ~ 2026.08.21\` \`D-7\` \`상시\` \`상시모집\` \`접수마감\`
  한 칸에 시작일과 마감일이 같이 들어 있으면 **마감일 쪽**을 잡는다.
- **금액에 한국식 단위가 붙는다.** \`최대 100,000천원\` \`5억원\` \`3,000만원\` \`1억 5천만원\`
  천원은 ×1000, 만원은 ×10000, 억은 ×100000000 이다. multiply 연산자로 표현한다.
- **링크가 상대경로거나 자바스크립트다.** \`/web/contents/detail?sn=123\` 은 absolute_url 로 절대화한다.
  \`javascript:goDetail('123')\` 같은 건 링크로 쓸 수 없다 — 이럴 때는 목록의 id 값을 잡아
  template 연산자로 상세 주소를 조립한다.
- **내부 API 의 키 이름이 자음 축약형이다.** \`pbancNm\`(공고명) \`jrsdInsttNm\`(소관기관)
  \`reqstEndDe\`(신청종료일) \`rcritPblancNo\` \`sportAmount\`. 뜻이 안 보이면 **값을 보고** 판단한다.
- **목록 옆에 목록이 아닌 반복 구조가 많다.** 좌측 카테고리 메뉴, 하단 페이지 번호, 인기검색어.
  이런 것들도 반복되지만 값이 짧고 날짜·기관명이 없다. 진짜 목록은 항목마다 제목이 길다.
- **분류값이 사이트마다 다른 말을 쓴다.** "기술개발" "R&D" "연구개발" 이 같은 것을 가리킨다.
`.trim()

/** 변환 연산자 닫힌 집합을 프롬프트에 넣는 설명 (기획서 11장 · ADR A2) */
export function transformOpsSection(ops: readonly string[]): string {
  return `
# 쓸 수 있는 변환 연산자 (이 목록이 전부다)

${ops.map((op) => `- ${op}`).join('\n')}

여기 없는 연산자를 지어내면 검사에서 걸러진다. 코드나 표현식은 넣을 수 없다.
변환이 필요 없으면 transform 을 아예 넣지 않는다.
`.trim()
}

/** 경로 문법 설명 — core 의 paths.ts 가 실제로 받아들이는 것만 적는다 */
export const PATH_SYNTAX = `
# 경로 문법

- JSON 응답에서 뽑을 때: \`$\` 로 시작하는 JSONPath.
  쓸 수 있는 것: \`$.key\` \`$.a.b\` \`$.list[0]\` \`$.list[-1]\` \`$.list[*]\` \`$['키 이름']\`
  쓸 수 없는 것: 재귀 하강(\`..\`), 필터(\`?()\`), 슬라이스(\`[1:3]\`), 함수
- HTML 에서 뽑을 때: \`css:\` 를 붙인 CSS 선택자. 예) \`css:.contest-list > li\`
  속성을 뽑을 때는 뒤에 \`@속성\`. 예) \`css:a@href\`
- fetch.mode 가 json 이면 **모든 경로가** JSONPath, html·browser 면 **모든 경로가** CSS 여야 한다. 섞을 수 없다.
- 항목별 경로(fields, dedupe_key)는 list 로 집은 **항목 하나를 기준으로** 적는다.
`.trim()

/** 표본을 프롬프트에 넣기 좋은 형태로 */
export function jsonBlock(label: string, value: unknown, maxChars = 12_000): string {
  let text: string
  try {
    text = JSON.stringify(value, null, 2)
  } catch {
    text = String(value)
  }
  if (text.length > maxChars) text = `${text.slice(0, maxChars)}\n… (이후 생략)`
  return `## ${label}\n\n\`\`\`json\n${text}\n\`\`\``
}

export function textBlock(label: string, value: string, maxChars = 6_000): string {
  const text = value.length > maxChars ? `${value.slice(0, maxChars)}…` : value
  return `## ${label}\n\n${text}`
}
