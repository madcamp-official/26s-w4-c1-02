// URL → 컬렉션 배선의 순수 부분 (기획서 9-1)
//
// 네트워크와 LLM 을 타는 부분은 여기서 보지 않는다. 대신 **사용자 입력이 들어오는 문턱**과
// **표에 이름을 붙이는 규칙**을 본다 — 둘 다 보장선이 걸려 있는 지점이다:
//   · 주소 확인 실패는 던지지 않고 사람이 읽는 문구가 된다 (B4)
//   · 컬렉션 이름과 slug 가 비면 사용자가 이름부터 지어야 한다 (B3)

import { describe, expect, it } from 'vitest'

import { collectionNameFrom, createCollectionFromUrl, normalizeUrl, slugFrom } from './create-collection'

describe('normalizeUrl', () => {
  it('스킴이 있으면 그대로 받는다', () => {
    expect(normalizeUrl('https://www.k-startup.go.kr/list')?.host).toBe('www.k-startup.go.kr')
    expect(normalizeUrl('http://example.com')?.protocol).toBe('http:')
  })

  it('스킴을 빼먹은 붙여넣기를 받아준다 — "주소가 틀렸다"를 한 번 덜 보여준다', () => {
    const u = normalizeUrl('k-startup.go.kr/web/list?page=1')
    expect(u?.protocol).toBe('https:')
    expect(u?.host).toBe('k-startup.go.kr')
    expect(u?.searchParams.get('page')).toBe('1')
  })

  it('앞뒤 공백을 턴다 — 복사할 때 딸려온다', () => {
    expect(normalizeUrl('  https://example.com/a  ')?.pathname).toBe('/a')
  })

  it('주소가 아니면 null 이다', () => {
    for (const bad of ['', '   ', '그냥 글자', 'http://']) {
      expect(normalizeUrl(bad), bad).toBeNull()
    }
  })

  it('스킴이 있는데 깨진 것은 https 를 덧붙이지 않는다', () => {
    // `https://` 를 앞에 또 붙이면 엉뚱한 주소가 만들어진다
    expect(normalizeUrl('javascript:alert(1)')?.protocol).toBe('javascript:')
    expect(normalizeUrl('mailto:a@b.c')?.protocol).toBe('mailto:')
  })
})

describe('createCollectionFromUrl — 문턱에서 막히는 경우', () => {
  it('빈 주소는 던지지 않고 사람이 읽는 문구를 돌려준다 (보장선 B4)', async () => {
    const r = await createCollectionFromUrl({ url: '   ' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.stage).toBe('url')
    expect(r.message).toContain('주소')
  })

  it('http(s) 가 아니면 거절한다 — probe 를 타기 전에 막는다', async () => {
    const r = await createCollectionFromUrl({ url: 'javascript:alert(1)' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.stage).toBe('url')
    expect(r.message).toContain('웹 주소')
  })

  it('실패 문구에 내부 명사·HTTP 코드가 없다 (보장선 B2 · B4)', async () => {
    const r = await createCollectionFromUrl({ url: 'file:///etc/passwd' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    for (const banned of ['probe', '스펙', '어댑터', '드리프트', '파서', 'Error', 'HTTP', '404', '500']) {
      expect(r.message, banned).not.toContain(banned)
    }
  })
})

describe('collectionNameFrom — 빈 이름을 주지 않는다 (보장선 B3)', () => {
  it('페이지 제목에서 사이트 이름 꼬리를 뗀다', () => {
    expect(collectionNameFrom('사업공고 | K-Startup', 'www.k-startup.go.kr')).toBe('사업공고')
    expect(collectionNameFrom('공모전 목록 - 씽굿', 'thinkcontest.com')).toBe('공모전 목록')
  })

  it('제목이 없으면 호스트로 짓는다 — 절대 비지 않는다', () => {
    expect(collectionNameFrom(null, 'www.k-startup.go.kr')).toBe('k-startup.go.kr')
    expect(collectionNameFrom('', 'bizinfo.go.kr')).toBe('bizinfo.go.kr')
    expect(collectionNameFrom('   ', 'bizinfo.go.kr')).toBe('bizinfo.go.kr')
  })

  it('제목이 너무 길면 호스트로 물러선다 — 열 이름이 화면을 깨지 않게', () => {
    const long = '가'.repeat(80)
    expect(collectionNameFrom(long, 'example.com')).toBe('example.com')
  })
})

describe('slugFrom — API 경로에 그대로 들어간다', () => {
  it('라틴 제목이면 제목에서 짓는다', () => {
    expect(slugFrom('thinkcontest.com', 'Contest List')).toBe('contest-list')
  })

  it('한국어 제목이면 호스트에서 짓는다 — 라틴 문자가 안 남기 때문', () => {
    expect(slugFrom('www.k-startup.go.kr', '사업공고')).toBe('k-startup')
    expect(slugFrom('bizinfo.go.kr', '지원사업 목록')).toBe('bizinfo')
  })

  it('소문자·숫자·하이픈만 남는다', () => {
    for (const s of [
      slugFrom('www.k-startup.go.kr', null),
      slugFrom('thinkcontest.com', 'Contest! List?'),
      slugFrom('example.co.kr', '한글'),
    ]) {
      expect(s).toMatch(/^[a-z0-9-]+$/)
      expect(s.startsWith('-')).toBe(false)
      expect(s.endsWith('-')).toBe(false)
    }
  })

  it('무슨 일이 있어도 비지 않는다', () => {
    expect(slugFrom('', null)).not.toBe('')
    expect(slugFrom('...', '!!!')).not.toBe('')
  })
})
