# Day 1 · 트랙 A — 진행 상황과 남은 일

> **트랙 A = `apps/worker`** — probe · 어댑터 컴파일 · 수집 · 검증 · 자가 치유 · 스케줄러 · 구독 발송
> (트랙 경계는 [CLAUDE.md](../CLAUDE.md) 와 기획서 14장을 따른다)

| | |
|---|---|
| 기준 커밋 | `fdebef9` — feat: 워커 실행층, 마이그레이션, 모노레포 .env 로딩 |
| 기준일 | 2026-07-27 |
| 판정 근거 | `pnpm typecheck` · `pnpm test` 실제 실행 + 전 소스 감사 |

## 0. 이 문서를 읽는 법

- **[gates.md](./gates.md) 가 판정 기준이고, 이 문서는 그 판정의 현재 값이다.** 둘이 어긋나면 gates.md 가 이긴다.
- 항목마다 검증 등급을 붙였다. 이 구분을 지워서 읽지 마라.
  - ✅ **검증됨** — 직접 돌려서 눈으로 본 것. 재현 명령이 같이 있다
  - ⚠️ **미검증** — 코드를 읽고 낸 주장. 아직 돌려보지 않았다
  - ⬜ **미착수** — 코드가 없다
- **"코드가 있다"와 "돈다"는 다르다** (gates.md 판정 규칙). 파일이 존재한다는 이유로 ✅ 를 주지 마라.
- 이 문서를 고칠 때는 §9 의 절차를 따른다.

---

## 1. 30초 요약

**부품은 대부분 만들어졌는데 조립이 안 됐다.**

```
소스 19,089줄 · typecheck 4개 패키지 통과 · 테스트 663개 통과
트랙 A(파이프라인) 5,262줄 — probe·컴파일·수집·치유·발송 전부 코드가 있다
트랙 B(표면)     2,909줄 — 표·REST·MCP 는 돈다. 피드·구독 화면은 없다

그런데 apps/web ──✗── apps/worker  둘이 이어진 적이 없다
```

가장 중요한 한 문장: **`compileSpec` · `matchFields` · `traceValue` 를 부르는 곳이 저장소에 하나도 없다.**
컬렉션을 만드는 흐름(기획서 9-1 · 9-2)이 통째로 배선되지 않았다. 부품은 다 있는데 조립 라인이 없다.

---

## 2. 관문 진도

```
G0 계약고정   ████████░░  80%   타입·스펙·DB·마이그레이션 있음 / DB 실기동 미검증
G1 URL→아이템 █████░░░░░  50%   B는 됨 / A는 낯선 URL로 판정한 적 없음  ← 지금 여기
G2 소스 접합  ██░░░░░░░░  20%   "제품이 성립하는 지점" — 못 넘음
G3 계속 돈다  ███░░░░░░░  30%   워커 코드 있음 / 피드·구독 화면 없음
G4 배포·MCP   ██░░░░░░░░  20%   MCP 완성 / 배포는 파일만
G5 데모       ░░░░░░░░░░   0%
```

---

## 3. 지금 실제로 돌아가는 것 ✅

전부 직접 돌려서 확인했다.

| 되는 것 | 확인 방법 |
|---|---|
| 전 패키지 타입 검사 | `pnpm typecheck` → 4개 패키지 Done |
| core 단위 테스트 630개 | `pnpm --filter @endpointer/core test` |
| 보장선 B2 자동 점검 33개 | `pnpm --filter @endpointer/web test` |
| 임의 URL probe (CLI) | `pnpm --filter @endpointer/worker probe <url>` |
| 시드 데이터 표 화면 | 정렬·필터·출처 뱃지·원문 대조·"자동 복구 N회" 전부 있음 |
| `GET /api/v1/{slug}` | 필터·정렬·커서·`sources` 부분성공 블록 |
| MCP 도구 4개 | `list_items` · `search_items` · `get_schema` · `get_sources_status` |
| 구글 로그인 | Auth.js + Drizzle 어댑터 |

**테스트가 없는 곳: `apps/worker` 0개 · `apps/mcp` 0개.**
두 앱 다 `test` 스크립트가 `--passWithNoTests` 라 `pnpm test` 가 초록으로 지나간다.
사수 대상 ②④가 사는 곳이 정확히 worker 다 — 여기가 무검증이라는 뜻이다.

---

## 4. 트랙 A 파일별 상태

### probe — 기획서 9-1① · ADR A3

| 단계 | 파일 | 상태 |
|---|---|---|
| 1. 인라인 JSON 스캔 | [`probe/inline-json.ts`](../apps/worker/src/probe/inline-json.ts) | ⚠️ 구현됨 (`__NEXT_DATA__` 위주, §6 참조) |
| 2. 네트워크 관찰 | [`probe/network.ts`](../apps/worker/src/probe/network.ts) | ⚠️ 구현됨 |
| 3. **DOM 반복 구조** | [`probe/dom.ts:43`](../apps/worker/src/probe/dom.ts) | ⬜ **빈 껍데기** — `return { candidates: [] }` |
| 4. 브라우저 렌더 | [`fetchers/browser.ts`](../apps/worker/src/fetchers/browser.ts) | ⚠️ 구현됨 |
| 후보 순위 (겹침률) | [`probe/rank.ts`](../apps/worker/src/probe/rank.ts) | ⚠️ 구현됨 |

> 3단계가 비어 있어서 **인라인 JSON 도 없고 관찰 가능한 XHR 도 없는 서버렌더 HTML 목록은 probe 가 구조적으로 못 뚫는다.**
> 한국 공공 목록 사이트에 이 형태가 많다. G1 판정 전에 이걸 먼저 채워야 한다.

### 어댑터 컴파일 — 기획서 9-1② · 11장

| 파일 | 상태 | 호출부 |
|---|---|---|
| [`compile/gemini.ts`](../apps/worker/src/compile/gemini.ts) | ⚠️ 구현됨 | — |
| [`compile/compile-spec.ts`](../apps/worker/src/compile/compile-spec.ts) | ⚠️ 구현됨 | **`compileSpec` 없음** / `recompileSpec` 은 heal 이 부름 |
| [`compile/match-fields.ts`](../apps/worker/src/compile/match-fields.ts) | ⚠️ 구현됨 | ⬜ **없음** ← 기능 ② |
| [`compile/trace-value.ts`](../apps/worker/src/compile/trace-value.ts) | ⚠️ 구현됨 | ⬜ **없음** ← 보장선 B1 |
| [`compile/budget.ts`](../apps/worker/src/compile/budget.ts) | ⚠️ 프로세스 메모리 카운터 | 재시작하면 0 |

### 잡 · 큐

| 파일 | 상태 |
|---|---|
| [`jobs/collect.ts`](../apps/worker/src/jobs/collect.ts) | ⚠️ 추출→검증→UPSERT→구독 팬아웃 |
| [`jobs/heal.ts`](../apps/worker/src/jobs/heal.ts) | ⚠️ 격리→재컴파일→겹침률→승격 (§5-1 결함 있음) |
| [`jobs/deliver.ts`](../apps/worker/src/jobs/deliver.ts) | ⚠️ webhook 구현 / 스케줄 발송은 `TODO(G3)` |
| [`jobs/channels/`](../apps/worker/src/jobs/channels/) | webhook ⚠️ · email ⬜ `TODO(G4)` |
| [`queues.ts`](../apps/worker/src/queues.ts) | ⚠️ `enqueueCollect/Heal/Deliver` 있음 |
| [`index.ts`](../apps/worker/src/index.ts) | ⚠️ 워커 3개 기동 · graceful shutdown |

> **워커에 HTTP 진입점이 없다.** 밖에서 파이프라인을 부를 수단은 BullMQ 큐가 유일하고,
> 큐에 잡을 미는 코드는 워커 부팅 시 cron 등록뿐이다 — 수동 수집·최초 수집을 부르는 경로가 없다.

---

## 5. 확인된 결함 ✅ — 전부 재현 명령이 있다

각각 직접 돌려서 확인했다. **추측이 아니다.**

### 5-1. 자가 치유의 오승격 방지 장치가 무력화돼 있다 🔴

`normalizeIdentity` 가 URL 의 쿼리스트링을 통째로 버린다
([`overlap.ts:160`](../packages/core/src/validate/overlap.ts)). 항목 id 가 쿼리에 들어가는 사이트
(한국 공공 목록 대부분)에서는 **모든 항목의 신원이 하나로 뭉개진다.**

```ts
normalizeIdentity('https://k-startup.go.kr/view?pbancSn=101')
// → 'k-startup.go.kr/view'   ← ?pbancSn 이 사라진다

passesHealGate(
  ['…?pbancSn=101', '…?pbancSn=102', '…?pbancSn=103'],
  ['…?pbancSn=901', '…?pbancSn=902', '…?pbancSn=903'],  // 겹치는 항목 0건
)
// → true   ← 통과시킨다
```

**왜 중요한가** — 기획서 9-3 이 승격 관문을 두 겹으로 둔 이유가 "사이드바 메뉴 12개를 공고 12개로
착각하는 실패"를 막기 위해서다. 그 두 번째 관문이 항상 `true` 를 내는 no-op 이다.
**기능 ④(사수 대상)의 유일한 오승격 방지 장치가 없는 것과 같다.**

### 5-2. 표 기반 목록 사이트에서 html/browser 경로가 전멸한다 🔴

[`cheerio-adapter.ts:27`](../apps/worker/src/fetchers/cheerio-adapter.ts) 이 행 조각을 문서 모드
`load(html)` 로 파싱한다. cheerio 는 `<table>` 없이 떠 있는 `<tr>`·`<td>` 를 파싱 단계에서 버린다.

```
입력:  <tr><td class="tit">공고제목</td><td class="date">2026-08-14</td></tr>
결과:  <html><head></head><body>공고제목2026-08-14</body></html>
$('.tit').text()  →  ""   ← 셀렉터가 아무것도 못 집는다
```

**왜 중요한가** — 한국 게시판 목록의 지배적 형태가 `<table><tr>` 이다.
그 사이트들은 html·browser 모드에서 **모든 필드가 null** 이 되고, `trace-value` 도 coverage 0 이 된다.

### 5-3. `'마감임박'` 이 "마감됨"으로 뒤집힌다 🟡

`CLOSED_KEYWORDS` 에 맨 낱말 `'마감'` 과 `'종료'` 가 들어 있고
([`date.ts:159`](../packages/core/src/normalize/date.ts)), `includes()` 부분 일치로 판정한다
([`date.ts:419`](../packages/core/src/normalize/date.ts)).

```
parseDate('마감임박')  →  { iso: null, kind: 'closed' }   ← 아직 접수 중인데 마감 처리
```

한국 목록 사이트에서 가장 흔한 배지 문구 하나가 정반대 뜻으로 저장된다.

### 5-4. ISO 8601 datetime 에서 시각이 통째로 사라진다 🟡

```
parseDate('2026-08-14T18:00:00Z')   →  '2026-08-14'                  ← 시각 소실
parseDate('2026.08.14 18:00')       →  '2026-08-14T18:00:00+09:00'   ← 이건 살아남음
```

**왜 중요한가** — probe 1·2순위가 인라인 JSON·네트워크 관찰이라 **ISO 표기가 가장 흔한 입력인데
거기서만 시각이 날아간다.** `18:00Z` 는 KST 로 익일 03:00 이므로 마감일이 하루 어긋난다.

### 5-5. `@endpointer/core/query` 가 패키지 경계에서 끊겨 있다 🟡

[`packages/core/package.json`](../packages/core/package.json) 의 `exports` 에 `"./query"` 가 없다.

```json
{ ".": "…", "./db": "…", "./spec": "…", "./normalize": "…", "./validate": "…" }
```

**왜 중요한가** — ADR A22 가 "REST 와 MCP 가 같은 쿼리 코드를 쓴다"고 못 박았는데
그 진입점이 없다. web·mcp 가 각자 우회로를 만들었고 **worker 는 아예 못 쓴다.**
[`jobs/deliver.ts:102`](../apps/worker/src/jobs/deliver.ts) 의 `TODO(G3)` 이 이 사실을 기록해 두고 있다 —
구독 발송이 표의 필터를 재사용하지 못하는 이유가 이것이다.

---

## 6. 미검증 결함 후보 ⚠️

코드 감사에서 나왔으나 **아직 돌려보지 않았다.** 손대기 전에 재현부터 하라.
(§5 의 5건은 같은 감사에서 나와 검증에 전부 살아남았으므로, 아래도 상당수는 진짜일 가능성이 높다.)

| 곳 | 주장 | 급 |
|---|---|---|
| [`fetchers/http.ts:137`](../apps/worker/src/fetchers/http.ts) | `res.text()` 가 항상 UTF-8 로 디코딩 → **EUC-KR 사이트 본문이 깨진다** | 🔴 |
| [`fetchers/http.ts`](../apps/worker/src/fetchers/http.ts) | fetch 계층에 사설망 차단이 없다. core 의 `isPrivateHost`([`validate.ts:140`](../packages/core/src/spec/validate.ts))를 **부르지 않는다** → SSRF | 🔴 |
| [`spec/validate.ts:140`](../packages/core/src/spec/validate.ts) | `isPrivateHost` 가 IPv4 사상 IPv6(`::ffff:…`)를 못 거른다 | 🔴 |
| [`fetchers/browser.ts`](../apps/worker/src/fetchers/browser.ts) | browser 모드만 HTTP 상태를 안 본다 → 404 페이지가 "수집 성공·0건" | 🟡 |
| [`probe/inline-json.ts`](../apps/worker/src/probe/inline-json.ts) | `__NEXT_DATA__` 만 그릇으로 잡아 Nuxt3·SvelteKit·Remix 페이로드 누락 | 🟡 |
| [`jobs/heal.ts:107`](../apps/worker/src/jobs/heal.ts) | json 모드 소스의 치유에서 네트워크 관찰을 꺼서 깨진 내부 API 재발견 경로가 막힘 | 🟡 |
| [`jobs/heal.ts:195`](../apps/worker/src/jobs/heal.ts) | 치유 **실패**가 `runs` 에 안 남는다 → 기능 ④의 "로그로 쌓기" 절반이 없음 | 🟡 |
| [`db.ts:135`](../apps/worker/src/db.ts) | `startRun` 이 진행 중 런을 `status:'ok'` 로 넣고 try/finally 가 없음 → 유령 런 | 🟡 |
| [`spec/interpret.ts:260`](../packages/core/src/spec/interpret.ts) | `external_key` 폴백이 `'title'` 을 하드코딩 → 없으면 row_hash 로 떨어져 매 수집 전량 신규 (구독 스팸) | 🟡 |
| [`normalize/number.ts:47`](../packages/core/src/normalize/number.ts) | 단위 앞 숫자를 합산 → 연도·회차가 금액에 더해짐 | 🟡 |
| [`db/seed.ts`](../packages/core/src/db/seed.ts) | seed 의 `raw_json` 형태가 파이프라인과 달라, 실수집 한 번에 원문 대조 툴팁이 사라짐 | 🟡 |

---

## 7. 남은 일 — 순서대로

### 7-1. 지금 당장 (G1 통과용)

1. **[`probe/dom.ts`](../apps/worker/src/probe/dom.ts) 구현.** 파일 안 주석에 5단계 알고리즘이 이미 적혀 있다.
   이게 없으면 서버렌더 HTML 목록을 못 뚫어 G1 의 "낯선 URL 3개 중 2개" 판정을 못 넘는다.
2. **§5-2 cheerio 행 조각 파싱 고치기.** `load(html)` 대신 fragment 모드를 쓰거나 `<table>` 로 감싼다.
   1번을 아무리 잘 해도 이게 안 고쳐지면 표 기반 사이트는 전부 빈 값이다.
3. **§6 의 🔴 3건 재현 후 처리** — charset · SSRF 2건. 임의 URL 을 받는 제품이라 미룰 수 없다.
4. **낯선 목록 URL 3개로 실제 판정.** `pnpm --filter @endpointer/worker probe <url>`
   → gates.md G1 트랙 A 체크박스를 채운다.

### 7-2. 그 다음 (G2 — 합류 지점 · 트랙 B와 같이)

**이게 제품이 성립하는 지점이다.** 트랙 A 가 낼 것은 "URL 하나 → 이미 채워진 표" 를 돌려주는 진입점이다.

5. **컬렉션 생성 경로 배선.** `probe → compileSpec → interpretSpec → inferSchema → normalize`
   를 한 함수로 묶고, 큐 잡(`enqueueCompile` 신설) 또는 워커 HTTP 엔드포인트로 노출한다.
   → 트랙 B가 `POST /api/collections` 에서 이걸 부른다. **어느 쪽으로 할지 B와 먼저 합의할 것.**
6. **`matchFields` 배선** — 두 번째 소스의 자동 매핑 (기능 ②).
7. **`traceValue` 배선** — 못 찾은 필드를 값 붙여넣기로 해결 (보장선 B1).
8. **§5-4 ISO 시각 소실 수정** — 두 소스의 날짜 형식이 같아야 G2 통과다.

### 7-3. 그 다음 (G3(A) — 자가 치유)

9. **§5-1 `normalizeIdentity` 수정.** 이걸 안 고치면 자가 치유가 엉뚱한 목록을 승격시킨다.
   **사수 대상이므로 강등 대상이 아니다.**
10. 수동 수집 트리거 (일부러 깨뜨리고 다시 돌리는 데모 경로).
11. 치유 실패도 `runs` 에 기록 (§6) — "복구 N회"의 반대편.
12. `budget.ts` 카운터를 DB/Redis 로 (재시작에 안 지워지게).
13. **두 번 연속 수집 시 두 번째 신규가 0인가** 확인 (gates.md G3 · 기획서 15장 리스크).

### 7-4. 마지막 (G4)

14. `deploy/` 로 실제 배포 — 아직 한 번도 올려본 적 없다.
15. worker 테스트 추가. 최소한 §5 의 5건은 회귀 테스트로 박아라.

---

## 8. 가장 큰 구조적 문제 — 배선

```
apps/web                          apps/worker
  ├ GET /api/v1/[collection] ✅      ├ probe ⚠️
  ├ 쓰기 라우트 0개 ⬜               ├ compileSpec ⚠️ (호출부 없음)
  └ Redis/BullMQ 연결 없음 ⬜        ├ matchFields ⚠️ (호출부 없음)
                                     ├ traceValue ⚠️ (호출부 없음)
            ✗ 연결 없음 ✗           └ 큐 3개 ⚠️ (cron 만 밀어넣음)
```

- `apps/web` 에 `POST`/`PUT`/`PATCH`/`DELETE` 라우트가 **하나도 없다**
- `apps/web` 에 Redis 의존성이 **없다** → 잡을 밀 수단이 없다
- `apps/worker` 에 HTTP 진입점이 **없다** → 밖에서 부를 수단이 큐뿐이다

**7-2 의 5번이 이 그림을 바꾸는 한 수다.** 그거 하나 붙는 순간 기능 ①②④가 동시에 살아난다.
반대로 그걸 안 붙이면 코드를 아무리 더 써도 G5 에서 녹화할 장면이 안 생긴다.

---

## 9. 검증 명령 모음

```bash
pnpm typecheck                              # 커밋 전 필수
pnpm test                                   # core 630 + web 33
pnpm --filter @endpointer/worker probe <url>   # 임의 URL probe

pnpm infra:up                               # postgres + redis
pnpm db:migrate && pnpm db:seed             # 마이그레이션은 이미 커밋돼 있다
pnpm dev                                    # web 3000 · worker · mcp 3002
```

### 이 문서를 갱신하는 법

- 항목을 ⚠️ → ✅ 로 올릴 때는 **재현 명령을 같이 적는다.** 명령 없는 ✅ 는 신뢰할 수 없다.
- §6 의 후보를 확인했으면 §5 로 옮기고 재현 절차를 붙인다. 오탐이면 줄을 지우지 말고 "오탐"으로 표시한다 —
  지우면 같은 것을 다시 조사한다.
- 관문 체크박스는 [gates.md](./gates.md) 에 반영하는 것이 정본이다. 여기 진도 막대는 그 요약일 뿐이다.
- `packages/core` 를 고쳤으면 **트랙 B에 통보한다** (G0 계약 · CLAUDE.md).
  §5 의 5-1·5-3·5-4·5-5 가 전부 core 수정이다 — 혼자 고치면 상대 트랙이 조용히 깨진다.

### 관련 문서

| 문서 | 무엇 |
|---|---|
| [`기획서-v2.md`](./기획서-v2.md) | 진실의 원천 (수정 금지) |
| [`gates.md`](./gates.md) | 관문 판정 체크리스트 — **판정의 정본** |
| [`guardrails.md`](./guardrails.md) | 보장선 B1~B7 점검 절차 |
| [`adr.md`](./adr.md) | 기술 결정 — **기술 변경은 여기부터** |
