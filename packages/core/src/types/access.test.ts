// 접근 판정 (ADR A40) — 표가 진실이다. 케이스를 눈으로 셀 수 있게 나열한다.

import { describe, expect, it } from 'vitest'

import { canManageCollection, canViewCollection, type CollectionAccessInput } from './access'

const make = (over: Partial<CollectionAccessInput>): CollectionAccessInput => ({
  isOwner: false,
  memberRole: null,
  ...over,
})

describe('canViewCollection', () => {
  it('아무 관계 없는 사람에게 닫힌다 — 이 한 줄이 기존 화면의 구멍이었다', () => {
    expect(canViewCollection(make({}))).toBe(false)
  })

  it('주인은 본다', () => {
    expect(canViewCollection(make({ isOwner: true }))).toBe(true)
  })

  it('뷰어 멤버는 본다 — 초대 링크의 존재 이유', () => {
    expect(canViewCollection(make({ memberRole: 'viewer' }))).toBe(true)
  })
})

describe('canManageCollection', () => {
  it('주인만 관리한다', () => {
    expect(canManageCollection(make({ isOwner: true }))).toBe(true)
  })

  it('뷰어는 관리하지 못한다 — 읽기 전용의 정의', () => {
    expect(canManageCollection(make({ memberRole: 'viewer' }))).toBe(false)
  })
})
