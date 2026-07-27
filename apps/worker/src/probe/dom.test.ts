// probe 4단계 — DOM 반복 구조 탐지 (기획서 9-1①-4)
//
// 여기서 보는 것은 세 가지다.
//   1. **낸 선택자가 실제로 도는가.** 이게 이 단계의 존재 이유다 — 검증 안 된 선택자를
//      스펙에 넣으면 수집이 조용히 0개가 되고, 화면에는 "수집 완료" 만 남는다.
//   2. **메뉴와 페이지 번호를 안 집는가.** 반복 구조는 목록 말고도 많다.
//   3. **겹침률 판정을 통과하는가.** 후보를 내도 rank 가 떨어뜨리면 probe 는 실패로 끝난다.

import { describe, expect, it } from 'vitest'

import { interpretSpec, type AdapterSpec } from '@endpointer/core/spec'

import { cheerioAdapter } from '../fetchers/cheerio-adapter'
import { visibleText } from '../html'
import { probeDom, structureSignature } from './dom'
import { rankCandidates } from './rank'
import type { ProbeCandidate } from './types'

const URL = 'https://example.go.kr/list'

/** 한국 공공 목록 사이트의 전형 — 표 하나에 위아래로 메뉴와 페이지 번호가 붙어 있다 */
const TABLE_PAGE = `<!DOCTYPE html><html><head><title>사업공고</title></head><body>
<div id="header"><ul class="gnb">
  <li><a href="/a">사업공고</a></li><li><a href="/b">알림마당</a></li>
  <li><a href="/c">고객센터</a></li><li><a href="/d">기업마당</a></li>
</ul></div>
<table class="board-list">
  <thead><tr><th>제목</th><th>기관</th><th>마감</th></tr></thead>
  <tbody>
    <tr><td class="tit"><a href="/view?id=1">2026년 청년창업사관학교 입교기업 모집공고</a></td><td class="org">중소벤처기업부</td><td class="date">2026-08-21</td></tr>
    <tr><td class="tit"><a href="/view?id=2">소상공인 온라인 판로개척 지원사업 참여기업 모집</a></td><td class="org">소상공인시장진흥공단</td><td class="date">2026-09-01</td></tr>
    <tr><td class="tit"><a href="/view?id=3">스마트공장 구축 및 고도화 지원사업 공고</a></td><td class="org">중소벤처기업부</td><td class="date">2026-09-15</td></tr>
    <tr><td class="tit"><a href="/view?id=4">수출바우처 사업 참여기업 모집 재공고</a></td><td class="org">한국무역협회</td><td class="date">2026-10-02</td></tr>
  </tbody>
</table>
<div class="paging"><a href="?p=1">1</a><a href="?p=2">2</a><a href="?p=3">3</a><a href="?p=4">4</a></div>
</body></html>`

/** 카드형 목록 — `on` 처럼 한 행에만 붙는 상태 클래스가 섞여 있다 */
const CARD_PAGE = `<!DOCTYPE html><html><head><title>공모전</title></head><body>
<div class="wrap"><ul class="contest-list">
  <li class="item"><span class="tit">제1회 전국 대학생 아이디어 공모전</span><span class="date">~2026.08.30</span><a href="/c/1">보기</a></li>
  <li class="item on"><span class="tit">2026 청년 스타트업 창업 경진대회</span><span class="date">~2026.09.12</span><a href="/c/2">보기</a></li>
  <li class="item"><span class="tit">제5회 데이터 분석 챌린지 참가자 모집</span><span class="date">~2026.09.30</span><a href="/c/3">보기</a></li>
</ul></div>
</body></html>`

function run(html: string, origin: 'dom' | 'browser_render' = 'dom') {
  return probeDom({ html, url: URL, minRows: 3, origin })
}

function rowsOf(candidate: ProbeCandidate): string[] {
  return candidate.rows as string[]
}

/** 후보의 list_path 를 실제로 돌려 본다 — core 해석기가 하는 것과 같은 방식으로 */
function selectWith(candidate: ProbeCandidate, html: string): number {
  const selector = candidate.list_path.replace(/^css:/, '')
  return cheerioAdapter.select(html, selector).length
}

describe('표로 된 목록', () => {
  it('본문 행을 집는 후보를 낸다', () => {
    const best = run(TABLE_PAGE).candidates[0]

    expect(best).toBeDefined()
    expect(rowsOf(best!)).toHaveLength(4)
    expect(rowsOf(best!)[0]).toContain('청년창업사관학교')
  })

  it('낸 선택자가 실제로 그 4행을 집는다 — 검증되지 않은 선택자는 내보내지 않는다', () => {
    for (const c of run(TABLE_PAGE).candidates) {
      expect(selectWith(c, TABLE_PAGE), c.list_path).toBe(c.rows.length)
    }
  })

  it('머리글 행(thead)을 끌어오지 않는다', () => {
    const best = run(TABLE_PAGE).candidates[0]!

    for (const row of rowsOf(best)) expect(row).not.toContain('제목 기관 마감')
  })

  it('메뉴와 페이지 번호는 후보가 되지 않는다', () => {
    const paths = run(TABLE_PAGE).candidates.map((c) => c.list_path)

    expect(paths.some((p) => p.includes('gnb'))).toBe(false)
    expect(paths.some((p) => p.includes('paging'))).toBe(false)
  })

  it('행 HTML 을 따로 낸다 — 컴파일 프롬프트가 이걸 보고 css: 경로를 쓴다', () => {
    const best = run(TABLE_PAGE).candidates[0]!

    expect(best.row_html).toHaveLength(4)
    expect(best.row_html?.[0]).toContain('<td')
    expect(best.row_html?.[0]).toContain('class="tit"')
  })

  it('겹침률에 쓰는 rows 에는 태그가 섞이지 않는다', () => {
    // 행 HTML 을 rows 에 같이 담으면 core 가 그것도 화면 텍스트와 견주려 든다.
    // 태그는 화면에 없으니 반드시 빗나가고, 겹침률이 실제보다 낮게 나와 후보가 밀린다.
    for (const row of rowsOf(run(TABLE_PAGE).candidates[0]!)) {
      expect(row).not.toContain('<')
    }
  })

  it('행마다 반복되는 자리 이름을 키로 낸다', () => {
    const best = run(TABLE_PAGE).candidates[0]!

    expect(best.keys).toContain('.tit')
    expect(best.keys).toContain('.date')
    expect(best.keys).toContain('a@href')
  })
})

// 고정 공지 + 일반 글 게시판 — 서울도서관 공지(lib.seoul.go.kr/bbs/list/3)의 축약이다.
// 상시 행은 `td.alwaysNum`, 일반 행은 `td.num` 이라 자식 클래스가 갈라진다.
const PINNED_PAGE = `<!DOCTYPE html><html><head><title>공지사항</title></head><body>
<div class="listTable"><table class="mobileTable">
  <thead><tr><th>No.</th><th>제목</th><th>작성일</th></tr></thead>
  <tbody>
    <tr><td class="alwaysNum"><span>상시</span></td><td class="title"><a href="/bbs/content/3_1">문학강연 프로그램 안내</a></td><td class="date">2026-07-15</td></tr>
    <tr><td class="alwaysNum"><span>상시</span></td><td class="title"><a href="/bbs/content/3_2">여름 휴관일 안내</a></td><td class="date">2026-06-24</td></tr>
    <tr><td class="num">1117</td><td class="title"><a href="/bbs/content/3_3">8월 독서동아리 참가자 모집</a></td><td class="date">2026-06-09</td></tr>
    <tr><td class="num">1116</td><td class="title"><a href="/bbs/content/3_4">자료실 서가 정리 일정 공지</a></td><td class="date">2026-05-30</td></tr>
    <tr><td class="num">1115</td><td class="title"><a href="/bbs/content/3_5">디지털자료실 좌석 예약 변경</a></td><td class="date">2026-05-12</td></tr>
  </tbody>
</table></div>
</body></html>`

describe('고정 공지가 섞인 게시판', () => {
  it('상시 행과 일반 행이 클래스만 다르면 한 목록으로 묶인다', () => {
    // 클래스까지 시그니처에 넣으면 5행이 2 + 3 으로 쪼개지고, 반쪽으로 선택자를
    // 검증하면 `tbody > tr` 이 "남의 행까지 집는다" 며 기각되어 표 전체를 놓친다.
    const best = run(PINNED_PAGE).candidates[0]

    expect(best).toBeDefined()
    expect(rowsOf(best!)).toHaveLength(5)
    expect(rowsOf(best!).some((r) => r.includes('문학강연'))).toBe(true)
    expect(rowsOf(best!).some((r) => r.includes('독서동아리'))).toBe(true)
  })

  it('낸 선택자가 다섯 행을 전부 집는다 — 머리글(th 행)은 안 집는다', () => {
    const best = run(PINNED_PAGE).candidates[0]!

    expect(selectWith(best, PINNED_PAGE)).toBe(5)
    for (const row of rowsOf(best)) expect(row).not.toContain('No. 제목 작성일')
  })
})

describe('카드형 목록', () => {
  it('한 행에만 붙은 상태 클래스(`on`) 때문에 행을 놓치지 않는다', () => {
    const best = run(CARD_PAGE).candidates[0]!

    expect(rowsOf(best)).toHaveLength(3)
    expect(selectWith(best, CARD_PAGE)).toBe(3)
  })

  it('컨테이너에 고유 클래스가 있으면 그걸 쓴다 — 사람이 읽고 고칠 수 있는 선택자', () => {
    expect(run(CARD_PAGE).candidates[0]!.list_path).toBe('css:.contest-list > li.item')
  })
})

describe('후보의 모양', () => {
  it('정적 HTML 이면 html 모드, 브라우저 렌더면 browser 모드', () => {
    expect(run(TABLE_PAGE).candidates[0]?.fetch_mode).toBe('html')
    expect(run(TABLE_PAGE, 'browser_render').candidates[0]?.fetch_mode).toBe('browser')
    expect(run(TABLE_PAGE, 'browser_render').candidates[0]?.origin).toBe('browser_render')
  })

  it('fetch_url 은 받은 주소 그대로다', () => {
    expect(run(TABLE_PAGE).candidates[0]?.fetch_url).toBe(URL)
  })

  it('행 텍스트가 190자를 넘지 않는다 — 넘으면 core 가 겹침률 비교에서 빼 버린다', () => {
    const page = `<html><body><ul class="list">${Array.from(
      { length: 4 },
      (_, i) => `<li class="row">${'가'.repeat(400)}${i}</li>`,
    ).join('')}</ul></body></html>`

    for (const c of run(page).candidates) {
      for (const row of rowsOf(c)) expect(row.length).toBeLessThanOrEqual(190)
    }
  })
})

describe('rank 로 이어붙였을 때', () => {
  it('겹침률 판정을 통과한다 — 후보를 내도 rank 가 떨어뜨리면 probe 는 실패다', () => {
    const candidates = run(TABLE_PAGE).candidates
    const ranked = rankCandidates({ pageText: visibleText(TABLE_PAGE), candidates })

    expect(ranked[0]?.overlap).toBeGreaterThanOrEqual(0.3)
  })
})

describe('해석기까지 이어붙였을 때', () => {
  it('낸 list_path 로 실제 항목이 뽑힌다 — probe 와 수집 사이가 끊기지 않았는지', () => {
    const best = run(TABLE_PAGE).candidates[0]!
    const spec: AdapterSpec = {
      spec_version: 1,
      pagination: { kind: 'none' },
      fetch: { mode: 'html', url: URL },
      list: best.list_path,
      fields: {
        title: { path: 'css:td.tit a', type: 'text' },
        deadline: { path: 'css:td.date', type: 'date' },
      },
    }

    const r = interpretSpec(spec, TABLE_PAGE, { html: cheerioAdapter })

    expect(r.items).toHaveLength(4)
    expect(r.items[0]?.data['title']).toBe('2026년 청년창업사관학교 입교기업 모집공고')
    expect(r.items[0]?.data['deadline']).toBe('2026-08-21')
  })
})

describe('못 찾는 경우', () => {
  it('반복이 없으면 빈 후보와 이유를 낸다 — 던지지 않는다', () => {
    const r = run('<html><body><div><p>글 하나뿐인 페이지</p></div></body></html>')

    expect(r.candidates).toEqual([])
    expect(r.note).not.toBe('')
  })

  it('minRows 를 못 채우면 후보가 아니다', () => {
    const two = `<html><body><ul class="list">
      <li class="row">첫 번째 공고 제목입니다</li><li class="row">두 번째 공고 제목입니다</li>
    </ul></body></html>`

    expect(probeDom({ html: two, url: URL, minRows: 3, origin: 'dom' }).candidates).toEqual([])
  })

  it('빈 문자열·깨진 HTML 에도 던지지 않는다', () => {
    expect(() => run('')).not.toThrow()
    expect(() => run('<div><span>닫히지 않은')).not.toThrow()
  })
})

describe('structureSignature', () => {
  it('같은 구조면 같은 값이다 — 클래스 순서가 달라도', () => {
    const a = { tag: 'li', classes: ['item', 'card'], children: [] }
    const b = { tag: 'li', classes: ['card', 'item'], children: [] }

    expect(structureSignature(a)).toBe(structureSignature(b))
  })

  it('자식 구성이 다르면 다른 값이다', () => {
    const a = { tag: 'li', classes: [], children: [{ tag: 'a', classes: [], children: [] }] }
    const b = { tag: 'li', classes: [], children: [{ tag: 'span', classes: [], children: [] }] }

    expect(structureSignature(a)).not.toBe(structureSignature(b))
  })

  it('깊이 2 까지만 본다 — 그보다 깊은 차이는 안 본다', () => {
    // 자신 + 두 대(代)까지 본다. 세 대째부터는 행마다 미세하게 달라지므로 일부러 안 본다.
    const leaf = (tag: string) => ({ tag, classes: [], children: [] })
    const deep = (bottom: string) => ({
      tag: 'li',
      classes: [],
      children: [{ tag: 'div', classes: [], children: [{ tag: 'span', classes: [], children: [leaf(bottom)] }] }],
    })

    expect(structureSignature(deep('a'))).toBe(structureSignature(deep('img')))
    // 두 대째의 차이는 본다
    expect(structureSignature(deep('a'))).not.toBe(
      structureSignature({ tag: 'li', classes: [], children: [{ tag: 'div', classes: [], children: [leaf('b')] }] }),
    )
  })
})
