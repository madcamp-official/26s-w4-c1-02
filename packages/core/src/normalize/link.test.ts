// link 파서 테스트 — 추적 파라미터를 못 털면 같은 공고가 매번 다른 링크를 갖고,
// 링크를 dedupe_key 로 쓰는 소스에서 매 수집이 전부 신규가 된다

import { describe, expect, it } from 'vitest'
import { parseLink } from './link'

const BASE = 'https://www.bizinfo.go.kr/web/lay1/bbs/list.do'

function link(raw: unknown, baseUrl?: string): string {
  const r = parseLink(raw, baseUrl === undefined ? {} : { baseUrl })
  if (!r.ok) throw new Error(`파싱 실패: ${r.reason}`)
  return r.value
}

describe('parseLink — 절대 주소', () => {
  it('그대로 통과한다', () => {
    expect(link('https://www.k-startup.go.kr/web/detail?sn=1')).toBe(
      'https://www.k-startup.go.kr/web/detail?sn=1',
    )
  })

  it('http 도 허용한다', () => {
    expect(link('http://example.go.kr/notice/1')).toBe('http://example.go.kr/notice/1')
  })
})

describe('parseLink — 상대경로 → 절대 URL', () => {
  it.each([
    ['/web/detail.do?id=7', 'https://www.bizinfo.go.kr/web/detail.do?id=7'],
    ['detail.do?id=7', 'https://www.bizinfo.go.kr/web/lay1/bbs/detail.do?id=7'],
    ['./detail.do', 'https://www.bizinfo.go.kr/web/lay1/bbs/detail.do'],
    ['../detail.do', 'https://www.bizinfo.go.kr/web/lay1/detail.do'],
  ])('%s → %s', (raw, expected) => {
    expect(link(raw, BASE)).toBe(expected)
  })

  it('기준 주소가 없으면 실패한다 — 절반짜리 링크를 내보내지 않는다', () => {
    expect(parseLink('/web/detail.do').ok).toBe(false)
  })
})

describe('parseLink — 프로토콜 없는 // 주소', () => {
  it('기준 주소의 프로토콜을 따른다', () => {
    expect(link('//cdn.example.com/a.html', 'http://example.com/x')).toBe('http://cdn.example.com/a.html')
  })

  it('기준이 없으면 https 로 본다', () => {
    expect(link('//cdn.example.com/a.html')).toBe('https://cdn.example.com/a.html')
  })
})

describe('parseLink — 추적 파라미터 제거', () => {
  it('utm_* 를 전부 턴다', () => {
    expect(link('https://a.go.kr/n/1?utm_source=naver&utm_medium=cpc&id=3')).toBe(
      'https://a.go.kr/n/1?id=3',
    )
  })

  it.each(['fbclid', 'gclid', 'igshid', 'mc_cid', 'spm'])('%s 도 턴다', (key) => {
    expect(link(`https://a.go.kr/n/1?${key}=xyz&id=3`)).toBe('https://a.go.kr/n/1?id=3')
  })

  it('추적 파라미터만 있으면 물음표까지 사라진다', () => {
    expect(link('https://a.go.kr/n/1?utm_source=naver')).toBe('https://a.go.kr/n/1')
  })

  it('같은 공고의 두 유입 링크가 같은 값으로 수렴한다', () => {
    expect(link('https://a.go.kr/n/1?id=3&utm_source=naver')).toBe(
      link('https://a.go.kr/n/1?id=3&fbclid=abc'),
    )
  })

  it('값이 들어 있는 일반 파라미터는 지킨다', () => {
    expect(link('https://a.go.kr/n?pbancSn=1234&page=2')).toBe('https://a.go.kr/n?pbancSn=1234&page=2')
  })
})

describe('parseLink — 링크가 아닌 것', () => {
  it.each(['javascript:void(0)', 'data:text/html,<b>x</b>', 'mailto:a@b.com', 'tel:021234'])(
    '%s → ok:false',
    (raw) => {
      expect(parseLink(raw, { baseUrl: BASE }).ok).toBe(false)
    },
  )

  it.each([null, undefined, '', '   ', {}])('%p → ok:false', (raw) => {
    expect(parseLink(raw, { baseUrl: BASE }).ok).toBe(false)
  })
})

describe('parseLink — 지저분한 원값', () => {
  it('HTML 엔티티가 섞인 href 를 푼다', () => {
    expect(link('https://a.go.kr/n?id=3&amp;page=2')).toBe('https://a.go.kr/n?id=3&page=2')
  })

  it('앞뒤 공백과 개행을 턴다', () => {
    expect(link('\n  https://a.go.kr/n/1  \n')).toBe('https://a.go.kr/n/1')
  })
})
