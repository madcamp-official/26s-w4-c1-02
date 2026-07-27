// 나가는 요청 관문 (SSRF)
//
// 여기서 보는 건 하나다: **서버가 자기 자리에서만 보이는 곳으로 나가지 않는가.**
// 그래서 테스트도 "막혔다" 가 아니라 **우회 수법별로** 적는다. 새 우회를 알게 되면
// 여기에 한 줄 늘리는 것이 이 파일의 쓰임이다.
//
// 이름 풀기는 가짜로 바꾼다. 진짜 DNS 를 타면 테스트가 남의 네트워크 사정에 달리게 된다.

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
const { checkOutboundUrl, checkOutboundUrlSync, isBlockedOutboundUrl } = await import('./guard')

beforeEach(() => {
  DNS.clear()
  // 개발자 `.env` 에 탈출구가 켜져 있어도 테스트는 닫힌 상태에서 돈다
  process.env['ALLOW_PRIVATE_HOSTS'] = 'false'
  resetConfigCache()
})

afterEach(() => {
  delete process.env['ALLOW_PRIVATE_HOSTS']
  resetConfigCache()
})

// ── 글자만 봐도 막히는 것 ──────────────────────────────────────────────

describe('주소에 적힌 그대로 내부를 가리키는 경우', () => {
  const blocked = [
    'http://localhost:6379/',
    'http://127.0.0.1:5432/',
    'http://[::1]:3000/',
    'http://169.254.169.254/latest/meta-data/', // 클라우드 인스턴스 자격증명
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://192.168.0.1/admin',
    'http://10.0.0.5/',
    'http://redis.internal:6379/',
  ]

  for (const url of blocked) {
    it(`막는다: ${url}`, () => {
      expect(checkOutboundUrlSync(url).ok).toBe(false)
    })
  }

  it('10진수·8진수·16진수로 적어도 막는다 — 주소 파서가 먼저 127.0.0.1 로 편다', () => {
    for (const url of ['http://2130706433/', 'http://0x7f000001/', 'http://017700000001/', 'http://127.1/']) {
      expect(checkOutboundUrlSync(url).ok, url).toBe(false)
    }
  })

  it('IPv4 를 IPv6 로 감싸도 막는다', () => {
    // `new URL(...).hostname` 이 `::ffff:7f00:1` 로 바꿔 놓기 때문에 눈으로는 127.0.0.1 이 안 보인다
    expect(checkOutboundUrlSync('http://[::ffff:127.0.0.1]/').ok).toBe(false)
    expect(checkOutboundUrlSync('http://[::ffff:a9fe:a9fe]/').ok).toBe(false)
  })

  it('사용자 정보로 눈속임한 주소를 막는다', () => {
    // 사람 눈에는 공공기관 주소로 보이지만 실제로 붙는 곳은 127.0.0.1 이다
    expect(checkOutboundUrlSync('http://www.k-startup.go.kr@127.0.0.1/').ok).toBe(false)
  })

  it('http · https 가 아니면 막는다', () => {
    for (const url of ['file:///etc/passwd', 'ftp://example.com/', 'gopher://127.0.0.1:6379/']) {
      expect(checkOutboundUrlSync(url).ok, url).toBe(false)
    }
  })

  it('읽을 수 없는 주소는 막는 쪽이다', () => {
    expect(isBlockedOutboundUrl('그냥 글자')).toBe(true)
    expect(isBlockedOutboundUrl('')).toBe(true)
  })
})

// ── 이름을 풀어야 막히는 것 ────────────────────────────────────────────

describe('이름은 멀쩡한데 내부를 가리키는 경우', () => {
  it('공인 도메인이 127.0.0.1 로 풀리면 막는다 — 글자만 봐서는 안 걸린다', async () => {
    DNS.set('evil.example', ['127.0.0.1'])

    // 글자 단계는 통과한다. 여기가 이름 풀기를 하는 이유다.
    expect(checkOutboundUrlSync('https://evil.example/list').ok).toBe(true)
    expect((await checkOutboundUrl('https://evil.example/list')).ok).toBe(false)
  })

  it('주소를 여러 개 주고 그중 하나만 내부여도 막는다', async () => {
    // 한 개만 보고 판단하면 운에 따라 통과한다. `lookup` 을 `all: true` 로 부르는 이유다.
    DNS.set('mixed.example', ['93.184.216.34', '169.254.169.254'])

    expect((await checkOutboundUrl('https://mixed.example/')).ok).toBe(false)
  })

  it('IPv6 내부 주소로 풀려도 막는다', async () => {
    DNS.set('six.example', ['::1'])

    expect((await checkOutboundUrl('https://six.example/')).ok).toBe(false)
  })

  it('바깥 주소로 풀리면 통과한다', async () => {
    DNS.set('www.k-startup.go.kr', ['175.45.223.88'])

    const r = await checkOutboundUrl('https://www.k-startup.go.kr/web/list')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.url.host).toBe('www.k-startup.go.kr')
  })

  it('이름을 못 풀면 요청하지 않고 끝낸다', async () => {
    expect((await checkOutboundUrl('https://없는주소.example/')).ok).toBe(false)
  })
})

// ── 문구 ───────────────────────────────────────────────────────────────

describe('막을 때 하는 말', () => {
  it('어디가 왜 막혔는지 자세히 말하지 않는다', async () => {
    DNS.set('probe.example', ['10.1.2.3'])
    const r = await checkOutboundUrl('https://probe.example/')

    expect(r.ok).toBe(false)
    if (!r.ok) {
      // 되돌아온 주소를 그대로 알려주면 그것만으로 내부망 지도가 그려진다
      expect(r.message).not.toContain('10.1.2.3')
      expect(r.message).toContain('probe.example')
    }
  })
})

// ── 개발용 탈출구 ──────────────────────────────────────────────────────

describe('ALLOW_PRIVATE_HOSTS', () => {
  it('켜면 사설망이 열린다 — 로컬 픽스처로 파이프라인을 돌려야 하기 때문이다', async () => {
    process.env['ALLOW_PRIVATE_HOSTS'] = 'true'
    resetConfigCache()

    expect(checkOutboundUrlSync('http://127.0.0.1:8080/list').ok).toBe(true)
    expect((await checkOutboundUrl('http://127.0.0.1:8080/list')).ok).toBe(true)
  })

  it('켜도 http · https 가 아닌 것은 그대로 막는다', () => {
    process.env['ALLOW_PRIVATE_HOSTS'] = 'true'
    resetConfigCache()

    expect(checkOutboundUrlSync('file:///etc/passwd').ok).toBe(false)
  })

  it('기본값은 닫힘이다 — 잊어서 열려 있는 일이 없어야 한다', () => {
    delete process.env['ALLOW_PRIVATE_HOSTS']
    resetConfigCache()

    expect(checkOutboundUrlSync('http://127.0.0.1:6379/').ok).toBe(false)
  })
})
