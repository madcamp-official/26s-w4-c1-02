# Day 2 · 트랙 A — 인수인계

> **이 문서 하나로 트랙 A 를 이어받을 수 있게 쓴다.**
> [day1-part-a.md](./day1-part-a.md) 는 *무엇을 고쳤는가*의 기록이고, 이 문서는 *지금 어디에 서 있고 다음에 뭘 하는가*다.
> 둘이 어긋나면 **이 문서가 최신**이다. 판정 기준 자체는 [gates.md](./gates.md) 가 정본이다.

| | |
|---|---|
| 기준 커밋 | `4508fa0` — feat: 붙인 사이트를 표에 저장한다 |
| 기준일 | 2026-07-27 |
| 브랜치 | `pipeline` (트랙 A) · 로컬이 `origin/pipeline` 보다 **7 커밋 앞. 아직 안 밀었다** |
| 판정 근거 | `pnpm typecheck` 4/4 · `pnpm test` **809개 통과** (core 657 · web 33 · worker 119) · 실제 사이트 4곳 실행 |

---

## 0. 30초 요약 — 지금 어디에 서 있나

**URL 하나가 표가 되고, 두 번째 사이트가 그 표에 합류한다. 둘 다 DB 까지 간다. 화면만 아직 안 붙었다.**

```
[URL] ─probe─ [목록 위치] ─LLM─ [스펙] ─실행─ [항목] ─검증·수리─ [표] ─저장─ [DB] ─→ REST ✅ / MCP ✅ / 화면 ⬜
                                                                        ↑
[두 번째 URL] ─probe─ ─matchFields─ [기존 칸에 매핑] ─실행─ ─수리·링크확인─ ┘  ✅ 여기까지 돈다
```

**제품이 갈라지는 지점(기능 ②)이 끝까지 돈다.** 실측:

```
GET /api/v1/bizinfo → 30건 · 두 출처
   www.bizinfo.go.kr    15건   6칸 전부
   www.k-startup.go.kr  15건   5칸 (원문 링크는 "물어볼 칸")
같은 여섯 칸 · 같은 ISO 날짜 형식으로 섞여 나온다  ← 이게 G2 판정문이다
```

**남은 것은 화면 한 곳이다** — 트랙 B 의 `apps/web/lib/create.ts` 에 있는 `buildMockPreview` 를
워커 HTTP 문 호출로 바꾸면 G2 가 닫힌다.

---

## 1. 5분 만에 손에 넣기

### 필요한 것

루트 `.env` 하나가 세 앱과 워커에 전부 먹는다 (`fdebef9` 에서 모노레포 공용 로딩으로 바꿨다).

| 키 | 없으면 | 비고 |
|---|---|---|
| `DATABASE_URL` | 전부 죽는다 | `pnpm infra:up` 이 띄우는 postgres |
| `REDIS_URL` | 워커 큐가 죽는다 | 같은 compose |
| `GEMINI_API_KEY` | probe 까지만 되고 스펙을 못 만든다 | **채워져 있다** (2026-07-27) |
| `WORKER_INTERNAL_TOKEN` | 워커 HTTP 문이 **아예 안 열린다** (16자 미만도 마찬가지) | 일부러 그렇게 했다 — §4-6 |
| `AUTH_GOOGLE_ID` / `SECRET` | 화면 로그인이 안 된다 | 채워져 있으나 **아직 아무도 로그인해 본 적이 없다** |

### 순서

```bash
pnpm install
pnpm infra:up                 # postgres + redis
pnpm db:migrate && pnpm db:seed
pnpm typecheck && pnpm test   # 4/4 · 809개가 나와야 한다
pnpm dev                      # web 3000 · worker · mcp 3002 · 워커 HTTP 3003
```

### 지금 DB 에 실제로 들어 있는 것 (2026-07-27 실측)

```
slug           출처  항목   무엇
contest          2    20   시드 (가짜 데이터)
bizinfo          2    30   ← 트랙 A 가 만든 것. G2 판정 대상이다
c-7ab3a820c3     1     0   ← 트랙 B 화면이 만든 것 (mock 경로)
c-bc4abdeaa7     1     0   ← 같음
```

**`c-` 로 시작하는 두 줄이 지금 가장 눈에 띄는 문제다.** 화면의 생성 흐름이
파이프라인을 안 부르고 자기 나름대로 컬렉션 행만 만들어서, **항목이 0개인 표**가 남는다.
쓰기 경로가 두 갈래인 상태다 — §7-1 이 이걸 하나로 합치는 일이다.

### 눈으로 확인하기 (아무것도 안 고치고)

```bash
curl -s "http://localhost:3000/api/v1/bizinfo?limit=3" | jq '.sources, (.items[0])'
```

```bash
pnpm --filter @endpointer/worker probe "https://www.wevity.com/?c=find&s=1&gub=1&cidx=20" --no-browser
```

---

## 2. 브랜치 지형 — 어디에 커밋해야 하나

```
origin/main         스캐폴딩 (2a561bc). 아직 A·B 어느 쪽도 안 올라갔다
origin/pipeline     트랙 A. **로컬이 7 커밋 앞이다 (미푸시)**
origin/B            트랙 B (73dd820 화면 확장 · 9ef3a10 mcp .env 수정)
integration         로컬 전용. pipeline + origin/B 를 합쳐 같이 띄워보는 용도
```

- **트랙 A 작업은 `pipeline` 에 커밋한다.** `integration` 은 테스트 합본이지 작업 브랜치가 아니다.
  (한 번 실수로 `integration` 에 커밋했다가 `bb20058` 로 cherry-pick 해 옮겼다.)
- `integration` 은 지금 `pipeline` 보다 **3 커밋 뒤에 있다** (`a8094a9`·`9b77c29`·`4508fa0` 없음).
  다시 합치려면 `git checkout integration && git merge pipeline`.
- **푸시는 아직 승인받지 않았다.** 7개 커밋이 로컬에만 있다.

---

## 3. 코드 지도 — 데이터가 흐르는 순서대로

### 두 개의 파이프라인

| | 첫 사이트 | 두 번째 사이트 |
|---|---|---|
| 파일 | [`pipeline/create-collection.ts`](../apps/worker/src/pipeline/create-collection.ts) | [`pipeline/attach-source.ts`](../apps/worker/src/pipeline/attach-source.ts) |
| 하는 일 | 표의 **칸을 정한다** | 이미 정해진 칸에 **맞춘다** |
| LLM | `discoverSpec` (칸 발견 + 뽑는 법을 한 번에) | `matchFields` (칸에 값을 매핑) |
| 입력 | URL | URL + **스키마** + 기존 항목 표본 |
| 결과 | 새 컬렉션 | 기존 컬렉션에 소스 하나 추가 |
| CLI | `pnpm --filter @endpointer/worker create-collection <url>` | `pnpm --filter @endpointer/worker attach <slug> <url>` |

**둘 다 DB 를 모른다.** 저장은 [`pipeline/persist.ts`](../apps/worker/src/pipeline/persist.ts) 가 따로 한다.
그 경계가 곧 보장선 B3 이다 — 사용자는 표를 **보고 나서** 저장한다. 만들면서 저장하면 마음에 안 드는 표가 그대로 남는다.

### 단계별 파일

```
① PROBE      probe/index.ts        네 갈래를 다 던져 보고 겹침률로 고른다
             ├ inline-json.ts      __NEXT_DATA__ 같은 페이지 안 JSON
             ├ network.ts          브라우저가 부르는 XHR 관찰
             ├ dom.ts              **DOM 반복 구조** — 한국 공공 목록의 지배적 형태
             └ fetchers/browser.ts 렌더 후 HTML
             rank.ts               후보 순위 = 화면 글자와 얼마나 겹치는가

② COMPILE    compile/discover.ts       첫 소스 — 칸 + 뽑는 법 (LLM)
             compile/match-fields.ts   두 번째 소스 — 기존 칸에 매핑 (LLM)
             compile/trace-value.ts    붙여넣은 값 → 경로 역추적 (**LLM 없음**)
             compile/prompts/          문장. 튜닝은 여기서만
             compile/gemini.ts         디스크 캐시 · 실패를 값으로 (throw 안 함)

③ EXECUTE    fetchers/index.ts     runAdapter — 스펙대로 실제로 뽑는다
             fetchers/http.ts      관문 + 수동 리다이렉트 + charset 판정
             fetchers/guard.ts     나가는 요청 관문 (SSRF)
             fetchers/charset.ts   BOM → 헤더 → <meta> → UTF-8
             packages/core/spec/interpret.ts   스펙 해석기 (**여기가 코드를 안 돌린다**)

③-b 수리     pipeline/repair-empty.ts  항상 비는 칸: 변환을 버리거나 칸을 뺀다
③-c 링크     pipeline/verify-link.ts   첫 링크를 한 번 열어 본다 (목록 페이지면 거짓 링크)

④ SAVE       pipeline/persist.ts   collection → source → adapter(candidate) → promote → items
             db.ts                 SQL 은 전부 여기

문             http/index.ts        화면이 부르는 HTTP 진입점 (ADR A30)
큐             jobs/collect.ts · heal.ts · deliver.ts · queues.ts
```

### 워커 HTTP 문 — 트랙 B 와의 계약

| 경로 | 하는 일 |
|---|---|
| `GET /healthz` | |
| `POST /internal/preview` | 주소 → 이미 채워진 표. **저장하지 않는다** |
| `POST /internal/collections` | 같은 것 + DB 에 앉히기 |

```bash
curl -s -X POST http://127.0.0.1:3003/internal/preview \
  -H "Authorization: Bearer $WORKER_INTERNAL_TOKEN" -H "Content-Type: application/json" \
  -d '{"url":"https://www.bizinfo.go.kr/web/lay1/bbs/S1T122C128/AS/74/list.do","skip_browser":true}' | jq
```

**실패는 HTTP 코드가 아니라 문구로 온다** (보장선 B4). 못 뚫어도 200 + `{ok:false, message}` 다.

---

## 4. 이 코드베이스가 반복하는 판단 — 이걸 모르면 되돌린다

새로 들어온 사람이 "왜 이렇게 복잡하게 했지" 하고 지우기 쉬운 것들이다. 전부 실제로 데인 자리다.

### 4-1. 진짜 적은 실패가 아니라 **조용한 실패**다

실패는 로그에 남고 사용자가 다시 시도한다. 무서운 건 **모든 품질 신호를 통과하는 잘못된 성공**이다.
지금까지 잡은 것 셋이 전부 이 부류다:

| 무엇 | 왜 안 걸렸나 |
|---|---|
| EUC-KR 글자 깨짐 | 겹침률 **100%** — 화면 글자도 똑같이 깨져서 둘이 일치한다 |
| `replace(/.*/g,'')` | 보고서에 `null_ratio: 1` 로 **정확히 적혔는데** 저장을 막는 게 없었다 |
| 지어낸 상세 링크 | HTTP **200** · 항목마다 값이 다 다름 · 주소 문법 정상 |

**설계 지침:** 새 기능을 붙일 때 "실패하면 어떻게 보이나" 말고
**"틀렸는데 성공처럼 보이면 어떻게 아나"** 를 먼저 답하라.

### 4-2. 정적으로 못 푸는 건 **돌려 본다**

"이 정규식이 값을 파괴하는가"는 일반적으로 풀 수 없다 (`.*` 는 파괴적이고 `\s*` 는 아니다).
"이 URL 틀이 진짜인가"도 마찬가지다. **그런데 우리는 컴파일 시점에 이미 행을 들고 있다.**
그래서 추론하지 않고 실행한다 — 페이지는 캐시라 거의 공짜다.

이게 [`repair-empty.ts`](../apps/worker/src/pipeline/repair-empty.ts) 와
[`verify-link.ts`](../apps/worker/src/pipeline/verify-link.ts) 가 존재하는 이유다.

### 4-3. **검증된 값이 추측을 이긴다**

probe 는 선택자를 실제로 돌려 몇 행이 나오는지 보고 고른다. LLM 의 `list` 는 검증 안 된 추측이다.
그래서 `matchFields` 결과에서 `list` 는 **probe 것을 쓴다**.
한 번 반대로 했다가 없는 선택자(`css:.list_item`)로 덮여 항목이 0개가 됐다.

### 4-4. `missing` 은 실패가 아니라 **기능이다**

못 찾은 칸을 억지로 채우면 표가 조용히 틀린다. 못 찾았다고 **말하고 값을 붙여넣게** 한다.
붙여넣은 값은 `traceValue` 가 역추적한다 — **LLM 없이, 결정론적으로** (보장선 B1).
사용자는 셀렉터를 입력하지 않는다. `D-32` 를 붙여넣으면 `css:div.day` 를 찾아내고,
날짜 정규화가 `D-32 접수중` → `2026-08-28` 로 바꾼다.

그래서 `validateSpec` 은 **찾은 칸만 담은 스키마**로 부른다. 필수 칸을 전부 요구하면
하나 못 찾은 사이트는 미리보기조차 못 본다 — 그런데 못 찾은 칸을 물어보는 게 이 기능의 핵심이다.

### 4-5. **말한 것과 저장한 것이 같아야 한다**

가장 심하게 데인 자리. 거짓 링크를 잡아 "못 만들었어요" 라고 **말해 놓고**
`missing` 목록에만 넣고 스펙·항목에서는 안 빼서 **그 값이 그대로 DB 에 앉고 API 로 나갔다.**

빼는 자리를 한 곳(`dropColumns` 한 번)으로 모았고, 불변식을
[`attach-source.test.ts`](../apps/worker/src/pipeline/attach-source.test.ts) 에 박았다:

```ts
for (const m of r.missing) {
  expect(Object.keys(r.spec.fields)).not.toContain(m.key)
  for (const item of r.items) expect(item.data).not.toHaveProperty(m.key)
}
```

**목(mock)이 현실보다 관대하면 이런 버그를 영원히 못 잡는다.** 이 테스트를 쓰면서
가짜 `runAdapter` 가 스펙을 무시하고 고정 행을 내놓는 것도 같이 드러나 고쳤다.

### 4-6. 임의 주소를 받는 것이 기능이므로 SSRF 는 **기능의 이면**이다

나가는 요청은 전부 [`guard.ts`](../apps/worker/src/fetchers/guard.ts) 를 지난다 —
글자 · **이름 풀기** · **리다이렉트 홉마다**. 같은 이유로 워커 HTTP 문은 토큰이 없으면 안 열린다.
열어 두면 이 서버는 "아무 주소나 대신 열어 주는 공개 서비스" 가 된다.

**클라이언트가 준 스펙은 절대 실행하지 않는다.** 스펙은 "어느 주소를 어떻게 긁을지" 이므로
그걸 받아 돌리는 건 임의 요청 실행이다. 저장할 때 **주소만 받아 다시 돈다.**

---

## 5. 이미 밟은 지뢰 — 다시 밟지 마라

전부 실제로 몇 시간씩 태운 것들이다. 회귀 방어가 있는 것은 되돌리면 테스트가 깨진다.

| 증상 | 진짜 원인 | 어디 | 방어 |
|---|---|---|---|
| `DATABASE_URL: undefined` 로 부팅 실패 | **ESM 은 `import` 를 본문보다 먼저 평가한다.** 진입점 맨 위의 `loadDotenv()` 보다 아래 줄의 `@endpointer/core/db` 가 먼저 돈다 | `apps/mcp/src/load-env.ts` | ADR A29 |
| Gemini 400 INVALID_ARGUMENT (스키마 전체 거부) | 원소가 복잡한 배열에 **`maxItems`** 를 걸면 지원 목록에 있는 키워드인데도 거부된다 | `packages/core/src/spec/json-schema.ts` | 파일 머리말에 "붙이지 마라" |
| `ERR_INVALID_ARG_TYPE` — 저장이 매번 죽음 | postgres.js 3.4.9 에서 `sql.json()` 이 `prepare:false` 와 함께 깨진다 | `db.ts` `finishRun` | `JSON.stringify` 사용 |
| esbuild `Expected ";"` | **SQL 템플릿 리터럴 안 주석에 백틱**을 썼더니 리터럴이 거기서 끝났다 | — | 주석을 리터럴 **밖**에 |
| 선택자가 아무것도 못 집음 (`<table>` 사이트 전멸) | cheerio 가 `<table>` 없이 뜬 `<tr>` 을 파싱에서 버린다 | `fetchers/cheerio-adapter.ts` | `load(html, null, false)` · 회귀 4개 |
| "6칸 전부 찾음" 인데 항목 0개 | LLM 프롬프트에 `candidate.rows`(=화면 **글자**)를 넣고 선택자를 쓰라고 시켰다 | `compile/match-fields.ts` | `row_html ?? rows` |
| 같은 증상 (0개) | LLM 의 `list` 가 probe 가 **실제로 돌려 본** 경로를 덮었다 | `compile/match-fields.ts` | probe 우선 (§4-3) |
| 한 칸 못 찾으면 스펙 통째 거절 | `validateSpec` 이 필수 칸을 전부 요구 | `attach-source.ts` | 찾은 칸만 담은 스키마로 검증 |
| 컬렉션 이름이 `"K"` | `K-Startup` 을 낱말 안 하이픈에서 잘랐다 | `create-collection.ts` | 구분자 **양옆 공백** 필수 |
| slug 가 `"---"` | 한국어를 지우고 남은 하이픈 3개가 "3글자"로 통과 | `create-collection.ts` | 길이 말고 **글자 수** |
| EUC-KR 페이지 글자 깨짐 | `res.text()` 는 **헤더 charset 만** 본다 | `fetchers/charset.ts` | ADR A28 · 테스트 16개 |
| 손으로 쓴 EUC-KR 바이트표 오타 | "오타"와 "글자 깨짐"이 실패 메시지에서 구분이 안 된다 | `charset.test.ts` | 역표를 **테스트가 생성** |

---

## 6. 관문 진도

```
G0 계약고정   █████████░  90%   타입·스펙·DB·마이그레이션 · DB 실기동 확인됨
G1 URL→아이템 ██████████ 100%   낯선 URL 4곳 전부 표가 나왔다 ✅
G2 소스 접합  █████████░  90%   두 출처가 한 표에서 API·MCP 로 나온다 ✅ / 화면 ⬜  ← 지금 여기
G3 계속 돈다  ███░░░░░░░  30%   워커 코드 있음 / 두 번째 수집 미검증 · 피드·구독 화면 없음
G4 배포·MCP   ██░░░░░░░░  20%   MCP 완성 / 배포는 파일만
G5 데모       ░░░░░░░░░░   0%
```

### G1 판정 (2026-07-27) ✅ — `create-collection <url> --no-browser`

| 사이트 | 칸 | 항목 | LLM | 시간 |
|---|---|---|---|---|
| k-startup.go.kr | 6 | 15 | 2회 | 4.9초 |
| bizinfo.go.kr | 6 | 15 | 2회 | 8.6초 |
| wevity.com | 5 | 20 | 2회 | 10.0초 |
| korcham.net (EUC-KR) | 4 | 15 | 2회 | 5.6초 |

네 곳 다 `DOM 반복 구조` 로 뚫렸고 겹침 100%. **정기 수집 경로에 LLM 은 없다** — 컴파일 때 2회가 전부다.

### G2 판정 (2026-07-27) — API·MCP 는 ✅, 화면은 ⬜

접합 실측. 이 기능의 성패는 숫자 하나다 — **사용자가 손으로 채워야 하는 칸이 몇 개인가.**

| 붙인 사이트 | 자동 | 물어봄 | 항목 |
|---|---|---|---|
| k-startup → `bizinfo` 표 | **5/6** | 1 (원문 링크) | 15 |
| wevity → `bizinfo` 표 | 4/6 | 2 (마감일·등록일) | 21 |
| wevity + `--paste "deadline=D-32"` | **5/6** | 1 (등록일) | 21 |

```bash
pnpm --filter @endpointer/worker attach bizinfo \
  "https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do" --no-browser --save
```

---

## 7. 다음에 할 일 — 순서와 이유

### 7-1. 화면을 파이프라인에 연결한다 (G2 를 닫는다) 🔴

**무엇** — 지금 화면은 파이프라인을 안 부르고 가짜 미리보기를 만든다. 두 곳이다 (`origin/B` 기준):

```
apps/web/lib/create.ts:39                    buildMockPreview()      ← POST /internal/preview 로
apps/web/app/collections/new/actions.ts:42   그걸 부르는 자리
```

저장은 `POST /internal/collections`. 워커 주소·토큰은 `.env` 의 `WORKER_INTERNAL_URL`·`WORKER_INTERNAL_TOKEN` 에 이미 있다.

**왜 지금** — 이거 하나로 §1 의 `c-7ab3a820c3`(항목 0개) 같은 유령 컬렉션이 사라지고,
쓰기 경로가 하나로 합쳐지고, G5 에서 녹화할 장면이 생긴다. **코드를 아무리 더 써도 이게 없으면 데모가 없다.**

**주의** — 트랙 B 디렉터리다. 패치를 만들어 **넘기는 것**이 맞고, 직접 고칠 거면 B 에게 먼저 말한다.

**판정** — 화면에서 URL 붙여넣기 → 표가 나온다 → 저장 → `GET /api/v1/{slug}` 에 항목이 있다.

### 7-2. 같은 소스를 두 번 수집해 본다 (G3 의 전제) 🔴

**무엇** — `enqueueCollect` 로 이미 있는 소스를 한 번 더 돌리고 **두 번째 수집의 신규가 0인지** 본다.

**왜 지금** — 여기서 `external_key` 안정성이 드러난다.
[`interpret.ts:260`](../packages/core/src/spec/interpret.ts) 의 폴백이 `'title'` 하드코딩이라,
없으면 `row_hash` 로 떨어져 **매 수집마다 전량 신규**가 된다. 그러면 구독 발송이 스팸이 되고
"자동 복구 N회" 같은 숫자도 전부 의미를 잃는다. 자가 치유·구독은 전부 이것 위에 서 있다.

**판정** — 두 번 연속 수집 → 두 번째 런의 `items_new = 0`.

### 7-3. `normalizeIdentity` 를 고친다 (사수 대상 ④) 🔴

**무엇** — [`overlap.ts:160`](../packages/core/src/validate/overlap.ts) 이 URL 쿼리스트링을 통째로 버린다.

```ts
normalizeIdentity('https://k-startup.go.kr/view?pbancSn=101')  // → 'k-startup.go.kr/view'
passesHealGate(['…?pbancSn=101','…102','…103'], ['…901','…902','…903'])  // → true  ← 겹침 0인데 통과
```

**왜 중요한가** — 기획서 9-3 이 승격 관문을 두 겹 둔 이유가 "사이드바 메뉴 12개를 공고 12개로
착각하는 실패"를 막기 위해서다. **그 두 번째 관문이 항상 `true` 를 내는 no-op 이다.**
기능 ④의 유일한 오승격 방지 장치가 없는 것과 같다. 항목 id 가 쿼리에 들어가는 사이트가
한국 공공 목록 대부분이다.

**주의** — `packages/core` 수정 → **트랙 B 통보 대상.**

### 7-4. 값 용어를 맞춘다 (기획서 9-2③ enum 매핑) 🟡

**무엇** — 지금 `bizinfo` 표의 `category` 에 `사업화`(k-startup)와 `내수`(bizinfo)가 그대로 섞여 있다.
같은 뜻의 다른 말(`"기술개발" ↔ "R&D"`)을 매핑하고 **사용자가 확인하게** 한다.

**왜 지금은 아닌가** — 표가 섞여 나오는 것 자체는 이미 되므로 G2 는 통과한다. 다만 필터가 반쪽이다.
`packages/core/src/normalize/enum.ts` 와 스키마의 `value_labels` 자리가 이미 있다.

### 7-5. ISO 8601 에서 시각이 사라지는 것 🟡

```
parseDate('2026-08-14T18:00:00Z')   →  '2026-08-14'                  ← 시각 소실
parseDate('2026.08.14 18:00')       →  '2026-08-14T18:00:00+09:00'   ← 이건 살아남음
```

probe 1·2순위가 인라인 JSON·네트워크 관찰이라 **ISO 가 가장 흔한 입력인데 거기서만 날아간다.**
`18:00Z` 는 KST 로 익일 03:00 이므로 마감일이 하루 어긋난다. core 수정 → 통보 대상.

### 7-6. 그 다음 (G3 나머지)

| | 무엇 | 왜 |
|---|---|---|
| 수동 수집 트리거 | 워커 HTTP 문에 경로 하나 추가 | 일부러 깨뜨리고 고치는 **데모 경로**가 없다 |
| 치유 **실패**도 `runs` 에 기록 | [`heal.ts:195`](../apps/worker/src/jobs/heal.ts) | 기능 ④는 "복구를 로그로 쌓아 보여주는 것"까지가 기능이다 |
| `budget.ts` 를 DB/Redis 로 | 지금은 프로세스 메모리 | 재시작하면 일일 한도가 0으로 리셋된다 |
| 접합 소스의 페이지네이션 | `attach-source.ts` `TODO(G3)` | 두 번째 사이트는 지금 **1페이지만** 붙는다 |
| 목록 머리글 행 걸러내기 | probe | wevity 의 `소관부처` 첫 값이 `주최사`(머리글)로 나온다 |

### 7-7. 마지막 (G4)

배포는 아직 한 번도 올려본 적이 없다. `deploy/` 에 파일만 있다.

---

## 8. 남은 결함 — 미검증 후보 ⚠️

코드 감사에서 나왔으나 **아직 돌려보지 않았다.** 손대기 전에 재현부터 하라.
(day1 §5 의 확인된 결함들이 같은 감사에서 나왔고 전부 진짜였다.)

| 곳 | 주장 | 급 |
|---|---|---|
| [`fetchers/browser.ts`](../apps/worker/src/fetchers/browser.ts) | browser 모드만 HTTP 상태를 안 본다 → 404 페이지가 "수집 성공·0건" | 🟡 |
| [`probe/inline-json.ts`](../apps/worker/src/probe/inline-json.ts) | `__NEXT_DATA__` 만 그릇으로 잡아 Nuxt3·SvelteKit·Remix 누락 | 🟡 |
| [`jobs/heal.ts:107`](../apps/worker/src/jobs/heal.ts) | json 소스 치유에서 네트워크 관찰을 꺼 깨진 내부 API 재발견 경로가 막힘 | 🟡 |
| [`db.ts:135`](../apps/worker/src/db.ts) | `startRun` 이 진행 중 런을 `status:'ok'` 로 넣고 try/finally 없음 → 유령 런. **✅ 확인·수리 (07-27)** — 유령 런을 심고 재시작해 실증. 부팅 때 30분 넘은 미완 런을 실패로 닫는다 (`closeAbandonedRuns` — 'running' 상태 추가는 G0 계약 변경이라 청소로 푼다) | ✅ |
| [`auth.ts:38`](../apps/web/auth.ts) | DB 를 못 붙어 JWT 로 강등되면 `session.user.id` 가 영영 안 채워진다 → 폴백이 사실상 작동 안 함 | 🟡 |
| [`normalize/number.ts:47`](../packages/core/src/normalize/number.ts) | 단위 앞 숫자를 합산 → 연도·회차가 금액에 더해짐. **✅ 확인·수리 (07-27)** — 주장보다 심했다: `제2회 1억원` → **3억**, `5천만원(2026년 기준)` → 50,002,026. 수사(연도·회차) 사전 제거 + 연속 숫자는 마지막만 (테스트 4개, core — B 통보) | ✅ |
| [`db/seed.ts`](../packages/core/src/db/seed.ts) | seed 의 `raw_json` 형태가 파이프라인과 달라, 실수집 한 번에 원문 대조 툴팁이 사라짐 | 🟡 |
| `CLOSED_KEYWORDS` | `'마감임박'` 이 부분일치로 "마감됨" 판정. **✅ 수리 (07-27)** — 임박·예정·곧 이 보이면 closed 로 내지 않는다 (날짜를 모르는 것이지 끝난 게 아니다 · 테스트 5개, core — B 통보) | ✅ |
| `fetchers/guard.ts` | 검사 후 `fetch` 가 이름을 다시 푼다 (DNS 리바인딩). **알고 남긴 구멍** — 막으려면 undici 의존 필요 → ADR 먼저 | 🟡 |
| 어디에도 없음 | **`apps/mcp` 테스트 0개** | 🟡 |

---

## 9. 트랙 경계 — 지금 B 에게 갚아야 할 통보

**`packages/core` 는 빌드가 없다** (ADR A15). 고치면 즉시 세 앱에 반영된다 — 조용히 고치면 상대가 조용히 깨진다.

| 무엇 | 어디 | 영향 |
|---|---|---|
| `isPrivateHost` 가 IPv4 사상 IPv6 도 거른다 | `spec/validate.ts` | **더 많이 막는 방향** — 통과하던 게 막힐 수는 있어도 반대는 없다 |
| `columns` 의 `maxItems` 제거 | `spec/json-schema.ts` | 상한은 이제 설명 문구와 파서가 건다 |
| `buildTransformPipelineSchema` 추가 | `spec/json-schema.ts` | 새 export |
| `apps/mcp/src/load-env.ts` 를 A 가 건드렸다 | `apps/mcp` (B 디렉터리) | 깨뜨린 커밋이 A 것(`fdebef9`)이라 A 가 고쳤다. **B 가 `9ef3a10` 으로 같은 수정을 독립적으로 했다** — 두 트랙이 서로 모르고 같은 걸 두 번 고친 증거다 |

**앞으로:** core 를 고치면 커밋 메시지에 적고 B 에게 바로 말한다.

---

## 10. 검증 명령 모음

```bash
pnpm typecheck                                          # 커밋 전 필수 · 4개 패키지
pnpm test                                               # core 657 + web 33 + worker 119 = 809
pnpm --filter @endpointer/worker test                   # 트랙 A 만
```

```bash
pnpm --filter @endpointer/worker probe <url> --no-browser        # 목록이 어디 있나
pnpm --filter @endpointer/worker create-collection <url> --no-browser --save --slug=xxx
pnpm --filter @endpointer/worker attach <slug> <url> --no-browser
pnpm --filter @endpointer/worker attach <slug> <url> --paste "deadline=D-32"
```

관문(SSRF) 확인 — 앞의 둘은 **`못 뚫음`** 이 나와야 한다:

```bash
pnpm --filter @endpointer/worker probe "http://127.0.0.1:6379" --no-browser
pnpm --filter @endpointer/worker probe "http://127.0.0.1.nip.io:6379/" --no-browser
```

### 이 문서를 갱신하는 법

- ⚠️ → ✅ 로 올릴 때는 **재현 명령을 같이 적는다.** 명령 없는 ✅ 는 신뢰할 수 없다.
- §8 의 후보를 확인했으면 재현 절차를 붙여 위로 옮긴다. **오탐이면 줄을 지우지 말고 "오탐"으로 표시한다** — 지우면 같은 것을 다시 조사한다.
- 관문 체크박스는 [gates.md](./gates.md) 가 정본이다. 여기 진도 막대는 요약일 뿐이다.
- **코드를 먼저 바꾸고 ADR 을 나중에 적지 마라.** 그 순서로는 상대 트랙이 변경을 모른다.

### 관련 문서

| 문서 | 무엇 |
|---|---|
| [`기획서-v2.md`](./기획서-v2.md) | 진실의 원천 (수정 금지) |
| [`day1-part-a.md`](./day1-part-a.md) | Day 1 기록 — 결함별 재현 절차가 여기 있다 |
| [`gates.md`](./gates.md) | 관문 판정 체크리스트 — **판정의 정본** |
| [`guardrails.md`](./guardrails.md) | 보장선 B1~B7 점검 절차 |
| [`adr.md`](./adr.md) | 기술 결정 — A27(SSRF) · A28(charset) · A29(ESM dotenv) · A30(워커 HTTP 문) |
