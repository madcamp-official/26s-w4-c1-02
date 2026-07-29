// 실행 전 계약 검사 테스트 (기획서 11장 "스펙 검증")
//
// 여기서 보는 것은 boolean 이 아니라 **문장**이다. errors 의 각 줄이 그대로
// Gemini 재생성 프롬프트에 붙기 때문에, "무엇이 어디서 어떻게 틀렸는가" 가
// 한 줄 안에 들어 있는지까지 테스트한다.

import { describe, expect, it } from 'vitest'
import type { CollectionSchemaJson } from '../types/collection'
import { CollectionSchemaJsonSchema } from '../types/collection'
import { findUnknownOps, isPrivateHost, validateSpec } from './validate'

/** 기획서 11장 JSON 모드 예시 (원본 그대로) */
function kstartupSpec(): Record<string, unknown> {
  return {
    spec_version: 1,
    fetch: {
      mode: 'json',
      url: 'https://www.k-startup.go.kr/api/pbanc/list?page={page}&size=50',
      method: 'GET',
      headers: { Accept: 'application/json' },
    },
    list: '$.data.items[*]',
    dedupe_key: '$.pbancSn',
    fields: {
      title: { path: '$.pbancNm', type: 'text' },
      organization: { path: '$.jrsdInsttNm', type: 'text' },
      deadline: {
        path: '$.reqstEndDe',
        type: 'date',
        transform: [{ op: 'date_parse', formats: ['YYYYMMDD', 'YYYY.MM.DD'] }],
      },
      amount: {
        path: '$.sportAmount',
        type: 'money',
        transform: [
          { op: 'regex_extract', pattern: '[\\d,]+' },
          { op: 'number_parse' },
          { op: 'multiply', by: 1000 },
        ],
      },
      link: {
        path: '$.pbancSn',
        type: 'link',
        transform: [{ op: 'template', value: 'https://www.k-startup.go.kr/web/contents/detail?sn={value}' }],
      },
    },
    pagination: { kind: 'page_param', param: 'page', start: 1, max_pages: 3 },
  }
}

/** 기획서 11장 HTML 모드 예시 */
function thinkcontestSpec(): Record<string, unknown> {
  return {
    spec_version: 1,
    fetch: { mode: 'html', url: 'https://thinkcontest.com/contest/list?p={page}' },
    list: 'css:.contest-list > li',
    dedupe_key: 'css:a@href',
    fields: {
      title: { path: 'css:.tit', type: 'text' },
      deadline: {
        path: 'css:.date',
        type: 'date',
        transform: [{ op: 'regex_extract', pattern: '\\d{4}[.-]\\d{2}[.-]\\d{2}' }, { op: 'date_parse' }],
      },
      link: { path: 'css:a@href', type: 'link', transform: [{ op: 'absolute_url' }] },
    },
    pagination: { kind: 'next_link', path: 'css:a.next@href', max_pages: 3 },
  }
}

const HOST = 'k-startup.go.kr'

function errorsOf(input: unknown, host = HOST, schema?: CollectionSchemaJson): string[] {
  const result = validateSpec(input, schema ? { host, schema } : { host })
  if (result.ok) throw new Error('통과하면 안 된다')
  return result.errors
}

// ── 통과해야 하는 것 ───────────────────────────────────────────────────

describe('validateSpec — 기획서 11장 예시는 통과한다', () => {
  it('JSON 모드', () => {
    const result = validateSpec(kstartupSpec(), { host: HOST })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.spec.fetch.mode).toBe('json')
      expect(result.spec.pagination.kind).toBe('page_param')
    }
  })

  it('HTML 모드', () => {
    const result = validateSpec(thinkcontestSpec(), { host: 'thinkcontest.com' })
    expect(result.ok).toBe(true)
  })

  it('통과하면 기본값이 채워진 스펙을 돌려준다', () => {
    const bare = {
      fetch: { mode: 'html', url: 'https://thinkcontest.com/list' },
      list: 'css:li',
      fields: { title: { path: 'css:.tit', type: 'text' } },
    }
    const result = validateSpec(bare, { host: 'thinkcontest.com' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.spec.spec_version).toBe(1)
      expect(result.spec.pagination).toEqual({ kind: 'none' })
    }
  })

  it('서브도메인은 같은 사이트로 본다 (www.k-startup.go.kr ↔ k-startup.go.kr)', () => {
    expect(validateSpec(kstartupSpec(), { host: 'www.k-startup.go.kr' }).ok).toBe(true)
  })

  // 날짜 파라미터 API (상영시간표 등) — POST + body + {today} 자리표시자
  it('JSON 모드 · POST + body ({today} 자리표시자)', () => {
    const megaboxSpec = {
      spec_version: 1,
      fetch: {
        mode: 'json',
        url: 'https://www.megabox.co.kr/on/oh/ohb/PlayTime/selectPlayTimeMasterList.do',
        method: 'POST',
        headers: { 'Content-Type': 'application/json;charset=UTF-8' },
        body: '{"playDe":"{today_iso}"}',
      },
      list: '$.movieList[*]',
      fields: { title: { path: '$.movieNm', type: 'text' } },
      pagination: { kind: 'none' },
    }
    const result = validateSpec(megaboxSpec, { host: 'www.megabox.co.kr' })
    expect(result.ok).toBe(true)
    if (result.ok && result.spec.fetch.mode === 'json') {
      expect(result.spec.fetch.method).toBe('POST')
      expect(result.spec.fetch.body).toBe('{"playDe":"{today_iso}"}')
    }
  })

  it('body 는 선택이다 — 없는 기존 JSON 스펙도 그대로 통과한다 (회귀)', () => {
    const result = validateSpec(kstartupSpec(), { host: HOST })
    expect(result.ok).toBe(true)
    if (result.ok && result.spec.fetch.mode === 'json') {
      expect(result.spec.fetch.body).toBeUndefined()
    }
  })
})

// ── 호스트 · SSRF ──────────────────────────────────────────────────────

/** 주소만 바꾼 스펙. `{page}` 가 없어지므로 페이지네이션도 같이 끈다 */
function specTargeting(url: string): Record<string, unknown> {
  return { ...kstartupSpec(), fetch: { mode: 'json', url }, pagination: { kind: 'none' } }
}

describe('validateSpec — fetch.url 의 호스트 (SSRF 방어이기도 하다)', () => {
  it('사용자가 준 호스트와 다르면 거부한다', () => {
    const errors = errorsOf(kstartupSpec(), 'bizinfo.go.kr')
    expect(errors.join(' ')).toContain('bizinfo.go.kr')
    expect(errors.join(' ')).toContain('다른 사이트')
  })

  it('localhost 는 거부한다', () => {
    expect(errorsOf(specTargeting('http://localhost:5432/api'), 'localhost').join(' ')).toContain('내부망')
  })

  it('사설 IP 도 거부한다', () => {
    expect(errorsOf(specTargeting('http://192.168.0.10/api'), '192.168.0.10').join(' ')).toContain('내부망')
  })

  it('클라우드 메타데이터 주소를 거부한다', () => {
    const errors = errorsOf(specTargeting('http://169.254.169.254/latest/meta-data'), '169.254.169.254')
    expect(errors.join(' ')).toContain('내부망')
  })

  it('개발용으로 열고 싶으면 allowPrivateHosts 로만 열린다', () => {
    const result = validateSpec(specTargeting('http://localhost:8080/api'), {
      host: 'localhost',
      allowPrivateHosts: true,
    })
    expect(result.ok).toBe(true)
  })

  it('URL 에 아이디·비밀번호를 넣을 수 없다', () => {
    expect(errorsOf(specTargeting('https://a:b@www.k-startup.go.kr/api')).join(' ')).toContain('비밀번호')
  })

  it('http · https 가 아니면 스펙 파싱에서 이미 걸린다', () => {
    expect(errorsOf(specTargeting('file:///etc/passwd')).length).toBeGreaterThan(0)
  })
})

describe('isPrivateHost', () => {
  const priv = [
    'localhost',
    'api.localhost',
    'db.internal',
    'printer.local',
    'metadata.google.internal',
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fd00::1',
    'fe80::1',
    // IPv4 사상 IPv6. 아래 세 개는 전부 같은 127.0.0.1 이다 —
    // 두 번째가 URL 파서(`new URL('http://[::ffff:127.0.0.1]/').hostname`)가 만드는 형태다
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '0:0:0:0:0:ffff:7f00:1',
    '::ffff:a9fe:a9fe', // 169.254.169.254 — 클라우드 메타데이터
    '::ffff:c0a8:1', // 192.168.0.1
    'fe80::1%eth0', // 존 인덱스가 붙어 와도
  ]
  const pub = [
    'k-startup.go.kr',
    'www.bizinfo.go.kr',
    '8.8.8.8',
    '172.32.0.1',
    '11.0.0.1',
    '::ffff:808:808', // 8.8.8.8 — 사상 주소라고 다 막으면 안 된다
    '2606:4700::1111',
  ]

  for (const host of priv) {
    it(`${host} 는 내부망`, () => expect(isPrivateHost(host)).toBe(true))
  }
  for (const host of pub) {
    it(`${host} 는 외부`, () => expect(isPrivateHost(host)).toBe(false))
  }
})

// ── 경로 문법 ──────────────────────────────────────────────────────────

describe('validateSpec — 경로 문법', () => {
  it('json 모드에 CSS 경로를 쓰면 거부한다', () => {
    const spec = { ...kstartupSpec(), list: 'css:.list > li' }
    expect(errorsOf(spec).join(' ')).toMatch(/json 모드/)
  })

  it('html 모드에 JSONPath 를 쓰면 거부한다', () => {
    const spec = thinkcontestSpec()
    spec['list'] = '$.items[*]'
    const result = validateSpec(spec, { host: 'thinkcontest.com' })
    expect(result.ok).toBe(false)
  })

  it('지원하지 않는 JSONPath 문법(재귀 하강)을 거부한다', () => {
    const spec = { ...kstartupSpec(), list: '$..items' }
    expect(errorsOf(spec).join(' ')).toContain('재귀 하강')
  })

  it('오류 문장에는 어느 필드인지가 들어 있다', () => {
    const spec = kstartupSpec()
    const fields = spec['fields'] as Record<string, unknown>
    fields['deadline'] = { path: '$..reqstEndDe', type: 'date' }
    expect(errorsOf(spec).join(' ')).toContain("'deadline' 필드의 경로")
  })
})

// ── 알 수 없는 op ──────────────────────────────────────────────────────

describe('validateSpec — 알 수 없는 op', () => {
  it('닫힌 집합에 없는 연산자는 거부하고, 쓸 수 있는 것을 알려준다', () => {
    const spec = kstartupSpec()
    const fields = spec['fields'] as Record<string, unknown>
    fields['title'] = { path: '$.pbancNm', type: 'text', transform: [{ op: 'eval', code: 'x => x' }] }
    const message = errorsOf(spec).join(' ')
    expect(message).toContain("'eval'")
    expect(message).toContain("'regex_extract'") // 대안 목록이 프롬프트에 그대로 들어간다
  })

  it('op 이름이 아예 없는 항목도 말해 준다', () => {
    const spec = kstartupSpec()
    const fields = spec['fields'] as Record<string, unknown>
    fields['title'] = { path: '$.pbancNm', type: 'text', transform: [{ pattern: 'x' }] }
    expect(errorsOf(spec).join(' ')).toContain("'op' 이름이 없는")
  })

  it('연산자에 없는 파라미터를 넣으면 거부한다 (strictObject)', () => {
    const spec = kstartupSpec()
    const fields = spec['fields'] as Record<string, unknown>
    fields['title'] = { path: '$.pbancNm', type: 'text', transform: [{ op: 'trim', extra: 1 }] }
    expect(errorsOf(spec).length).toBeGreaterThan(0)
  })

  it('findUnknownOps 는 zod 없이도 이름만 먼저 훑는다', () => {
    expect(
      findUnknownOps({ fields: { a: { transform: [{ op: 'trim' }, { op: 'fetch_url' }] } } }),
    ).toHaveLength(1)
  })

  it('스펙 형태가 아니면 findUnknownOps 는 조용히 빈 배열', () => {
    expect(findUnknownOps(null)).toEqual([])
    expect(findUnknownOps('문자열')).toEqual([])
    expect(findUnknownOps({})).toEqual([])
  })
})

// ── max_pages 상한 (ADR A12) ───────────────────────────────────────────

describe('validateSpec — max_pages 상한', () => {
  it('3 을 넘기면 거부한다', () => {
    const spec = { ...kstartupSpec(), pagination: { kind: 'page_param', param: 'page', max_pages: 50 } }
    expect(errorsOf(spec).join(' ')).toContain('3')
  })

  it('scroll 의 times 에도 같은 상한이 걸린다', () => {
    const spec = {
      spec_version: 1,
      fetch: { mode: 'browser', url: 'https://www.k-startup.go.kr/list' },
      list: 'css:li',
      fields: { title: { path: 'css:.tit', type: 'text' } },
      pagination: { kind: 'scroll', times: 99 },
    }
    expect(errorsOf(spec).length).toBeGreaterThan(0)
  })

  it('scroll 은 browser 모드에서만 쓸 수 있다', () => {
    const spec = { ...thinkcontestSpec(), pagination: { kind: 'scroll', times: 2 } }
    const result = validateSpec(spec, { host: 'thinkcontest.com' })
    expect(result.ok).toBe(false)
  })

  it('page_param 을 쓰려면 URL 에 {page} 가 있어야 한다', () => {
    const spec = {
      ...kstartupSpec(),
      fetch: { mode: 'json', url: 'https://www.k-startup.go.kr/api/pbanc/list' },
    }
    expect(errorsOf(spec).join(' ')).toContain('{page}')
  })
})

// ── 컬렉션 스키마와의 대조 ─────────────────────────────────────────────

describe('validateSpec — 스키마의 required 필드', () => {
  const schema: CollectionSchemaJson = CollectionSchemaJsonSchema.parse([
    { key: 'title', label: '공고명', type: 'text', required: true },
    { key: 'organization', label: '주관', type: 'text' },
    { key: 'deadline', label: '마감', type: 'date' },
    { key: 'amount', label: '지원금', type: 'money' },
    { key: 'link', label: '원문', type: 'link', required: true },
  ])

  it('required 필드가 다 있으면 통과', () => {
    expect(validateSpec(kstartupSpec(), { host: HOST, schema }).ok).toBe(true)
  })

  it('required 필드가 빠지면 무엇을 추가해야 하는지 말해 준다', () => {
    const spec = kstartupSpec()
    const fields = spec['fields'] as Record<string, unknown>
    delete fields['link']
    const message = errorsOf(spec, HOST, schema).join(' ')
    expect(message).toContain("'link'")
    expect(message).toContain('추가해')
  })

  it('표에 없는 필드를 지어내면 쓸 수 있는 필드 목록을 알려준다', () => {
    const spec = kstartupSpec()
    const fields = spec['fields'] as Record<string, unknown>
    fields['views'] = { path: '$.inqCnt', type: 'number' }
    const message = errorsOf(spec, HOST, schema).join(' ')
    expect(message).toContain("'views'")
    expect(message).toContain("'title'")
  })

  it('타입이 표와 다르면 거부한다', () => {
    const spec = kstartupSpec()
    const fields = spec['fields'] as Record<string, unknown>
    fields['deadline'] = { path: '$.reqstEndDe', type: 'text' }
    expect(errorsOf(spec, HOST, schema).join(' ')).toContain("type 은 'date'")
  })
})

// ── 오류 문장 자체의 계약 ──────────────────────────────────────────────

describe('errors 는 재생성 프롬프트에 그대로 들어갈 문장이다', () => {
  it('같은 오류가 두 번 나오지 않는다', () => {
    const errors = errorsOf({ fetch: { mode: 'json', url: 'https://www.k-startup.go.kr/api' } })
    expect(new Set(errors).size).toBe(errors.length)
  })

  it('전부 비어 있지 않은 문장이다', () => {
    const errors = errorsOf({ list: 123, fields: '아님' })
    expect(errors.length).toBeGreaterThan(0)
    for (const line of errors) {
      expect(typeof line).toBe('string')
      expect(line.trim().length).toBeGreaterThan(0)
    }
  })

  it('스펙이 아예 객체가 아니어도 던지지 않는다', () => {
    for (const junk of [null, undefined, 42, '문자열', []]) {
      expect(() => validateSpec(junk, { host: HOST })).not.toThrow()
      expect(validateSpec(junk, { host: HOST }).ok).toBe(false)
    }
  })

  it('필드가 하나도 없으면 거부한다', () => {
    const spec = { ...kstartupSpec(), fields: {} }
    expect(errorsOf(spec).join(' ')).toContain('필드가 하나도 없습니다')
  })
})
