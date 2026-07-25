// core 쿼리 모듈로 가는 다리 — **임시**. 상대 경로를 이 파일 한 곳에만 가둬 둔다.
//
// 왜 있나:
//   `packages/core/src/query` 는 web 의 `GET /api/v1/{slug}` 와 여기 `list_items` 가
//   공유하는 단일 출처다. 두 표면이 파라미터 표를 따로 구현하면 반드시 갈라지므로
//   MCP 는 반드시 이걸 써야 한다.
//   그런데 `packages/core/package.json` 의 exports 에 아직 `"./query"` 진입점이 없어서
//   `@endpointer/core/query` 로 들어갈 수 없다. core 의 package.json 은 이 조각의
//   소유가 아니라 고칠 수 없다.
//
// 안전한가:
//   `apps/mcp/node_modules/@endpointer/core` 는 `packages/core` 로 가는 심링크이고
//   Node 는 심링크를 실경로로 풀어서 모듈을 캐싱한다. 즉 이 경로로 들어가도
//   `@endpointer/core/db` 로 들어간 것과 **같은 모듈 인스턴스**다 — DB 커넥션 풀이
//   두 벌로 갈라지지 않는다.
//
// TODO(G1): `packages/core/package.json` 의 exports 에
//     "./query": "./src/query/index.ts"
//   를 추가하고, 아래 한 줄을 `export * from '@endpointer/core/query'` 로 바꾼 뒤
//   이 파일을 지워도 되게 만들어라. 그 전까지는 다른 파일에서 절대 상대 경로를 쓰지 마라.

export * from '../../../packages/core/src/query/index'
