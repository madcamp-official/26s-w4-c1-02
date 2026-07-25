// @endpointer/core 루트 배럴
// 세 앱(web · worker · mcp)이 공유하는 계약. 빌드 없이 소스 그대로 소비된다.
//
// 하위 진입점:
//   @endpointer/core/db        DB 클라이언트 + Drizzle 스키마
//   @endpointer/core/spec      어댑터 스펙 해석기
//   @endpointer/core/normalize 정규화 파서
//   @endpointer/core/validate  검증기

export * from './types'
export * from './spec/spec'
export * from './spec/ops'
