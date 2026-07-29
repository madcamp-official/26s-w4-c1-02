import { describe, expect, it } from 'vitest'

import { normalizeEntryUrl } from './urls'

/**
 * 붙여넣은 주소를 정리하는 규칙.
 *
 * 회귀의 계기: "담은 사이트" 칩을 통째로 복사하면 삭제 버튼의 ✕ 가 주소 뒤에 딸려 붙었고,
 * `new URL` 이 그걸 `%20%E2%9C%95` 로 감싸 **엉뚱한 주소를 조용히 살펴봤다**.
 * 화면에는 "목록을 못 찾았어요" 만 떠서, 사용자는 자기 주소가 바뀐 줄 알 방법이 없었다.
 */
describe('normalizeEntryUrl', () => {
  it('공백 뒤에 딸려온 글자를 버린다 (칩째 복사 사고)', () => {
    expect(normalizeEntryUrl('https://www.hanyang.ac.kr/web/www/main-notices ✕')).toBe(
      'https://www.hanyang.ac.kr/web/www/main-notices',
    )
    expect(normalizeEntryUrl('https://example.com/list 대표')).toBe('https://example.com/list')
  })

  it('앞뒤 공백과 줄바꿈을 털어낸다', () => {
    expect(normalizeEntryUrl('  https://example.com/list\n')).toBe('https://example.com/list')
  })

  it('스킴이 없으면 https 를 붙인다', () => {
    expect(normalizeEntryUrl('example.com/list')).toBe('https://example.com/list')
  })

  it('이미 인코딩된 주소는 건드리지 않는다 (진짜 %20 은 살아남는다)', () => {
    expect(normalizeEntryUrl('https://example.com/a%20b')).toBe('https://example.com/a%20b')
  })

  it('http · https 가 아니면 받지 않는다 (https 를 덧붙여 헛다리 짚지 않는다)', () => {
    expect(normalizeEntryUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeEntryUrl('file:///etc/passwd')).toBeNull()
    expect(normalizeEntryUrl('ftp://example.com/pub')).toBeNull()
  })

  it('포트가 붙은 주소는 스킴으로 오해하지 않는다', () => {
    expect(normalizeEntryUrl('example.com:8080/list')).toBe('https://example.com:8080/list')
  })

  it('빈 값과 주소가 아닌 것은 null (부르는 쪽이 사람 문장을 낸다)', () => {
    expect(normalizeEntryUrl('')).toBeNull()
    expect(normalizeEntryUrl('   ')).toBeNull()
    expect(normalizeEntryUrl('http://')).toBeNull()
  })
})
