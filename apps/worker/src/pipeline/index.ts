// @endpointer/worker · pipeline — 기획서 9-1 "컬렉션 생성 흐름" 의 배선
//
//   create-collection.ts  URL → 이미 채워진 표. **DB 를 모른다** (미리보기가 같은 코드를 쓴다)
//   persist.ts            그 표를 DB 에 앉힌다. 실패하면 아무것도 남기지 않는다
//
// 이 두 파일이 갈라져 있는 이유가 곧 보장선 B3 이다 — 사용자는 표를 **먼저 보고**
// 그 다음에 저장한다. 만들면서 저장하면 마음에 안 드는 표가 그대로 남는다.

export {
  createCollectionFromUrl,
  collectionNameFrom,
  normalizeUrl,
  slugFrom,
  type CreateCollectionInput,
  type CreateCollectionOutcome,
  type CreatePreviewTrace,
} from './create-collection'

export {
  persistNewCollection,
  uniqueSlug,
  type PersistInput,
  type PersistResult,
} from './persist'
