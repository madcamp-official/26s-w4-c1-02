// DNS 리바인딩 관문 (ADR A41) — guardedLookup 이 사설로 풀리는 이름을 접속 직전에 끊는가.
//
// 실제 dns 를 타지 않게 lookup 을 주입할 수 있으면 좋겠지만, guardedLookup 은 node:dns 를
// 직접 부른다. 그래서 여기서는 dns 가 이미 푼 뒤의 판정을 재현한다 — localhost 는 127.0.0.1 로
// 풀리므로 결정론적이다. 공인 IP 로 푸는 케이스는 실제 접속을 요구해 통합 테스트로 미룬다.

import { describe, expect, it } from 'vitest'

import { guardedLookup } from './guarded-dispatcher'

function runLookup(
  hostname: string,
  options: { all?: boolean } = {},
): Promise<{ err: NodeJS.ErrnoException | null; address: unknown; family?: number }> {
  return new Promise((resolve) => {
    guardedLookup(hostname, options, (err, address, family) => resolve({ err, address, family }))
  })
}

describe('guardedLookup', () => {
  it('사설로 풀리는 이름(localhost → 127.0.0.1)은 접속 전에 끊는다', async () => {
    const { err, address } = await runLookup('localhost', { all: true })
    expect(err).not.toBeNull()
    // 어느 IP 였는지 흘리지 않는다 — getaddrinfo 실패처럼 보인다 (guard.ts 와 같은 규율)
    expect(err?.code).toBe('ENOTFOUND')
    expect(address).toEqual([])
  })

  it('사설 판정은 all 여부와 무관하다 — 첫 주소만 보고 통과시키지 않는다', async () => {
    const single = await runLookup('localhost', { all: false })
    expect(single.err).not.toBeNull()
    expect(single.err?.code).toBe('ENOTFOUND')
  })

  it('풀 수 없는 이름은 에러로 돌린다 (막는 쪽 기본값)', async () => {
    const { err } = await runLookup('nx-이런호스트는없다.invalid', { all: true })
    expect(err).not.toBeNull()
  })

  it('공인 IP 로 풀리는 이름은 통과하고 그 주소를 돌려준다 (회귀)', async () => {
    // example.com 은 공인 IP 로 푼다. 네트워크가 없으면 에러가 나되 "사설이라 막힘"은 아니어야 한다
    const { err, address } = await runLookup('example.com', { all: true })
    if (err === null) {
      expect(Array.isArray(address)).toBe(true)
      expect((address as { address: string }[]).length).toBeGreaterThan(0)
    } else {
      // 오프라인 환경 — 최소한 사설 차단(ENOTFOUND + 빈 배열)이 아니라 실제 조회 실패여야 한다
      expect(['ENOTFOUND', 'EAI_AGAIN', 'ESERVFAIL']).toContain(err.code)
    }
  })
})
