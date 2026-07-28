# Day 4 — 트랙 A 인수인계 (day3 이후의 델타)

> 2026-07-28 낮 기준. **[day3-part-a.md](./day3-part-a.md) 를 먼저 읽어라** — 특히 §8(Day 4 시작 시점 상태).
> 코드 지도·반복 판단·지뢰의 본문은 [day2-part-a.md](./day2-part-a.md) 에 그대로 유효하다.
> 이 문서는 day3 §8 이후 **오늘 바뀐 것만** 적는다. 실측만 적는다 — "될 것"이라고 쓴 줄은 없다.

## 0. 30초 요약 — 지금 어디에 서 있나

- **초대 링크(읽기 전용)가 v1 로 들어왔다.** 07-28 두 트랙 합의로 gates 의 "G4 이후"를 뒤집었다(ADR A40).
  구현·실측·커밋 완료 — 다른 계정이 링크로 들어와 표를 읽고, 관리는 서버에서 막히고, 링크 폐기·멤버 내보내기가 돈다.
  **덤으로 기존 구멍 하나를 막았다**: slug 만 알면 로그인 없이 남의 컬렉션 화면이 다 열리고 있었다.
- **day2 §8 미검증 결함 후보 — A 몫이 전부 판정됐다.** 넷 다 실측 재현했고, 하나는 오탐 절반으로 기록했다.
  ISO 시각 소실(두 번 이월)·browser 404·인라인 JSON 프레임워크·치유 네트워크 관찰·원문 툴팁·DNS 리바인딩.
- **502 는 우리 잘못이 아니다 (확정).** 캠프가 여러 팀에 **같은 터널 토큰**을 줘서 엣지가 요청을 아무 팀 VM 에나
  보낸다. 우리 커넥터 요청 카운터가 12발 중 1발만 움직였다. 다른 팀 호스트(`graceheeseo.…`)도 같이 502 다. §3.
- 테스트 **957개** (core 721 · web 63 · worker 173). day3 시점 927개에서 +30.
- **origin/pipeline 까지 전부 밀었다.** 로컬과 원격이 같은 지점이다.

## 1. 오늘 한 것 — 커밋별

전부 `pipeline` 에 있고 origin 까지 밀었다. 순서는 오래된 것부터.

| 커밋 | 무엇 | 트랙 경계 |
|---|---|---|
| `51aad30` | ADR A40 + gates G4 — 초대 링크 v1 편입 (문서) | 공동 |
| `8986227` | core: 초대·멤버십 테이블 + 접근 판정 헬퍼 — **마이그레이션 0002** | **B 통보 · 배포 전 migrate** |
| `aee7449` | web: 읽기 전용 초대 링크 — 화면 게이트·수락 흐름·함께 보기 관리 | B 디렉터리 |
| `aaf4ab6` | core: ISO 8601 시각 소실 수리 | **B 통보** |
| `b6a4ae7` | worker: browser 모드 4xx·5xx 차단 | A 단독 |
| `9e41268` | worker: 인라인 JSON 에 Nuxt3·SvelteKit 추가 | A 단독 |
| `620da39` | worker: json 소스 치유 네트워크 관찰 복구 | A 단독 |
| `2b6d82e` | fix: 원문 툴팁 raw_json 형태 수렴 | **B 통보** (core seed) |
| `55425f3` | worker: DNS 리바인딩 차단 (ADR A41 · A27 대체) | A 단독 (undici 는 worker 안에만) |

## 2. 초대 링크 (ADR A40) — 새 계약

**결정 3개** (day3 이후 07-28 합의 · 근거는 [adr.md](./adr.md) A40):
접근은 **구글 로그인 필수**(뷰어 멤버십) · 출구는 화면·REST·MCP 셋 · **폐기(링크 재생성)+키 회전** 포함.
편집자·관리자 역할, 창작마당은 **그대로 G4 이후**다.

### 2-1. core — 소유권 구조는 안 건드렸다 (덧붙이기만)

- `collection_invites`(token_hash — 원문 미저장 · revoked_at 로 폐기, 행 삭제 없음 · A38 규율)
  · `collection_members`(collection_id, user_id, role=`viewer`). **마이그레이션 0002.**
- 접근 판정은 순수 함수로 core 에 올렸다 (`types/access.ts` — `canViewCollection`/`canManageCollection`).
  apps/mcp/src/auth.ts 가 TODO 로 예약해 둔 자리다. **visibility 는 화면 열쇠가 아니다** — 화면은 주인·멤버만,
  REST·MCP 의 공개 범위(unlisted/public)와 다르다. 이 구분이 없던 게 아래 구멍이었다.

### 2-2. web — 기존 접근 구멍을 같이 막았다

`resolveCollectionAccess`(lib/access.ts) 하나가 판정한다. 컬렉션 상세의 다섯 페이지(표·피드·작업실·붙이기·연결)에
게이트를 걸었다. **어제까지는 `getCollectionBySlug` 로 바로 렌더해서, slug 만 알면 남의 private 컬렉션 화면이
표·수집 기록까지 다 보였다.** 지금은 주인·멤버만. 작업실·붙이기는 관리 표면이라 뷰어에게 404.

- 초대 수락: `/invite/[token]` → 로그인 강제 → 멤버 등록 → 컬렉션으로. 못 쓰는 링크는 사유(없음·꺼짐)를 안 가른다.
- 연결 탭에 주인 전용 "함께 보기" 구역: 링크 만들기/다시 만들기(옛 링크 revoke)/끄기 · 멤버 내보내기.
  새 링크는 만든 응답에서 **한 번만** 보인다(원문 미저장).

### 2-3. 실측 (계정 2개 · 브라우저 + curl)

| 판정 | 결과 |
|---|---|
| 뷰어가 링크로 합류 → 표 열림 | 200 · "함께 보는 중 · 읽기만" 배지 · 탭에서 작업실 제외 |
| 뷰어가 작업실·붙이기 (서버측) | **404** · 비로그인 표도 404 (뷰어 표는 200) |
| 링크 끄기 | 꺼진 링크로 신규 합류 → "쓸 수 없어요" · **기존 멤버는 유지** |
| 멤버 내보내기 | 즉시 404 (다시 보려면 새 링크) |
| 링크 다시 만들기 | 새 링크 1회 노출 · 옛 링크 revoke |

실험 잔재(뷰어·세션·초대 행)는 일회성 SQL 로 정리했다 — **삭제 코드는 안 만들었다** (델타 10절).

## 3. 프로덕션 502 — 원인 확정 (우리 잘못이 아니다) 🔴

VPN 붙어 VM(`172.10.8.235`, root·키인증) 안까지 봤다. **우리 스택은 전부 정상**이다 —
컨테이너 6개 Up(healthy) · Caddy 가 8080 에서 200(30ms) · cloudflared active · `.env` 도메인과 터널 ingress 일치.

**결정적 증거:** 바깥에서 12발 요청 → 11발 502 · 우리 커넥터 `total_requests` 카운터는 **+1 만** 움직였다.
즉 요청이 우리 커넥터에 **도달하지 않는다.** 그리고 다른 팀 호스트 `graceheeseo.madcamp-kaist.org` 도 같이 502 다.

→ **캠프가 여러 팀에 같은 터널 토큰을 발급**했고, 엣지가 요청을 아무 팀 VM 으로나 보낸다(각 cloudflared 는
자기 127.0.0.1:8080 으로 프록시하므로 남의 도메인은 502). 어제 멀쩡했던 건 그때 우리 커넥터만 떠 있었기 때문.
`systemctl restart cloudflared` 로 재등록해도 그대로 — **VM 에서 고칠 수 없다.**

**운영진에 보낼 말:** "madcamp-kaist.org 터널 하나를 여러 팀이 같은 토큰으로 쓴다. 팀별로 터널을 분리(팀마다 자기 토큰)해
달라. 임시로는 한쪽이 cloudflared 를 끄면 다른 쪽이 정상화된다." 증거는 요청 카운터(529→529)와 graceheeseo 동반 502.

## 4. day2 §8 미검증 후보 — A 몫 전부 판정 완료

day2 §8 · day3 §4-5 로 이월돼 온 표를 오늘 전부 재현했다. **손대기 전에 재현**이라는 규율을 지켰고,
표에 재현 명령을 붙여 ✅ 로 올렸다. 요약:

| 후보 | 판정 | 커밋 |
|---|---|---|
| ISO 8601 시각 소실 (day2 §7-5 · 두 번 이월) | ✅ 진짜 — 주장보다 심했다(`+09:00` 표기조차 시각이 죽음) | `aaf4ab6` |
| browser 404 → "성공·0건" | ✅ 진짜 — bizinfo 없는 주소로 3KB 404 HTML 이 ok:true | `b6a4ae7` |
| 인라인 JSON 프레임워크 누락 | ✅ **절반 오탐** — Remix·Nuxt2 는 원래 잡힘. 진짜 누락은 Nuxt3 devalue·SvelteKit 이중포장 | `9e41268` |
| 치유 json 네트워크 관찰 꺼짐 | ✅ 진짜 (코드 경로 확정) — `healSkipsBrowser()` 로 html 만 끔. **실소스 재현은 미실시** | `620da39` |
| seed raw_json 형태 차이 | ✅ 진짜인데 심했다 — 실수집 항목 툴팁이 **이미 전멸**(bizinfo 0→370) | `2b6d82e` |
| DNS 리바인딩 (알고 남긴 구멍) | ✅ 수리 (ADR A41) — 접속 시점 이름 풀기에 관문. **browser 모드는 아직 열림** | `55425f3` |

남은 §8 항목은 전부 **B 트랙**이거나 범위 밖이다: auth JWT 폴백(B) · apps/mcp 테스트 0개(B).

### 4-1. A 단독 로컬 재검증 (사람·외부 없이 · 07-28 오후)

오늘 바꾼 것들 이후에도 수집·MCP 가 회귀 없이 도는지 로컬에서 확인했다. Gemini 키가 막혀도
정기 수집·뷰·REST·MCP 는 LLM 을 안 타므로(원칙 ①) 전부 A 단독으로 돌아간다.

| 검증 | 결과 |
|---|---|
| G3 · 같은 소스 반복 수집 | `collect bizinfo` 여러 번 → 세 소스 전부 **신규 0 · 변경 0**, 로그에 **Gemini 0회** |
| MCP 로컬 JSON-RPC | 도구 5개(list_items·search_items·get_schema·get_sources_status + **뷰별 `closing-soon`**). `closing-soon` 호출 → 마감 `07-29~08-03`(오늘+7일)만, 뷰 조건 정확 |
| ISO 8601 수리 (통합) | ⚠️ **지금 붙은 데이터엔 대상이 없다** — bizinfo 날짜가 전부 `YYYY-MM-DD`(시각 없음, `T` 0개). 세 소스가 게시판형 DOM 이라 ISO 를 안 준다. SPA(인라인 JSON) 소스가 붙어야 드러난다 — 지금은 단위 테스트로만 커버 |

**아직 A 단독으로 더 할 수 있는 것:** 뷰 평가·알림(`views --demo`) · browser 404 통합(소스를 없는 URL 로 바꿔 collect) · 초대 링크의 REST·MCP 출구(private + api_key 로 뷰어 읽기).

## 5. DNS 리바인딩 (ADR A41) — A27 을 대체

A27 이 "다시 보게 만드는 조건 ①"로 예약해 둔 작업이다. checkOutboundUrl 이 이름을 검사해도 fetch 가
이름을 **다시** 풀어 TTL 0 리바인딩이면 검사 IP 와 접속 IP 가 갈렸다(TOCTOU). undici 를 worker 의존에 넣고
`Agent({connect:{lookup: guardedLookup}})` 로 **접속 직전** 이름 풀기에 사설 IP 판정을 끼웠다.
`net.connect` 는 lookup 이 준 주소로 곧장 붙으므로 재조회 틈이 없다. html·json 수집과 웹훅 발송(본문까지 실려 나가는
더 위험한 경로)에 dispatcher 를 **명시로** 붙였다(전역 X — Gemini SDK 등 안 건드리게).

**아직 열린 곳:** browser 모드(Playwright)는 undici 를 안 타 접속 시점 고정이 없다. A41 조건 ①에 남겼다.

## 6. 트랙 경계 — B 에게 통보할 것 (오늘 core 변경 3건)

전부 origin/pipeline 에 있다. **한 번에 전하면 된다.**

| 무엇 | 어디 | 방향 |
|---|---|---|
| 초대·멤버십 테이블 + 접근 판정 | `types/access.ts` · `db/schema.ts` · **마이그레이션 0002** | 신규 — **배포 전 `pnpm db:migrate` 필수** |
| ISO 8601 시각 소실 수리 | `normalize/date.ts` | `18:00Z` 가 KST 익일로 옮겨진다. 기존 표기 회귀 없음 |
| seed raw_json 형태 수렴 | `db/seed.ts` | `{_row,_fields}` 로. 화면(collection-table)은 두 형태 다 읽게 해뒀다 |

**화면 접근 게이트(web)도 알아둘 것:** 이제 컬렉션 상세는 주인·멤버만 연다(`resolveCollectionAccess`).
새 페이지 만들 때 이걸 부르면 된다. undici 는 worker 안에만 있어 B 통보 대상 아님.

## 7. 다음에 할 일 — Day 4 남은 것 (day3 §8-4 기준)

사람·외부가 필요한 것이 대부분이다. 코드로 A 가 지금 당길 수 있는 빚은 오늘 다 갚았다.

| 급 | 무엇 | 누가 |
|---|---|---|
| 🔴 | **502 터널 토큰 분리** — 운영진 문의 (§3). 나머지 G4 가 여기 걸려 있다 | 사람 |
| 🔴 | **낯선 사람 통과 실험** — 로그인→URL 2개→표. 사람 섭외 필요 | 사람 |
| 🔴 | **Gemini 키 충전** — 자가 치유 정지 중(wevity 깨진 채). 데모에 기능 ④ 넣으면 필수 | 사람 |
| 🔴 | **재부팅 테스트** — 실제 `sudo reboot` 후 복구 확인 | 배포(B) |
| 🔴 | **배포판 MCP 를 실제 커넥터에** — 502 해결이 전제. **로컬 JSON-RPC 는 오늘도 정상**(§4-1) | B |
| 🟡 | **B1~B7 전수 점검** — 초대 링크가 늘었으니 B2(내부 명사)·B3 재점검 포함 | 공동 |
| 🟢 | 실험 잔재 컬렉션 3개 정리 · 없는 뷰 이름 응답 정책(§day3 4-1 끝) | — |

**재배포 순서 주의:** 마이그레이션 0002 가 프로덕션에 아직 없다. compose 의 migrate 서비스가 자동으로 돌지만,
502 풀고 재배포할 때 순서(migrate → 앱)를 지켜야 한다. 지금 프로덕션 DB 에는 invites·members 테이블이 없다.

## 8. 검증 명령 (day3 §7 갱신분)

```bash
pnpm typecheck && pnpm test        # 957개: core 721 · web 63 · worker 173
```

```bash
# 초대 링크 (계정 2개 필요 — 실측은 §2-3 참고, 세션을 DB 에 심어 확인했다)
pnpm --filter @endpointer/worker test src/fetchers/guarded-dispatcher.test.ts   # 리바인딩 관문
pnpm --filter @endpointer/worker test src/probe/inline-json.test.ts             # Nuxt3·SvelteKit 그릇
pnpm --filter @endpointer/core test src/normalize/date.test.ts                  # ISO 8601
```

```bash
# 502 진단 (VM 안에서)
ssh root@172.10.8.235 'curl -s http://127.0.0.1:20241/metrics | grep total_requests'  # 바깥 요청과 대조
```

### 관련 문서

- [day3-part-a.md](./day3-part-a.md) — Day 4 시작 시점(§8)이 이 문서의 전제
- [day2-part-a.md](./day2-part-a.md) — 코드 지도·판단·지뢰의 본문
- [adr.md](./adr.md) — A40(초대 링크) · A41(리바인딩) 이 오늘 추가됐다
- [gates.md](./gates.md) — G4 에 초대 링크 판정 4개 추가됨
