// 겹침률 — 치유 승격 관문(기획서 9-3③)과 probe 후보 순위(9-1)

import { describe, expect, it } from 'vitest'
import {
  collectComparableValues,
  identityOf,
  normalizeIdentity,
  overlapRatio,
  passesHealGate,
  textOverlapRatio,
} from './overlap'

// ── overlapRatio — "엉뚱한 목록을 잡았는지" ────────────────────────────

describe('overlapRatio', () => {
  const prev = [
    { external_key: 'A-1', title: '2026 창업도약패키지' },
    { external_key: 'A-2', title: '청년창업사관학교' },
    { external_key: 'A-3', title: '기술개발 R&D 지원' },
    { external_key: 'A-4', title: '수출바우처' },
  ]

  it('같은 목록이면 1', () => {
    expect(overlapRatio(prev, prev)).toBe(1)
  })

  it('엉뚱한 목록(사이드바 메뉴)을 잡으면 0 — 검증만 통과해선 승격시킬 수 없다', () => {
    const sidebar = [{ title: '로그인' }, { title: '회원가입' }, { title: '고객센터' }]
    expect(overlapRatio(prev, sidebar)).toBe(0)
  })

  it('절반만 겹치면 0.5', () => {
    expect(overlapRatio(prev, [prev[0]!, prev[1]!, { external_key: 'Z-9' }])).toBe(0.5)
  })

  it('후보가 새 아이템을 더 뽑아도 감점하지 않는다 (새 공고가 올라오는 건 정상이다)', () => {
    const more = [...prev, { external_key: 'A-5' }, { external_key: 'A-6' }]
    expect(overlapRatio(prev, more)).toBe(1)
  })

  it('직전 목록이 비면 잴 것이 없으므로 0', () => {
    expect(overlapRatio([], prev)).toBe(0)
  })

  it('후보가 비면 0', () => {
    expect(overlapRatio(prev, [])).toBe(0)
  })

  it('문자열 배열도 그대로 받는다', () => {
    expect(overlapRatio(['a', 'b'], ['b', 'c'])).toBe(0.5)
  })

  it('링크의 세션 파라미터가 매번 바뀌어도 같은 아이템으로 본다 (기획서 15장 external_key 불안정)', () => {
    const before = [{ link: 'https://k-startup.go.kr/notice/view?id=10&jsessionid=AAA' }]
    const after = [{ link: 'https://k-startup.go.kr/notice/view?id=10&jsessionid=ZZZ' }]
    expect(overlapRatio(before, after)).toBe(1)
  })

  it('신원 키가 없으면 원시값 지문으로 폴백한다', () => {
    const a = [{ label: '창업도약', org: '중기부' }]
    const b = [{ org: '중기부', label: '창업도약' }]
    expect(overlapRatio(a, b)).toBe(1)
  })

  it('data_json 한 겹 안에 든 DB 행 형태도 받아준다', () => {
    const a = [{ id: 'x', data_json: { title: '창업도약패키지' } }]
    const b = [{ title: '창업도약패키지' }]
    expect(overlapRatio(a, b)).toBe(1)
  })
})

describe('passesHealGate', () => {
  const prev = [{ external_key: '1' }, { external_key: '2' }, { external_key: '3' }, { external_key: '4' }]

  it('기본 임계 30% 이상이면 승격을 허용한다', () => {
    const candidate = [{ external_key: '1' }, { external_key: '2' }, { external_key: '9' }]
    expect(passesHealGate(prev, candidate)).toBe(true)
  })

  it('겹침이 거의 없으면 막는다', () => {
    expect(passesHealGate(prev, [{ external_key: '9' }, { external_key: '8' }])).toBe(false)
  })

  it('임계값은 조절 가능하다', () => {
    const candidate = [{ external_key: '1' }, { external_key: '2' }]
    expect(passesHealGate(prev, candidate, { minHealOverlapRatio: 0.5 })).toBe(true)
    expect(passesHealGate(prev, candidate, { minHealOverlapRatio: 0.75 })).toBe(false)
  })

  it('직전 목록이 없으면 이 관문으로 막지 않는다 — 없는 근거로 승격을 막으면 치유가 안 돈다', () => {
    expect(passesHealGate([], [{ external_key: '9' }])).toBe(true)
  })
})

// ── §5-1 — 관문이 no-op 이던 결함의 재현이 곧 회귀 방어다 ──────────────
//
// 항목 id 가 쿼리스트링에 들어가는 사이트(한국 공공 목록 대부분)에서 쿼리를 통째로
// 떼면 모든 신원이 `host/path` 하나로 뭉개져, 겹치는 항목이 0건이어도 통과했다.
// 기획서 9-3 이 승격 관문을 두 겹으로 둔 이유("사이드바 메뉴 12개를 공고 12개로
// 착각하는 실패")의 두 번째 겹이 항상 true 를 내는 상태였다 — 기능 ④(사수 대상)의
// 유일한 오승격 방지 장치가 없는 것과 같았다.

describe('쿼리스트링에 신원이 든 사이트 (§5-1)', () => {
  const url = (sn: number) => `https://k-startup.go.kr/view?pbancSn=${sn}`

  it('겹치는 항목이 0건이면 관문이 막는다 — day1 §5-1 의 재현 코드 그대로', () => {
    // 고치기 전에는 셋 다 'k-startup.go.kr/view' 로 뭉개져 true 가 나왔다
    expect(passesHealGate([url(101), url(102), url(103)], [url(901), url(902), url(903)])).toBe(false)
    expect(overlapRatio([url(101), url(102), url(103)], [url(901), url(902), url(903)])).toBe(0)
  })

  it('같은 항목들이면 통과한다 — 신원 파라미터가 살아서 비교된다', () => {
    expect(overlapRatio([url(101), url(102), url(103)], [url(103), url(101), url(102)])).toBe(1)
  })

  it('세션·목록 상태 파라미터는 여전히 무시된다 — 행마다 값이 같으면 신원이 아니다', () => {
    // 수집 A 는 세션 AAA, 수집 B 는 세션 ZZZ. 목록 "안"에서는 상수라 신원에서 빠진다
    const before = [101, 102, 103].map((sn) => `https://k.go.kr/view?pbancSn=${sn}&jsessionid=AAA&cpage=1`)
    const after = [101, 102, 103].map((sn) => `https://k.go.kr/view?pbancSn=${sn}&jsessionid=ZZZ&cpage=3`)
    expect(overlapRatio(before, after)).toBe(1)
  })

  it('상대 주소 external_key 도 같은 규칙을 탄다 — DB 의 키가 이 모양이다', () => {
    const key = (id: number) => `/web/view.do?pblancId=PBLN_${id}`
    expect(overlapRatio([key(1), key(2), key(3)], [key(9), key(8), key(7)])).toBe(0)
    expect(overlapRatio([key(1), key(2), key(3)], [key(3), key(2), key(1)])).toBe(1)
  })

  it('주소가 3개 미만이면 판단하지 않는다 — 분포 없는 판단은 전부 오판이다', () => {
    // 이 경우 옛 동작(쿼리 전부 뗌)으로 물러난다 — 위 "세션 파라미터" 테스트의 1건짜리가 그 예다
    expect(overlapRatio(['https://a.com/v?id=1'], ['https://a.com/v?id=2'])).toBe(1)
  })
})

// ── textOverlapRatio — probe 후보 순위 ─────────────────────────────────

describe('textOverlapRatio', () => {
  const pageText = `
    공모전·지원사업 목록
    2026 창업도약패키지 창업기업  중소벤처기업부  2026-08-14 마감
    청년창업사관학교 15기 모집     중소벤처기업부  2026-09-01 마감
    수출바우처 참여기업 모집        산업통상자원부  2026-08-30 마감
  `

  it('진짜 목록이면 겹침률이 높다', () => {
    const candidate = [
      { title: '2026 창업도약패키지', org: '중소벤처기업부', deadline: '2026-08-14' },
      { title: '청년창업사관학교 15기 모집', org: '중소벤처기업부', deadline: '2026-09-01' },
    ]
    expect(textOverlapRatio(pageText, candidate)).toBeGreaterThan(0.9)
  })

  it('내부 설정 객체를 잡으면 겹침률이 바닥이다', () => {
    const junk = [
      { gtmId: 'GTM-ABCD', locale: 'ko_KR', csrf: 'a91f0c2b7d' },
      { gtmId: 'GTM-EFGH', locale: 'ko_KR', csrf: 'c02e88aa41' },
    ]
    expect(textOverlapRatio(pageText, junk)).toBeLessThan(0.4)
  })

  it('띄어쓰기가 달라도 같은 값으로 본다 (한국어 사이트에서 흔하다)', () => {
    expect(textOverlapRatio('청년 창업 사관학교', ['청년창업사관학교'])).toBe(1)
  })

  it('링크·경로는 눈에 보이는 값이 아니므로 분모에서 뺀다', () => {
    const ratio = textOverlapRatio(pageText, [
      { title: '수출바우처 참여기업 모집', link: 'https://example.com/x/1', icon: '/img/a.png' },
    ])
    expect(ratio).toBe(1)
  })

  it('말줄임으로 잘린 긴 문장은 토큰 다수결로 인정한다', () => {
    const page = '중소벤처기업부 2026 창업도약패키지 창업기업 모집'
    const value = ['중소벤처기업부 2026 창업도약패키지 창업기업 모집 공고 (2차)']
    expect(textOverlapRatio(page, value)).toBe(1)
  })

  it('페이지 텍스트가 비면 0', () => {
    expect(textOverlapRatio('', ['무엇이든'])).toBe(0)
  })

  it('비교할 값이 없으면 0', () => {
    expect(textOverlapRatio(pageText, [])).toBe(0)
    expect(textOverlapRatio(pageText, [{ link: 'https://a.b/c' }])).toBe(0)
  })

  it('두 후보를 줄 세울 수 있다 — 이게 후보 순위 판정의 전부다', () => {
    const real = [{ title: '수출바우처 참여기업 모집', due: '2026-08-30' }]
    const fake = [{ id: 'ZZZ-001', flag: 'true' }]
    expect(textOverlapRatio(pageText, real)).toBeGreaterThan(textOverlapRatio(pageText, fake))
  })
})

describe('collectComparableValues', () => {
  it('중첩 구조에서 원시값을 평평하게 꺼낸다', () => {
    const values = collectComparableValues([{ a: '창업도약', b: { c: 42, d: ['청년창업'] } }])
    expect(values).toContain('창업도약')
    expect(values).toContain('42')
    expect(values).toContain('청년창업')
  })

  it('상한을 넘기지 않는다', () => {
    const big = Array.from({ length: 100 }, (_, i) => `값${i}`)
    expect(collectComparableValues(big, 10)).toHaveLength(10)
  })
})

describe('normalizeIdentity · identityOf', () => {
  it('URL 은 host + path 만 남긴다', () => {
    expect(normalizeIdentity('https://Example.COM/a/b/?x=1#frag')).toBe('example.com/a/b')
  })

  it('URL 이 아니면 소문자 + 공백 정리', () => {
    expect(normalizeIdentity('  Hello   World ')).toBe('hello world')
  })

  it('신원 키 우선순위는 external_key 가 가장 앞이다', () => {
    expect(identityOf({ external_key: 'K1', link: 'https://a.b/c', title: 'T' })).toBe('k1')
  })

  it('뽑을 게 없으면 null', () => {
    expect(identityOf({})).toBeNull()
  })
})
