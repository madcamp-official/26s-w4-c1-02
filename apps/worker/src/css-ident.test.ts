// CSS 클래스 이스케이프 회귀 — 보장선 B1 의 뼈대를 지키는 검사.
//
// 계기: cse.snu.ac.kr 등록일 수리에서 `span.sm:w-auto` 가 만들어져 CSS 파서가
// `Unknown pseudo-class :w-auto` 로 던졌다. 던지는 자리가 값 역추적이라, Tailwind 사이트에서는
// "값 붙여넣어 고치기" 와 "못 찾은 칸 물어보기" 가 통째로 죽었다.
//
// 이스케이프가 **실제 CSS 엔진에서** 통하는지까지 본다 — 문자열 모양만 맞추는 검사는
// 같은 사고를 다시 못 잡는다.

import { load } from 'cheerio'
import { describe, expect, it } from 'vitest'

import { escapeCssClass, tagWithClasses } from './css-ident'

describe('escapeCssClass', () => {
  it('Tailwind 의 콜론을 이스케이프한다', () => {
    expect(escapeCssClass('sm:w-auto')).toBe('sm\\:w-auto')
  })

  it('대괄호·점이 든 임의값 클래스도 이스케이프한다', () => {
    expect(escapeCssClass('min-w-[7.125rem]')).toBe('min-w-\\[7\\.125rem\\]')
  })

  it('평범한 클래스는 그대로 둔다', () => {
    expect(escapeCssClass('tracking-wide')).toBe('tracking-wide')
    expect(escapeCssClass('post_card')).toBe('post_card')
  })

  it('한글 클래스는 CSS 식별자로 그대로 쓸 수 있다', () => {
    expect(escapeCssClass('공지')).toBe('공지')
  })
})

describe('tagWithClasses — 실제 CSS 엔진에서 통해야 한다', () => {
  const html = `<li>
    <span class="icon">i</span>
    <a href="/notice/1"><span class="title">제목</span></a>
    <span class="sm:w-auto tracking-wide">2026/7/28</span>
  </li>`

  it('콜론 클래스로 만든 선택자가 던지지 않고 그 자리를 집는다', () => {
    const $ = load(html)
    const selector = tagWithClasses('span', ['sm:w-auto', 'tracking-wide'])
    expect(() => $(selector)).not.toThrow()
    expect($(selector).text()).toBe('2026/7/28')
  })

  it('이스케이프하지 않으면 CSS 파서가 던진다 (이 검사가 지키는 것)', () => {
    const $ = load(html)
    expect(() => $('span.sm:w-auto')).toThrow()
  })

  it('클래스가 없으면 태그만 낸다', () => {
    expect(tagWithClasses('div', [])).toBe('div')
  })
})
