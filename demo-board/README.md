# 분반 공지 게시판 — 알림·자가치유 데모 사이트

의존성 0, 단일 파일(`server.mjs`). 글을 **글쓰기 폼으로** 올리면(자연스러운 행위) 다음 수집 때
알림이 가고, **관리 페이지의 [개편] 버튼**이 마크업을 통째로 바꿔(v1↔v2) 자가치유를 발동시킨다.

실측 검증됨: v1(테이블)·v2(카드) 모두 probe 겹침 100% 관통, 서로 완전히 다른 셀렉터.

## 1. 서버 올리기 (호스팅할 VM에서)

```bash
# node 18+ 만 있으면 된다
mkdir -p ~/demo-board && cd ~/demo-board
# server.mjs 를 이 디렉터리로 복사한 뒤:
PORT=4400 DEMO_PW=원하는비밀번호 node server.mjs
```

재부팅에도 살리려면 systemd:

```ini
# /etc/systemd/system/demo-board.service
[Unit]
Description=demo board
After=network.target
[Service]
Environment=PORT=4400
Environment=DEMO_PW=원하는비밀번호
ExecStart=/usr/bin/node /root/demo-board/server.mjs
Restart=always
[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl enable --now demo-board
```

## 2. 공개 도메인 붙이기 (캠프 터널 API — 그 VM 팀의 API 키로)

```bash
export API_KEY=sk_dns_...   # 그 팀 키
export BASE_URL=https://dns.madcamp-kaist.org

# 터널이 없다면 생성 (installCommand 로 cloudflared 설치까지 — 캠프 가이드 7장)
curl -s -X POST -H "Authorization: Bearer $API_KEY" $BASE_URL/v1/tunnels

# 호스트네임 연결 (예: <서브도메인>.madcamp-kaist.org → localhost:4400)
curl -s -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{"subdomain": "<서브도메인>", "localPort": 4400}' $BASE_URL/v1/tunnels/hostnames
```

## 3. 우리(endpointer) 쪽 세팅

1. 새 컬렉션 → 게시판 주소 붙여넣기 → 표 확인(제목·분류·행사일) → 저장
2. 표 탭 필터: 행사일 **D-7 이내** → **이 조건 저장** (이름: `일주일 안 행사`)
3. 뷰·알림 탭 → 받아보기 채널에 디스코드 웹훅 등록 → 뷰에 알림 켬
4. **수집 주기를 2분으로** (데모 소스만): DB 에서
   ```sql
   update sources set schedule = '*/2 * * * *' where host = '<서브도메인>.madcamp-kaist.org';
   ```
   워커 재시작(또는 부팅 동기화) 후 적용. 발표 끝나면 되돌린다.

## 4. 데모 절차

**알림**: `/write` 에서 행사일을 3~5일 뒤로 잡아 글 작성 → 1~2분 내 자동 수집 →
뷰 enter → 디스코드 알림 도착. (수동 트리거 없음 — "공고 올림 → 구독자에게 알림" 그대로)

**자가치유**: `/admin` → [사이트 개편] → 다음 수집에서 깨짐 감지("다시 맞추는 중", 표는 기존
데이터로 계속 서빙) → 재컴파일 → 복구 + "자동 복구 1회" 기록. [개편] 은 토글이라 무한 리허설.

**리허설 팁**: [글 초기화]는 [지금 상태를 기준으로 저장]으로 찍어 둔 스냅샷(board-seed.json)을
복원한다 — 발표 전날 글(특히 행사일이 지난 것)을 다듬고 [기준 저장]을 한 번 눌러 두면,
리허설을 아무리 반복해도 [초기화] 한 번으로 그 상태로 돌아온다. 스냅샷이 없으면 내장 시드를 쓴다.
다른 VM 으로 옮길 때 board-seed.json 도 server.mjs 와 같이 복사한다.
