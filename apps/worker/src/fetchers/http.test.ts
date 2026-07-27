// httpGet 의 리다이렉트 처리
//
// **첫 주소만 검사하면 관문이 없는 것과 같다.** 공인 주소를 하나 두고 302 로 내부를 가리키는 건
// SSRF 의 기본형이라, 여기서 보는 것은 "홉마다 다시 검사하는가" 다.
// 그래서 이 파일은 `redirect: 'manual'` 로 손수 따라가는 코드가 있는 한 같이 있어야 한다.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { DNS } = vi.hoisted(() => ({ DNS: new Map<string, string[]>() }))

vi.mock('node:dns/promises', () => ({
  lookup: async (hostname: string) => {
    const addresses = DNS.get(hostname)
    if (addresses === undefined) throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' })
    return addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
  },
}))

const { resetConfigCache } = await import('../config')
const { clearHttpCache, httpGet } = await import('./http')

/** 응답 하나를 어떻게 흉내 낼지 */
interface Hop {
  status: number
  location?: string
  body?: string
}

let script: Hop[] = []
let calls: { url: string; method: string; hasBody: boolean }[] = []

function stubFetch(): void {
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      hasBody: init?.body !== undefined && init.body !== null,
    })
    const hop = script.shift() ?? { status: 200, body: '마지막' }
    const headers = new Headers({ 'content-type': 'text/html; charset=utf-8' })
    if (hop.location !== undefined) headers.set('location', hop.location)
    // 204·205·304 는 본문을 가질 수 없다 (Response 생성자가 거부한다)
    const nullBody = hop.status === 204 || hop.status === 205 || hop.status === 304
    return new Response(nullBody ? null : (hop.body ?? ''), { status: hop.status, headers })
  })
}

beforeEach(() => {
  DNS.clear()
  DNS.set('www.k-startup.go.kr', ['175.45.223.88'])
  DNS.set('other.example', ['93.184.216.34'])
  DNS.set('evil.example', ['93.184.216.34'])

  script = []
  calls = []
  process.env['ALLOW_PRIVATE_HOSTS'] = 'false'
  // 호스트별 최소 간격이 살아 있으면 홉마다 1.5초씩 잔다
  process.env['CRAWLER_MIN_INTERVAL_MS'] = '0'
  resetConfigCache()
  clearHttpCache()
  stubFetch()
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env['ALLOW_PRIVATE_HOSTS']
  delete process.env['CRAWLER_MIN_INTERVAL_MS']
  resetConfigCache()
})

describe('리다이렉트를 따라갈 때', () => {
  it('내부망으로 넘기면 따라가지 않는다', async () => {
    script = [{ status: 302, location: 'http://169.254.169.254/latest/meta-data/' }]

    const r = await httpGet('https://evil.example/list')

    expect(r.ok).toBe(false)
    // 한 번만 나갔다 = 넘어간 주소로는 요청하지 않았다
    expect(calls).toHaveLength(1)
  })

  it('이름은 멀쩡한데 내부로 풀리는 곳으로 넘겨도 막는다', async () => {
    DNS.set('inner.example', ['10.0.0.7'])
    script = [{ status: 302, location: 'https://inner.example/' }]

    expect((await httpGet('https://evil.example/list')).ok).toBe(false)
    expect(calls).toHaveLength(1)
  })

  it('바깥으로 넘기면 따라가고 마지막 응답을 준다', async () => {
    script = [{ status: 301, location: 'https://other.example/final' }, { status: 200, body: '목록입니다' }]

    const r = await httpGet('https://www.k-startup.go.kr/old')

    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.response.body).toBe('목록입니다')
      // 최종 주소가 남아야 상대 경로 링크를 절대 주소로 펼 수 있다
      expect(r.response.url).toBe('https://other.example/final')
    }
    expect(calls).toHaveLength(2)
  })

  it('상대 경로로 넘겨도 따라간다', async () => {
    script = [{ status: 302, location: '/list?page=1' }, { status: 200, body: 'ok' }]

    const r = await httpGet('https://www.k-startup.go.kr/web/old')

    expect(r.ok).toBe(true)
    expect(calls[1]?.url).toBe('https://www.k-startup.go.kr/list?page=1')
  })

  it('계속 넘기면 몇 번 만에 끊는다', async () => {
    script = Array.from({ length: 20 }, () => ({ status: 302, location: 'https://other.example/loop' }))

    const r = await httpGet('https://www.k-startup.go.kr/loop')

    expect(r.ok).toBe(false)
    expect(calls.length).toBeLessThanOrEqual(7)
  })

  it('303 을 받으면 GET 으로 바꾸고 본문을 버린다 — 브라우저와 같은 규칙', async () => {
    script = [{ status: 303, location: 'https://other.example/result' }, { status: 200, body: 'ok' }]

    await httpGet('https://www.k-startup.go.kr/api', { method: 'POST', body: '{"page":1}' })

    expect(calls[0]?.method).toBe('POST')
    expect(calls[1]?.method).toBe('GET')
    expect(calls[1]?.hasBody).toBe(false)
  })

  it('307 은 방법과 본문을 그대로 들고 간다', async () => {
    script = [{ status: 307, location: 'https://other.example/api' }, { status: 200, body: 'ok' }]

    await httpGet('https://www.k-startup.go.kr/api', { method: 'POST', body: '{"page":1}' })

    expect(calls[1]?.method).toBe('POST')
    expect(calls[1]?.hasBody).toBe(true)
  })

  it('넘길 곳을 안 적은 3xx 는 그 응답이 끝이다 — 어디로 가야 할지 추측하지 않는다', async () => {
    script = [{ status: 302, body: '' }]

    const r = await httpGet('https://www.k-startup.go.kr/list')

    expect(r.ok).toBe(true)
    if (r.ok) expect(r.response.status).toBe(302)
    expect(calls).toHaveLength(1)
  })
})

describe('나가기 전에', () => {
  it('내부망 주소는 요청조차 하지 않는다', async () => {
    const r = await httpGet('http://127.0.0.1:6379/')

    expect(r.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('실패해도 던지지 않는다 (원칙 ④)', async () => {
    await expect(httpGet('그냥 글자')).resolves.toMatchObject({ ok: false })
  })
})
