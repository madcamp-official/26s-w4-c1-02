# ADR 로그 — 기술 결정과 교체 조건

> 기획서 부록 B 를 **갱신되는 문서**로 옮긴 것. 기술 조건이 추가되면 여기부터 본다.

기획서(`docs/기획서-v2.md`)는 고정 문서다. 부록 B 의 A1~A13 은 v2 작성 시점(2026-07-25)에 박제된 상태로 남는다.
**이 파일이 그 이후의 진실이다.** 두 문서가 어긋나면 이 파일이 이긴다.

## 이 파일을 고치는 절차 (기획서 0장)

1. 해당 ADR 의 "다시 보게 만드는 조건" 열을 본다. 변경이 거기 해당하는가.
2. 해당하면 그 줄의 **상태를 `superseded` 로 바꾸고 새 번호를 아래에 추가한다.** 기존 줄을 지우지 않는다.
   지우면 "왜 그때 그렇게 했는가"가 사라지고 같은 논쟁을 다시 한다.
3. "영향받는 곳"에 적힌 장절과 파일만 고친다.
4. 기획서 Part I(1~6장)을 고쳐야 한다는 결론이 나오면 그건 기술 변경이 아니라 제품 변경이다. 문서 버전을 v3 로 올린다.

**기술 변경은 코드보다 ADR 이 먼저다.** 순서를 뒤집으면 다른 트랙이 조용히 깨진다.

## 상태 표기

| 상태 | 뜻 |
|---|---|
| `accepted` | 현재 유효. 코드가 이 결정을 따르고 있다 |
| `superseded` | 다른 ADR 로 대체됨. "다시 보게 만드는 조건"이 실제로 발생한 것 |
| `proposed` | 결정했지만 코드에 아직 반영되지 않음 |

---

## A1~A13 — 기획서 부록 B 승계

날짜는 전부 2026-07-25(기획서 v2 작성일)다. 이번 스캐폴딩에서 상태가 바뀐 것만 비고에 적었다.

| # | 결정 | 상태 | 근거 | 이걸 다시 보게 만드는 조건 | 영향받는 곳 |
|---|---|---|---|---|---|
| **A1** | LLM 은 컴파일 시에만 호출 | `accepted` | 비용·속도·재현성. P6 무료 티어 제약 | 실시간 파싱이 필요한 요구(매 요청마다 다른 스키마)가 생기면 | 기획서 7장①·8장·9장, `apps/worker` |
| **A2** | 어댑터는 코드가 아니라 선언적 JSON 스펙 | `accepted` | 샌드박스 비용 0, 검증·롤백·치유가 쉬움 | 변환 연산자로 표현 불가능한 사이트가 **반복적으로** 나오면 → 먼저 연산자 추가로 대응, 그래도 안 되면 재검토 | 기획서 7장②·11장, `packages/core/src/spec` |
| **A3** | probe 순서: 인라인 JSON → 네트워크 관찰 → DOM 구조 → 브라우저 렌더 | `accepted` | 싼 것부터. 내부 API 가 가장 안정적 | 대상 사이트군이 SPA 위주로 바뀌면 브라우저를 앞으로 | 기획서 9-1, G1 강등 규칙, `apps/worker` |
| **A4** | 부분 성공을 응답에 싣는다 | `accepted` | 소스 하나가 전체를 죽이지 않게 | 없음 — 제품 원칙에 가깝다 | 기획서 7장④·12장, `packages/core/src/query/respond.ts` |
| **A5** | TypeScript 단일 언어 | `accepted` | 스키마 타입이 프론트·워커·API·MCP 를 관통 | 팀에 Python 강점이 있고 파싱 라이브러리가 결정적이 되면 | 모노레포 구조 전체 |
| **A6** | PostgreSQL 하나 + JSONB (별도 검색엔진 없음) | `accepted` | 5일 규모에서 검색엔진은 부채 | 아이템이 수백만 건이 되거나 한국어 형태소 검색이 필수가 되면 | 기획서 10장·12장 `?q=`, `packages/core/src/db/schema.ts`, `query/build.ts` |
| **A7** | Drizzle ORM | `accepted` | 마이그레이션 사이클이 짧음 | 팀이 Prisma 에 훨씬 익숙하면 (이 규모에서 기능 차이는 없음) | `packages/core/src/db` — 드라이버 선택은 **A23** |
| **A8** | BullMQ + Redis | `accepted` | repeatable job 이 크론·재시도·rate limit 을 한 번에 해결 | 워커가 1대로 충분하고 Redis 가 부담이면 pg-boss 로 (Postgres 만 씀) | 기획서 9-3·9-4, `apps/worker` |
| **A9** | 단일 VM + Docker Compose + Caddy | `accepted` | P5. Playwright 실행에 시간·메모리 제약이 없어야 함 | 트래픽이 VM 1대를 넘거나 브라우저 워커를 분리해야 하면 | 기획서 8장 배포, `deploy/` — 로컬 분리는 **A25** |
| **A10** | 인증: Auth.js + Google 단일 / 공개 API 는 컬렉션별 키 | `accepted` | P4. 로그인 화면을 하나로 | 다른 소셜 로그인이나 팀 계정 요구가 생기면 (6장에서 제외한 범위) | `packages/core/src/db/schema.ts` (Auth.js 4종), `apps/web` |
| **A11** | 구독 채널은 인터페이스로 추상화, 웹훅 먼저 | `accepted` | P7. 발송 도메인 문제를 뒤로 미룸 | 이메일이 주 채널이 되면 SPF/DKIM 설정이 선행 작업으로 올라옴 | 기획서 9-4, G3/G4, `packages/core/src/types/subscription.ts` |
| **A12** | 페이지네이션 상한 3페이지 | `accepted` | 5일 범위에서 무한 크롤 금지 | 사용자가 전체 이력을 원하면 (6장에서 제외한 범위) | 기획서 11장 `max_pages`, `spec/spec.ts` (파싱 단계에서 거부) |
| **A13** | 신규 판정은 `(source_id, external_key)` 의 최초 등장 | `accepted` | 구독의 "새 항목만"이 여기 걸려 있음 | `external_key` 가 불안정한 사이트가 다수가 되면 콘텐츠 기반 지문으로 | 기획서 10장·9-3·15장, `spec/interpret.ts`(`ExternalKeyOrigin`), `db/seed.ts` 멱등성 |

---

## A14~ — 스캐폴딩(G0)에서 새로 생긴 결정

날짜는 전부 2026-07-26 이다.

| # | 결정 | 상태 | 근거 | 이걸 다시 보게 만드는 조건 | 영향받는 곳 |
|---|---|---|---|---|---|
| **A14** | LLM 모델을 `gemini-3.1-flash-lite` 하나로 통일. 기획서 8장의 pro/flash 배분표는 폐기 | `accepted` | `gemini-2.5-pro` 는 무료 티어 쿼터가 사실상 0 이고, `2.5-flash`/`-lite` 는 종료 예정이다. 3.x 세대에 무료 pro 는 없다. **P6(무료 티어)이 유지되는 한 선택지가 하나뿐이다** | 유료 키를 쓰게 되거나, 컴파일 품질이 lite 로 부족하다고 G1 에서 판정되면 | 기획서 8장 모델 배분표(무효), `.env.example`, `packages/core/src/env.ts`, `apps/worker` 컴파일·치유 |
| **A15** | `packages/core` 를 **빌드 없이 소스 그대로** 소비한다 | `accepted` | 5일에서 워치·빌드 순서 관리는 순수한 손실이다. `dist/` 가 없으면 "빌드를 안 돌려서 옛 타입을 보고 있었다" 라는 사고가 구조적으로 불가능하다 | core 를 워크스페이스 밖에서 쓰게 되거나, 배포 이미지가 소스 트리를 담기 싫어지면 | `packages/core/package.json` (`exports` 가 `./src/*.ts`), `tsconfig.base.json` (`noEmit`), `apps/web` (`transpilePackages`), worker·mcp (tsx) |
| **A16** | Next 16 · React 19 · Tailwind 4 (CSS-first, `tailwind.config.js` 없음) | `accepted` | 기획서는 Next 15 + Tailwind 3 이었으나 스캐폴딩 시점의 최신 안정판이 16/4 다. 5일짜리 신규 프로젝트에서 한 세대 뒤처진 버전을 고르면 문서·예제가 안 맞는다. Turbopack 이 기본이라 dev 기동도 빠르다 | Tailwind 4 의 CSS-first 설정으로 표현이 안 되는 테마 요구가 나오거나, 라이브러리가 Next 16 을 아직 지원하지 않으면 | 기획서 8장 스택표, `apps/web/package.json`, `apps/web/app/globals.css`(`@import 'tailwindcss'`), PostCSS 설정 |
| **A17** | shadcn/ui 를 쓰지 않고 **최소 자체 컴포넌트**를 둔다 | `accepted` | shadcn 은 Radix 의존 트리와 생성 파일을 같이 들고 온다. 필요한 것은 버튼·배지·표 몇 개뿐이고, Tailwind 4 조합에서 생성기를 맞추는 비용이 직접 쓰는 비용보다 크다. `clsx` + `tailwind-merge` + `lucide-react` 만 남긴다 | 다이얼로그·드롭다운·콤보박스처럼 접근성 처리가 까다로운 것이 세 개 이상 필요해지면 (그때는 Radix 만 직접 넣는다) | 기획서 8장 스택표, `apps/web/components` |
| **A18** | core 는 cheerio 를 모른다. HTML 평가를 **`HtmlAdapter` 주입점**으로 뺀다 | `accepted` | 해석기는 화면 미리보기와 워커 수집이 **같은 코드**여야 한다(기획서 8장). core 가 cheerio 를 직접 import 하면 브라우저 번들에 파서가 딸려 간다. 주입으로 바꾸면 테스트가 가짜 구현으로 돌고, 그게 곧 독립성의 증명이다 | 브라우저에서도 cheerio 를 쓰기로 하거나, DOM 평가에 어댑터로 못 감싸는 기능(예: 계산된 스타일)이 필요해지면 | `packages/core/src/spec/paths.ts`(`HtmlAdapter`), `spec/interpret.ts`(`InterpretContext.html`), `apps/worker`(cheerio 구현 주입) |
| **A19** | 상태 컬럼은 `pgEnum` 이 아니라 `text().$type<...>()` | `accepted` | 값 하나 늘릴 때마다 `ALTER TYPE` 마이그레이션을 도는 것은 5일 규모에서 부채다. 값 집합은 TS 유니온과 zod 가 지킨다 — 어차피 **G0 계약 #5 로 고정**된 집합이라 DB 가 한 번 더 지킬 실익이 적다 | 애플리케이션 밖(수동 SQL·BI 도구)에서 쓰기가 생기거나, 잘못된 상태 값이 실제로 들어가는 사고가 나면 | `packages/core/src/db/schema.ts`, 기획서 10장 |
| **A20** | worker · mcp 를 **번들 없이 `tsx` 로 실행**한다 | `accepted` | A15 의 따름 결정. 두 앱 다 서버 프로세스라 번들이 주는 이득이 없고, 소스 그대로 도는 편이 스택 트레이스가 정직하다. `tsx watch` 가 곧 dev 서버다 | 배포 이미지 크기나 기동 시간이 실제로 문제가 되면 (그때 `tsup`/`esbuild` 를 붙인다) | `apps/worker/package.json`, `apps/mcp/package.json`, `deploy/` Dockerfile |
| **A21** | zod 4 를 **스펙·환경변수·쿼리 파라미터의 단일 검증기**로 쓴다 | `accepted` | 기획서 11장의 "스펙 검증은 프롬프트 신뢰가 아니라 계약 검사"를 실체화한 것. 같은 zod 스키마가 (1) LLM 구조화 출력의 JSON Schema, (2) 저장 전 검증, (3) 시드 검증을 전부 담당한다. 정의가 한 군데다 | zod 스키마에서 뽑은 JSON Schema 를 Gemini 가 거부하는 사례가 나오면 (그때는 JSON Schema 를 손으로 쓰고 zod 와 대조하는 테스트를 둔다) | `packages/core/src/spec/ops.ts`·`spec.ts`·`json-schema.ts`, `src/env.ts`, `src/query/params.ts` |
| **A22** | REST 와 MCP 가 **같은 쿼리 코드**(`@endpointer/core/query`)를 쓴다 | `accepted` | 두 표면이 12장 파라미터 표를 각자 구현하면 반드시 갈라지고, 갈라지는 순간 "내 API 하나"라는 제품 약속이 거짓말이 된다. `parseCollectionQuery` → `planItemsQuery` → `buildCollectionResponse` 세 단계를 둘이 공유한다 | MCP 도구가 REST 에 없는 질의(예: 벡터 검색)를 갖게 되면 | `packages/core/src/query/*`, `apps/web/app/api/v1/[collection]/route.ts`, `apps/mcp` |
| **A23** | DB 드라이버는 `postgres.js` (`pg` 아님) | `accepted` | ESM 네이티브고 타입이 좋다. Drizzle 의 `postgres-js` 어댑터가 1급 지원이며 마이그레이터도 같은 드라이버를 쓴다. 커넥션 풀 설정이 한 줄이다 | 커넥션 풀 동작이나 `LISTEN/NOTIFY` 에서 `pg` 가 필요해지면 | `packages/core/src/db/client.ts`, `db/migrate.ts` |
| **A24** | 개발 런타임은 **Node 24**, `engines` 는 `>=22` | `accepted` | 기획서는 22 LTS 였으나 설치된 것이 24.13.0 이고 Playwright·MCP SDK·BullMQ 가 전부 지원한다. `engines` 를 `>=22` 로 열어 두어 배포 이미지가 22 여도 깨지지 않게 한다 | 어떤 의존성이 24 에서만 깨지거나, 배포 베이스 이미지가 22 로 고정되면 | 기획서 8장, 루트 `package.json` `engines`, `deploy/` 베이스 이미지 |
| **A25** | 로컬 `docker-compose.yml` 은 **인프라(postgres·redis)만**. 앱은 호스트에서 `pnpm dev` | `accepted` | 개발 중 앱까지 컨테이너에 넣으면 HMR·tsx watch 가 느려지고 Playwright 디버깅이 어려워진다. 배포용 전체 구성(web·worker·mcp·caddy)은 `deploy/docker-compose.prod.yml` 로 분리한다 | 로컬과 배포의 차이 때문에 "내 컴퓨터에서는 됐는데"가 실제로 발생하면 | 루트 `docker-compose.yml`, `deploy/`, 루트 `package.json` `infra:*` 스크립트 |
| **A26** | 보장선 B2(내부 명사 금지)를 **테스트로 강제**한다 | `accepted` | 기획서 15장이 "보장선이 조용히 무너짐"을 리스크로 꼽았다. 급할 때 붙인 상태 문구 한 줄이 보장선을 깨고, 사람 눈으로만 지키면 G4 전수 점검에서야 발견된다. 문자열 규약은 기계가 잡을 수 있는 유일한 보장선이므로 잡는다 | 오탐이 잦아 개발이 막히면 (그때는 패턴을 좁히지, 테스트를 끄지 않는다) | `apps/web/lib/guardrails.ts`, `guardrails.test.ts`, `docs/guardrails.md` |

## A27~ — G1 작업 중 생긴 결정

날짜는 2026-07-27 이다.

> ⚠️ **A27 은 코드가 먼저 들어갔다.** 절차(ADR 먼저)를 어긴 것이라 여기 적어 둔다.
> 되돌릴 수 있는 결정이므로 남긴다.

| # | 결정 | 상태 | 근거 | 이걸 다시 보게 만드는 조건 | 영향받는 곳 |
|---|---|---|---|---|---|
| **A27** | 나가는 요청은 **fetch 계층의 관문**에서 이름을 풀어 검사하고, 리다이렉트 **홉마다** 다시 검사한다. 확인된 IP 로 접속을 고정하지는 **않는다** | `accepted` | 이 제품은 사용자가 준 주소를 서버가 대신 연다 — 임의 URL 을 받는 것이 기능이므로 SSRF 는 부수 위험이 아니라 **기능의 이면**이다. 검사를 스펙 검증(`validateSpec`)에만 두면 probe 는 스펙이 생기기 **전에** 나가므로 아무것도 못 막는다. 이름만 보는 검사는 `evil.example → 127.0.0.1` 을 못 막아 이름 풀기가 필요하고, 첫 주소만 보면 302 한 번에 뚫려 홉마다 검사가 필요하다. IP 고정은 Node 내장 fetch 로 불가능해(undici 직접 의존) 지금 범위 밖이다 | ① DNS 리바인딩이 실제 위협이 되면 → undici 를 의존에 넣고 `lookup` 고정 (그때는 새 ADR). ② `apps/web`·`apps/mcp` 가 서버에서 임의 주소를 열게 되면 → 관문을 `packages/core` 로 올려야 한다 (지금은 worker 안에만 있다) | `apps/worker/src/fetchers/guard.ts`, `fetchers/http.ts`(수동 리다이렉트), `fetchers/browser.ts`·`probe/network.ts`(라우트 훅), `jobs/channels/webhook.ts`, `packages/core/src/spec/validate.ts`(`isPrivateHost`), `.env.example`(`ALLOW_PRIVATE_HOSTS`) |
| **A28** | 응답 본문의 인코딩은 **BOM → 헤더 → `<meta>`(앞 4KB) → UTF-8** 순으로 정한다. 판정은 `TextDecoder` 에게 맡기고 별도 인코딩 목록을 들지 않는다 | `accepted` | `res.text()` 는 헤더의 charset 만 본다. 한국 공공·협회 목록에는 헤더에 charset 을 안 적고 `<meta charset="euc-kr">` 로만 적은 곳이 아직 있다(korcham.net 으로 재현). 이때 **목록은 정상적으로 뚫리고 겹침률도 100% 가 나온다** — 화면 텍스트도 같이 깨져 둘이 일치하기 때문이다. 즉 우리가 가진 어떤 품질 신호에도 안 걸리는 **조용한 실패**라서, 사후 탐지가 아니라 받는 지점에서 막아야 한다. 순서를 브라우저와 같게 두는 이유는 사이트들이 브라우저에서 보이는 대로 만들어졌기 때문이다 | ① 헤더가 `iso-8859-1` 인데 `<meta>` 가 EUC-KR 인 사이트가 나오면 → 브라우저는 헤더를 따르지만 우리는 `<meta>` 를 택할지 다시 판단한다(그런 주소를 아직 못 잡아 지금은 브라우저와 같게 뒀다). ② 인코딩 자동 판별(문자 빈도 추정)이 필요해지면 → 의존성이 생기므로 새 ADR | `apps/worker/src/fetchers/charset.ts`, `fetchers/http.ts`(`HttpResponse.charset`), `probe/static.ts`·`probe/index.ts`(단계 기록에 표시) |
| **A29** | 앱의 `.env` 로딩은 **별도 모듈**(`load-env.ts`)에 두고 진입점의 **첫 import** 로 부른다 | `accepted` | ESM 은 `import` 선언을 전부 본문 코드보다 먼저 평가한다. 진입점 안에서 `loadDotenv()` 를 맨 위에 적어도, 아래에 있는 `@endpointer/core/db` 가 **먼저** 평가되면서 모듈 최상단에서 `DATABASE_URL` 을 읽다 죽는다. 실제로 `apps/mcp` 가 이 이유로 `pnpm dev:mcp` 에서 부팅조차 못 했다. 모듈로 빼면 ESM 이 import 선언 순서대로 의존 모듈을 평가하므로 순서가 보장된다 | 앱이 늘어나면 같은 파일을 복사하게 된다 → 세 번째 앱이 생기면 `packages/core` 로 올린다 | `apps/mcp/src/load-env.ts`, `apps/mcp/src/index.ts`. (`apps/worker` 는 `config.ts` 가 우연히 같은 역할을 하고 있어 지금은 무사하나 같은 함정 위에 있다) |
| **A30** | 트랙 B 화면은 워커의 **HTTP 진입점**으로 파이프라인을 부른다. 큐가 아니고, `apps/web` 이 `apps/worker` 를 직접 import 하지도 않는다 | `accepted` | ① **미리보기는 본질적으로 요청-응답이다.** 사용자는 표를 *보고 나서* 저장한다(보장선 B3). 큐로 하면 화면이 폴링·대기 상태를 다뤄야 하고, B 가 이미 만든 create-flow 를 그만큼 고쳐야 한다. ② **직접 import 는 경계를 무너뜨린다.** cheerio·playwright·Gemini SDK 가 Next 서버 번들로 끌려 들어가고, `apps/web → apps/worker` 의존이 생겨 트랙 경계가 디렉터리 경계와 어긋난다. ③ 워커에 HTTP 진입점이 생기면 **수동 수집 트리거(G3)** 도 같은 문 하나로 풀린다 — 지금은 밖에서 파이프라인을 부를 수단이 cron 등록뿐이다. 정기 수집은 지금처럼 큐로 남는다 (그건 요청-응답이 아니다) | ① 미리보기가 느려 브라우저 시한을 넘기면 → 그때 큐 + 폴링으로 바꾼다 (새 ADR). ② 워커를 여러 대로 늘리면 → 진입점 앞에 로드밸런서가 필요하고 호스트별 간격 제어(`http.ts` 의 프로세스 메모리 맵)를 Redis 로 옮겨야 한다 | `apps/worker` 의 HTTP 진입점(신설), `apps/web/lib/create.ts`(`buildMockPreview` 를 fetch 로 교체), `.env`(워커 주소·내부 토큰) |

## A31~ — 배포(G4)에서 생긴 결정

날짜는 2026-07-27 이다. (트랙 B 가 A27·A28 로 적었다가 main 의 번호와 겹쳐 A31·A32 로 옮겼다 —
커밋 메시지·과거 대화의 "A27/A28(배포)"는 이 두 줄을 가리킨다)

| # | 결정 | 상태 | 근거 | 이걸 다시 보게 만드는 조건 | 영향받는 곳 |
|---|---|---|---|---|---|
| **A31** | HTTPS 는 Let's Encrypt 가 아니라 **Caddy 내부 CA(자체 서명)** | `superseded` (→ A32) | 캠프 VM(172.10.8.235)은 VPN 안 사설 IP 라 HTTP-01 챌린지가 불가능하고, 캠프 DNS API 가 언더스코어 레코드(`_acme-challenge`)를 금지해 DNS-01 도 불가능하다. HTTP 평문으로는 구글 OAuth 리디렉션 URI(https 필수)가 성립하지 않는다. 남는 선택지는 내부 CA 하나 — 첫 접속 시 브라우저 경고 1회를 감수한다 | 공인 IP VM 으로 옮기거나 DNS API 가 TXT `_acme-challenge` 를 허용하게 되면 → Caddyfile 의 `tls internal` 세 줄을 지우면 A9 원안(자동 LE)으로 복귀한다 | `deploy/Caddyfile`, deploy/README 의 G4 체크 "유효한 인증서(경고 없음)" 항목은 이 조건에서 "경고 후 진행"으로 완화 |
| **A32** | 외부 공개는 **Cloudflare Tunnel** — Caddy 는 8080 평문으로 터널을 받고, TLS 는 Cloudflare 엣지가 끝낸다 | `accepted` | A31 의 조건(사설 IP)이 그대로인 채로 "VPN 없는 방문자"가 필요해졌다. 캠프 DNS API 의 터널 기능이 `cloudflared` 아웃바운드 연결 + 정식 인증서를 제공한다 — 브라우저 경고가 사라지고 G4 "유효한 인증서" 체크가 원래 의미로 복원된다. Caddy 의 :443(내부 CA)은 VPN 직접 접속용으로 남긴다. 평문 블록은 `X-Forwarded-Proto: https` 를 명시한다 (엣지가 TLS 를 끝냈으므로 — 이게 없으면 Auth.js 콜백이 http 로 구른다) | 터널 API 가 사라지거나 순수 TCP/UDP 가 필요해지면 (터널은 HTTP 계열만 통과한다 — 7-8) | `deploy/Caddyfile` (`:8080` 블록 3개), `docker-compose.prod.yml` (caddy 에 127.0.0.1:8080 바인딩), VM 의 `cloudflared` systemd 서비스 |

## A33~ — 스펙 델타(07-27 논의)에서 확정된 결정

날짜는 전부 2026-07-27 이다. 근거·맥락 전문은 [spec-delta-0727.md](./spec-delta-0727.md) — 여기는 결정만 승격해 둔다.

| # | 결정 | 상태 | 근거 | 이걸 다시 보게 만드는 조건 | 영향받는 곳 |
|---|---|---|---|---|---|
| **A33** | **뷰(View)를 일급 객체로** 도입하고, 컬렉션의 기본 표를 **조건 없는 뷰 #0** 으로 취급한다. 네 출구(표·알림·REST `?view=`·MCP)가 전부 `packages/core/src/query` 하나를 탄다 | `proposed` (코드 미반영) | 델타 2절. 뷰가 없으면 사용자가 소스 겹치는 컬렉션을 여러 개 만든다 — "컬렉션은 넓게, 뷰는 좁게". 기본 표를 특수 케이스로 두면 출구마다 쿼리가 갈라진다 | 컬렉션을 넘나드는 뷰 요구가 나오면 (채택 안 함 — 델타 16절) | `packages/core`(View 타입·query), `views`·`view_matches` 테이블, 작업실 탭, MCP 도구 생성 |
| **A34** | 알림은 상태가 아니라 **전이**다. v1 은 `enter` 하나만 — 뷰별 매칭 id 집합을 저장하고 run 마다 차집합. **뷰 평가는 수집과 분리된 일일 잡**으로 돌고, 조건 값은 **상대 표현**(`this_month`·`d7`)으로 저장한다 | `proposed` | 델타 2-5·2-6. `D-7 이내` 뷰는 데이터가 안 바뀌어도 전이가 일어난다(어제 D-8 → 오늘 D-7) — 그게 사용자가 가장 원하는 알림이다. 절대값 저장은 뷰를 한 달 뒤 죽인다 | `change`/`exit`/`gone` 이 필요해지면 → 항목 동일성 판정이 선행돼야 한다 (G3 이후 새 ADR) | `apps/worker` 뷰 평가 잡, `view_matches`, 스케줄러 |
| **A35** | **뷰 술어(op)는 zod 닫힌 집합.** 목록 밖 술어·자유 표현식·SQL 조각을 거부한다 — 변환 연산자(A2)와 같은 규율 | `proposed` | 델타 2-7. 뷰는 네 출구를 전부 타므로 한 번 열면 네 곳에서 안전성을 보장해야 하고 B2 점검에도 걸린다 | 술어로 표현 불가능한 조건이 반복되면 → 먼저 술어를 추가한다 (A2 와 동일) | `packages/core`(술어 스키마), 뷰 편집 UI |
| **A36** | 알림 **중복 제거는 채널 단위** — 한 항목이 뷰 3개에 걸려도 채널당 1회 보내고 "3개 뷰에 걸림"을 표시한다. 메일은 하루 1회 묶음, 웹훅은 건별 | `accepted` (설계 확정 · 발송 구현 시 적용) | 델타 2-9. 뷰 단위 발송이면 스팸이 되고, 이 결정은 나중에 뒤집기 번거로워 지금 확정한다 | 없음에 가깝다 — 채널별 즉시/묶음 옵션이 생겨도 dedupe 단위는 유지 | `notification_dedupe` 테이블, `apps/worker` deliver |
| **A37** | **추천·제안 기능을 만들지 않는다.** 능동성의 형태는 "정의는 사용자가, 관찰은 시스템이" — 침묵 감지·상태 줄처럼 관찰만 말한다 | `accepted` | 델타 4-4. 매 호출 LLM 개입은 결정성을 깨고(A1 위반), 시스템이 카테고리를 대신 정하면 정의권(강점 #1)을 침범한다 | 없음 — 제품 원칙이다 | 화면 전반, 소스 침묵 감지, 상단 상태 줄 |
| **A38** | **Run 이력과 항목 스냅샷을 삭제하지 않는다.** 시간축 기능(주기성·이상 감지)은 지금 안 만들되 스위치를 공짜로 유지한다 | `accepted` | 델타 10절. 보존 비용은 지금 0에 가깝고, 삭제하면 몇 달치 데이터를 되살릴 수 없다 | 저장 용량이 실제 문제가 되면 → 보존 기간 정책을 새 ADR 로 | `runs`·`items` 보존, O4(보존 기간) 재확정 |
| **A39** | 스키마 진화는 **기본은 버리되 언제든 승격** — 새 소스에만 있는 필드는 `_raw` 에 두고, 능동 알림으로 승격을 제안하며, 승격 버튼은 작업실 > 스키마 편집에 둔다 | `proposed` | 델타 6절. 자동 추가는 기존 소스 전부 null 컬럼을 만들고, 매번 묻기는 온보딩을 막는다 | 승격 요청이 소스 추가마다 반복되면 → 기본값 재검토 | `apps/worker` attach, 작업실 스키마 편집(G2 이후) |

---

## 열린 결정 (기획서 16장) — 정해지면 여기로 승격

| # | 열린 질문 | 정해야 하는 시점 | 기본값 | 현재 |
|---|---|---|---|---|
| O1 | 도메인 이름 | G4 이전 | 미정 (`endpointer` 는 가칭) | 미정 |
| O2 | 컬렉션 공개 범위 기본값 | G2 | `unlisted` | 시드는 `unlisted`, DB 기본값은 `private` |
| O3 | 수집 주기 기본값 | G3 | 하루 1회 | `sources.schedule` 기본값 `0 6 * * *` |
| O4 | 아이템 보존 기간 | G3 | 무제한 | 무제한 |
| O5 | `raw_json` 저장 범위 | G2 | 원본 객체 전체 | 전체 + 필드별 변환 전 원값(`_row`/`_fields`) |
| O6 | 스키마 v(n-1) 응답 유지 | G4 | 유지 안 함 | 미정 |
| O7 | 즐겨찾기 위치 | G3 | 컬렉션 안 `starred` 플래그 | 미정 — 델타 12절(항목별 개인 표시)과 합쳐 판단 |
| O8 | 소스 수집 공유 | 범위 밖 (v3) | 사용자별 독립 수집 | 범위 밖 |
| O9 | 대상 사용자 — 온보딩·발표에서 비개발자와 개발자 중 누굴 앞에 세우나 (델타 1-3) | **G3 저녁** | 비개발자 앞 (강점=정의권이면) · MCP 는 각주로 | 미정 |
| O10 | `schema_version` 의 의미 — 올라가면 API 소비자가 깨지는가, 웹훅 구독자에게 알리는가 (델타 6-3) | G3 | 경고만 (O6 연장) · 뷰 참조 필드 소실은 `broken` | 미정 |
| O11 | 소유자를 user 직접 참조 대신 한 단계 띄우기 + 멤버십(role) 테이블 (델타 9절·13-1) | 팀 기능 착수 전 (G4 이후) | 지금은 안 바꿈 — 초대 기능이 실제로 시작되면 | 미정 |
| O12 | Run 을 컬렉션이 아니라 소스 단위로 (델타 13-1 — 창작마당 복제 대비) | 창작마당 착수 전 | 현행 유지 | 미정 |
| O13 | 제품명 (`endpointer` 는 가칭 — 델타 1-3 재검토 대상) | G5 발표 전 | 미정 | 미정 |
