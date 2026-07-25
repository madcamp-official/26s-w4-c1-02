// 컬렉션 쿼리 — 기획서 12장 REST 계약의 단일 출처
//
// web 의 `GET /api/v1/{slug}` 와 mcp 의 `list_items` 가 **같은 코드**를 쓴다.
// 두 표면이 파라미터 표를 따로 구현하면 반드시 갈라지고, 갈라지는 순간
// "내 API 하나" 라는 제품 약속이 거짓말이 된다.
//
//   parseCollectionQuery   URLSearchParams → CollectionQuery + 경고 (throw 하지 않는다)
//   planItemsQuery         CollectionQuery → where / orderBy / 커서
//   buildCollectionResponse  → G0 계약 (2) 응답. sources 는 언제나 포함된다

export * from './params'
export * from './build'
export * from './respond'
