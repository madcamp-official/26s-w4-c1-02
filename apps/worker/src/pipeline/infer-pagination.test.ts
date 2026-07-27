// 페이지 넘김 후보 찾기 — 순수 부분만 검증한다.
// "2페이지를 실제로 받아 항목이 느는지" 판정은 attach 실측(gates G2)이 맡는다.

import { describe, expect, it } from 'vitest'

import { findPagerParams, templateUrl } from './infer-pagination'

const ENTRY = 'https://www.wevity.com/?c=find&s=1&gub=1&cidx=20'

/** wevity 실물을 닮은 페이지 하단 — 같은 경로에 gp 만 다른 링크들 */
const PAGER_HTML = `
  <div class="pager">
    <a href="/?c=find&s=1&gub=1&cidx=20&gp=1" class="on">1</a>
    <a href="/?c=find&s=1&gub=1&cidx=20&gp=2">2</a>
    <a href="/?c=find&s=1&gub=1&cidx=20&gp=3">3</a>
    <a href="/?c=find&s=1&gub=1&cidx=20&gp=4">4</a>
  </div>
  <a href="/?c=find&s=1&gub=1&cidx=20&gbn=view&ix=109568">상세로 가는 링크</a>
  <a href="/about">다른 경로 — 후보가 아니다</a>
`

describe('findPagerParams', () => {
  it('같은 경로 + 정수 파라미터 여러 값 = 페이지 넘김', () => {
    const found = findPagerParams(PAGER_HTML, ENTRY)
    expect(found[0]?.param).toBe('gp')
    expect(found[0]?.start).toBe(1) // 지금 주소에 gp 가 없으니 1부터
  })

  it('상세 링크의 고유 파라미터(ix)는 후보가 아니다 — 값이 하나뿐이고 알려진 이름도 아니다', () => {
    const found = findPagerParams(PAGER_HTML, ENTRY)
    expect(found.map((f) => f.param)).not.toContain('ix')
  })

  it('다른 경로의 링크는 세지 않는다 — 메뉴·상세는 페이지가 아니다', () => {
    const html = '<a href="/menu?page=2">메뉴</a><a href="/menu?page=3">메뉴</a>'
    expect(findPagerParams(html, ENTRY)).toEqual([])
  })

  it('값이 하나뿐이어도 알려진 이름(page 등)이면 후보로 남긴다', () => {
    const html = '<a href="/?c=find&s=1&gub=1&cidx=20&page=2">다음</a>'
    expect(findPagerParams(html, ENTRY)[0]?.param).toBe('page')
  })

  it('지금 주소에 이미 값이 있으면 그 값이 start 다', () => {
    const found = findPagerParams(PAGER_HTML, 'https://www.wevity.com/?c=find&s=1&gub=1&cidx=20&gp=2')
    expect(found[0]?.start).toBe(2)
  })
})

describe('templateUrl', () => {
  it('{page} 를 글자 그대로 넣는다 — URL API 는 인코딩해 버려서 못 쓴다', () => {
    expect(templateUrl('https://a.com/list?c=1&gp=3', 'gp')).toBe('https://a.com/list?c=1&gp={page}')
  })

  it('없던 파라미터면 붙인다', () => {
    expect(templateUrl('https://a.com/list', 'page')).toBe('https://a.com/list?page={page}')
  })
})
