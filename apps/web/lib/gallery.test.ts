import { describe, expect, it } from 'vitest'

import { setCollectionListed } from './gallery'

/**
 * 모두의 컬렉션 전시의 핵심 불변식 (델타 §8):
 *   전시(listed)하려면 반드시 공개(public)여야 한다.
 *
 * 이걸 어기면 카드는 모두의 컬렉션 목록에 보이는데 열면 막히는 모순이 생긴다
 * (갤러리 상세는 visibility='public' 을 열쇠로 쓴다). 그래서 공개가 아닌 컬렉션을
 * 전시로 켜려 하면 DB 에 닿기 전에 값으로 거절한다.
 *
 * 이 검사는 DB 없이 순수하게 돈다 — guard 가 safeQuery 앞에서 끝나기 때문이다.
 */
describe('setCollectionListed — 전시는 공개일 때만', () => {
  it('비공개를 전시로 켜려 하면 막는다', async () => {
    const result = await setCollectionListed({ id: 'x', visibility: 'private' }, true)
    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ blocked: true })
  })

  it('unlisted(주소를 아는 사람)를 전시로 켜려 해도 막는다', async () => {
    const result = await setCollectionListed({ id: 'x', visibility: 'unlisted' }, true)
    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ blocked: true })
  })

  it('막을 때 사람이 읽는 문장을 낸다 (내부 용어 없음 · 보장선 B4)', async () => {
    const result = await setCollectionListed({ id: 'x', visibility: 'private' }, true)
    if (result.ok) throw new Error('공개가 아닌데 통과했다')
    expect(result.message).toContain('공개')
    expect(result.message).not.toMatch(/listed|visibility|public/i)
  })
})
