// @endpointer/worker · pipeline — 기획서 9-1 "컬렉션 생성 흐름" 의 배선
//
//   create-collection.ts  URL → 이미 채워진 표. **DB 를 모른다** (미리보기가 같은 코드를 쓴다)
//   attach-source.ts      두 번째 URL → 같은 표에 합류 (9-2 · 기능 ②). 역시 DB 를 모른다
//   repair-empty.ts       항상 비는 칸을 만들어 내지 않게 (보장선 B3)
//   persist.ts            그 표를 DB 에 앉힌다. 실패하면 아무것도 남기지 않는다
//
// 만드는 쪽과 저장하는 쪽이 갈라져 있는 이유가 곧 보장선 B3 이다 — 사용자는 표를 **먼저 보고**
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
  attachSourceToCollection,
  resolveByPastedValue,
  type AttachSourceInput,
  type AttachSourceOutcome,
  type AttachedField,
  type ResolveInput,
  type ResolveOutcome,
} from './attach-source'

export {
  planRepair,
  applyTransformDrop,
  dropColumns,
  repairNotes,
  hasWork,
  type RepairPlan,
  type DropColumnsResult,
} from './repair-empty'

export {
  persistNewCollection,
  persistAttachedSource,
  uniqueSlug,
  type PersistInput,
  type PersistResult,
  type AttachPersistInput,
  type AttachPersistResult,
} from './persist'

export { cloneCollection, type CloneInput, type CloneOutcome } from './clone'
