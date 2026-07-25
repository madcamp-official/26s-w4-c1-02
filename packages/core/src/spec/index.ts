// @endpointer/core/spec — 어댑터 스펙 계약 · 해석기 · 검증기
//
// 세 곳이 이 진입점 하나를 본다:
//   apps/worker  정기 수집 — fetch 한 payload 를 interpretSpec 에 넣는다
//   apps/web     미리보기 — 같은 interpretSpec 을 쓴다. 그래서 미리보기가 거짓말하지 않는다
//   컴파일·치유  buildAdapterSpecResponseSchema 로 스키마를 만들고 parseGeminiSpecOutput 으로 받는다
//
// 층위:
//   spec.ts / ops.ts   무엇이 유효한 스펙인가 (계약 · 다른 곳에서 소유)
//   paths.ts           경로를 값으로
//   transform.ts       연산자 닫힌 집합의 실행
//   interpret.ts       스펙 + payload → 아이템 배열 + 필드 통계
//   validate.ts        실행 전 계약 검사 (SSRF 방어 포함)
//   json-schema.ts     Gemini responseSchema 생성과 되돌아오는 검증

export * from './spec'
export * from './ops'
export * from './paths'
export * from './transform'
export * from './interpret'
export * from './validate'
export * from './json-schema'
