# endpointer

> **세상에 없는 카테고리를, 원문까지 확인 가능한 상태로, 계속 살아있게 만드는 도구.**

다나와는 남이 정해준 카테고리만 비교할 수 있다. 내가 궁금한 건 이번 달 마감인 디자인 공모전인데, 그런 다나와는 세상에 없다.
URL 몇 개를 붙이면 그 주제의 다나와가 생기고, 표로도·읽기로도·API 로도·MCP 로도 쓴다.

강점은 셋이다 (스펙 델타 1-1 — "자유도"라는 말은 쓰지 않는다):

| | 무엇 | 답하는 질문 |
|---|---|---|
| **정의권** | 세상에 없는 카테고리를 사용자가 만든다 | 왜 필요한가 |
| **원문 대조** | 자동으로 모았지만 원문으로 확인할 수 있다 | 믿을 수 있는가 |
| **지속** | 한 번 만들면 살아서 갱신된다 | 왜 API 인가 |

제품의 전모는 [`docs/기획서-v2.md`](./docs/기획서-v2.md) + [`docs/spec-delta-0727.md`](./docs/spec-delta-0727.md)(07-27 논의로 확정된 변경 — 뷰·작업실·능동성)에 있다. 이 README 는 저장소를 돌리는 법만 다룬다.

---

## 저장소 구조

```
26s-w4-c1-02/
├─ apps/
│  ├─ web/            @endpointer/web     Next 16 App Router · 포트 3000
│  │                                      화면 · 인증 · 관리 API · 공개 v1 API   [트랙 B]
│  ├─ worker/          @endpointer/worker  tsx 실행 · 진입점 src/index.ts
│  │  └─ src/probe/                        수집 · 어댑터 컴파일 · 검증 · 자가 치유 · 발송  [트랙 A]
│  └─ mcp/             @endpointer/mcp     tsx 실행 · 포트 3002
│                                          MCP Streamable HTTP 서버              [트랙 B]
├─ packages/
│  └─ core/            @endpointer/core    빌드 없음. 세 앱이 소스 그대로 소비한다  [공유]
│     ├─ src/types/       도메인 타입 — Collection · Source · Adapter · Item · Run · Subscription
│     ├─ src/spec/        어댑터 스펙(zod) · 변환 연산자 · 경로 평가 · 해석기
│     ├─ src/normalize/   date · money · number · text · link · enum 파서
│     ├─ src/validate/    드리프트 판정 · 기준선 · 겹침률
│     ├─ src/query/       REST 와 MCP 가 공유하는 쿼리·응답 조립
│     ├─ src/db/          Drizzle 스키마 · 클라이언트 · 마이그레이션 러너 · 시드
│     └─ src/env.ts       환경변수 zod 검증
├─ demo-board/        발표용 데모 사이트 — 의존성 0 단일 파일 게시판 → demo-board/README.md
│                    (알림·자가 치유는 원본이 변해야 보인다. 남의 사이트는 못 바꾸므로 직접 띄운다)
├─ deploy/            배포용 compose · Caddyfile · Dockerfile 3종 → deploy/README.md
├─ docs/              기획서 · 관문 · 보장선 · ADR
├─ docker-compose.yml   로컬 인프라만 (postgres 16 · redis 7)
├─ tsconfig.base.json   전 패키지 공통 컴파일러 옵션
└─ pnpm-workspace.yaml
```

`core` 가 웹과 워커와 MCP 모두에 들어간다. **어댑터 스펙 해석기가 여기 있는 게 중요하다** —
화면의 "미리보기"와 워커의 "정기 수집"이 같은 코드로 돌아야 미리보기가 거짓말을 하지 않는다.

## 시작하기

필요한 것: **Node 24** (또는 22 이상), **Docker**, pnpm.

```bash
corepack enable                    # package.json 의 packageManager 로 pnpm 11.17 고정
pnpm install

cp .env.example .env               # DATABASE_URL 은 기본값 그대로 두면 아래 컨테이너와 맞는다
                                   # AUTH_SECRET 은 `openssl rand -base64 32`

pnpm infra:up                      # postgres 5432 · redis 6379
pnpm db:migrate                    # 마이그레이션 적용 (SQL 은 저장소에 있다)
pnpm db:seed                       # 가짜 컬렉션 1개 · 사이트 2개 · 항목 20개 (멱등)

pnpm dev                           # web 3000 · worker · mcp 3002
```

마이그레이션 SQL 은 `packages/core/drizzle/` 에 커밋돼 있다 (0000~0005). `pnpm db:generate` 는
**`packages/core/src/db/schema.ts` 를 고쳤을 때만** 돌린다 — 새로 클론했다면 `db:migrate` 부터 하면 된다.

구글 로그인을 쓰려면 `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` 이 필요하다
(승인된 리디렉션 URI: `http://localhost:3000/api/auth/callback/google`).
LLM 은 컴파일 시에만 호출되므로 화면과 API 만 볼 거면 `GEMINI_API_KEY` 없이도 돈다.

### 그 밖의 명령

| 명령 | 하는 일 |
|---|---|
| `pnpm typecheck` | 전 패키지 `tsc --noEmit`. 커밋 전 필수 |
| `pnpm test` | 전 패키지 vitest |
| `pnpm db:reset` | 볼륨까지 날리고 migrate + seed |
| `pnpm db:studio` | Drizzle Studio |
| `pnpm infra:down` / `infra:logs` | 컨테이너 내리기 / 로그 |
| `pnpm dev:web` · `dev:worker` · `dev:mcp` | 하나만 띄우기 |

## 어떻게 돌아가는가

두 흐름만 알면 전체가 읽힌다. **표를 만드는 길**과 **표를 갱신하는 길**이다.

### 표를 만드는 길

```
주소 붙여넣기 → ① probe → ② compile → ③ validate → 표 완성
```

| 단계 | 하는 일 | 실패하면 |
|---|---|---|
| **① probe** | 목록이 어디 있는지 찾는다 — 인라인 JSON → 내부 API → DOM → 브라우저 순서로, **싼 것부터** 시도하고 찾으면 멈춘다. 후보마다 화면 텍스트와의 **겹침률**을 매겨 "메뉴가 아니라 사람이 보는 그 목록"인지 판정한다 | 못 찾으면 거기서 멈추고 상태 문구를 낸다 |
| **② compile** | Gemini 에 후보와 샘플을 주고 **어떤 칸을 둘지 + 값을 어디서 읽을지**를 JSON 으로 받는다. LLM 이 내놓는 것은 코드가 아니라 선언이고, 실행은 `core` 의 해석기가 한다 | — |
| **③ validate** | zod 로 검증하고 실제로 표본을 뽑아 항목이 나오는지 본다 | 오류 문장을 그대로 프롬프트에 붙여 ②로 되돌아간다 (최대 2회) |

두 번째 사이트를 붙일 때는 여기에 한 단계가 더 붙는다 — 새 사이트의 값을 **기존 표의 칸에 맞추는 것**. 새 칸을 만들지 않으므로 사이트가 늘어도 표의 모양은 그대로다 (기능 ②).

LLM 출력을 그대로 믿지 않기 위한 관문이 셋이다: **닫힌 연산자 집합**(변환은 16개 연산자로만 표현 — `op: "custom"` 도 문자열 평가도 없으므로 샌드박스가 필요 없다) · **호스트 관문**(스펙이 사용자가 준 사이트를 가리키는지 + 내부망 차단) · **표기 교정**(모델이 반복하는 기계적 실수는 검증 전에 고치고, 결과는 같은 관문을 다시 통과한다).

### 표를 갱신하는 길

```
예약 → 수집 → 판정 → 반영(또는 치유) → 뷰 재평가 → 발송
```

| 단계 | 하는 일 |
|---|---|
| **예약** | 사이트마다 주기 하나. Redis 반복 잡으로 사이트당 예약 하나를 걸고, 붙이면 생기고 지우면 사라진다 (기본 하루 1회 · `Asia/Seoul`) |
| **수집** | 저장된 스펙을 해석기가 실행한다 — **LLM 호출 0.** 사용자가 API 를 만 번 불러도 Gemini 호출은 없다 |
| **판정** | 직전 성공 기록들과 비교한다. 항목이 절반 이하로 줄거나(0.5) 특정 칸이 갑자기 비거나 타입 실패가 늘면 드리프트다 |
| **반영** | `(사이트, 고유키)` **UNIQUE 제약**이 신규/갱신을 가린다. 판정을 로직이 아니라 제약에 맡기므로 잡이 두 번 돌아도 두 번 세지 않는다. 값 변경은 **정규화된 값만의 해시**로 보므로 원문 공백이 바뀌어도 알림이 울리지 않는다 |
| **치유** | 격리 → 재컴파일 → **관문 두 겹**(검증 통과 + 직전 결과와 **겹침률 0.3 이상**) → 승격. 실패하면 `봐주셔야 해요` 로 남고 그동안 마지막으로 받아둔 내용을 계속 보여준다. 성공은 지워지지 않고 쌓여 `이번 달 자동 복구 N회` 가 된다 |
| **재평가** | 뷰별 **현재 매칭 집합**과의 차집합이 곧 "새로 걸린 항목". 조건을 벗어나면 빠지고, 다시 들어오면 새 사건이다 |
| **발송** | 받는 주소별 **24시간 원장**으로 중복을 막는다. 잡이 재시도되거나 여러 뷰에 동시에 걸려도 한 번만 간다 |

**부분 성공이 정상이다.** 사이트 하나가 깨져도 나머지는 응답하고, 응답에는 항목과 함께 사이트별 상태가 늘 실려 나간다.

## 지금 무엇이 되고 무엇이 안 되나

**현재 상태 (2026-07-30): 배포 완료 · 테스트 1,086개 · typecheck 4/4.**
관문별 판정 조건은 [`docs/gates.md`](./docs/gates.md) 에 있다 (판정 기록은 이 표보다 뒤처져 있을 수 있다).

**공개 주소** — VPN 없이 접속된다 (Cloudflare Tunnel · ADR A32):

| | 주소 |
|---|---|
| 화면 | `https://endpointer.madcamp-kaist.org` |
| API | `https://endpointer-api.madcamp-kaist.org/{slug}` (= 화면 앱의 `/api/v1/{slug}`) |
| MCP | `https://endpointer-mcp.madcamp-kaist.org/{slug}` |
| 데모 게시판 | `https://bjsbest0326.madcamp-kaist.org` (별도 VM · `demo-board`) |

| 영역 | 상태 | 비고 |
|---|---|---|
| core 전체 (타입·스펙·해석기·정규화·검증·쿼리) | **돌아간다** | 테스트 723개 · G0 계약 |
| probe 4단계 + Gemini 컴파일 | **돌아간다** | 실측 통과 사이트 6곳 (아래 "검증된 시연 사이트") |
| URL → 컬렉션 생성 (화면 관통) | **돌아간다** | 여러 URL 한 번에 · 자연어로 사이트 찾기 (ADR A42) |
| 두 번째 소스 접합 (기능 ②) | **돌아간다** | 화면 흐름까지 — 자동 매핑 + 못 찾은 칸은 값 붙여넣기 |
| 화면 7탭 (대시보드·표·읽기 피드·뷰·알림·소스·연결·설정) | **돌아간다** | 제목=컬렉션 이름 · 부제=탭 이름으로 위계 통일 |
| 표 (조건 필터·정렬·열 드래그 재정렬·조건→뷰 저장) | **돌아간다** | 텍스트 포함 검색 포함 |
| 뷰 · `enter` 알림 · 소스 침묵 감지 | **돌아간다** | 뷰 건강 상태 · 이름 인라인 편집 · 컬렉션 단위 알림 주소록 |
| 스케줄 수집 · 자가 치유 (기능 ④) | **돌아간다** | 생성·접합 즉시 예약 등록 · 승격 겹침률은 직전 성공 run 기준 |
| 공개 API `GET /api/v1/{slug}` | **돌아간다** | 필터·정렬·커서·`?view=` · 부분 성공(`items`·`sources`·`schema_version`) |
| MCP 도구 4개 | **돌아간다** | `list_items` · `search_items` · `get_schema` · `get_sources_status` |
| 원문 대조 (값 → 원문 조각) | **돌아간다** | `provenance_json` 으로 칸마다 원본 경로를 남긴다 |
| 함께 보기 (초대 링크 · 읽기 전용 멤버) | **돌아간다** | ADR A40 — 화면은 주인·멤버만, `visibility` 는 API 범위다 |
| 모두의 컬렉션 (전시 · 복제 · 원작자 크레딧) | **돌아간다** | 전시하려면 `공개` + `올리기` 둘 다 켜야 한다 |
| 둘러보기 투어 (콘솔 3스텝 · 컬렉션 4스텝) | **돌아간다** | 첫 방문에 뜨고 `둘러보기 다시 보기` 로 재생 |
| 배포 (VM · compose · Caddy · Cloudflare Tunnel) | **돌아간다** | 재부팅 테스트 미실시 |
| 이메일 구독 | 없음 | 웹훅만 (P7 의 "이어서") |
| **인라인 JSON 추출기** | **없음 — 알려진 구멍** | probe 는 `__NEXT_DATA__`·`ld+json` 을 찾아내지만 해석기에 그 갈래가 없다. `fetch.mode` 가 `json\|html\|browser` 뿐이라 표현할 자리가 없고, LLM 이 `html` + CSS 로 내면 스크립트 태그 안을 못 본다 → 추출 0건. 링커리어·인터파크·온오프믹스가 여기서 죽는다. **다음에 넣을 것 1순위** |

### 검증된 시연 사이트

`create-collection` CLI 로 **추출까지** 통과한 곳만 적는다 (probe 통과 ≠ 시연 가능).

| 사이트 | 경로 | 결과 |
|---|---|---|
| `k-startup.go.kr` 창업 공고 | JSON API | 15건 · 마감일 date 정규화 |
| `bizinfo.go.kr` 지원사업 | 브라우저 | 15건 · 분류 enum · 마감일 date |
| `contestkorea.com` 공모전 | 브라우저 | 12건 · 주최·분류·마감일 |
| `wevity.com` 공모전 | 브라우저 | 15건 · 마감일이 `D-30 접수중` 텍스트 |
| `megabox.co.kr` 상영작 | JSON API | 20건 · 개봉일 date |
| `lottecinema.co.kr` 상영작 | JSON API | 35건 · 상영시간 |

접합 데모 페어로 **컨테스트코리아 + wevity**(같은 공모전 도메인) 또는 **메가박스 + 롯데시네마**(같은 영화가 양쪽에 있어 합쳐지는 게 눈에 보인다)를 쓴다.
대형 커머스(무신사·올리브영·에이블리·29CM)는 봇 차단·앱 유도로 전부 탈락했다.

## 역할 분담

코드 생산이 병목이 아니므로 **분담의 기준은
"누가 더 빨리 짜는가"가 아니라 "어디에서 사람의 판단이 필요한가"** 다.

| | **트랙 A — 파이프라인** | **트랙 B — 표면** |
|---|---|---|
| 디렉터리 | `apps/worker` | `apps/web` · `apps/mcp` |
| 담당 | probe · 어댑터 컴파일 · 스펙 해석기 · 정규화 · 검증 · 자가 치유 · 스케줄러 | 인증 · 컬렉션 화면 · 표 · 피드 · REST API · MCP · 구독 발송 |
| 사람이 판단할 것 | 후보 목록이 맞는가 / 정규화가 맞는가 / 드리프트 기준선이 적절한가 / 치유 결과를 승격해도 되는가 | 보장선 B1~B7 이 지켜지는가 / 접힘의 기본값이 맞는가 / 상태 문구가 사람 말인가 |
| 주 관문 | G1(A) · G3(A) | G1(B) · G3(B) |
| 공동 | G0 · G2 · G4 · G5 | |

**트랙 경계가 곧 디렉터리 경계다.** 두 사람이 같은 파일을 만지지 않게 하려고 이렇게 잘랐다.
`packages/core` 만 공유 지대이고, G0 이후 여기를 고칠 때는 **상호 통보**한다 — 조용히 고치면 상대 트랙이 조용히 깨진다.

G0 에서 고정하고 이후 바꾸지 않는 다섯 가지: core 타입 정의 · DB 스키마와 마이그레이션 ·
`GET /api/v1/{slug}` 응답 형태 · 시드가 만드는 가짜 데이터 · 상태 값 집합.

## 기획서와 다르게 간 것

기획서 v2 는 2026-07-25 에 쓰였고, 스캐폴딩 시점의 최신 버전과 무료 티어 현실이 달랐다.
전부 [`docs/adr.md`](./docs/adr.md) 에 A14 이후 번호로 기록돼 있다. **기획서 쪽을 고치지 않았다** (Part II 는 교체 가능하되, 고정 문서다).

| 항목 | 기획서 | 실제 | ADR |
|---|---|---|---|
| Node | 22 LTS | **24.13.0** (`engines` 는 `>=22`) | A24 |
| Next.js | 15 | **16.2.11** (App Router · Turbopack 기본) | A16 |
| Tailwind | 3 + shadcn/ui | **4.3.3** CSS-first (`tailwind.config.js` 없음) | A16 |
| UI 컴포넌트 | shadcn/ui | **자체 최소 컴포넌트** (clsx + tailwind-merge + lucide-react) | A17 |
| LLM 모델 | `gemini-2.5-pro` / `-flash` 배분 | **`gemini-3.1-flash-lite` 하나** — 무료 티어에 pro 쿼터가 없다 | A14 |
| Gemini SDK | (미지정) | `@google/genai` 2.13 (구 `@google/generative-ai` 아님) | A14 |
| DB 드라이버 | (미지정) | **postgres.js** (`pg` 아님) | A23 |
| 상태 컬럼 | (미지정) | `pgEnum` 대신 **`text().$type<...>()`** | A19 |
| core 소비 방식 | (미지정) | **빌드 없이 소스 그대로** (Next `transpilePackages` + tsx) | A15 |
| worker · mcp 실행 | (미지정) | 번들 없이 **tsx** | A20 |
| 검증 라이브러리 | (미지정) | **zod 4** — 스펙·환경변수·쿼리의 단일 검증기 | A21 |
| 로컬 compose | web·worker 포함 | **인프라만** (postgres·redis). 배포용은 `deploy/` 로 분리 | A25 |

기획서에 없던 것을 나중에 v1 로 편입한 결정도 ADR 에 있다:

| 항목 | 무엇 | ADR |
|---|---|---|
| 함께 보기 | 초대 링크 + 읽기 전용 멤버. **화면은 주인·멤버만** 열고 `visibility` 는 REST·MCP 의 범위로 분리했다 | A40 |
| DNS 리바인딩 방어 | `checkOutboundUrl` 앞단 검사 + undici `lookup` 관문 두 겹 (TOCTOU 차단) | A41 |
| 자연어 사이트 찾기 | 주소를 모를 때 말로 적으면 후보 사이트를 제안한다 (**정의권은 사용자에게** — 추천이 아니라 검색이다) | A42 |

## 문서

| 문서 | 무엇 |
|---|---|
| [`docs/기획서-v2.md`](./docs/기획서-v2.md) | **진실의 원천(1/2).** 고정 문서다 — 고치지 않는다 |
| [`docs/spec-delta-0727.md`](./docs/spec-delta-0727.md) | **진실의 원천(2/2).** 07-27 확정 변경 — 뷰·작업실·능동성. 기획서와 어긋나면 델타가 이긴다 |
| [`docs/gates.md`](./docs/gates.md) | 관문 G0~G5 판정 체크리스트 + 강등 규칙 (델타 반영판) |
| [`docs/adr.md`](./docs/adr.md) | 기술 결정과 "이걸 다시 보게 만드는 조건" (A1~A42) — **기술 변경은 여기부터** |
| [`docs/guardrails.md`](./docs/guardrails.md) | 비개발자 보장선 B1~B7 점검 절차 (전수 점검용) |
| [`docs/view-contract-draft.md`](./docs/view-contract-draft.md) | 뷰 계약 — 술어 닫힌 집합 · `enter` 전이 · 건강 상태 |
| [`docs/demo-scenarios.md`](./docs/demo-scenarios.md) | 시연 시나리오 |
| [`docs/day3-plan.md`](./docs/day3-plan.md) | 진행 정리 + Day 3~5 재분배 |
| [`docs/day1-part-a.md`](./docs/day1-part-a.md) · [`day2`](./docs/day2-part-a.md) · [`day3`](./docs/day3-part-a.md) · [`day4`](./docs/day4-part-a.md) | 트랙 A 일별 인수인계 — 파이프라인 코드 지도와 밟은 지뢰 |
| [`demo-board/README.md`](./demo-board/README.md) | 데모 게시판 띄우는 법 + 리허설 절차 |
| [`deploy/README.md`](./deploy/README.md) | VM 1대 배포 |
| [`CLAUDE.md`](./CLAUDE.md) | 이 저장소에서 일하는 Claude 를 위한 지침 |

---

*제품명 `endpointer` 와 "커스텀 다나와"는 모두 가칭이다. 프로젝트성 제작이며 수익 모델·법인·계약을 전제하지 않는다.*
