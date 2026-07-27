# 뷰 계약 — 확정 (2026-07-27 저녁 · A·B 합의)

> ~~아직 계약이 아니다.~~ **확정됐다.** 열려 있던 결정은 §7 에 결과와 근거가 있다.
> 이 문서가 G0 계약 #6 이다 — 이제 여기를 고치는 것은 G0 계약을 고치는 것이므로 **양쪽이 같이 있을 때만.**
> 남은 것은 반영이다: `packages/core` 의 타입·zod·`viewToQuery`, 마이그레이션, ADR A33~A35 `accepted` 승격 (§6).

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
  slug: string           // 이름에서 자동 생성. REST ?view= / MCP 도구명에 쓰임 (규칙은 아래 ※)
  name: string           // 조건에서 자동 제안, 수정 가능
  where: ViewCondition[] // ★ 사용자가 정하는 유일한 필수 항목
  sort: { field: string; dir: 'asc' | 'desc' }[]   // 기본값: 컬렉션 기본
  columns: string[] | null                         // null = 컬렉션 기본
  notify: { on: 'enter'; channels: string[] } | null  // null = 알림 꺼짐 (기본)
  owner_id: string       // 개인 기본 (델타 9-4 — 팀 공유는 나중에 명시적으로)
  pinned: boolean        // 고정/일반 (델타 2-9)
  created_at: Date
  updated_at: Date
  // health 는 여기 없다 — **저장하지 않고 읽을 때 계산한다** (§7 결정 ③).
  // 응답(REST·화면)에는 계산된 health: ViewHealth 가 포함된다.
}
```

> ※ **slug 규칙** — MCP 도구명은 ASCII(`[a-zA-Z0-9_-]`) 제약이 있다. 한국어 이름("이번 달 마감")에서
> 라틴 문자를 못 건지면 `view-1` 순번으로 떨어지고 사용자가 고칠 수 있다. 한국어 이름은 도구 **설명**에 들어간다.

- **기본 표 = 조건 없는 뷰 #0** (델타 2-3). 저장하지 않고 런타임에 합성하는 쪽을 제안한다 —
  행이 실제로 있으면 삭제·이름변경 등 엣지가 생긴다. (반대 의견 있으면 여기서 결정)

## 2. 술어(op) 닫힌 집합 — 델타 2-7 그대로

| 필드 타입 | 허용 op | value 형태 |
|---|---|---|
| `date` | `within` | `'this_week' \| 'this_month'` (상대 표현만 — A34) |
| | `d_within` | `number` (D-n 이내, 예: 7) |
| | `before` / `after` | 상대 표현만 (**결정안 확정** — 아래 2-b) |
| | `is_null` | — (`상시` 취급. 마감 뷰에서는 **제외가 기본** — 델타 2-6③) |
| `number` / `money` | `gte` / `lte` / `between` / `is_null` | number / [number, number] |
| `enum` | `in` / `not_in` | string[] (정규화 키) |
| `text` | `contains` / `not_contains` | string |

### 2-b. 절대 날짜의 자리 (**확정** — §7 결정 ④)

**계층으로 가른다.** 저장된 뷰는 상대 표현만(A34 그대로), 임시 조회(REST 쿼리 파라미터 · 표 위 필터)는
절대 날짜 허용 — `?deadline_gte=2026-08-01` 은 지금처럼 그대로 산다.

**"이 조건 저장" 때 절대 날짜가 섞여 있으면** 시스템이 상대 표현으로 바꿔 **제안**하거나, 그 조건만 **빼고 저장**을 안내한다.
변환은 의미가 바뀌므로(고정 컷오프 → 움직이는 창) 해석을 그대로 보여준다 (델타 5-4 와 같은 원칙):

> "『8월 3일까지』는 저장하면 『오늘부터 7일 이내』(매일 달라져요)로 바뀌어요 — 아니면 이 조건은 빼고 저장할 수 있어요."

변환이 어색한 경우(먼 미래의 임의 날짜, 과거 기준 이후 조건 등)는 변환 제안 없이 "빼고 저장"만 안내한다.
근거: 절대 날짜가 박힌 뷰는 기준일이 지나면 영원히 0건이 되는데, 화면의 0건은 "해당 없음"과 구별되지 않는다 —
어떤 품질 신호에도 안 걸리는 조용한 실패다. 일회성 질문은 조회 계층이 이미 답한다.

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
                   PK (view_id, item_id)
                   -- **현재 매칭 집합과 동기화한다** (§7 결정 ①): enter = 추가, exit = 삭제.
                   -- 재진입하면 다시 enter 다. matched_at 은 "이번 진입" 시각이다.

notification_log   channel_key(text) · item_id · view_ids_json · sent_at
                   PK (channel_key, item_id, sent_at)
                   -- 결정 ①의 파급으로 dedupe(평생 1회)가 **발송 기록(사건당 1회)** 으로 바뀌었다.
                   -- 같은 전이 사건에서 항목이 뷰 3개에 걸리면 채널당 1건 + view_ids 로 "3개 뷰에 걸림".
                   -- 같은 (channel_key, item_id) 는 **24시간 안에 재발송하지 않는다** — 값이 경계에서
                   -- 흔들려 매 run 마다 나갔다 들어오는 항목이 스팸이 되는 것을 막는 안전판.
                   -- 부수 효과: 이 기록이 뷰 카드의 "최근 enter 2건 (어제)" 재료가 된다.
```

- `where_json` 안의 date 조건 값은 **상대 표현만 저장** (A34). 마이그레이션은 계약 확정 직후 A·B 중 먼저 한가한 쪽이.
- **뷰 평가 일일 잡의 기준 시각은 KST 자정 직후** (예: 00:05). `D-8 → D-7` 전이가 "언제" 일어나는지가
  계약이어야 알림 시각을 사용자에게 설명할 수 있다. 구현은 A 몫.

## 4. 출구별 계약

| 출구 | 계약 |
|---|---|
| REST | `GET /api/v1/{slug}?view={view-slug}` — 뷰 설정이 기본값, 쿼리 파라미터가 덮어쓴다 |
| MCP | **뷰마다 도구 하나** — 도구명 = 뷰 slug, 설명 = 뷰 이름+조건 요약 (델타 2-4) |
| 알림 | `enter` 만. 페이로드에 `view: {slug, name}` 포함. dedupe 는 채널 단위 |
| 표 | 뷰 선택 = 저장된 필터·정렬·컬럼 적용. 편집은 표 위에서 (델타 2-10) |

## 4-b. `notify.channels` 의 실체 (A 질문에 대한 답)

`channels: string[]` 는 **배달 채널 개체의 id 목록**이다. 그 개체의 전신이 지금 DB 의 `subscriptions` 행이다 —
다만 뷰 도입으로 subscriptions 의 의미가 쪼개진다:

| 지금 subscriptions 한 행 | 뷰 이후 |
|---|---|
| 조건 (`filter_json`) | → 뷰의 `where` 로 이동 (은퇴) |
| 목적지 (`channel`: webhook/email + `target`: URL/주소) | → **이게 "채널"의 실체** |
| 스케줄 (`schedule`) | → 채널 종류별 정책 (메일 하루 1회 묶음 · 웹훅 건별 — 델타 2-9) |

**확정: ① 승계** (§7 결정 ②) — subscriptions 를 채널 저장소로 재해석. `notify.channels = [subscriptions.id]`.
마이그레이션 없음, 기존 구독 행·화면 그대로 승계. 테이블명과 실체가 어긋나는 건 주석으로 방어.
(② 신설안은 이관 비용 때문에 기각 — 5일 일정. 팀 기능(O11)이 시작되면 그때 다시 본다)

부수 확정: `notification_log.channel_key` 는 채널 id 가 아니라 **`kind + 정규화된 target` 의 해시** —
같은 슬랙 URL 이 두 행으로 등록돼도 사건당 1회가 보장되게 (채널 단위 dedupe 의 취지).

## 5. ~~같이 정할 것~~ → 전부 결정됨 (§7)

| # | 질문 | **결정** |
|---|---|---|
| O9 | 온보딩·발표에서 누굴 앞에 세우나 | **비개발자.** MCP 는 마지막 각주 |
| O10 | `schema_version` 의미 | **경고만** (O6 연장) · 뷰 참조 필드 소실 → 그 뷰만 `broken` + 알림 중단 |
| 신규 | 뷰 #0 을 행으로 저장하나 | **저장 안 함** (런타임 합성) |
| 신규 | 절대 날짜 | **2-b 그대로** — 저장은 상대만 · 조회는 절대 허용 · 저장 시 변환 제안/빼기 안내 |
| 신규 | 컬렉션당 뷰 상한 | **20 — 서버가 거부한다** (화면 안내만으론 API 로 우회된다). 문구는 사람 말로 (B2) |

## 6. 확정 후 순서

1. core: `types/view.ts` + 술어 zod + `viewToQuery` (+ 테스트) — **공유 지대이므로 이 커밋은 두 트랙 모두 확인**
2. 마이그레이션 3테이블 → `pnpm db:generate`
3. A: enter 차집합 + 뷰 평가 일일 잡 / B: "이 조건 저장" UI + 작업실 탭 — 병렬 시작
4. ADR 갱신: A33·A35 `proposed → accepted` · A34 에 재진입 의미(§7 ①) 반영 · A36 의 "채널 단위 1회"를
   "**사건당** 채널 단위 1회 + 24시간 안전판"으로 정정

## 7. 결정 기록 (2026-07-27 저녁 · A·B 합의)

| # | 질문 | 결정 | 기각된 쪽과 이유 |
|---|---|---|---|
| ① | 재진입 알림 | **재진입 시 재알림.** `view_matches` 는 현재 매칭 집합과 동기화(나가면 삭제) | "평생 1회"안 기각 — 마감 연기로 조건에 다시 들어온 항목을 놓친다. 이 선택이 사실상 `change` 이벤트의 절반을 공짜로 준다 |
| ② | 채널의 실체 | **subscriptions 승계.** `channels = [subscriptions.id]` · 조건(`filter_json`)은 뷰로 은퇴 · 스케줄은 채널 종류별 정책으로 | 신설안 기각 — 5일 일정에 이관 비용. 팀 기능(O11) 때 재론 |
| ③ | 뷰 건강 저장 | **읽을 때 계산.** views 테이블에 health 컬럼 없음 | 컬럼안 기각 — 갱신 시점 목록을 다 정해야 하고 하나 빠지면 썩은 값이 화면에 남는다. 판정 재료(스키마 필드 + 소스별 필드 유무)가 싸서 계산으로 충분 |
| ④ | 절대 날짜 | **계층으로 가른다** (2-b) — 저장은 상대만 · 조회는 절대 허용 · 저장 시 변환 제안/빼기 안내 | 전면 거부안 기각 — 표의 날짜 필터 → "이 조건 저장" 흐름(델타 2-10)이 끊긴다 |

**결정 ①의 파급** — 초안의 `notification_dedupe`(PK 로 평생 1회 강제)는 재알림과 양립하지 않는다.
`notification_log` 로 바꿨다 (§3): dedupe 단위는 "같은 전이 사건", 안전판은 24시간, 기록은 뷰 카드 재료로 재사용.
