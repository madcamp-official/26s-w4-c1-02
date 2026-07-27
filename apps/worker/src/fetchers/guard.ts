// 나가는 요청 관문 — 임의 주소를 받는 제품의 최소 방어선 (SSRF)
//
// 이 제품은 사용자가 준 주소를 **서버가 대신 연다.** 그러면 서버 자리에서만 보이는 것이
// 전부 사정권에 들어온다 — 같은 기계의 Redis·Postgres, 사내망, 그리고 클라우드
// 메타데이터(169.254.169.254 · 여기서 인스턴스 자격증명이 나온다).
// 화면에 나가는 건 "목록을 찾지 못했습니다" 한 줄뿐이지만, 응답이 오기까지 걸린 시간만으로도
// 내부망 포트 스캔이 된다. 그래서 화면 문구로는 막을 수 없고 나가기 전에 막아야 한다.
//
// ── 이름만 봐서는 안 되는 이유 ─────────────────────────────────────────
// core 의 `isPrivateHost` 는 **글자**를 본다. `http://127.0.0.1` 은 막지만
// `http://evil.example` 이 127.0.0.1 로 풀리는 건 못 막는다. 이름은 아무 주소나 가리킬 수 있고,
// 그렇게 가리키게 해 주는 공개 서비스도 있다. 그래서 여기서 실제로 이름을 풀어
// **돌아온 주소 전부**를 본다. 하나라도 사설이면 막는다.
//
// ── 여기서도 못 막는 것 (모르고 빠뜨린 게 아니라 알고 남긴다) ──────────
// 확인이 끝난 뒤 `fetch` 가 이름을 **다시** 푼다. 그 사이 답이 바뀌면(DNS 리바인딩) 확인한
// 주소와 실제로 붙는 주소가 달라진다. 완전히 막으려면 확인된 IP 로 고정해 붙어야 하는데,
// Node 내장 fetch 는 붙을 주소를 지정할 수단을 주지 않는다 (undici 를 직접 의존해야 한다).
// TTL 을 0 으로 깎은 이름을 미리 준비해 둬야 하는 공격이라 지금 순위에서는 미룬다.

import { lookup } from 'node:dns/promises'

import { isPrivateHost } from '@endpointer/core/spec'

import { getConfig } from '../config'

export type GuardOutcome = { ok: true; url: URL } | { ok: false; message: string }

/**
 * 나가도 되는 주소인지 본다. 통과하면 파싱된 URL 을 함께 돌려준다.
 *
 * 던지지 않는다 — 막힌 것도 결과다 (원칙 ④).
 */
export async function checkOutboundUrl(raw: string | URL): Promise<GuardOutcome> {
  const shallow = checkOutboundUrlSync(raw)
  if (!shallow.ok) return shallow
  if (getConfig().allowPrivateHosts) return shallow

  const { url } = shallow
  let addresses: { address: string }[]
  try {
    // `all: true` 가 핵심이다. 기본값은 **하나만** 돌려주는데, 그러면 A 레코드를
    // 공인 주소와 127.0.0.1 로 섞어 둔 이름이 운에 따라 통과한다.
    addresses = await lookup(url.hostname, { all: true, verbatim: true })
  } catch {
    // 이름을 못 푸는 주소는 어차피 붙지도 못한다. 여기서 끊으면 요청 한 번을 아낀다.
    return { ok: false, message: `${url.host} 를 찾지 못했습니다` }
  }

  if (addresses.length === 0) return { ok: false, message: `${url.host} 를 찾지 못했습니다` }
  for (const { address } of addresses) {
    if (isPrivateHost(address)) return { ok: false, message: blocked(url.host) }
  }

  return { ok: true, url }
}

/**
 * 이름을 풀지 않고 글자만 보는 판정.
 *
 * 브라우저 경로에서 쓴다. 페이지 하나가 만드는 요청이 수백 개라 그 전부를 이름 풀기까지
 * 기다리게 하면 수집이 느려서 못 쓴다. 여기서 걸러지는 건 `http://127.0.0.1:6379` 처럼
 * **주소를 대놓고 적은 것**까지고, 그게 브라우저 경로에서 실제로 오는 형태다.
 */
export function checkOutboundUrlSync(raw: string | URL): GuardOutcome {
  let url: URL
  try {
    url = raw instanceof URL ? raw : new URL(raw)
  } catch {
    return { ok: false, message: `주소를 읽을 수 없습니다: ${String(raw)}` }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, message: `http · https 주소만 받습니다: ${url.protocol}//…` }
  }
  // `http://k-startup.go.kr@127.0.0.1/` 은 눈으로 읽으면 공공기관 주소지만 127.0.0.1 로 간다.
  if (url.username !== '' || url.password !== '') {
    return { ok: false, message: '주소에 아이디·비밀번호를 넣을 수 없습니다' }
  }

  if (getConfig().allowPrivateHosts) return { ok: true, url }
  if (isPrivateHost(url.hostname)) return { ok: false, message: blocked(url.host) }

  return { ok: true, url }
}

/**
 * 막을 주소인가 (Playwright 라우트 훅처럼 불리언 하나만 필요한 곳).
 * 판정 실패는 **막는 쪽**으로 기운다 — 읽지 못한 주소를 통과시킬 이유가 없다.
 */
export function isBlockedOutboundUrl(raw: string): boolean {
  return !checkOutboundUrlSync(raw).ok
}

// 어디가 막혔는지 자세히 말하지 않는다. "127.0.0.1 은 막혔고 10.0.0.5 는 느리다" 는
// 대답 차이만으로도 내부망 지도가 그려진다.
function blocked(host: string): string {
  return `${host} 는 외부에서 열 수 없는 주소입니다`
}
