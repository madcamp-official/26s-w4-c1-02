// 인라인 JSON 그릇 커버리지 — day2 §8 후보 "Nuxt3·SvelteKit·Remix 누락" 판정
//
// 픽스처는 각 프레임워크가 실제로 페이지에 심는 형태를 그대로 줄인 것이다:
//   Nuxt 3     <script id="__NUXT_DATA__" type="application/json">[devalue 배열]</script>
//   SvelteKit  <script type="application/json" data-sveltekit-fetched>{"status":200,"body":"<JSON 문자열>"}</script>
//   Remix      window.__remixContext = {...}  (대입형 — 원래부터 잡혔는지 확인)

import { describe, expect, it } from 'vitest'

import { extractPage } from '../html'
import { scanInlineJson } from './inline-json'
import type { StaticPage } from './static'

function pageFrom(html: string): StaticPage {
  return {
    requestedUrl: 'https://example.test/list',
    url: 'https://example.test/list',
    host: 'example.test',
    status: 200,
    contentType: 'text/html',
    charset: 'utf-8',
    html,
    isJson: false,
    page: extractPage(html),
  }
}

const ROWS_EXPECTED = [
  { title: '공고 A', link: '/board/a', date: '2026-08-01' },
  { title: '공고 B', link: '/board/b', date: '2026-08-05' },
  { title: '공고 C', link: '/board/c', date: '2026-08-09' },
]

describe('scanInlineJson — Nuxt 3 (__NUXT_DATA__ · devalue 배열)', () => {
  // devalue 형식: 값들이 한 배열에 눕고, 객체·배열의 원소 자리는 그 배열의 **인덱스**다.
  // {data:{list:[A,B,C]}} + views 숫자 컬럼을 인덱스로 편 것:
  const DEVALUE = JSON.stringify([
    { data: 1 },
    { list: 2 },
    [3, 8, 13],
    { title: 4, link: 5, date: 6, views: 7 },
    '공고 A',
    '/board/a',
    '2026-08-01',
    10,
    { title: 9, link: 10, date: 11, views: 12 },
    '공고 B',
    '/board/b',
    '2026-08-05',
    22,
    { title: 14, link: 15, date: 16, views: 17 },
    '공고 C',
    '/board/c',
    '2026-08-09',
    5,
  ])

  it('devalue 배열을 풀어 목록 후보를 낸다', () => {
    const html = `<html><body><div>목록</div>
      <script id="__NUXT_DATA__" type="application/json">${DEVALUE}</script>
    </body></html>`
    const candidates = scanInlineJson({ page: pageFrom(html), minRows: 3 })

    expect(candidates.length).toBeGreaterThan(0)
    const rows = (candidates[0]?.rows ?? []) as Record<string, unknown>[]
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r['title'])).toEqual(ROWS_EXPECTED.map((r) => r.title))
    // 인덱스(숫자)가 값으로 풀렸는지 — 10 이 "/board/b" 참조가 아니라 조회수 10 으로 남아야 한다
    expect(rows[0]?.['views']).toBe(10)
    expect(rows[1]?.['link']).toBe('/board/b')
  })
})

describe('scanInlineJson — SvelteKit (data-sveltekit-fetched · body 가 JSON 문자열)', () => {
  it('body 문자열을 한 번 더 파싱해 목록 후보를 낸다', () => {
    const inner = JSON.stringify({ items: ROWS_EXPECTED })
    const wrapper = JSON.stringify({ status: 200, statusText: '', headers: {}, body: inner })
    const html = `<html><body>
      <script type="application/json" data-sveltekit-fetched="1" data-url="/api/list">${wrapper}</script>
    </body></html>`
    const candidates = scanInlineJson({ page: pageFrom(html), minRows: 3 })

    expect(candidates.length).toBeGreaterThan(0)
    const rows = (candidates[0]?.rows ?? []) as Record<string, unknown>[]
    expect(rows.map((r) => r['title'])).toEqual(ROWS_EXPECTED.map((r) => r.title))
  })
})

describe('scanInlineJson — Remix (window.__remixContext 대입형)', () => {
  it('대입된 객체 리터럴에서 목록 후보를 낸다', () => {
    const state = JSON.stringify({ state: { loaderData: { 'routes/list': { posts: ROWS_EXPECTED } } } })
    const html = `<html><body>
      <script>window.__remixContext = ${state};</script>
    </body></html>`
    const candidates = scanInlineJson({ page: pageFrom(html), minRows: 3 })

    expect(candidates.length).toBeGreaterThan(0)
    const rows = (candidates[0]?.rows ?? []) as Record<string, unknown>[]
    expect(rows.map((r) => r['title'])).toEqual(ROWS_EXPECTED.map((r) => r.title))
  })
})

describe('scanInlineJson — 기존 그릇 회귀', () => {
  it('__NEXT_DATA__ 는 그대로 잡힌다', () => {
    const html = `<html><body>
      <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
        props: { pageProps: { list: ROWS_EXPECTED } },
      })}</script>
    </body></html>`
    const candidates = scanInlineJson({ page: pageFrom(html), minRows: 3 })
    expect(candidates.length).toBeGreaterThan(0)
  })
})
