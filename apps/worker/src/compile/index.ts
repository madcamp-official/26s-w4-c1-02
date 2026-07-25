// @endpointer/worker · compile — LLM 이 호출되는 유일한 층 (원칙 ① · ADR A1)
//
//   gemini.ts       클라이언트 · 디스크 캐시 · 실패를 값으로 돌려주기
//   budget.ts       호출 카운터와 일일 상한 (15장 → 한도 초과는 상태이지 정지가 아니다)
//   compile-spec.ts 9-1② 최초 생성 · 9-3③ 재컴파일 (검증 실패 시 재생성 1회)
//   match-fields.ts 9-2② 두 번째 소스 필드 매핑
//   trace-value.ts  9-2 붙여넣은 값 역추적 — **LLM 없음. 보장선 B1 의 구현체**
//   prompts/        문장. 튜닝은 여기서만 일어난다

export { geminiStatus, generateJson, type GeminiOutcome, type GeminiFailureReason } from './gemini'
export {
  consumeBudget,
  peekBudget,
  budgetUsedToday,
  resetBudget,
  type BudgetScope,
  type BudgetVerdict,
} from './budget'
export {
  compileSpec,
  recompileSpec,
  type CompileInput,
  type CompileResult,
  type CompileAttempt,
} from './compile-spec'
export {
  matchFields,
  parseMatchOutput,
  DEFAULT_MIN_CONFIDENCE,
  type MatchInput,
  type MatchOutcome,
  type MatchResult,
  type FieldMatch,
} from './match-fields'
export {
  traceValue,
  traceInJson,
  traceInHtml,
  type TraceInput,
  type TraceHit,
  type MatchKind,
} from './trace-value'
