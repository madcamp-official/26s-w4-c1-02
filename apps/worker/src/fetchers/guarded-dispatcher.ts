// DNS 리바인딩 차단 — 확인한 IP 로 접속을 고정한다 (ADR A41 · A27 을 대체)
//
// A27 이 남긴 구멍이 여기다: checkOutboundUrl 이 이름을 풀어 검사해도, 그 뒤 fetch 가
// 이름을 **다시** 푼다. 두 번째 답이 127.0.0.1 로 바뀌면(TTL 0 리바인딩) 검사한 주소와
// 실제로 붙는 주소가 달라진다. 검사와 접속 사이의 시간차 공격(TOCTOU)이다.
//
// 막는 유일한 길: 접속 직전 이름 풀기(net.connect 의 lookup)에 관문을 끼운다.
// net.connect 는 lookup 이 돌려준 그 주소로 곧장 붙으므로 — 재조회 틈이 없다 — 여기서
// 사설 IP 를 거르면 리바인딩이 성립하지 않는다. Node 내장 fetch 는 lookup 을 못 바꿔서
// undici 를 직접 의존한다 (A41).

import { lookup as dnsLookup } from 'node:dns'
import type { LookupFunction } from 'node:net'

import { isPrivateHost } from '@endpointer/core/spec'
import { Agent, type Dispatcher } from 'undici'

interface LookupAddress {
  address: string
  family: number
}

type GuardedLookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void

interface LookupOptions {
  family?: number
  hints?: number
  all?: boolean
}

/**
 * net.connect 가 접속 직전에 부르는 이름 풀기. 돌아온 주소를 **전부** 보고
 * 하나라도 사설이면 접속을 막는다. 통과한 주소만 net.connect 에 돌려준다.
 *
 * 내부에서는 항상 `all: true` 로 풀어 전체를 검사한다 — 공인·127.0.0.1 을 섞어 둔
 * 레코드가 첫 주소만 검사하면 운에 따라 통과하기 때문이다 (guard.ts 의 `all: true` 와 같은 이유).
 * 그런 다음 caller 가 요청한 형태(all 여부)로 돌려준다.
 */
export function guardedLookup(
  hostname: string,
  options: LookupOptions,
  callback: GuardedLookupCallback,
): void {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, [])
    const resolved = addresses as LookupAddress[]
    for (const entry of resolved) {
      if (isPrivateHost(entry.address)) {
        const blocked: NodeJS.ErrnoException = new Error(
          `${hostname} 가 외부에서 열 수 없는 주소로 풀립니다`,
        )
        // getaddrinfo 실패처럼 보이게 둔다 — 어느 IP 였는지 흘리지 않는다 (guard.ts 와 같은 규율)
        blocked.code = 'ENOTFOUND'
        return callback(blocked, [])
      }
    }
    if (options.all === true) return callback(null, resolved)
    const first = resolved[0]
    if (first === undefined) {
      const empty: NodeJS.ErrnoException = new Error(`${hostname} 를 찾지 못했습니다`)
      empty.code = 'ENOTFOUND'
      return callback(empty, [])
    }
    callback(null, first.address, first.family)
  })
}

/**
 * 모든 fetch 접속이 guardedLookup 을 지나게 하는 undici Agent.
 * 리다이렉트 홉·페이지가 내는 하위 요청까지 전부 이 dispatcher 를 타면 관문을 우회할 수 없다.
 */
export function createGuardedDispatcher(): Dispatcher {
  // node:net 의 LookupFunction 콜백 타입은 `all:true` 의 배열 형태를 모른다(런타임은 지원).
  // 그 타입 간극만 여기서 메운다 — guardedLookup 의 실제 계약은 위 시그니처가 정본이다.
  return new Agent({ connect: { lookup: guardedLookup as unknown as LookupFunction } })
}

/**
 * 프로세스 하나에 dispatcher 하나 — 커넥션 풀을 나눠 쓴다.
 * `fetch(url, { dispatcher: guardedDispatcher() })` 로 호출부마다 명시로 붙인다
 * (setGlobalDispatcher 로 전역을 바꾸지 않는 이유: Gemini SDK 등 다른 fetch 까지 건드리지 않게).
 */
let shared: Dispatcher | null = null
export function guardedDispatcher(): Dispatcher {
  if (shared === null) shared = createGuardedDispatcher()
  return shared
}
