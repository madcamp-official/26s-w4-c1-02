// 링크가 진짜 그 항목으로 가는지
//
// 여기서 보는 건 하나다: **눌러 보면 목록으로 돌아오는 링크를 잡는가.**
// 이 실패는 다른 모든 검사를 통과한다 — 주소 문법 맞고, 칸이 안 비고, 값이 다 다르다.
// 그래서 이 파일이 없으면 사용자가 링크를 눌러 보고서야 안다.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CollectionSchemaJson } from '@endpointer/core'
import type { InterpretedItem } from '@endpointer/core/spec'

const { PAGES } = vi.hoisted(() => ({ PAGES: new Map<string, string>() }))

vi.mock('../fetchers', () => ({
  httpGet: async (url: string) => {
    const body = PAGES.get(url)
    if (body === undefined) return { ok: false, message: '못 열었습니다' }
    return { ok: true, response: { ok: true, status: 200, url, contentType: 'text/html', body, charset: 'utf-8', cached: false } }
  },
}))

const { verifyLinkField } = await import('./verify-link')

const SCHEMA: CollectionSchemaJson = [
  { key: 'title', label: '공고명', type: 'text', required: true, mapping: null, value_labels: null },
  { key: 'link', label: '원문 링크', type: 'link', required: false, mapping: null, value_labels: null },
]

const TITLES = [
  '2026년 성남시 북유럽 시장개척단 참여기업 모집',
  '여성 1인 창조기업 지원센터 신규 입주기업 모집',
  '2026년 부산 창업기업 액셀러레이팅 프로그램 참여기업 모집',
  '기후산업국제박람회 라운드테이블 행사대행업체 모집',
]

function items(links: readonly string[]): InterpretedItem[] {
  return TITLES.slice(0, links.length).map(
    (title, i) =>
      ({
        external_key: `k${i}`,
        external_key_origin: 'link',
        data: { title, link: links[i] },
        raw: {},
      }) as unknown as InterpretedItem,
  )
}

const LINKS = ['https://x.example/1', 'https://x.example/2', 'https://x.example/3', 'https://x.example/4']

beforeEach(() => PAGES.clear())
afterEach(() => vi.clearAllMocks())

describe('열어 봤더니 목록이면', () => {
  it('막는다 — 실제로 겪은 경우 (?view=id 가 목록을 돌려줬다)', async () => {
    // 링크를 열었더니 다른 항목 제목들이 그대로 있다 = 상세가 아니라 목록이다
    PAGES.set(LINKS[0]!, `<html><body><ul>${TITLES.map((t) => `<li>${t}</li>`).join('')}</ul></body></html>`)

    const v = await verifyLinkField(items(LINKS), SCHEMA, 'link')

    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toContain('목록')
  })
})

describe('열어 봤더니 항목이면', () => {
  it('통과시킨다', async () => {
    // 상세 페이지에는 그 항목 제목만 있다
    PAGES.set(LINKS[0]!, `<html><body><h1>${TITLES[0]}</h1><p>신청 방법…</p></body></html>`)

    expect((await verifyLinkField(items(LINKS), SCHEMA, 'link')).ok).toBe(true)
  })

  it('상세가 JS 로 그려져 제목이 하나도 없어도 통과시킨다', async () => {
    // 목록이면 다른 제목들이 **여러 개** 보인다. 아무것도 없는 건 목록이 아니라는 뜻이다.
    PAGES.set(LINKS[0]!, '<html><body><div id="app"></div></body></html>')

    expect((await verifyLinkField(items(LINKS), SCHEMA, 'link')).ok).toBe(true)
  })

  it('제목 하나가 우연히 겹치는 정도로는 막지 않는다', async () => {
    PAGES.set(LINKS[0]!, `<html><body><h1>${TITLES[0]}</h1><a>${TITLES[1]}</a></body></html>`)

    expect((await verifyLinkField(items(LINKS), SCHEMA, 'link')).ok).toBe(true)
  })

  it('상세 아래에 목록을 같이 그리는 게시판도 통과시킨다 — 문서 제목이 자기 제목이면 상세다', async () => {
    // 그누보드류: 글 본문 밑에 게시판 목록이 통째로 붙는다 (math.snu.ac.kr 실측, 07-30).
    // 다른 제목이 여러 개 보여도 <title> 이 이 항목 제목이면 목록이 아니다.
    PAGES.set(
      LINKS[0]!,
      `<html><head><title>${TITLES[0]}</title></head><body><article>본문…</article><ul>${TITLES.map((t) => `<li>${t}</li>`).join('')}</ul></body></html>`,
    )

    const v = await verifyLinkField(items(LINKS), SCHEMA, 'link')

    expect(v.ok).toBe(true)
    if (v.ok) expect(v.reason).toContain('상세')
  })
})

describe('판단할 수 없으면 통과시킨다', () => {
  // 멀쩡한 링크를 의심해 사용자에게 물어보면 "할 일이 늘어나는" 쪽이고,
  // 그건 기능 ②가 지려는 싸움이다.

  it('링크를 못 열면 통과시킨다 — 남의 네트워크 사정으로 칸을 버리지 않는다', async () => {
    expect((await verifyLinkField(items(LINKS), SCHEMA, 'link')).ok).toBe(true)
  })

  it('견줄 항목이 모자라면 통과시킨다', async () => {
    PAGES.set(LINKS[0]!, `<html><body>${TITLES.join(' ')}</body></html>`)

    expect((await verifyLinkField(items(LINKS.slice(0, 2)), SCHEMA, 'link')).ok).toBe(true)
  })

  it('견줄 제목 칸이 없으면 통과시킨다', async () => {
    const noText: CollectionSchemaJson = [SCHEMA[1]!]

    expect((await verifyLinkField(items(LINKS), noText, 'link')).ok).toBe(true)
  })

  it('열어 볼 링크가 하나도 없으면 통과시킨다', async () => {
    expect((await verifyLinkField(items(['', '', '', '']), SCHEMA, 'link')).ok).toBe(true)
  })
})
