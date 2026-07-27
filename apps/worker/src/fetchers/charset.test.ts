// 인코딩 판정
//
// 여기서 보는 건 하나다: **헤더가 말을 안 해줄 때 글자가 깨지지 않는가.**
// 깨져도 목록은 뚫리고 겹침률도 100% 로 나오기 때문에, 이 테스트가 없으면
// 사람이 눈으로 보기 전까지 아무도 모른다.

import { describe, expect, it } from 'vitest'

import { charsetOf, decodeBody } from './charset'

/**
 * EUC-KR **인코더** 는 Node 에 없다 (디코더만 있다).
 * 그래서 두 바이트 조합을 전부 디코딩해 역표를 한 번 만든다.
 * 바이트를 손으로 적으면 오타가 나도 "글자가 깨졌다" 와 구분이 안 된다 — 실제로 한 번 그랬다.
 */
const euckr = (() => {
  const table = new Map<string, readonly [number, number]>()
  const dec = new TextDecoder('euc-kr')
  for (let hi = 0x81; hi <= 0xfe; hi += 1) {
    for (let lo = 0x41; lo <= 0xfe; lo += 1) {
      const ch = dec.decode(new Uint8Array([hi, lo]))
      if (ch.length === 1 && ch !== '�' && !table.has(ch)) table.set(ch, [hi, lo])
    }
  }
  return (text: string): number[] => {
    const out: number[] = []
    for (const ch of text) {
      const pair = table.get(ch)
      if (pair === undefined) throw new Error(`EUC-KR 에 없는 글자: ${ch}`)
      out.push(...pair)
    }
    return out
  }
})()

function bytes(...parts: (string | readonly number[])[]): Uint8Array {
  const out: number[] = []
  for (const part of parts) {
    if (typeof part === 'string') out.push(...[...part].map((c) => c.charCodeAt(0)))
    else out.push(...part)
  }
  return new Uint8Array(out)
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

describe('헤더가 charset 을 말해주면', () => {
  it('그대로 따른다', () => {
    const body = bytes('<html><title>', euckr('코참넷'), '</title>')
    expect(decodeBody(body, 'text/html; charset=euc-kr').text).toContain('코참넷')
  })

  it('따옴표로 감싸도 읽는다', () => {
    expect(charsetOf('text/html; charset="EUC-KR"')).toBe('euc-kr')
  })

  it('대소문자를 가리지 않는다', () => {
    expect(charsetOf('TEXT/HTML; CHARSET=EUC-KR')).toBe('euc-kr')
  })

  it('표준에 없는 이름도 뜻이 같으면 받아준다', () => {
    // 한국 사이트가 실제로 적는 이름들. `TextDecoder` 는 이대로는 거부한다.
    expect(charsetOf('text/html; charset=cp949')).toBe('euc-kr')
    expect(charsetOf('text/html; charset=ks_c_5601-1987')).toBe('ks_c_5601-1987')
  })

  it('모르는 이름이면 없는 셈 친다 — 거기서 멈추지 않는다', () => {
    expect(charsetOf('text/html; charset=made-up-9999')).toBeNull()

    const body = bytes('<meta charset="euc-kr"><p>', euckr('한국'), '</p>')
    // 헤더가 헛소리를 해도 <meta> 까지 내려가서 살린다
    expect(decodeBody(body, 'text/html; charset=made-up-9999').text).toContain('한국')
  })

  it('charset 이 없으면 없는 것이다', () => {
    expect(charsetOf('text/html')).toBeNull()
    expect(charsetOf('')).toBeNull()
  })
})

describe('헤더가 아무 말도 안 하면', () => {
  it('<meta charset> 을 보고 정한다 — korcham.net 이 이 경우다', () => {
    const body = bytes('<html><head><meta charset="euc-kr"><title>', euckr('코참넷'), '</title>')

    const r = decodeBody(body, 'text/html')
    expect(r.charset).toBe('euc-kr')
    expect(r.text).toContain('코참넷')
    // 고치기 전에는 이랬다
    expect(new TextDecoder('utf-8').decode(body)).not.toContain('코참넷')
  })

  it('<meta http-equiv> 로 적힌 옛날 방식도 읽는다', () => {
    const body = bytes(
      '<meta http-equiv="Content-Type" content="text/html; charset=euc-kr" /><p>',
      euckr('공고'),
      '</p>',
    )
    expect(decodeBody(body, 'text/html').text).toContain('공고')
  })

  it('XML 선언도 본다 — RSS 목록에서 나온다', () => {
    const body = bytes('<?xml version="1.0" encoding="euc-kr"?><item><title>', euckr('한국'), '</title>')
    expect(decodeBody(body, 'application/rss+xml').text).toContain('한국')
  })

  it('선언이 어디에도 없으면 UTF-8 이다', () => {
    const r = decodeBody(utf8('<p>한국</p>'), 'text/html')
    expect(r.charset).toBe('utf-8')
    expect(r.text).toContain('한국')
  })

  it('머리 4KB 밖에 적힌 선언은 못 본다 — 무한정 뒤지지 않는다', () => {
    const body = bytes(`<!--${'x'.repeat(5000)}-->`, '<meta charset="euc-kr">')
    expect(decodeBody(body, 'text/html').charset).toBe('utf-8')
  })
})

describe('JSON 응답은', () => {
  it('본문에 <meta charset= 같은 글자가 있어도 뒤지지 않는다 — 그건 데이터다', () => {
    // 명세가 UTF-8 로 못 박았다. 게시글 본문에 HTML 조각이 들어 있는 API 가 흔하다.
    const body = utf8('{"html":"<meta charset=\\"euc-kr\\">","title":"한국"}')

    const r = decodeBody(body, 'application/json')
    expect(r.charset).toBe('utf-8')
    expect(r.text).toContain('한국')
  })
})

describe('BOM 이 있으면', () => {
  it('헤더보다 BOM 을 믿는다', () => {
    const body = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('<p>한국</p>')])

    // 헤더는 euc-kr 이라고 하지만 바이트가 스스로 UTF-8 이라고 밝혔다
    const r = decodeBody(body, 'text/html; charset=euc-kr')
    expect(r.charset).toBe('utf-8')
    expect(r.text).toContain('한국')
    // BOM 글자는 본문에 남지 않는다 — 남으면 첫 필드 앞에 보이지 않는 글자가 붙는다
    expect(r.text.startsWith('<p>')).toBe(true)
  })

  it('UTF-16 도 알아본다', () => {
    const body = new Uint8Array([0xff, 0xfe, ...Buffer.from('<p>한국</p>', 'utf16le')])
    expect(decodeBody(body, 'text/html').text).toContain('한국')
  })
})

describe('무슨 일이 있어도', () => {
  it('본문을 통째로 잃지 않는다 (원칙 ④)', () => {
    // UTF-8 로 읽을 수 없는 바이트가 섞여 있어도 나머지는 살아야 한다
    const body = bytes('<p>hello ', [0xff, 0xfe, 0xfd], ' world</p>')

    const r = decodeBody(body, 'text/html; charset=utf-8')
    expect(r.text).toContain('hello')
    expect(r.text).toContain('world')
  })

  it('빈 본문도 던지지 않는다', () => {
    expect(decodeBody(new Uint8Array(0), 'text/html').text).toBe('')
  })
})
