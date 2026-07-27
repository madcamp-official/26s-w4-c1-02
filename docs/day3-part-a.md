# Day 3 — 트랙 A 인수인계 (day2 이후의 델타)

> 2026-07-27 심야 기준. **[day2-part-a.md](./day2-part-a.md) 를 먼저 읽어라** — 코드 지도(§3)·반복 판단(§4)·지뢰(§5)는
> 거기 있는 그대로 유효하고, 이 문서는 그 이후 **바뀐 것만** 적는다.
> day2 를 읽었다면 이 문서만으로 오늘 밤의 상태를 따라잡을 수 있다.

## 0. 30초 요약 — 지금 어디에 서 있나

- **G2 의 A 몫이 닫혔다.** 마지막 조각이던 분류값 매핑까지 실측 통과 (§2-7). 남은 G2 는 B 의 화면 붙이기 흐름과 `[Δ]` 둘뿐.
- **뷰가 계약에서 실체가 됐다.** [view-contract-draft.md](./view-contract-draft.md) 4개 쟁점을 결정하고
  core(타입·질의·DB 0001)와 worker(평가·알림·침묵)를 전부 구현했다. MCP 에 뷰별 도구(`closing-soon`)가 실제로 떠 있다.
- **자가 치유가 실전에서 완주했다.** 깨뜨림→감지→격리→재컴파일→승격이 진짜 사이트(wevity)로 한 바퀴 돌았고,
  그 `healed` 런이 B 의 화면에 "이번 달 자동 복구 1회"로 보인다. 치유 **실패**도 이제 runs 에 남는다.
- **첫 합류가 끝났다.** main = B = pipeline 이 같은 지점에서 만났고, 충돌 0 · 테스트 전부 통과.
- 테스트 **918개** (core 707 · web 58 · worker 153). day2 시점 809개에서 +109.

## 1. 브랜치 지형 (day2 §2 갱신)

```
main      ── 합류 지점. B 도 여기서 시작한다
pipeline  ── 트랙 A 작업 브랜치 (main 보다 앞설 수 있다 — 여기에 커밋해라)
origin/B  ── 트랙 B 작업 브랜치
integration · backup-before-rebase ── 죽은 브랜치. 체크아웃하지 마라 (내용이 한참 뒤다)
```

07-27 합류에서 확인된 사실: `git log origin/B..main` 이 비면 합류는 fast-forward 다.
합류 전 의식은 하나 — **로컬에서 시험 합류 → `pnpm typecheck` + `pnpm test` → 밀기.**

## 2. day2 §7 "다음에 할 일"이 어떻게 됐나

day2 §7 의 번호를 그대로 쓴다. 이어서 일할 사람은 이 표부터 보면 된다.

| day2 § | 무엇 | 결과 |
|---|---|---|
| 7-1 | 화면을 파이프라인에 연결 | ✅ B 가 생성 흐름을 붙였고, A 는 **attach 를 HTTP 문으로** 열었다 (§2-1) |
| 7-2 | 같은 소스 두 번 수집 → 신규 0 | ✅ 실증. 흔들리는 키는 `stabilize-keys` 가 잡는다 (§2-2) |
| 7-3 | `normalizeIdentity` 수리 | ✅ 치유 승격 관문이 다시 작동한다 (§2-3) |
| 7-4 | enum 매핑 | ✅ 오늘 마감 (§2-7) |
| 7-5 | ISO 8601 시각 소실 | ⬜ **그대로 남았다** — §4 에 다시 적었다 |
| 7-6 | 치유 실패 기록 · budget Redis · 접합 페이지네이션 · 머리글 행 | ✅ 전부 (§2-4~6, §2-8) |
| 7-7 | 배포 | ⬜ **프로덕션은 아직 Day 2 저녁 코드다** — 뷰도 마이그레이션 0001 도 없다 (§4) |

### 2-1. attach 가 HTTP 문이 됐다 — B 와의 새 계약

`apps/worker/src/http/index.ts` 에 두 경로가 늘었다 (기존 `/internal/preview`·`/internal/collections` 옆):

```
POST /internal/attach    두 번째 주소 → 기존 표에 맞춰본 결과 (저장 안 함, 미리보기)
POST /internal/sources   같은 것 + 소스로 앉히기
```

응답 타입은 같은 파일이 export 한다: `AttachPreviewResponse` · `AttachSaveResponse` · `PasteReport`.
클라이언트는 **값만** 보낸다 (`pasted: {key: value}`, 최대 12개) — 셀렉터를 받는 문은 없다 (B1).
B 의 화면 "사이트 붙이기" 흐름(G2 마지막 체크박스)은 이 두 문을 부르면 된다.

### 2-2. external_key 안정화 — "행들이 답이다"의 두 번째 적용

`apps/worker/src/fetchers/stabilize-keys.ts` (신규). dedupe_key 가 URL 인데 세션·페이지 파라미터가
붙어 흔들리면 매 수집이 전량 신규가 된다. 여러 행의 URL 을 모아 **값이 행마다 다른 파라미터(=신원)만 남기고**
정리한다 (`IDENTITY_RATIO = 0.7` · 3행 미만이면 판단 안 함). 제목이 다른 두 항목이 같은 키로 접히면
전체를 되돌리는 안전판이 있다. `runAdapter` 페이지 루프 뒤에 자동으로 돈다 — 호출부가 신경 쓸 것 없다.

### 2-3. 치유 승격 관문 수리 (core `validate/overlap.ts` — B 통보됨)

`normalizeIdentity(raw, keepParams?)` 로 시그니처가 바뀌었다. 신원 파라미터 집합은 **두 목록을 합쳐 한 번만**
결정한다 (`combinedIdentityParams`) — 따로 결정하면 같은 URL 이 다른 모양으로 정규화돼 겹침이 0 이 된다.
이게 고장 나 있어서 day2 까지의 치유 승격 판정은 사실상 눈감고 통과시키고 있었다.

### 2-4. 자가 치유 실전 완주 + 실패 기록

- **`healSchema`**: 재컴파일에 컬렉션 스키마 전체가 아니라 **이전 스펙이 알던 필드만** 준다
  (`jobs/heal.ts`). 전체를 주면 LLM 이 "물어볼 칸"으로 남겨둔 필드의 경로를 지어내고,
  전부 null → 검증 탈락 → `still_broken` 무한 반복. 실제로 밟은 뒤 고쳤다.
- **`giveUp()`**: 치유 포기도 이제 runs 에 남는다. 늦은 실패(`still_broken`·`wrong_list`)는 `drift`,
  이른 실패는 `failed`. 조용한 포기가 없어졌다 — 기능 ④는 "로그로 쌓아 보여주는 것"까지가 기능이다.
- **G5 데모 대본이 [`cli/heal.ts`](../apps/worker/src/cli/heal.ts) 머리주석에 있다.** 깨뜨림→치유→복구 확인 순서 그대로.

### 2-5. budget 이 Redis 로 갔다

`compile/budget.ts`. 키는 `endpointer:budget:{scope}:{KST날짜}`, TTL 2일, INCR 먼저.
Redis 가 죽으면 메모리로 강등해서 **LLM 호출을 막지는 않는다** (예산이 죽어서 제품이 죽으면 주객전도).
네 함수 전부 `async` 가 됐다 — 호출부를 고칠 일이 있으면 await 를 빼먹지 마라.

### 2-6. 접합 소스도 여러 페이지를 읽는다

`pipeline/infer-pagination.ts` (신규). 링크가 답이다 — 페이지 HTML 에서 같은 host+path 로 가는
정수 파라미터 링크를 모아 후보를 뽑고, **2페이지를 실제로 가져와 항목이 늘어나는지** 확인한 것만 스펙에 앉힌다.
여기서 회귀를 하나 밟았다: ③-b 재시도가 `maxPages: 1` 을 하드코딩해 "46개를 가져왔어요"라고 말하고
16개만 앉혔다. **"말한 것과 저장한 것이 같아야 한다"(day2 §4-5)의 세 번째 사례** — 페이지네이션이
없는 스펙일 때만 1페이지로 제한하게 고쳤다 (`attach-source.ts`).

### 2-7. 분류값 매핑 (G2 마지막 조각 · 07-27 심야)

기획서 5장③. 부품(`FieldDef.mapping`·`value_labels`·`parseEnum`)은 원래 있었고 **만들어주는 쪽**이 없었다.

```bash
pnpm --filter @endpointer/worker map-enums bizinfo           # 제안만 출력 (확인 단계)
pnpm --filter @endpointer/worker map-enums bizinfo --apply   # 스키마에 앉히고 기존 항목 재정규화
```

- `compile/map-enum-values.ts` + `prompts/map-enums.ts`: 소스별 관찰값(items 실측)을 LLM 에 주고
  `{키, 표시 이름, 원값들}` 그룹 제안을 받는다. **파서가 관문** — 지어낸 원값 제거 · snake_case 키 강제 ·
  중복 원값 첫 그룹 승리. 살아남은 게 없으면 null (빈 제안을 성공으로 치지 않는다).
- `--apply` 는 두 가지를 같이 한다: schema_json 반영 + **기존 항목 재정규화**. 재정규화가 절반이다 —
  스키마만 고치면 새 수집분은 `export_global` 인데 기존 행은 `수출` 로 남아 필터가 두 갈래로 갈라진다.
  `content_hash` 도 같이 다시 쓴다 — 안 그러면 다음 수집이 전량을 "변경"으로 오판한다.
- 이미 매핑된 값은 다음 제안에서 빠진다 — 새 원값이 나타나면 **그것만 증분 제안**된다.
  실제로 적용 직후 수집에서 `행사ㆍ네트워크` 가 새로 나타났고, 재실행 한 번으로 증분 1종이 그대로 앉았다.

판정 실측: 16개 원값 → 12종. 적용 후 수집 재실행 **변경 0** = 정기 수집이 LLM 없이 매핑 테이블만으로
같은 값을 낸다 (원칙 ①). 화면은 B 가 미리 파둔 `value_labels` 자리로 분류 필터·한국어 표시가 자동으로 켜졌다.

### 2-8. 신원 없는 행 방어선 (core `spec/interpret.ts` — B 통보됨)

day2 §7-6 "목록 머리글 행 걸러내기"의 답. probe 가 아니라 **항목이 태어나는 곳**(interpretSpec)을 막았다:
external_key 가 `row_hash` 로 떨어졌고(=dedupe_key·title 없음) 스펙에 link 필드가 있는데 전부 비면
항목으로 앉히지 않는다. link 필드가 없는 스키마는 판별 근거가 없으므로 기존대로 앉힌다.
버린 행은 경고로 남고(B4), fieldStats 에도 안 센다 (null 비율이 부풀면 드리프트 검증기가 오판한다).
기존 DB 의 잔재 1건(`주최사` 행)은 일회성 SQL 로 지웠다 — **삭제 코드는 만들지 않았다** (델타 10절).

## 3. 뷰 — 이번 델타에서 가장 큰 덩어리

[view-contract-draft.md](./view-contract-draft.md) 가 **확정 계약(G0 #6)** 이 됐다. 결정 4개와 기각 대안은
그 문서 §7 결정 기록에 있다. 요지: 재진입은 재알림 · 채널은 subscriptions 재사용 · 건강은 읽을 때 계산 ·
날짜 조건은 상대 표현만 저장.

| 층 | 파일 | 내용 |
|---|---|---|
| core 타입 | `types/view.ts` | 술어 zod 닫힌 집합 (`VIEW_OPS_BY_FIELD_TYPE`) · `validateViewDefinition` · `suggestViewSlug` |
| core 질의 | `query/view.ts` | **`viewToQuery` — 네 출구(표·REST·MCP·알림)의 단일 진입.** KST 상대날짜 해석기 포함 |
| DB | `db/schema.ts` + 마이그레이션 `0001` | `views` · `view_matches`(현재 매칭 집합) · `notification_log`(24시간 재발송 안전판) |
| worker 평가 | `jobs/evaluate-views.ts` | 매칭 집합 차집합으로 enter/exit. **수집 후 + KST 00:05 마다** 돈다 (시간이 만드는 전이 · 델타 2-6) |
| worker 알림 | 같은 파일 + `jobs/channel-key.ts` | enter → 채널별 dedupe → `notification_log` 기록 **후** 발송 큐 |
| worker 침묵 | `jobs/silence.ts` | 14일 조용하면 상태 줄에 관찰만 말한다 (진단 금지 · A37) |
| 판정 도구 | `cli/views.ts` (`--demo`) | 뷰 평가·알림을 손으로 돌려본다 |

**주의 — 아직 안 배선된 출구가 하나 있다:** REST `?view=slug` (§4 참조). MCP·표·알림은 돈다.

## 4. 다음에 할 일 — 순서와 이유

### 4-1. REST `?view=` 배선 (계약 §4 의 구멍) 🔴

`GET /api/v1/bizinfo?view=closing-soon` 이 지금 `"모르는 조건이라 무시했습니다: view"` 를 낸다.
고칠 파일은 `apps/web/app/api/v1/[collection]/route.ts` (**B 디렉터리**) — slug 로 `views` 를 찾아
`viewToQuery(view, new Date())` 를 기존 쿼리에 병합하면 끝. 함수는 `@endpointer/core/query` 에 이미 있다.
**A 혼자 하지 말고 B 와 합의하고 진행해라** (트랙 경계).

### 4-2. 스케줄 발화 확인 (기다림이 필요한 판정) 🔴

코드는 다 있는데 **시간이 지나야 확인되는 것 둘**: 정기 수집이 아침에 실제로 돌았나 ·
KST 00:05 뷰 평가가 실제로 돌았나. `runs` 와 `notification_log` 의 타임스탬프로 판정한다.
자정 직후와 아침에 한 번씩 봐라.

### 4-3. 프로덕션 재배포 🔴

프로덕션은 Day 2 저녁 코드다. 뷰 계약 전이라 **마이그레이션 0001 이 안 올라가 있다** —
재배포 순서: `pnpm db:migrate` 먼저, 그 다음 앱. 순서를 바꾸면 새 코드가 없는 테이블을 찾는다.

### 4-4. ISO 8601 시각 소실 (day2 §7-5 그대로) 🟡

`parseDate('2026-08-14T18:00:00Z')` → `'2026-08-14'` 로 시각이 죽는다. `18:00Z` 는 KST 익일 03:00 이라
마감일이 하루 어긋난다. probe 1·2순위가 인라인 JSON·네트워크 관찰이라 ISO 가 가장 흔한 입력이다.
core `normalize/date.ts` 수정 → **B 통보 대상.**

### 4-5. 남은 미검증 후보 (day2 §8 에서 이월) ⚠️

day2 §8 표에서 ✅ 셋(startRun 유령 런 · number 합산 · CLOSED_KEYWORDS)을 뺀 나머지가 그대로 남아 있다:
browser 모드 404 → "성공·0건" · inline-json 의 Nuxt/SvelteKit 누락 · heal json 네트워크 관찰 꺼짐 ·
seed `raw_json` 형태 차이 · auth JWT 폴백(B) · `apps/mcp` 테스트 0개(B) · DNS 리바인딩(undici ADR 먼저).
**손대기 전에 재현부터** — day1·day2 의 같은 감사에서 나온 주장은 전부 진짜였다.

### 4-6. 사라진 항목 (`gone`) — v1 에서는 하지 않기로 한 것

델타 2-5 가 `gone` 이벤트를 v1 에서 뺐고, 우리는 머리글 행 문제를 방어선(§2-8)으로 풀었다.
**실제 내려간 공고**는 여전히 표에 남는다 — `last_seen_at` 이 오래된 항목이 그것이다.
데모에서 지적받으면 "시간축 데이터는 버리지 않는다(델타 10절), 표시는 v1 이후" 라고 답하면 된다.

## 5. 새로 밟은 지뢰 (day2 §5 에 추가할 것들)

| 증상 | 진짜 원인 | 방어 |
|---|---|---|
| worker 테스트가 `Cannot find package 'zod'` | worker 는 zod 를 **직접 의존하지 않는다** (core 만) | worker 의 LLM 출력 검증은 손 파서로 (match-fields·map-enum-values 선례) |
| 치유가 `still_broken` 무한 반복 | 재컴파일에 전체 스키마를 줘서 LLM 이 없는 필드 경로를 지어냄 | `healSchema` — 이전 스펙이 알던 필드만 (§2-4) |
| 접합 결과 "N개 가져옴" ≠ 앉힌 개수 | 재시도가 `maxPages: 1` 하드코딩 | 말한 것과 저장한 것 대조를 판정에 포함 (§2-6) |
| Gemini 400 INVALID_ARGUMENT | `maxItems` 가 **anyOf 항목 배열**에 붙으면 스키마 전체 거부 | day1 에 이어 **세 번째 발견** (`fieldSpecSchema`·`columnProps`). responseSchema 에 maxItems 금지, 상한은 파서가 |
| `FieldValidation` 에 `total` 필드 기대 | 형태는 `null_ratio`·`type_fail_ratio`·`samples` 뿐 | 통계 단언은 비율로 써라 |
| 매핑 적용 후 다음 수집이 전량 "변경" | data_json 만 고치고 `content_hash` 를 안 고침 | 값과 지문은 **한 트랜잭션의 한 몸** (§2-7) |

## 6. 트랙 경계 — 이번 델타에서 B 에게 통보한 core 변경

전부 커밋 메시지와 대화로 통보됐다. 새 세션이 "이거 왜 바뀌었지" 할 때 여기를 봐라.

| 무엇 | 어디 | 방향 |
|---|---|---|
| 뷰 계약 전체 (타입·질의·DB 0001) | `types/view.ts` · `query/view.ts` · `db/schema.ts` | 신규 — **배포 전 `pnpm db:migrate` 필수** |
| 술어 5개 추가 (`in`·`not_in`·`contains`·`not_contains`·`is_null`) | `types/api.ts` · `query/build.ts` | URL 파라미터로는 안 받는다. `viewToQuery` 만 채운다 |
| `"./query"` export 추가 | `package.json` | day1 §5-5 의 문서만 되고 안 고쳐졌던 결함 |
| `normalizeIdentity(raw, keepParams?)` | `validate/overlap.ts` | 시그니처 변경 (§2-3) |
| transform 배열 `maxItems` 제거 ×2 | `spec/json-schema.ts` | **다시 넣지 마라** — Gemini 400 |
| 마감 키워드에 임박·예정·곧 예외 | `normalize/date.ts` | '마감임박' 이 "마감됨"으로 죽던 것 |
| 연도·회차 수사 사전 제거 | `normalize/number.ts` | `제2회 1억원` → 3억 사건 |
| 신원 없는 행 방어선 | `spec/interpret.ts` | 경고 한 줄이 늘 수 있다. API·타입 변화 없음 (§2-8) |

**B 쪽에서 알아둘 것 하나:** 침묵 임계값이 두 곳에 있다 — `apps/web/lib/silence.ts:12` 와
`apps/worker/src/jobs/silence.ts:16` 둘 다 `QUIET_THRESHOLD_DAYS = 14`. 바꿀 땐 같이 바꿔라.

## 7. 검증 명령 (day2 §10 갱신분)

```bash
pnpm typecheck && pnpm test        # 918개: core 707 · web 58 · worker 153
```

```bash
pnpm --filter @endpointer/worker collect bizinfo            # 두 번째 실행에서 "신규 0" 이어야 한다 (G3 판정)
pnpm --filter @endpointer/worker views bizinfo --demo       # 뷰 평가·알림 손으로 돌리기
pnpm --filter @endpointer/worker heal --help                # G5 데모 대본은 파일 머리주석
pnpm --filter @endpointer/worker map-enums bizinfo          # 분류 매핑 제안 (--apply 로 앉힘)
```

REST 출구 확인:

```bash
curl "http://localhost:3000/api/v1/bizinfo?category=export_global&limit=3"   # enum 키 필터
curl "http://localhost:3000/api/v1/bizinfo?view=closing-soon"                # 지금은 무시 경고가 나온다 — §4-1
```

### 이 문서를 갱신하는 법

day2 와 같다: **실측만 적는다.** 코드를 읽고 "될 것"이라고 적지 마라 — §2 의 모든 ✅ 는 실제로 돌려본 것이다.

### 관련 문서

- [day2-part-a.md](./day2-part-a.md) — 코드 지도·판단·지뢰의 본문 (이 문서의 전제)
- [view-contract-draft.md](./view-contract-draft.md) — 뷰 계약 (확정 · G0 #6)
- [gates.md](./gates.md) — 관문 체크리스트 (G2 A 몫 마감 반영됨)
