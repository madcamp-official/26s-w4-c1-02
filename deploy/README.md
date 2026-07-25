# 배포 — VM 1대에 올리기

기획서 8장(배포 · P5) · ADR A9 구현. 대상은 **관문 G4**:

> 도메인에 HTTPS로 떠 있고, 재부팅해도 컨테이너가 다시 뜬다.

로컬 개발은 이 디렉터리와 무관하다. 레포 루트의 `docker-compose.yml`(Postgres·Redis만)을
쓰고 앱은 호스트에서 `pnpm dev` 로 돈다. **루트 compose 파일은 건드리지 마라.**

## 이 디렉터리에 있는 것

| 파일 | 하는 일 |
|---|---|
| `docker-compose.prod.yml` | caddy · web · worker · mcp · postgres · redis + 1회성 migrate |
| `Caddyfile` | 도메인 3개 라우팅, 자동 HTTPS |
| `Dockerfile.web` | Next.js 빌드 후 `next start` |
| `Dockerfile.worker` | Playwright 베이스. `tsx` 로 실행 |
| `Dockerfile.mcp` | slim 베이스. `tsx` 로 실행. migrate 서비스가 재사용 |
| `Dockerfile.*.dockerignore` | 빌드 컨텍스트에서 `node_modules`·`.env`·`.git` 제외 |
| `.env.production.example` | 배포용 환경변수 원본 |

## VM 요구사항

- **2vCPU / 8GB** (기획서 8장). 4GB 는 Playwright 때문에 빠듯하다 — 올릴 수는 있지만
  `.env` 의 `MEM_*` 를 낮추고 `BROWSER_CONCURRENCY=1` 로 묶어라.
- 디스크 40GB 이상 (이미지 3개 + Playwright 브라우저 + Postgres).
- 방화벽: **22 / 80 / 443 만** 연다. Postgres·Redis·web·mcp 는 호스트 포트를 열지 않는다
  (compose 에서 `expose` 만 쓴다 — 컨테이너 네트워크 안에서만 보인다).

---

## 절차

### 1. DNS — 먼저 해라 (전파에 시간이 걸린다)

A 레코드 3개를 VM 공인 IP 로 건다. 16장 O1 이 아직 미정이므로 도메인이 정해지는 즉시 이걸 먼저 한다.

```
example.com        A   <VM_IP>
api.example.com    A   <VM_IP>
mcp.example.com    A   <VM_IP>
```

확인:

```bash
dig +short example.com api.example.com mcp.example.com
```

세 줄 다 VM IP 가 나와야 한다. **안 나오면 다음 단계로 가지 마라** — Let's Encrypt 발급이
실패하고, 실패를 반복하면 주간 한도에 걸려서 몇 시간 동안 재시도가 막힌다.

### 2. VM 준비

```bash
# Docker Engine + compose plugin
curl -fsSL https://get.docker.com | sh

# 재부팅해도 도커가 뜨게 (G4 판정의 절반이 여기 걸려 있다)
sudo systemctl enable --now docker

# sudo 없이 쓰려면
sudo usermod -aG docker "$USER" && newgrp docker
```

### 3. 코드 가져오기

```bash
git clone <repo> endpointer && cd endpointer/deploy
```

### 4. 환경변수

```bash
cp .env.production.example .env
```

`.env` 를 열고 최소한 이것들을 채운다. 비어 있으면 compose 가 `set X` 에러로 멈춘다.

```bash
openssl rand -hex 24     # → POSTGRES_PASSWORD
openssl rand -base64 32  # → AUTH_SECRET
```

- `APP_DOMAIN` / `API_DOMAIN` / `MCP_DOMAIN` / `ACME_EMAIL`
- `POSTGRES_PASSWORD` · `AUTH_SECRET`
- `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`
  — Google Cloud Console 의 승인된 리디렉션 URI 에 `https://<APP_DOMAIN>/api/auth/callback/google` 등록
- `GEMINI_API_KEY`

`chmod 600 .env`.

### 5. 인증서 발급을 먼저 시험한다 (권장)

`Caddyfile` 상단 전역 블록의 `acme_ca` 주석을 풀어 staging 으로 한 번 올려 본다.
브라우저는 "신뢰할 수 없는 인증서"라고 경고하지만 **그 경고가 뜨는 것 자체가 성공 신호다** —
DNS·방화벽·80 포트가 다 맞았다는 뜻이다. 확인했으면 주석을 다시 닫고 6번으로 간다.

### 6. 올린다

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

처음 빌드는 10~20분 걸린다 (Playwright 이미지가 크다). 순서는 compose 가 잡는다:

```
postgres/redis (healthy) → migrate (완료) → web/worker/mcp (healthy) → caddy
```

### 7. 확인

```bash
docker compose -f docker-compose.prod.yml ps          # 전부 Up / healthy
docker compose -f docker-compose.prod.yml logs -f caddy   # 인증서 발급 로그
```

```bash
curl -I  https://example.com
curl -s  https://api.example.com/contest | head -c 400   # items·sources·schema_version 이 보여야 한다
curl -I  http://example.com                              # 308 → https 리다이렉트
```

### 8. 시드 (필요하면)

마이그레이션은 `migrate` 서비스가 자동으로 돌지만 시드는 수동이다.

```bash
docker compose -f docker-compose.prod.yml run --rm migrate \
  pnpm --filter @endpointer/core db:seed
```

시드는 멱등이므로 두 번 돌려도 중복이 생기지 않는다.

---

## G4 체크리스트

배포 판정은 이 목록으로 한다. **하나라도 아니면 미통과다.**

- [ ] `dig` 로 도메인 3개가 전부 VM IP 를 가리킨다
- [ ] `https://<APP_DOMAIN>` 이 유효한 인증서(브라우저 경고 없음)로 열린다
- [ ] `https://<API_DOMAIN>/<slug>` 가 `items` · `sources` · `schema_version` 을 돌려준다
- [ ] `http://<APP_DOMAIN>` 이 https 로 리다이렉트된다 (308)
- [ ] `https://<MCP_DOMAIN>/<slug>` 를 커넥터에 붙여 넣으면 실제 아이템으로 답한다
      (스트리밍이 끊기면 `Caddyfile` 의 `flush_interval -1` 부터 의심해라)
- [ ] `docker compose -f docker-compose.prod.yml ps` 에서 caddy·web·worker·mcp·postgres·redis 가
      전부 `Up (healthy)` — `migrate` 만 `Exited (0)` 이 정상이다
- [ ] **재부팅 테스트**: `sudo reboot` 후 2~3분 기다렸다가 다시 접속하면 사이트가 떠 있다
  - [ ] `systemctl is-enabled docker` → `enabled`
  - [ ] `docker compose -f docker-compose.prod.yml ps` 가 다시 healthy
  - [ ] 재부팅 후에도 로그인 세션·수집 데이터가 남아 있다 (볼륨 확인)
- [ ] 예약 수집(BullMQ repeatable job)이 재부팅 후에도 다시 걸린다
- [ ] `docker stats` 로 30분 관찰 — worker 가 `MEM_WORKER` 상한 근처에서 OOM 재시작을 반복하지 않는다

## 운영 메모

**재배포**

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

`migrate` 는 매번 다시 돌아 새 마이그레이션만 적용한다.

**로그**

```bash
docker compose -f docker-compose.prod.yml logs -f worker
```

컨테이너별 10MB × 3 로 회전한다 (디스크가 로그로 차는 사고 방지).

**메모리** — 15장 리스크 "Playwright 가 VM 을 잡아먹음" 대응이 세 겹으로 들어가 있다.

1. `mem_limit` — worker 가 죽어도 Postgres 는 안 죽는다
2. `WORKER_CONCURRENCY` / `BROWSER_CONCURRENCY` — 동시에 뜨는 브라우저 수 제한
3. `shm_size: 1gb` — Chromium 이 `/dev/shm` 부족으로 탭을 잃지 않게

worker 가 반복 재시작하면 `docker inspect endpointer-worker --format '{{.State.OOMKilled}}'`
를 먼저 본다. `true` 면 `BROWSER_CONCURRENCY` 를 1 로 내리거나 `MEM_WORKER` 를 올린다.

**DB 접속** — 포트를 열지 않았으므로 SSH 터널이나 컨테이너 안에서 붙는다.

```bash
docker compose -f docker-compose.prod.yml exec postgres psql -U endpointer -d endpointer
```

**백업**

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U endpointer endpointer | gzip > "backup-$(date +%F).sql.gz"
```

`caddy_data` 볼륨에는 발급받은 인증서가 들어 있다. **지우지 마라** — 재발급이 일어나고
Let's Encrypt 주간 한도에 걸릴 수 있다.

**완전 초기화 (데이터까지 날린다)**

```bash
docker compose -f docker-compose.prod.yml down -v
```
