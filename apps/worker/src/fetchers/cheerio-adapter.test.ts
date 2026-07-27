// 회귀 테스트 — 표(`<table>`)로 된 목록에서 값이 뽑히는가
//
// 해석기는 행을 집은 뒤 **행의 outerHTML 을 다시 파싱해서** 필드를 뽑는다.
// 그래서 이 어댑터가 조각을 문서로 취급하는 순간 `<tr>` 과 `<td>` 가 사라지고,
// 표로 된 사이트는 항목 수만 맞고 값이 전부 빈 채로 수집된다. 화면에는 표가 보이니까
// 아무도 안 깨진 줄 안다 — 그래서 여기에 테스트를 박아 둔다.
//
// 한국 공공 목록 사이트는 아직도 `<table>` 이 많다. G1 의 "낯선 URL 3개 중 2개" 가
// 여기에 걸려 있다.

import { beforeEach, describe, expect, it } from 'vitest'

import { interpretSpec, type AdapterSpec } from '@endpointer/core/spec'

import { cheerioAdapter, resetHtmlCache } from './cheerio-adapter'

beforeEach(() => {
  resetHtmlCache()
})

const TABLE_PAGE = `<!DOCTYPE html>
<html><head><title>공고 목록</title></head>
<body>
  <table class="board-list">
    <thead><tr><th>제목</th><th>기관</th><th>마감</th></tr></thead>
    <tbody>
      <tr>
        <td class="tit"><a href="/view?id=1">청년 창업 지원사업</a></td>
        <td class="org">중소벤처기업부</td>
        <td class="date">2026-08-21</td>
      </tr>
      <tr>
        <td class="tit"><a href="/view?id=2">소상공인 판로개척</a></td>
        <td class="org">소상공인시장진흥공단</td>
        <td class="date">2026-09-01</td>
      </tr>
    </tbody>
  </table>
</body></html>`

const TABLE_SPEC: AdapterSpec = {
  spec_version: 1,
  pagination: { kind: 'none' },
  fetch: { mode: 'html', url: 'https://example.go.kr/list' },
  list: 'css:table.board-list tbody > tr',
  dedupe_key: 'css:a@href',
  fields: {
    title: { path: 'css:td.tit a', type: 'text' },
    organization: { path: 'css:td.org', type: 'text' },
    deadline: { path: 'css:td.date', type: 'date' },
    link: { path: 'css:td.tit a@href', type: 'link', transform: [{ op: 'absolute_url' }] },
  },
}

describe('표로 된 목록', () => {
  it('행 안의 td 값이 뽑힌다 — 조각을 문서로 파싱하면 여기서 전부 빈 값이 된다', () => {
    const r = interpretSpec(TABLE_SPEC, TABLE_PAGE, { html: cheerioAdapter })

    expect(r.items).toHaveLength(2)
    expect(r.items[0]?.data['title']).toBe('청년 창업 지원사업')
    expect(r.items[0]?.data['organization']).toBe('중소벤처기업부')
    expect(r.items[0]?.data['deadline']).toBe('2026-08-21')
    expect(r.items[0]?.data['link']).toBe('https://example.go.kr/view?id=1')
    expect(r.items[1]?.data['title']).toBe('소상공인 판로개척')
  })

  it('필드가 다 뽑혔으니 빈 값 비율이 0 이다 — 드리프트 기준선이 여기서 시작한다', () => {
    const r = interpretSpec(TABLE_SPEC, TABLE_PAGE, { html: cheerioAdapter })

    for (const key of ['title', 'organization', 'deadline', 'link']) {
      expect(r.fieldStats[key]?.null_ratio, key).toBe(0)
      expect(r.fieldStats[key]?.type_fail_ratio, key).toBe(0)
    }
  })
})

describe('cheerioAdapter.select', () => {
  it('행 조각에서 tr·td 가 살아남는다', () => {
    const row = '<tr><td class="tit"><a href="/x">제목</a></td><td class="date">2026-08-21</td></tr>'

    expect(cheerioAdapter.select(row, 'td.tit a')).toHaveLength(1)
    expect(cheerioAdapter.select(row, 'td.date')[0]?.text()).toBe('2026-08-21')
  })

  it('온전한 문서도 그대로 다룬다 — 조각 모드로 바꿔도 문서가 깨지지 않는다', () => {
    expect(cheerioAdapter.select(TABLE_PAGE, 'tbody > tr')).toHaveLength(2)
    expect(cheerioAdapter.select(TABLE_PAGE, 'title')[0]?.text()).toBe('공고 목록')
  })

  it('행의 html() 은 outerHTML 이다 — 해석기가 이걸 다시 파싱한다', () => {
    const rows = cheerioAdapter.select(TABLE_PAGE, 'tbody > tr')
    const first = rows[0]?.html() ?? ''

    expect(first.startsWith('<tr')).toBe(true)
    // 다시 넣어도 값이 나와야 한다 (해석기가 실제로 하는 일)
    expect(cheerioAdapter.select(first, 'td.org')[0]?.text()).toBe('중소벤처기업부')
  })

  it('선택자 문법이 틀리면 던지지 않고 빈 배열이다', () => {
    expect(cheerioAdapter.select(TABLE_PAGE, 'td[[[')).toEqual([])
  })

  it('`<li>` 목록도 그대로 된다 — 회귀 수정이 다른 구조를 깨지 않았는지', () => {
    const li = '<li class="item"><span class="tit">공고</span><a href="/a">보기</a></li>'

    expect(cheerioAdapter.select(li, 'span.tit')[0]?.text()).toBe('공고')
    expect(cheerioAdapter.select(li, 'a')[0]?.attr('href')).toBe('/a')
  })
})
