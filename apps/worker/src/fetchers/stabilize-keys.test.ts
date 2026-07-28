// 항목 신원에서 목록 상태를 빼는 것 — 실측 재현이 곧 테스트다.
//
// 2026-07-27 bizinfo 실측: 같은 공고가 cpage=1 로 저장됐다가 cpage=3 으로 다시 와서
// "신규"로 재계수됐다 (한 오후에 5건 중복). 이 테스트의 키 형태는 그 실측 그대로다.

import { describe, expect, it } from 'vitest'

import type { InterpretedItem } from '@endpointer/core/spec'

import { stabilizeExternalKeys } from './stabilize-keys'

function item(key: string, title: string, origin: InterpretedItem['external_key_origin'] = 'dedupe_key'): InterpretedItem {
  return {
    external_key: key,
    external_key_origin: origin,
    data: { title },
    raw: { _row: '<li/>', _fields: { title } },
    provenance: {},
  } as InterpretedItem
}

/** bizinfo 실측 키 형태 — 목록 상태 + pblancId */
const bizinfoKey = (cpage: number, id: number) =>
  `/sii/siia/selectSIIA200Detail.do?hashCode=&rows=15&cpage=${cpage}&keyword=&pblancId=PBLN_${id}`

describe('목록 상태 파라미터를 뺀다', () => {
  it('cpage 가 바뀌어도 같은 키가 나온다 — 실측 결함의 재현이자 수리', () => {
    const page1 = [1, 2, 3, 4, 5].map((i) => item(bizinfoKey(1, i), `공고 ${i}`))
    const page3 = [1, 2, 3, 4, 5].map((i) => item(bizinfoKey(3, i), `공고 ${i}`))

    const a = stabilizeExternalKeys(page1)
    const b = stabilizeExternalKeys(page3)

    // 페이지가 밀려도(1→3) 키가 같아야 "신규"로 재계수되지 않는다
    expect(a.items.map((i) => i.external_key)).toEqual(b.items.map((i) => i.external_key))
    expect(a.items[0]?.external_key).toBe('/sii/siia/selectSIIA200Detail.do?pblancId=PBLN_1')
    expect(a.note).not.toBeNull()
  })

  it('행마다 값이 다른 파라미터만 남는다 — 상수(keyword=)와 소수값(cpage)은 빠진다', () => {
    const items = [1, 2, 3, 4].map((i) => item(bizinfoKey(i <= 2 ? 1 : 2, i), `공고 ${i}`))
    const r = stabilizeExternalKeys(items)
    for (const it of r.items) {
      expect(it.external_key).toContain('pblancId=')
      expect(it.external_key).not.toContain('cpage=')
      expect(it.external_key).not.toContain('keyword=')
    }
  })

  it('파라미터 순서가 달라도 같은 키다 (이름순 정렬)', () => {
    const r = stabilizeExternalKeys([
      item('/view.do?b=2&a=1&ix=100&cpage=1', 'ㄱ'),
      item('/view.do?a=1&b=2&ix=200&cpage=1', 'ㄴ'),
      item('/view.do?b=2&a=1&ix=300&cpage=1', 'ㄷ'),
    ])
    expect(r.items[0]?.external_key).toBe('/view.do?ix=100')
  })

  it('수집 중 목록이 밀려 같은 항목이 두 페이지에 잡히면 하나로 합친다', () => {
    const r = stabilizeExternalKeys([
      item(bizinfoKey(1, 1), '공고 1'),
      item(bizinfoKey(1, 2), '공고 2'),
      item(bizinfoKey(2, 1), '공고 1'), // 페이지 경계에서 다시 잡힌 같은 공고
      item(bizinfoKey(2, 3), '공고 3'),
    ])
    expect(r.items).toHaveLength(3)
  })
})

describe('안전판 — 확신이 없으면 그대로 둔다', () => {
  it('빼고 나서 서로 다른 항목의 키가 겹치면 전부 원래대로', () => {
    // id 가 거의 고유해서 신원으로 남는데(9/10), 서로 다른 두 항목이 같은 id 를 갖는
    // 병리적 사이트 — cpage 를 빼는 순간 그 둘의 키가 겹친다. 제목이 다르므로 중단해야 한다.
    const items = [
      ...Array.from({ length: 8 }, (_, i) => item(`/v.do?cpage=1&id=${i}`, `항목 ${i}`)),
      item('/v.do?cpage=2&id=0', '항목 8'), // id=0 인데 다른 항목
      item('/v.do?cpage=2&id=9', '항목 9'),
    ]
    const r = stabilizeExternalKeys(items)
    expect(r.items.map((i) => i.external_key)).toEqual(items.map((i) => i.external_key))
    expect(r.note).toBeNull()
  })

  it('신원이 경로에 있으면 파라미터를 전부 빼도 된다 — 서울도서관 실측의 재현이자 수리', () => {
    // 2026-07-27 실측: 항목 링크에 현재 페이지 번호가 되박혀(`?page=1&` ↔ `?page=2&`)
    // 같은 공지가 페이지마다 "신규"로 3벌씩 쌓였다. 신원은 경로(3_67487)에 있다.
    const seoulKey = (page: number, id: number) => `/bbs/content/3_${id}?page=${page}&`
    const page1 = [67487, 66999, 66441, 67396].map((id) => item(seoulKey(1, id), `공지 ${id}`))
    const page2 = [67487, 66999, 66441, 67396].map((id) => item(seoulKey(2, id), `공지 ${id}`))

    const r = stabilizeExternalKeys([...page1, ...page2])

    // 페이지 번호가 빠지고 경로만 남아, 두 페이지에 걸쳐 잡힌 같은 공지가 하나로 합쳐진다
    expect(r.items).toHaveLength(4)
    expect(r.items[0]?.external_key).toBe('/bbs/content/3_67487')
    expect(r.note).not.toBeNull()
  })

  it('경로까지 같으면(전부 목록 상태) 겹침 안전판이 원래대로 되돌린다', () => {
    const items = [
      item('/list.do?cpage=1&sort=new', '항목 ㄱ'),
      item('/list.do?cpage=1&sort=new', '항목 ㄴ'),
      item('/list.do?cpage=2&sort=new', '항목 ㄷ'),
      item('/list.do?cpage=2&sort=new', '항목 ㄹ'),
    ]
    const r = stabilizeExternalKeys(items)
    expect(r.items.map((i) => i.external_key)).toEqual(items.map((i) => i.external_key))
    expect(r.note).toBeNull()
  })

  it('행이 3개 미만이면 판단하지 않는다', () => {
    const items = [item(bizinfoKey(1, 1), 'ㄱ'), item(bizinfoKey(1, 2), 'ㄴ')]
    const r = stabilizeExternalKeys(items)
    expect(r.items.map((i) => i.external_key)).toEqual(items.map((i) => i.external_key))
  })

  it('링크가 아닌 신원(row_hash 등)은 손대지 않는다', () => {
    const items = [
      item('hash:abc', 'ㄱ', 'row_hash'),
      item('hash:def', 'ㄴ', 'row_hash'),
      item('hash:ghi', 'ㄷ', 'row_hash'),
    ]
    const r = stabilizeExternalKeys(items)
    expect(r.items.map((i) => i.external_key)).toEqual(['hash:abc', 'hash:def', 'hash:ghi'])
    expect(r.note).toBeNull()
  })

  it('쿼리가 없는 키는 그대로 둔다', () => {
    const items = [
      item('/detail/100', 'ㄱ'),
      item('/detail/200', 'ㄴ'),
      item('/detail/300', 'ㄷ'),
    ]
    const r = stabilizeExternalKeys(items)
    expect(r.items.map((i) => i.external_key)).toEqual(['/detail/100', '/detail/200', '/detail/300'])
  })

  it('절대 주소는 origin 을 보존한다', () => {
    const r = stabilizeExternalKeys([
      item('https://ex.com/v.do?cpage=1&id=1', 'ㄱ'),
      item('https://ex.com/v.do?cpage=1&id=2', 'ㄴ'),
      item('https://ex.com/v.do?cpage=1&id=3', 'ㄷ'),
    ])
    expect(r.items[0]?.external_key).toBe('https://ex.com/v.do?id=1')
  })
})
