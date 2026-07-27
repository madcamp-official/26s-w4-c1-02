# 뷰 계약 초안 — Day 3 아침 공동 결정용

> **아직 계약이 아니다.** 트랙 B 가 델타(2절·13-2)를 코드 모양으로 옮겨 둔 제안이다.
> 30분 안에 훑고 · 고치고 · 확정하는 것이 목적. 확정되면 `packages/core` 에 반영하고
> ADR A33~A35 를 `proposed` → `accepted` 로 올리며, G0 계약 #6 이 된다.

## 1. 타입 (packages/core/src/types/view.ts 로 제안)

```ts
/** 뷰 건강 (델타 2-8). 값 키는 내부용 — 화면은 사람 문장으로 옮긴다 (B2) */
export const VIEW_HEALTH = ['ok', 'warn', 'broken'] as const
export type ViewHealth = (typeof VIEW_HEALTH)[number]

/** 알림 전이 (델타 2-5). v1 은 enter 만 — 나머지 값은 지금 정의하되 구현하지 않는다 */
export const VIEW_EVENTS = ['enter'] as const

export interface ViewCondition {
  field: string          // 스키마 필드 키 (화이트리스트 — 스키마 밖 키는 파싱 거부)
  op: ViewOp             // 아래 닫힌 집합
  value: unknown         // op 별 스키마로 zod 검증
}

export interface View {
  id: string
  collection_id: string
  slug: string           // 이름에서 자동 생성. REST ?view= / MCP 도구명에 쓰임
  name: string           // 조건에서 자동 제안, 수정 가능
  where: ViewCondition[] // ★ 사용자가 정하는 유일한 필수 항목
  sort: { field: string; dir: 'asc' | 'desc' }[]   // 기본값: 컬렉션 기본
  columns: string[] | null                         // null = 컬렉션 기본
  notify: { on: 'enter'; channels: string[] } | null  // null = 알림 꺼짐 (기본)
  owner_id: string       // 개인 기본 (델타 9-4 — 팀 공유는 나중에 명시적으로)
  health: ViewHealth     // 시스템이 계산
  pinned: boolean        // 고정/일반 (델타 2-9)
  created_at: Date
  updated_at: Date
}
```

- **기본 표 = 조건 없는 뷰 #0** (델타 2-3). 저장하지 않고 런타임에 합성하는 쪽을 제안한다 —
  행이 실제로 있으면 삭제·이름변경 등 엣지가 생긴다. (반대 의견 있으면 여기서 결정)

## 2. 술어(op) 닫힌 집합 — 델타 2-7 그대로

| 필드 타입 | 허용 op | value 형태 |
|---|---|---|
| `date` | `within` | `'this_week' \| 'this_month'` (상대 표현만 — A34) |
| | `d_within` | `number` (D-n 이내, 예: 7) |
| | `before` / `after` | `'today'` 기준 상대만? **→ 결정: 절대 날짜 허용 여부** (권장: 거부 — 뷰가 한 달 뒤 죽는다) |
| | `is_null` | — (`상시` 취급. 마감 뷰에서는 **제외가 기본** — 델타 2-6③) |
| `number` / `money` | `gte` / `lte` / `between` / `is_null` | number / [number, number] |
| `enum` | `in` / `not_in` | string[] (정규화 키) |
| `text` | `contains` / `not_contains` | string |

- 자유 표현식·SQL 조각·`op:"custom"` 없음 (A35). 목록 밖 op 는 **파싱 단계에서 거부** (변환 연산자와 동일 규율).
- 평가 위치: `packages/core/src/query` 에 `viewToQuery(view): CollectionQuery` 하나 —
  네 출구(표·알림·REST·MCP)가 전부 이 함수를 탄다. 워커의 enter 판정도 같은 함수로 매칭 집합을 만든다.

## 3. 테이블 (13-2)

```sql
views              id · collection_id(fk cascade) · slug · name · where_json · sort_json
                   · columns_json · notify_json · owner_id(fk) · health · pinned
                   · created_at · updated_at
                   UNIQUE (collection_id, slug)

view_matches       view_id(fk cascade) · item_id(fk cascade) · matched_at
                   PK (view_id, item_id)          -- enter = run 후 차집합

notification_dedupe  channel_key(text) · item_id · sent_at
                     PK (channel_key, item_id)    -- 채널 단위 1회 (A36)
```

- `where_json` 안의 date 조건 값은 **상대 표현만 저장** (A34). 마이그레이션은 계약 확정 직후 A·B 중 먼저 한가한 쪽이.

## 4. 출구별 계약

| 출구 | 계약 |
|---|---|
| REST | `GET /api/v1/{slug}?view={view-slug}` — 뷰 설정이 기본값, 쿼리 파라미터가 덮어쓴다 |
| MCP | **뷰마다 도구 하나** — 도구명 = 뷰 slug, 설명 = 뷰 이름+조건 요약 (델타 2-4) |
| 알림 | `enter` 만. 페이로드에 `view: {slug, name}` 포함. dedupe 는 채널 단위 |
| 표 | 뷰 선택 = 저장된 필터·정렬·컬럼 적용. 편집은 표 위에서 (델타 2-10) |

## 5. 같이 정할 것 (열린 결정)

| # | 질문 | B 의 권장 |
|---|---|---|
| O9 | 온보딩·발표에서 누굴 앞에 세우나 | **비개발자** — 강점이 정의권이면. MCP 는 마지막 각주 |
| O10 | `schema_version` 의미 | 경고만 (O6 연장) · 뷰 참조 필드 소실 → 그 뷰만 `broken` + 알림 중단 |
| 신규 | 뷰 #0 을 행으로 저장하나 | **저장 안 함** (런타임 합성) |
| 신규 | `before`/`after` 에 절대 날짜 | **거부** (상대 표현만) |
| 신규 | 컬렉션당 뷰 상한 | 20 (델타 2-9 — 성능이 아니라 신호) |

## 6. 확정 후 순서

1. core: `types/view.ts` + 술어 zod + `viewToQuery` (+ 테스트) — **공유 지대이므로 이 커밋은 두 트랙 모두 확인**
2. 마이그레이션 3테이블 → `pnpm db:generate`
3. A: enter 차집합 + 뷰 평가 일일 잡 / B: "이 조건 저장" UI + 작업실 탭 — 병렬 시작
