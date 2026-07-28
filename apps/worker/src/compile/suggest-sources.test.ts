// 소스 후보 제안의 관문 (ADR A42) — 파서가 지어낸·위험한·중복 후보를 거른다.
// LLM 은 안 탄다 (worker 는 zod·gemini 없이 손 파서를 테스트한다 — match-fields 선례).

import { describe, expect, it } from 'vitest'

import { parseSuggestOutput } from './suggest-sources'

const wrap = (candidates: unknown) => JSON.stringify({ candidates })

describe('parseSuggestOutput', () => {
  it('정상 후보를 통과시킨다', () => {
    const out = parseSuggestOutput(
      wrap([{ url: 'https://www.bizinfo.go.kr/list', title: '기업마당 공고', why: '창업 지원' }]),
      [],
    )
    expect(out).toHaveLength(1)
    expect(out[0]?.url).toBe('https://www.bizinfo.go.kr/list')
    expect(out[0]?.why).toBe('창업 지원')
  })

  it('http(s) 가 아닌 주소는 버린다', () => {
    const out = parseSuggestOutput(
      wrap([
        { url: 'ftp://x.kr/a', title: 'a' },
        { url: 'not a url', title: 'b' },
        { url: 'javascript:alert(1)', title: 'c' },
      ]),
      [],
    )
    expect(out).toHaveLength(0)
  })

  it('사설·로컬 호스트는 제안하지 않는다', () => {
    const out = parseSuggestOutput(
      wrap([
        { url: 'http://127.0.0.1/list', title: 'local' },
        { url: 'http://192.168.0.1/x', title: 'lan' },
        { url: 'http://localhost:3000/y', title: 'localhost' },
      ]),
      [],
    )
    expect(out).toHaveLength(0)
  })

  it('host+path 로 중복을 제거한다 (쿼리·트레일링 슬래시 무시)', () => {
    const out = parseSuggestOutput(
      wrap([
        { url: 'https://a.kr/list', title: '1' },
        { url: 'https://a.kr/list/', title: '2' },
        { url: 'https://a.kr/list?page=2', title: '3' },
      ]),
      [],
    )
    expect(out).toHaveLength(1)
  })

  it('이미 넣은 주소는 제안에서 뺀다', () => {
    const out = parseSuggestOutput(
      wrap([
        { url: 'https://a.kr/list', title: '이미 있음' },
        { url: 'https://b.kr/list', title: '새 것' },
      ]),
      ['https://a.kr/list/'],
    )
    expect(out).toHaveLength(1)
    expect(out[0]?.title).toBe('새 것')
  })

  it('최대 6개까지만', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ url: `https://s${i}.kr/list`, title: `${i}` }))
    expect(parseSuggestOutput(wrap(many), [])).toHaveLength(6)
  })

  it('title 이 비면 버린다 · why 없으면 null', () => {
    const out = parseSuggestOutput(
      wrap([
        { url: 'https://a.kr/x', title: '   ' },
        { url: 'https://b.kr/y', title: '제목만' },
      ]),
      [],
    )
    expect(out).toHaveLength(1)
    expect(out[0]?.title).toBe('제목만')
    expect(out[0]?.why).toBeNull()
  })

  it('형태가 아예 아니면 빈 목록 (throw 안 함)', () => {
    expect(parseSuggestOutput('쓰레기', [])).toEqual([])
    expect(parseSuggestOutput(null, [])).toEqual([])
    expect(parseSuggestOutput(wrap('not-array'), [])).toEqual([])
  })

  it('코드펜스로 감싼 JSON 도 읽는다', () => {
    const fenced = '```json\n' + wrap([{ url: 'https://a.kr/l', title: 't' }]) + '\n```'
    expect(parseSuggestOutput(fenced, [])).toHaveLength(1)
  })
})
