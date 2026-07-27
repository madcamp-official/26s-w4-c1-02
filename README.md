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
pnpm db:generate                   # 마이그레이션 SQL 생성 (packages/core/drizzle/)
pnpm db:migrate
pnpm db:seed                       # 가짜 컬렉션 1개 · 사이트 2개 · 항목 20개 (멱등)

pnpm dev                           # web 3000 · worker · mcp 3002
```

`pnpm db:generate` 는 **처음 한 번 반드시 돌려야 한다.** 마이그레이션 SQL(`packages/core/drizzle/`)이
아직 저장소에 없다 — 스키마에서 생성한 뒤 커밋한다. 이후에는 `packages/core/src/db/schema.ts` 를 고칠 때만 다시 돌린다.

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

## 지금 무엇이 되고 무엇이 안 되나

**현재 상태 (2026-07-27 저녁): G1 통과 · G2 는 화면 "붙이기"만 남음 · 배포 완료.**
관문별 판정 조건과 현재 체크 상태는 [`docs/gates.md`](./docs/gates.md), 남은 일의 분배는 [`docs/day3-plan.md`](./docs/day3-plan.md) 에 있다.

**공개 주소** — VPN 없이 접속된다 (Cloudflare Tunnel · ADR A32):
화면 `https://endpoint.madcamp-kaist.org` · API `https://endpoint-api.madcamp-kaist.org/{slug}` · MCP `https://endpoint-mcp.madcamp-kaist.org/{slug}`

| 영역 | 상태 | 비고 |
|---|---|---|
| core 전체 (타입·스펙·해석기·정규화·검증·쿼리) | **돌아간다** | 테스트 657개 · G0 계약 |
| probe 4단계 + Gemini 컴파일 | **돌아간다** | 낯선 URL 4곳 실측 통과 (G1(A) · [day2-part-a](./docs/day2-part-a.md) §6) |
| URL → 컬렉션 생성 (화면 관통) | **돌아간다** | 워커 HTTP 문(ADR A30) → 미리보기 → 저장 → 표 |
| 두 번째 소스 접합 (기능 ②) | **CLI 로 돌아간다** | 자동 매핑 5/6 · 못 찾은 칸은 값 붙여넣기 · **화면 흐름만 남음** |
| 화면 (랜딩·목록·표·읽기 피드·구독·연결·관리) | **돌아간다** | 클로드 디자인 적용 · 구글 로그인 실기 확인 |
| 공개 API `GET /api/v1/{slug}` | **돌아간다** | 실수집 데이터 · 필터·정렬·커서·`sources` |
| MCP 도구 4개 | **돌아간다** | JSON-RPC 실측 · 실제 커넥터 연결은 G4 판정 |
| 원문 대조 (값 → 원문 조각) | **돌아간다** | 실수집 컬렉션에서 재확인 필요 (seed 와 raw 형태 차이) |
| 배포 (VM · compose · Caddy · Cloudflare Tunnel) | **돌아간다** | 재부팅 테스트만 미실시 |
| 스케줄 수집 · 자가 치유 | 코드만 | **G3(A)** — 두 번째 수집·치유 실검증이 다음 |
| 뷰 · 작업실 · `enter` 알림 · 소스 침묵 감지 | 없음 | **G3** — [스펙 델타](./docs/spec-delta-0727.md) 로 새로 정의된 v1 필수 셋 |
| 이메일 구독 | 없음 | **G4** (P7 의 "이어서") |

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

## 문서

| 문서 | 무엇 |
|---|---|
| [`docs/기획서-v2.md`](./docs/기획서-v2.md) | **진실의 원천(1/2).** 고정 문서다 — 고치지 않는다 |
| [`docs/spec-delta-0727.md`](./docs/spec-delta-0727.md) | **진실의 원천(2/2).** 07-27 확정 변경 — 뷰·작업실·능동성. 기획서와 어긋나면 델타가 이긴다 |
| [`docs/gates.md`](./docs/gates.md) | 관문 G0~G5 판정 체크리스트 + 강등 규칙 (델타 반영판) |
| [`docs/day3-plan.md`](./docs/day3-plan.md) | 진행 정리 + Day 3~5 재분배 |
| [`docs/day2-part-a.md`](./docs/day2-part-a.md) | 트랙 A 인수인계 — 파이프라인 코드 지도와 밟은 지뢰 |
| [`docs/guardrails.md`](./docs/guardrails.md) | 비개발자 보장선 B1~B7 점검 절차 (G4 전수 점검용) |
| [`docs/adr.md`](./docs/adr.md) | 기술 결정과 "이걸 다시 보게 만드는 조건" — **기술 변경은 여기부터** |
| [`deploy/README.md`](./deploy/README.md) | VM 1대 배포 |
| [`CLAUDE.md`](./CLAUDE.md) | 이 저장소에서 일하는 Claude 를 위한 지침 |

---

*제품명 `endpointer` 와 "커스텀 다나와"는 모두 가칭이다. 프로젝트성 제작이며 수익 모델·법인·계약을 전제하지 않는다.*
