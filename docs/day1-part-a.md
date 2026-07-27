# Day 1 · 트랙 A — 진행 상황과 남은 일

> **트랙 A = `apps/worker`** — probe · 어댑터 컴파일 · 수집 · 검증 · 자가 치유 · 스케줄러 · 구독 발송
> (트랙 경계는 [CLAUDE.md](../CLAUDE.md) 와 기획서 14장을 따른다)

| | |
|---|---|
| 기준 커밋 | `f0a8b21` — fix: mcp 가 .env 를 못 읽어 부팅에 실패하던 것 |
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

**URL 하나가 표가 되어 화면까지 나온다. 이제 두 번째 사이트를 붙이는 일이 남았다.**

```
소스 19,089줄 · typecheck 4개 패키지 통과 · 테스트 809개 통과 (core 657 · web 33 · worker 119)
트랙 A(파이프라인) 5,262줄 — probe·컴파일·수집·치유·발송 전부 코드가 있다
트랙 B(표면)     2,909줄 — 표·REST·MCP 는 돈다. 피드·구독 화면은 없다

2026-07-27: apps/worker ──✅── DB ──✅── apps/web · apps/mcp  한 줄로 이어졌다
```

가장 중요한 한 문장: **두 출처가 한 표에서 섞여 나온다** (§5-9). 사수 대상 ②가 끝까지 돈다.
남은 것은 **화면**이다 — 트랙 B 가 `buildMockPreview` 를 워커 문으로 바꾸면 된다.

---

## 2. 관문 진도

```
G0 계약고정   ████████░░  80%   타입·스펙·DB·마이그레이션 있음 / DB 실기동 미검증
G1 URL→아이템 ██████████ 100%   낯선 URL 4곳 전부 표가 나왔다 (2026-07-27) ✅
G2 소스 접합  █████████░  90%   두 출처가 한 표에서 API·MCP 로 나온다 ✅ / 화면이 남았다  ← 지금 여기
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
| core 단위 테스트 657개 | `pnpm --filter @endpointer/core test` |
| 보장선 B2 자동 점검 33개 | `pnpm --filter @endpointer/web test` |
| worker 테스트 119개 | `pnpm --filter @endpointer/worker test` — probe·표 파싱·나가는 요청 관문·인코딩 판정 |
| 임의 URL probe (CLI) | `pnpm --filter @endpointer/worker probe <url>` |
| URL → 표 배선 (CLI) | `pnpm --filter @endpointer/worker create-collection <url>` — **LLM 키가 있어야 끝까지 간다** |
| 시드 데이터 표 화면 | 정렬·필터·출처 뱃지·원문 대조·"자동 복구 N회" 전부 있음 |
| `GET /api/v1/{slug}` | 필터·정렬·커서·`sources` 부분성공 블록 |
| MCP 도구 4개 | `list_items` · `search_items` · `get_schema` · `get_sources_status` |

**구글 로그인 키는 채워졌다** (2026-07-27). 다만 **로그인한 화면을 아직 아무도 확인하지 않았다** —
`/collections/*` 는 전부 로그인 뒤에 있어서, 사람이 한 번 들어가 보기 전까지 표 화면은 미검증이다.

**테스트가 없는 곳: `apps/mcp` 0개.** (`apps/worker` 는 0개였다가 119개가 됐다 — probe·표 파싱·관문·인코딩.)
아직 무검증인 곳이 **사수 대상 ②④ 자체다** — `matchFields`·`traceValue`·자가 치유에는 테스트가 없다.

---

## 4. 트랙 A 파일별 상태

### probe — 기획서 9-1① · ADR A3

| 단계 | 파일 | 상태 |
|---|---|---|
| 1. 인라인 JSON 스캔 | [`probe/inline-json.ts`](../apps/worker/src/probe/inline-json.ts) | ⚠️ 구현됨 (`__NEXT_DATA__` 위주, §6 참조) |
| 2. 네트워크 관찰 | [`probe/network.ts`](../apps/worker/src/probe/network.ts) | ⚠️ 구현됨 |
| 3. **DOM 반복 구조** | [`probe/dom.ts`](../apps/worker/src/probe/dom.ts) | ✅ **검증됨** — 낯선 사이트 3곳에서 본 목록을 집었다 (아래) |
| 4. 브라우저 렌더 | [`fetchers/browser.ts`](../apps/worker/src/fetchers/browser.ts) | ⚠️ 구현됨 |
| 후보 순위 (겹침률) | [`probe/rank.ts`](../apps/worker/src/probe/rank.ts) | ⚠️ 구현됨 |

**3단계 실측** — `--no-browser` 로 정적 GET 만 써서 (2026-07-27):

| 사이트 | 뚫은 경로 | 집은 것 |
|---|---|---|
| k-startup.go.kr | `css:ul > li.notice` | 공고 15건 · 겹침 100% |
| bizinfo.go.kr | `css:tbody > tr` | 지원사업 15건 · 겹침 100% |
| wevity.com | `css:.list > li` | 공모전 16건 · 겹침 100% |

세 곳 다 인라인 JSON 도 XHR 도 없는 **서버렌더 HTML** 이다. 이 형태가 한국 공공 목록의 지배적 형태이고,
3단계가 비어 있던 동안은 구조적으로 못 뚫던 것이다. bizinfo 는 `<table>` 이라 §5-2 수정이 같이 있어야 값이 나온다.

> **얕게 묶는다** — 시그니처는 행 자신과 직계 자식까지만 본다. 더 깊이 보면 `span.dday.ing`/`.soon`/`.end`
> 같은 **행마다 바뀌는 상태 클래스** 때문에 같은 목록이 여러 묶음으로 쪼개진다 (wevity 16행 → 7+4+4+1).
> 얕게 봐서 엉뚱한 게 섞이는 위험은 **선택자를 실제로 돌려 보는 검증**과 글자 길이 필터가 막는다.

### 나가는 요청 — ADR A27

| 파일 | 상태 |
|---|---|
| [`fetchers/guard.ts`](../apps/worker/src/fetchers/guard.ts) | ✅ **검증됨** — 글자·이름 풀기·리다이렉트 세 겹 (§5-6 에 재현 명령) |
| [`fetchers/http.ts`](../apps/worker/src/fetchers/http.ts) | ✅ 리다이렉트를 손으로 따라가며 홉마다 관문 · bizinfo 가 실제로 1회 넘긴다 |
| [`fetchers/browser.ts`](../apps/worker/src/fetchers/browser.ts) · [`probe/network.ts`](../apps/worker/src/probe/network.ts) | ⚠️ 첫 주소는 이름까지 확인, 페이지가 내는 요청은 **글자만** 본다 (수백 개라 이름 풀기를 못 건다) |
| [`jobs/channels/webhook.ts`](../apps/worker/src/jobs/channels/webhook.ts) | ⚠️ 관문 통과 + 리다이렉트를 아예 안 따라간다. 발송 자체는 아직 실기동 미검증 |

### 어댑터 컴파일 — 기획서 9-1② · 11장

| 파일 | 상태 | 호출부 |
|---|---|---|
| [`compile/gemini.ts`](../apps/worker/src/compile/gemini.ts) | ⚠️ 구현됨 | — |
| [`compile/compile-spec.ts`](../apps/worker/src/compile/compile-spec.ts) | ⚠️ 구현됨 | **`compileSpec` 없음** / `recompileSpec` 은 heal 이 부름 |
| [`compile/match-fields.ts`](../apps/worker/src/compile/match-fields.ts) | ✅ **검증됨** — 낯선 사이트 2곳 (§5-9) | `pipeline/attach-source.ts` |
| [`compile/trace-value.ts`](../apps/worker/src/compile/trace-value.ts) | ✅ **검증됨** — 붙여넣기 루프 완주 (§5-9) | `pipeline/attach-source.ts` |
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

> **워커에 HTTP 진입점이 생겼다** ([`http/index.ts`](../apps/worker/src/http/index.ts) · ADR A30).
> 미리보기·생성은 이 문으로 부른다. 정기 수집은 지금처럼 큐로 남는다.
> **수동 수집 트리거(G3)는 아직 없다** — 같은 문에 경로 하나를 더 내면 된다.

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

### 5-2. 표 기반 목록 사이트에서 html/browser 경로가 전멸한다 🔴 → ✅ **고침 (2026-07-27)**

`load(html, null, false)` 로 조각 모드 파싱한다. 회귀 테스트는
[`cheerio-adapter.test.ts`](../apps/worker/src/fetchers/cheerio-adapter.test.ts) — 되돌리면 4개가 깨진다.
아래는 무엇이었는지의 기록이다.

[`cheerio-adapter.ts`](../apps/worker/src/fetchers/cheerio-adapter.ts) 가 행 조각을 문서 모드
`load(html)` 로 파싱했다. cheerio 는 `<table>` 없이 떠 있는 `<tr>`·`<td>` 를 파싱 단계에서 버린다.

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

### 5-6. 사용자가 준 주소로 서버가 내부망을 열 수 있었다 (SSRF) 🔴 → ✅ **고침 (2026-07-27)**

나가는 요청이 전부 [`fetchers/guard.ts`](../apps/worker/src/fetchers/guard.ts) 를 지난다.
아래는 무엇이었는지의 기록이다.

core 에 `isPrivateHost` 가 있었지만 **스펙 검증에서만** 불렸다. 스펙은 LLM 이 만든 뒤에나 생기는데
probe 는 그 전에 사용자가 준 주소로 이미 나간다. 그래서 `probe http://127.0.0.1:6379` 가 그대로 통했다.
웹훅 발송([`jobs/channels/webhook.ts`](../apps/worker/src/jobs/channels/webhook.ts))은
더해서 **본문까지 실어** 보냈다.

세 겹으로 막는다. 아래가 각 겹의 재현 명령이다 — 앞의 둘은 `못 뚫음` 이 나와야 한다.

```bash
# ① 글자 — 주소에 대놓고 적은 내부 주소
pnpm --filter @endpointer/worker probe "http://127.0.0.1:6379" --no-browser
# ② 이름 풀기 — 공인 도메인인데 127.0.0.1 로 풀린다 (글자만 봐서는 절대 안 걸린다)
pnpm --filter @endpointer/worker probe "http://127.0.0.1.nip.io:6379/" --no-browser
# ③ 리다이렉트 — 홉마다 다시 본다 (모의 응답으로 검증)
pnpm --filter @endpointer/worker test -- --run http
```

`--allow-private` 를 붙이면 셋 다 열린다. 로컬 픽스처로 파이프라인을 돌릴 때만 쓴다.

**남은 구멍 (알고 남긴다)** — 검사한 뒤 `fetch` 가 이름을 다시 푼다. 그 사이 답이 바뀌면
(DNS 리바인딩) 검사한 주소와 실제로 붙는 주소가 달라진다. 막으려면 검사된 IP 로 고정해 붙어야 하는데
Node 내장 fetch 로는 붙을 주소를 지정할 수 없다 (undici 직접 의존 필요 → ADR 먼저).

### 5-7. EUC-KR 페이지의 글자가 통째로 깨진 채 "성공" 으로 넘어갔다 🔴 → ✅ **고침 (2026-07-27)**

`res.text()` 는 **응답 헤더의 charset 만** 본다. 헤더에 없으면 UTF-8 로 읽는다.
헤더에 charset 을 안 적고 `<meta charset="euc-kr">` 로만 적어 둔 사이트가 아직 있다.

**재현 대상을 찾았다: 대한상공회의소** — 헤더는 `Content-Type: text/html` (charset 없음),
본문은 `<meta charset="euc-kr">`.

```bash
pnpm --filter @endpointer/worker probe \
  "https://www.korcham.net/nCham/Service/Kcci/appl/KcciNoticeList.asp" --no-browser
```

고치기 전 — **뚫림 · 겹침 100% · 15개**, 그런데 샘플이 이랬다:

```
1933 ���Ļ�������ڶ�ȸ(WCE) �������̺� �������... �ѹ��� 2026.07.24
```

**이 실패가 위험한 이유가 저 100% 다.** 반복 구조도 찾고 항목 수도 맞고 날짜·번호(ASCII)도 정상이다.
겹침률조차 100% 로 나온다 — 화면 텍스트도 똑같이 깨져서 둘이 일치하기 때문이다.
우리가 가진 **어떤 품질 신호에도 안 걸린다.** 사람이 글자를 눈으로 보기 전까지 아무도 모른다.

고친 뒤 같은 명령:

```
● DOM 반복 구조  ... HTML 43,844자 (242ms) · euc-kr 로 읽음 · script 9개 검사
  1933 기후산업국제박람회(WCE) 라운드테이블 행사대행업... 총무팀 2026.07.24
```

[`fetchers/charset.ts`](../apps/worker/src/fetchers/charset.ts) 가 브라우저와 같은 순서로 정한다:
**BOM → 헤더 → `<meta>`(앞 4KB) → UTF-8.** JSON 응답은 명세대로 UTF-8 고정이라 `<meta>` 를 뒤지지 않는다
(게시글 본문에 HTML 조각이 든 API 가 흔하다). `cp949` 처럼 표준 라벨이 아닌 이름은 별칭표로 받는다.

utf-8 이 아니면 **probe 단계 기록에 적는다** (`euc-kr 로 읽음`). 조용히 고치면 고쳤는지도 모른다.

브라우저(Playwright) 경로는 이 파일을 안 탄다 — 크롬이 이미 제대로 디코딩해 `page.content()` 로 준다.

### 5-8. LLM 이 값을 지우는 변환을 내서 칸 하나가 영원히 비었다 🔴 → ✅ **고침 (2026-07-27)**

컬렉션을 처음 저장했더니 `organization` 칸이 15/15 전부 비었다. 셀렉터는 맞았고 원값도 잡혔다 —
`raw_json._fields.organization` 에 `"재단법인 글로벌디지털혁신네트워크"` 가 그대로 있었다.
LLM 이 낸 변환이 그걸 지웠다:

```json
{"op": "replace", "flags": "g", "pattern": ".*", "replacement": ""}
```

`replace(/.*/g, '')` 는 무엇을 넣든 빈 문자열이다.

**보고서는 `null_ratio: 1` 로 정확히 기록했고 CLI 도 찍었다. 그런데 저장을 막는 것이 없었다** —
빈 칸이 그대로 DB 에 앉고 API 로 나갔다.

정적 검사("이 정규식이 파괴적인가")는 일반적으로 풀 수 없다. `.*` 는 파괴적이지만 `\s*` 는 아니고
(`'abc'.replace(/\s*/g,'')` 는 `'abc'` 다) 그 사이에 무한한 회색지대가 있다.
**우리는 컴파일 시점에 이미 행을 들고 있으므로 돌려 보고 판단한다** ([`pipeline/repair-empty.ts`](../apps/worker/src/pipeline/repair-empty.ts)):

| 값이 비었다 + | 판단 | 조치 |
|---|---|---|
| 원값은 있었다 | 변환이 죽였다 | **변환만 버리고 다시 뽑는다** (페이지는 캐시라 공짜) |
| 원값도 없었다 | 경로가 틀렸다 | **칸을 뺀다** + 사용자에게 알린다 |

마지막 칸까지 빼지는 않는다. 빈 칸 하나보다 표가 통째로 없는 게 나쁘다.
`null_ratio` 를 쓰지 않고 값을 직접 세는 이유는 **잡으려는 게 `null` 이 아니라 빈 문자열**이라서다.

실측 (그때 LLM 이 낸 스펙을 캐시에서 꺼내 실제 페이지에 적용):

```
고치기 전   organization  채워짐  0/15   (전부 빔)
판단        변환을 버릴 칸: organization
고친 뒤     organization  채워짐 15/15   성남산업진흥원
최종        남은 칸: title, link, organization, deadline, category, posted_at
```

**칸을 지운 게 아니라 살렸다.** 다른 캐시 스펙에서는 링크 경로가 `javascript:go_view(...)` 를 집어
정규화가 전부 거절했고, 그때는 규칙대로 칸이 빠지면서 "값이 하나도 없어서 상세링크 칸은 뺐어요" 가 떴다.

### 5-9. 두 번째 사이트 접합 — 기능 ② 가 돈다 ✅ **(2026-07-27)**

[`pipeline/attach-source.ts`](../apps/worker/src/pipeline/attach-source.ts) + `pnpm --filter @endpointer/worker attach <slug> <url>`.

이 기능의 성패는 숫자 하나다: **사용자가 손으로 채워야 하는 칸이 몇 개인가.**

| 붙인 사이트 | 자동 | 물어봄 | 항목 |
|---|---|---|---|
| k-startup → `bizinfo` 표 | **5/6** | 1 (원문 링크) | 15 |
| wevity → `bizinfo` 표 | 4/6 | 2 (마감일·등록일) | 21 |
| wevity + `--paste "deadline=D-32"` | **5/6** | 1 (등록일) | 21 |

붙여넣기 루프가 실제로 돈다 — `D-32` 를 넣으니 `css:div.day` 를 찾았고, 날짜 정규화가
`D-32 접수중` 을 **`2026-08-28`** 로 바꿨다. **LLM 없이** 결정론적으로 (보장선 B1).

**이 흐름을 만들면서 잡은 결함 넷** — 넷 다 "그럴듯한데 틀린" 부류다:

1. **매핑이 CSS 경로를 지어냈다.** `matchFields` 가 `candidate.rows` 를 프롬프트에 넣었는데,
   그건 화면에 보이는 **글자**다 (`probe/types.ts` 의 rows 주석). HTML 을 한 번도 못 본 채
   선택자를 쓰라고 시킨 셈이라 `.tit`·`.organ` 같은 걸 지어내고 확신도는 1.0 으로 적었다.
   **"6개 전부 찾음" 인데 항목은 0개였다.** `discover.ts` 는 처음부터 `row_html` 을 쓰고 있었다.
2. **LLM 의 `list` 가 probe 의 것을 덮었다.** probe 는 선택자를 실제로 돌려 몇 행이 나오는지까지
   보고 고른다. 그걸 검증 안 된 추측(`css:.list_item` — 없는 선택자)으로 덮어써서 0건이 됐다.
   **확인된 값이 이긴다.**
3. **`missing` 이 있으면 스펙이 통째로 거절됐다.** `validateSpec` 이 필수 칸을 전부 요구해서,
   등록일 하나 못 찾은 wevity 는 미리보기조차 못 봤다. 그런데 **못 찾은 칸을 물어보는 게
   이 기능의 핵심이다.** 찾은 칸만 담은 스키마로 검증하게 고쳤다.
4. **지어낸 주소가 모든 검사를 통과했다** ([`verify-link.ts`](../apps/worker/src/pipeline/verify-link.ts)).
   href 가 `javascript:go_view(178642);` 인 사이트에서 LLM 이 번호를 뽑아 주소 틀에 끼웠는데,
   그 틀을 지어냈다:

   ```
   https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do?view=178642
   → HTTP 200 · 그런데 열리는 건 목록 페이지다 (서버가 ?view 를 무시한다)
   진짜는 .../detail.do?sn=178642
   ```

   **주소 문법 맞고, 칸 안 비고, 항목마다 값이 다 다르다.** 우리가 가진 어떤 검사도 못 잡는다.
   사용자가 눌러 보고서야 아는데, 그때는 이미 "이 제품은 거짓말을 한다" 가 된다.
   그래서 **첫 링크를 한 번 열어 본다** — 열린 페이지에 다른 항목 제목이 여러 개 있으면 목록이다.
   확실하지 않으면 통과시킨다 (멀쩡한 링크를 의심해 물어보면 그게 지는 싸움이다).

**저장까지 된다** (`persistAttachedSource` · `attach --save`). 컬렉션은 만들지 않고 사이트만 더 앉힌다 —
실패하면 방금 만든 사이트만 지운다 (컬렉션을 지우면 첫 사이트까지 날아간다).

```
GET /api/v1/bizinfo → 30건
   www.bizinfo.go.kr    15건    링크 있음
   www.k-startup.go.kr  15건    링크는 (없음 — 물어볼 칸)
MCP get_sources_status → 두 사이트 다 "정상 · 15건"
```

**두 출처가 같은 여섯 칸으로, 같은 ISO 날짜 형식으로 섞여 나온다.** 그게 G2 판정문이다.

> **다섯 번째 결함 — 말한 것과 저장한 것이 달랐다** 🔴 → ✅
> 위 ④의 거짓 링크를 잡아 "못 만들었어요" 라고 **말해 놓고**, `missing` 에만 넣고
> 스펙·항목에서는 안 빼서 **그 값이 그대로 저장되고 API 로 나갔다.**
> 빼는 자리를 한 곳으로 모으고, `missing` 에 든 칸은 스펙에도 항목에도 없어야 한다는
> 불변식을 [`attach-source.test.ts`](../apps/worker/src/pipeline/attach-source.test.ts) 에 박았다.
> 사용자에게 하는 말과 DB 에 넣는 것이 다른 게 제일 나쁜 거짓말이다.

> **곁가지** — wevity 의 `소관부처` 첫 값이 `주최사` 로 나온다. 목록의 첫 행이 머리글인데
> probe 가 그걸 항목으로 센다. 머리글 행 걸러내기는 아직 없다.

---

## 6. 미검증 결함 후보 ⚠️

코드 감사에서 나왔으나 **아직 돌려보지 않았다.** 손대기 전에 재현부터 하라.
(§5 의 5건은 같은 감사에서 나와 검증에 전부 살아남았으므로, 아래도 상당수는 진짜일 가능성이 높다.)

| 곳 | 주장 | 급 |
|---|---|---|
| [`fetchers/http.ts`](../apps/worker/src/fetchers/http.ts) | `res.text()` 가 헤더 charset 만 봐서 `<meta>` 에만 EUC-KR 을 적은 사이트가 깨진다. **✅ 실제 사이트(korcham.net)로 재현했고 고쳤다 — §5-7** | ✅ |
| [`fetchers/http.ts`](../apps/worker/src/fetchers/http.ts) | fetch 계층에 사설망 차단이 없다 → SSRF. **✅ 검증됐고 고쳤다 — §5-6** | ✅ |
| [`spec/validate.ts`](../packages/core/src/spec/validate.ts) | `isPrivateHost` 가 IPv4 사상 IPv6(`::ffff:…`)를 못 거른다. **✅ 검증됐고 고쳤다 — §5-6** (core 수정 · 트랙 B 통보 대상) | ✅ |
| [`fetchers/browser.ts`](../apps/worker/src/fetchers/browser.ts) | browser 모드만 HTTP 상태를 안 본다 → 404 페이지가 "수집 성공·0건" | 🟡 |
| [`probe/inline-json.ts`](../apps/worker/src/probe/inline-json.ts) | `__NEXT_DATA__` 만 그릇으로 잡아 Nuxt3·SvelteKit·Remix 페이로드 누락 | 🟡 |
| [`jobs/heal.ts:107`](../apps/worker/src/jobs/heal.ts) | json 모드 소스의 치유에서 네트워크 관찰을 꺼서 깨진 내부 API 재발견 경로가 막힘 | 🟡 |
| [`jobs/heal.ts:195`](../apps/worker/src/jobs/heal.ts) | 치유 **실패**가 `runs` 에 안 남는다 → 기능 ④의 "로그로 쌓기" 절반이 없음 | 🟡 |
| [`db.ts:135`](../apps/worker/src/db.ts) | `startRun` 이 진행 중 런을 `status:'ok'` 로 넣고 try/finally 가 없음 → 유령 런 | 🟡 |
| [`auth.ts:38`](../apps/web/auth.ts) | ✅ **검증됨** — DB 를 못 붙어 JWT 로 강등되면 `session` 콜백에 `user` 가 안 와(`token` 이 온다) `session.user.id` 가 영영 안 채워진다 → `currentUser()` 가 항상 `null`. 폴백 경로가 사실상 작동하지 않는다 | 🟡 |
| [`spec/interpret.ts:260`](../packages/core/src/spec/interpret.ts) | `external_key` 폴백이 `'title'` 을 하드코딩 → 없으면 row_hash 로 떨어져 매 수집 전량 신규 (구독 스팸) | 🟡 |
| [`normalize/number.ts:47`](../packages/core/src/normalize/number.ts) | 단위 앞 숫자를 합산 → 연도·회차가 금액에 더해짐 | 🟡 |
| [`db/seed.ts`](../packages/core/src/db/seed.ts) | seed 의 `raw_json` 형태가 파이프라인과 달라, 실수집 한 번에 원문 대조 툴팁이 사라짐 | 🟡 |

---

## 7. 남은 일 — 순서대로

### 7-1. 지금 당장 (G1 통과용)

1. ~~`probe/dom.ts` 구현~~ — **됐다** (2026-07-27). §4 의 실측 표 참조.
2. ~~§5-2 cheerio 행 조각 파싱~~ — **됐다.** 회귀 테스트 있음.
3. ~~SSRF·사설망 차단~~ — **됐다** (2026-07-27). §5-6 에 세 겹과 재현 명령이 있다.
4. ~~charset~~ — **됐다** (2026-07-27). korcham.net 으로 재현하고 고쳤다. §5-7.
   **§6 의 🔴 는 이제 없다.**
5. ~~`GEMINI_API_KEY` 로 진짜 G1 판정~~ — **통과했다 (2026-07-27). 아래 참조.**

#### G1(A) 판정 결과 ✅ — 낯선 URL 4곳 전부 표가 나왔다

`create-collection <url> --no-browser`. 판정 조건은 "3개 중 2개 이상" 이었다.

| 사이트 | 칸 | 항목 | LLM | 시간 |
|---|---|---|---|---|
| k-startup.go.kr | 6 | 15 | 2회 | 4.9초 |
| bizinfo.go.kr | 6 | 15 | 2회 | 8.6초 |
| wevity.com | 5 | 20 | 2회 | 10.0초 |
| korcham.net (EUC-KR) | 4 | 15 | 2회 | 5.6초 |

네 곳 다 `DOM 반복 구조` 로 뚫렸고 겹침 100%. 날짜는 `2026-08-05` 로, 링크는 절대 주소로 정규화됐다.
**정기 수집 경로에 LLM 은 없다** — 컴파일 때 2회가 전부다 (원칙 ①).

**여기까지 오는 데 두 가지를 고쳐야 했다:**

- **`columns` 의 `maxItems: 12` 때문에 Gemini 가 스키마 전체를 400 으로 거부했다.**
  키가 있어도 `create-collection` 이 한 번도 못 돌던 진짜 이유다. 지원 목록에 있는 키워드인데도
  원소가 복잡한 배열에서는 거부된다. 상한은 설명 문구와 파서에서 건다 (`json-schema.ts` 머리말).
- **`queryClient.json()` 이 `prepare: false` 와 함께 깨진다** (postgres.js 3.4.9).
  `finishRun` 이 매번 죽어서 `--save` 가 불가능했다. `JSON.stringify` 로 바꿨다.

### 7-2. 그 다음 (G2 — 합류 지점 · 트랙 B와 같이)

**이게 제품이 성립하는 지점이다.** 트랙 A 가 낼 것은 "URL 하나 → 이미 채워진 표" 를 돌려주는 진입점이다.

> #### 두 트랙을 같이 띄워봤다 (2026-07-27) ✅
>
> **원격에 트랙 B 의 작업물은 아직 없다.** `origin` 에 있는 브랜치는 `main`(스캐폴딩)과
> `pipeline`(트랙 A) 둘뿐이고, `apps/web`·`apps/mcp` 를 건드린 커밋은 스캐폴딩과 내 것뿐이다.
> 그래서 **"합쳐서 테스트" 는 지금 시점에선 스캐폴딩 표면과 붙여 보는 것**이 된다. 그건 해봤고 돌아간다:
>
> | 확인한 것 | 결과 |
> |---|---|
> | postgres·redis 컨테이너 | 37시간째 healthy · 마이그레이션·시드 적용됨 (컬렉션 1 · 항목 20 · 소스 2 · 런 6) |
> | `GET /api/v1/contest?limit=2` | 200 · `items`·`sources`·`schema_version`·`page.next_cursor` 다 나온다 |
> | 인증 | 컬렉션 페이지는 307 → `/` · API 는 `unlisted` 라 열림 (`isAuthorized` 가 실제로 판정한다) |
> | 첫 화면 | "목록이 있는 페이지 주소를 붙여넣어 주세요" — B2 위반 문구 없음 |
> | MCP 도구 4개 | `POST /contest` → `list_items`·`search_items`·`get_schema`·`get_sources_status` |
> | MCP 실호출 | `list_items(limit:2)` → 시드 항목 2건 + 사이트 상태 블록 |
>
> **막고 있던 것 하나를 고쳤다** — `pnpm dev:mcp` 가 `DATABASE_URL: undefined` 로 부팅조차 못 했다.
> ESM 이 `import` 를 본문보다 먼저 평가해서, `index.ts` 맨 위의 `loadDotenv()` 보다
> `@endpointer/core/db` 가 먼저 돌았기 때문이다. `load-env.ts` 로 빼서 첫 import 로 부른다 (ADR A29).
> **`apps/mcp` 는 트랙 B 디렉터리지만 깨뜨린 커밋이 `fdebef9`(내 것)이라 내가 고쳤다 — B 에게 알릴 것.**
>
> #### 트랙 A 가 만든 데이터를 파이프에 흘려봤다 (2026-07-27) ✅
>
> ```bash
> pnpm --filter @endpointer/worker create-collection \
>   "https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do" \
>   --no-browser --save --name="창업 지원사업" --slug=startup
> ```
>
> **URL 하나 → 표 → DB → REST → MCP 가 처음으로 한 줄로 이어졌다.**
>
> - `GET /api/v1/startup` → 15항목 · `sources` 에 `www.k-startup.go.kr` `status: ok`
> - MCP `list_items` → 같은 항목이 사람이 읽는 문장으로
>
> **다만 칸 하나(`organization`)가 15/15 전부 비었다.** 셀렉터는 맞았고 원값도 잡혔다
> (`raw_json._fields.organization` = `"재단법인 글로벌디지털혁신네트워크"`). LLM 이 낸 변환이 지웠다:
>
> ```json
> {"op": "replace", "flags": "g", "pattern": ".*", "replacement": ""}
> ```
>
> `replace(/.*/g, '')` 는 무엇을 넣든 빈 문자열이다. 검증 보고서는 `null_ratio: 1` 로 **정확히 기록했고**
> CLI 도 "값이 자주 비는 칸" 으로 찍는다. **그런데 저장을 막는 것은 아무것도 없었다** —
> 영원히 비는 칸이 그대로 API 로 나간다. 아래 7-2 의 새 항목.

> #### 이음매가 뚫렸다 (2026-07-27) ✅ — ADR A30
>
> 워커에 HTTP 진입점이 생겼다 ([`http/index.ts`](../apps/worker/src/http/index.ts)).
>
> | | |
> |---|---|
> | `GET /healthz` | |
> | `POST /internal/preview` | 주소 → 이미 채워진 표. **저장하지 않는다** |
> | `POST /internal/collections` | 같은 것 + DB 에 앉히기 |
>
> **`WORKER_INTERNAL_TOKEN` 이 없거나 16자 미만이면 문을 아예 열지 않는다.** 열어 두면
> 이 서버는 "아무 주소나 대신 열어 주는 공개 서비스" 가 된다 — 관문이 사설망을 막아도
> 공인 주소로는 얼마든지 남을 대신 때릴 수 있다. 기본 바인드는 `127.0.0.1` 이다.
>
> **클라이언트가 준 스펙을 실행하지 않는다.** 미리보기 스펙을 화면에 내려보냈다가 저장할 때
> 돌려받는 설계가 편해 보이지만, 스펙은 "어느 주소를 어떻게 긁을지" 이므로 그건 곧 임의 요청
> 실행이다. 저장할 때 **주소만 받아 다시 돈다** — HTTP·LLM 캐시 덕에 두 번째는 거의 공짜다.
>
> ```bash
> curl -s -X POST http://127.0.0.1:3003/internal/collections \
>   -H "Authorization: Bearer $WORKER_INTERNAL_TOKEN" -H "Content-Type: application/json" \
>   -d '{"url":"https://www.bizinfo.go.kr/...","owner_id":"...","skip_browser":true}'
> # → {"ok":true,"slug":"bizinfo","name":"지원사업 공고","items_inserted":15}
> ```
>
> **남은 것은 트랙 B 쪽 한 곳** — `apps/web/lib/create.ts` 의 `buildMockPreview` 를 이 문 호출로 바꾸는 일.
>
> 이 문을 붙이며 잡은 결함 둘 (둘 다 화면 첫인상에 바로 보이는 것):
> - `collectionNameFrom('K-Startup 사업공고')` → **`"K"`**. 낱말 안 하이픈에서 잘랐다.
>   구분자 양옆에 공백이 있을 때만 자르고, 빵부스러기(`A>B>C`)는 **끝**을 쓰게 고쳤다.
> - `slugFrom(host, '기업마당>정책정보>지원사업 공고')` → **`"---"`**. 한국어를 지우고 남은
>   하이픈 세 개가 "3글자" 로 통과했다. 길이가 아니라 **글자 수**를 세게 고쳤다.

5. ~~컬렉션 생성 경로 배선~~ — **함수까지는 됐고, 부르는 문도 생겼다** (`pipeline/create-collection.ts` + `http/index.ts`).
   `probe → discoverSpec → runAdapter` 가 한 함수로 묶였고 CLI 로 끝까지 돌려볼 수 있다.
   **남은 것은 그것을 트랙 B 가 부를 수 있게 노출하는 일이다** — 큐 잡(`enqueueCreate` 신설)이냐
   워커 HTTP 엔드포인트냐. **어느 쪽으로 할지 B와 먼저 합의할 것.**
   - `create-collection.ts` 는 DB 를 모른다 → 화면의 "미리보기" 가 저장 없이 같은 코드를 부를 수 있다
   - 저장은 `pipeline/persist.ts` 가 따로 한다 → 사용자가 표를 **보고 나서** 저장한다 (보장선 B3)
5-1. ~~항상 비는 칸을 만들어 내지 않게 한다~~ — **됐다** (2026-07-27). §5-8.
6. ~~`matchFields` 배선~~ — **됐다** (2026-07-27). §5-9.
7. ~~`traceValue` 배선~~ — **됐다.** 붙여넣기 루프가 실제로 돈다. §5-9.
7-1. ~~접합 결과를 저장하는 경로~~ — **됐다** (`persistAttachedSource`). §5-9.
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
- ~~`apps/worker` 에 HTTP 진입점이 **없다**~~ → 생겼다 (ADR A30). 남은 건 web 쪽 `buildMockPreview` 교체 한 곳

**7-2 의 5번이 이 그림을 바꾸는 한 수다.** 그거 하나 붙는 순간 기능 ①②④가 동시에 살아난다.
반대로 그걸 안 붙이면 코드를 아무리 더 써도 G5 에서 녹화할 장면이 안 생긴다.

---

## 9. 검증 명령 모음

```bash
pnpm typecheck                              # 커밋 전 필수
pnpm test                                   # core 655 + web 33 + worker 74
pnpm --filter @endpointer/worker probe <url>              # 임의 URL probe
pnpm --filter @endpointer/worker probe <url> --allow-private   # 로컬 픽스처용 (관문을 연다)

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
  §5 의 5-1·5-3·5-4·5-5 가 전부 core 수정이고, **5-6 은 이미 고쳤다** (`isPrivateHost` — 더 많이 막는
  방향이라 통과하던 게 막힐 수는 있어도 그 반대는 없다). 혼자 고치면 상대 트랙이 조용히 깨진다.

### 관련 문서

| 문서 | 무엇 |
|---|---|
| [`기획서-v2.md`](./기획서-v2.md) | 진실의 원천 (수정 금지) |
| [`gates.md`](./gates.md) | 관문 판정 체크리스트 — **판정의 정본** |
| [`guardrails.md`](./guardrails.md) | 보장선 B1~B7 점검 절차 |
| [`adr.md`](./adr.md) | 기술 결정 — **기술 변경은 여기부터** |
