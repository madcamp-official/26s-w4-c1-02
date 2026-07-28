// 치유 probe 의 브라우저 판정 (day2 §8 후보 — "json 소스 치유에서 네트워크 관찰이 꺼짐")

import { describe, expect, it } from 'vitest'

import { healSkipsBrowser } from './heal'

describe('healSkipsBrowser', () => {
  it('json 소스는 브라우저를 살린다 — 내부 API 재발견 경로가 곧 네트워크 관찰이다', () => {
    expect(healSkipsBrowser('json')).toBe(false)
  })

  it('browser 소스는 당연히 살린다', () => {
    expect(healSkipsBrowser('browser')).toBe(false)
  })

  it('정적 DOM 에서 태어난 html 소스만 싸게 간다', () => {
    expect(healSkipsBrowser('html')).toBe(true)
  })
})
