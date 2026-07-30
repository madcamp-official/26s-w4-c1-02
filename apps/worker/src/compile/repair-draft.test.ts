import { describe, expect, it } from 'vitest'

import { repairSpecDraft } from './repair-draft'

// 실측 실패 사례(wevity·bizinfo·korea.kr 신규 생성 전멸)에서 뽑은 형태들
const base = {
  spec_version: 1,
  fetch: { mode: 'browser', url: 'https://example.com/list.do', wait_for: 'networkidle' },
  list: 'css:ul > li',
  columns: [{ key: 'title', label: '제목', type: 'text', path: 'css:.tit' }],
  pagination: { kind: 'none' },
}

function draft(over: { fetch?: Record<string, unknown>; pagination?: Record<string, unknown> }) {
  return {
    ...base,
    fetch: { ...base.fetch, ...(over.fetch ?? {}) },
    pagination: over.pagination ?? base.pagination,
  }
}

describe('repairSpecDraft — wait_for 의 css: 접두사', () => {
  it("선택자인데 접두사가 없으면 'css:' 를 붙인다 (실측 실패 ①)", () => {
    const out = repairSpecDraft(draft({ fetch: { wait_for: 'div.list_type > ul' } })) as {
      fetch: { wait_for: string }
    }
    expect(out.fetch.wait_for).toBe('css:div.list_type > ul')
  })

  it("'networkidle' 과 이미 'css:' 인 것은 건드리지 않는다", () => {
    const idle = repairSpecDraft(draft({ fetch: { wait_for: 'networkidle' } })) as {
      fetch: { wait_for: string }
    }
    expect(idle.fetch.wait_for).toBe('networkidle')

    const css = repairSpecDraft(draft({ fetch: { wait_for: 'css:.done' } })) as {
      fetch: { wait_for: string }
    }
    expect(css.fetch.wait_for).toBe('css:.done')
  })

  it('browser 모드가 아니면 손대지 않는다', () => {
    const out = repairSpecDraft(
      draft({ fetch: { mode: 'html', wait_for: 'div.list' } }),
    ) as { fetch: { wait_for: string } }
    expect(out.fetch.wait_for).toBe('div.list')
  })
})

describe('repairSpecDraft — page_param 의 {page} 복원', () => {
  it('URL 에 {page} 가 없으면 param 이름으로 붙인다 (실측 실패 ②)', () => {
    const out = repairSpecDraft(
      draft({ pagination: { kind: 'page_param', param: 'cpage', start: 1, max_pages: 3 } }),
    ) as { fetch: { url: string } }
    expect(out.fetch.url).toBe('https://example.com/list.do?cpage={page}')
  })

  it('이미 쿼리가 있으면 & 로 잇고, 같은 파라미터가 있으면 값만 {page} 로 바꾼다', () => {
    const appended = repairSpecDraft(
      draft({
        fetch: { url: 'https://example.com/list.do?c=find' },
        pagination: { kind: 'page_param', param: 'gp', start: 1, max_pages: 3 },
      }),
    ) as { fetch: { url: string } }
    expect(appended.fetch.url).toBe('https://example.com/list.do?c=find&gp={page}')

    const replaced = repairSpecDraft(
      draft({
        fetch: { url: 'https://example.com/list.do?c=find&gp=1&s=1' },
        pagination: { kind: 'page_param', param: 'gp', start: 1, max_pages: 3 },
      }),
    ) as { fetch: { url: string } }
    expect(replaced.fetch.url).toBe('https://example.com/list.do?c=find&gp={page}&s=1')
  })

  it('param 이름조차 없으면 pagination 을 none 으로 내린다', () => {
    const out = repairSpecDraft(
      draft({ pagination: { kind: 'page_param', param: '' } }),
    ) as { pagination: { kind: string }; fetch: { url: string } }
    expect(out.pagination.kind).toBe('none')
    expect(out.fetch.url).not.toContain('{page}')
  })

  it('URL 에 이미 {page} 가 있으면 손대지 않는다', () => {
    const url = 'https://example.com/list?p={page}'
    const out = repairSpecDraft(
      draft({ fetch: { url }, pagination: { kind: 'page_param', param: 'p', start: 1, max_pages: 3 } }),
    ) as { fetch: { url: string } }
    expect(out.fetch.url).toBe(url)
  })
})

describe('repairSpecDraft — 입력 형태', () => {
  it('```json 울타리를 두른 문자열도 객체로 교정해 돌려준다', () => {
    const text = '```json\n' + JSON.stringify(draft({ fetch: { wait_for: '.list' } })) + '\n```'
    const out = repairSpecDraft(text) as { fetch: { wait_for: string } }
    expect(out.fetch.wait_for).toBe('css:.list')
  })

  it('JSON 이 아니면 원본을 그대로 돌려준다 — 실패 문장은 기존 관문이 낸다', () => {
    expect(repairSpecDraft('이건 JSON 이 아니다')).toBe('이건 JSON 이 아니다')
    expect(repairSpecDraft(null)).toBe(null)
    expect(repairSpecDraft([1, 2])).toEqual([1, 2])
  })
})
