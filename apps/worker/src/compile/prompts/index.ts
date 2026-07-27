// 프롬프트 배럴 — 코드에서 문장을 분리해 둔 곳 (튜닝은 여기서만 일어난다)

export {
  COMPILE_SYSTEM,
  buildCompilePrompt,
  buildHealPrompt,
  type CompileCandidateBrief,
  type CompilePromptInput,
} from './compile-spec'

export {
  DISCOVER_SYSTEM,
  buildDiscoverPrompt,
  type DiscoverPromptInput,
} from './discover'

export {
  MATCH_SYSTEM,
  buildMatchPrompt,
  buildMatchResponseSchema,
  type MatchPromptInput,
} from './match-fields'

export {
  KOREAN_LIST_SITE_NOTES,
  PATH_SYNTAX,
  transformOpsSection,
  jsonBlock,
  textBlock,
} from './shared'
