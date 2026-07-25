// 경로 평가기 테스트 (기획서 11장)
//
// JSONPath 는 이 프로젝트가 쓰는 부분집합만 지원한다. **지원하지 않는 문법을 거부하는 것**도
// 기능이다 — 필터식·재귀 하강을 조용히 통과시키면 외부 라이브러리를 안 쓴 이유가 사라진다.
// CSS 는 주입받은 HtmlAdapter 로만 평가한다. 여기서는 고정 응답 스텁을 넣는다.

import { describe, expect, it } from 'vitest'
import type { HtmlAdapter, HtmlNode } from './paths'
import {
  applyJsonPath,
  checkPathSyntax,
  evaluateCssPath,
  evaluateJsonPath,
  parseCssPathStrict,
  parseJsonPath,
  PathSyntaxError,
  selectCssNodes,
} from './paths'

// ── 고정 응답 스텁 ─────────────────────────────────────────────────────

function node(text: string, attrs: Record<string, string> = {}, html = ''): HtmlNode {
  return {
    text: () => text,
    attr: (name: string) => attrs[name],
    html: () => html,
  }
}

function stubAdapter(bySelector: Record<string, HtmlNode[]>): HtmlAdapter {
  return { select: (_html, selector) => bySelector[selector] ?? [] }
}

// ── JSONPath 파싱 ──────────────────────────────────────────────────────

describe('parseJsonPath — 지원하는 문법', () => {
  it('$ 하나는 뿌리 그 자체', () => {
    expect(parseJsonPath('$')).toEqual({ source: '$', steps: [], multi: false })
  })

  it('$.a.b — 점 표기', () => {
    expect(parseJsonPath('$.a.b').steps).toEqual([
      { kind: 'key', name: 'a' },
      { kind: 'key', name: 'b' },
    ])
  })

  it('$.a[0] — 인덱스', () => {
    expect(parseJsonPath('$.a[0]').steps).toEqual([
      { kind: 'key', name: 'a' },
      { kind: 'index', index: 0 },
    ])
  })

  it('$.a[-1] — 음수 인덱스는 뒤에서부터', () => {
    expect(parseJsonPath('$.a[-1]').steps[1]).toEqual({ kind: 'index', index: -1 })
  })

  it('$.a[*] — 와일드카드면 multi 가 선다', () => {
    const parsed = parseJsonPath('$.a[*]')
    expect(parsed.multi).toBe(true)
  })

  it("$['키 이름'] — 공백이 든 키는 대괄호 표기로", () => {
    expect(parseJsonPath("$['키 이름']").steps).toEqual([{ kind: 'key', name: '키 이름' }])
  })

  it('$["키"] — 쌍따옴표도 같다', () => {
    expect(parseJsonPath('$["키"]').steps).toEqual([{ kind: 'key', name: '키' }])
  })

  it('기획서 11장의 list 경로 — $.data.items[*]', () => {
    const parsed = parseJsonPath('$.data.items[*]')
    expect(parsed.steps).toEqual([
      { kind: 'key', name: 'data' },
      { kind: 'key', name: 'items' },
      { kind: 'wildcard' },
    ])
    expect(parsed.multi).toBe(true)
  })

  it('$.a.* — 점 뒤 와일드카드', () => {
    expect(parseJsonPath('$.a.*').steps[1]).toEqual({ kind: 'wildcard' })
  })
})

describe('parseJsonPath — 거부해야 하는 문법', () => {
  const rejected: Array<[string, string]> = [
    ['$..items', '재귀 하강'],
    ['$.items[?(@.id)]', '필터식'],
    ['$.items[1:3]', '슬라이스'],
    ['$.items[', '대괄호'],
    ['$.', '키 이름'],
    ['items', 'JSONPath'],
  ]

  for (const [path, hint] of rejected) {
    it(`${path} — ${hint} 를 거부한다`, () => {
      expect(() => parseJsonPath(path)).toThrow(PathSyntaxError)
    })
  }

  it('오류 메시지는 재생성 프롬프트에 그대로 넣을 수 있는 문장이다', () => {
    try {
      parseJsonPath('$..items')
      throw new Error('여기 오면 안 된다')
    } catch (e) {
      expect(e).toBeInstanceOf(PathSyntaxError)
      const message = (e as PathSyntaxError).message
      expect(message).toContain('$..items')
      expect(message).toContain('재귀 하강')
      expect(message.length).toBeGreaterThan(10)
    }
  })
})

// ── JSONPath 평가 ──────────────────────────────────────────────────────

describe('evaluateJsonPath', () => {
  const data = {
    data: {
      items: [
        { id: 1, name: '가' },
        { id: 2, name: '나' },
      ],
      total: 2,
    },
    '키 이름': '값',
  }

  it('$.data.items[*] — 행 배열을 편다', () => {
    expect(evaluateJsonPath(data, '$.data.items[*]')).toHaveLength(2)
  })

  it('$.data.items[0].name', () => {
    expect(evaluateJsonPath(data, '$.data.items[0].name')).toEqual(['가'])
  })

  it('$.data.items[-1].id — 마지막 원소', () => {
    expect(evaluateJsonPath(data, '$.data.items[-1].id')).toEqual([2])
  })

  it('$.data.items[*].name — 와일드카드 뒤에도 이어진다', () => {
    expect(evaluateJsonPath(data, '$.data.items[*].name')).toEqual(['가', '나'])
  })

  it("$['키 이름']", () => {
    expect(evaluateJsonPath(data, "$['키 이름']")).toEqual(['값'])
  })

  it('없는 경로는 빈 배열 — 던지지 않는다 (부분 성공)', () => {
    expect(evaluateJsonPath(data, '$.data.missing.deeper')).toEqual([])
  })

  it('한글 키도 점 표기로 읽는다 — 국내 내부 API 가 실제로 쓴다', () => {
    expect(evaluateJsonPath({ 공고명: '공모전' }, '$.공고명')).toEqual(['공모전'])
  })

  it('객체에 [*] 를 걸면 값 전부로 편다', () => {
    expect(evaluateJsonPath({ a: 1, b: 2 }, '$[*]')).toEqual([1, 2])
  })

  it('배열이 아닌 값에 인덱스를 걸면 빈 배열', () => {
    expect(evaluateJsonPath({ a: 'text' }, '$.a[0]')).toEqual([])
  })

  it('null 은 조용히 빠진다', () => {
    expect(evaluateJsonPath({ a: null }, '$.a.b')).toEqual([])
  })

  it('applyJsonPath 는 파싱 결과를 재사용한다 (행마다 다시 파싱하지 않기 위한 통로)', () => {
    const parsed = parseJsonPath('$.name')
    expect(applyJsonPath({ name: '가' }, parsed)).toEqual(['가'])
    expect(applyJsonPath({ name: '나' }, parsed)).toEqual(['나'])
  })
})

// ── CSS 경로 ───────────────────────────────────────────────────────────

describe('CSS 경로', () => {
  it('css:a@href — 선택자와 속성으로 쪼갠다', () => {
    expect(parseCssPathStrict('css:a@href')).toEqual({ selector: 'a', attr: 'href' })
  })

  it('css:.contest-list > li — 속성이 없으면 attr 은 null', () => {
    expect(parseCssPathStrict('css:.contest-list > li')).toEqual({
      selector: '.contest-list > li',
      attr: null,
    })
  })

  it('CSS 경로가 아니면 PathSyntaxError', () => {
    expect(() => parseCssPathStrict('$.a')).toThrow(PathSyntaxError)
  })

  it('속성이 없는 경로는 텍스트를 낸다', () => {
    const adapter = stubAdapter({ '.tit': [node('  공모전  ')] })
    expect(evaluateCssPath('<html/>', 'css:.tit', adapter)).toEqual(['  공모전  '])
  })

  it('@속성 이 있으면 속성값을 낸다', () => {
    const adapter = stubAdapter({ a: [node('링크', { href: '/contest/1' })] })
    expect(evaluateCssPath('<html/>', 'css:a@href', adapter)).toEqual(['/contest/1'])
  })

  it('속성이 없는 노드는 결과에서 빠진다 (부분 성공)', () => {
    const adapter = stubAdapter({ a: [node('링크', { href: '/1' }), node('링크', {})] })
    expect(evaluateCssPath('<html/>', 'css:a@href', adapter)).toEqual(['/1'])
  })

  it('안 걸리면 빈 배열', () => {
    expect(evaluateCssPath('<html/>', 'css:.없음', stubAdapter({}))).toEqual([])
  })

  it('selectCssNodes 는 노드를 그대로 준다 (행 단위 평가에 쓴다)', () => {
    const adapter = stubAdapter({ li: [node('행', {}, '<li>행</li>')] })
    const nodes = selectCssNodes('<html/>', 'css:li', adapter)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.html()).toBe('<li>행</li>')
  })
})

// ── 모드 대조 ──────────────────────────────────────────────────────────

describe('checkPathSyntax — 실행 전 계약 검사가 쓰는 판정', () => {
  it('json 모드 + JSONPath 는 통과', () => {
    expect(checkPathSyntax('$.data.items[*]', 'json', "'list' 경로")).toBeNull()
  })

  it('html 모드 + CSS 는 통과', () => {
    expect(checkPathSyntax('css:.contest-list > li', 'html', "'list' 경로")).toBeNull()
  })

  it('browser 모드도 CSS 를 쓴다', () => {
    expect(checkPathSyntax('css:.card', 'browser', "'list' 경로")).toBeNull()
  })

  it('json 모드에 CSS 를 쓰면 어디가 틀렸는지 말한다', () => {
    const message = checkPathSyntax('css:.tit', 'json', "'title' 필드의 경로")
    expect(message).toContain("'title' 필드의 경로")
    expect(message).toContain('JSONPath')
    expect(message).toContain('css:.tit')
  })

  it('html 모드에 JSONPath 를 쓰면 어디가 틀렸는지 말한다', () => {
    const message = checkPathSyntax('$.title', 'html', "'title' 필드의 경로")
    expect(message).toContain('CSS')
  })

  it('json 모드에서 문법이 깨진 JSONPath 도 잡는다', () => {
    expect(checkPathSyntax('$..items', 'json', "'list' 경로")).toContain('재귀 하강')
  })
})
