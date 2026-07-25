// 변환 연산자 실행기 테스트 — 12종 전부 (기획서 11장 표)
//
// 연산자는 닫힌 집합이다. 표의 줄 하나마다 여기 describe 하나가 있어야 한다.
// 실패가 throw 가 아니라 결과 객체라는 것도 같이 못 박는다 (원칙 ④ 부분 성공).

import { describe, expect, it } from 'vitest'
import type { TransformOp, TransformPipeline } from './ops'
import { TransformOpSchema, TransformPipelineSchema } from './ops'
import type { TransformContext } from './transform'
import { applyTransformOp, isEmptyValue, runTransformPipeline } from './transform'

/** 기본값이 채워진 연산자를 만든다 — 스펙이 저장되는 형태와 같게 */
function op(raw: unknown): TransformOp {
  return TransformOpSchema.parse(raw)
}

function pipeline(raw: unknown[]): TransformPipeline {
  return TransformPipelineSchema.parse(raw)
}

/** 2026-07-26(일) 09:00 KST — date_parse 의 상대 표기 기준 */
const NOW = new Date('2026-07-26T09:00:00+09:00')
const CTX: TransformContext = { now: NOW, baseUrl: 'https://thinkcontest.com/contest/list?p=1' }

function value(raw: unknown, spec: unknown): unknown {
  const out = applyTransformOp(raw, op(spec), CTX)
  if (!out.ok) throw new Error(`실패했다: ${out.error}`)
  return out.value
}

function error(raw: unknown, spec: unknown): string {
  const out = applyTransformOp(raw, op(spec), CTX)
  if (out.ok) throw new Error('성공하면 안 된다')
  return out.error
}

describe('trim · collapse_space — 공백 정리', () => {
  it('trim', () => {
    expect(value('  공모전  ', { op: 'trim' })).toBe('공모전')
  })

  it('collapse_space — 개행과 연속 공백을 스페이스 하나로', () => {
    expect(value('청년\n\t 창업   공모전 ', { op: 'collapse_space' })).toBe('청년 창업 공모전')
  })

  it('숫자도 문자열로 받아 처리한다', () => {
    expect(value(174233, { op: 'trim' })).toBe('174233')
  })

  it('값이 없으면 실패 (throw 가 아니라 결과)', () => {
    expect(error(null, { op: 'trim' })).toContain('값이 없어')
  })
})

describe('regex_extract — 패턴으로 잘라내기', () => {
  it('기획서 11장 amount 예시 — [\\d,]+', () => {
    expect(value('최대 100,000천원', { op: 'regex_extract', pattern: '[\\d,]+' })).toBe('100,000')
  })

  it('기획서 11장 deadline 예시 — 날짜만 집어낸다', () => {
    expect(
      value('접수 ~ 2026.08.21 마감', { op: 'regex_extract', pattern: '\\d{4}[.-]\\d{2}[.-]\\d{2}' }),
    ).toBe('2026.08.21')
  })

  it('group 으로 캡처 그룹을 고른다', () => {
    expect(value('sn=174233', { op: 'regex_extract', pattern: 'sn=(\\d+)', group: 1 })).toBe('174233')
  })

  it('안 맞으면 실패 — 무엇에서 무엇을 못 찾았는지 말한다', () => {
    const message = error('상시모집', { op: 'regex_extract', pattern: '\\d{4}' })
    expect(message).toContain('상시모집')
    expect(message).toContain('\\d{4}')
  })

  it('없는 그룹 번호는 실패', () => {
    expect(error('abc', { op: 'regex_extract', pattern: 'a(b)c', group: 5 })).toContain('그룹')
  })
})

describe('replace — 치환', () => {
  it('기본은 전역 치환', () => {
    expect(value('가.나.다', { op: 'replace', pattern: '\\.', replacement: '-' })).toBe('가-나-다')
  })

  it('flags 를 주면 그대로 쓴다', () => {
    expect(value('AaA', { op: 'replace', pattern: 'a', replacement: 'x', flags: 'gi' })).toBe('xxx')
  })
})

describe('split + index — 구분자로 자르고 n번째', () => {
  it('앞에서부터', () => {
    expect(value('중소벤처기업부 | 창업진흥원', { op: 'split', separator: '|', index: 0 })).toBe(
      '중소벤처기업부 ',
    )
  })

  it('음수는 뒤에서부터 (-1 = 마지막)', () => {
    expect(value('/web/contents/detail/174233', { op: 'split', separator: '/', index: -1 })).toBe('174233')
  })

  it('조각이 없으면 실패', () => {
    expect(error('가', { op: 'split', separator: ',', index: 3 })).toContain('3번째')
  })
})

describe('date_parse — normalize/date 의 파서를 그대로 쓴다 (중복 구현 금지)', () => {
  it('기획서 11장 formats 후보 — YYYYMMDD', () => {
    expect(value('20260814', { op: 'date_parse', formats: ['YYYYMMDD', 'YYYY.MM.DD'] })).toBe('2026-08-14')
  })

  it('formats 없이도 한국 목록 사이트 관용 표기를 읽는다 — ~2026-08-21', () => {
    expect(value('~2026-08-21', { op: 'date_parse' })).toBe('2026-08-21')
  })

  it('D-7 은 기준일에 걸린다', () => {
    expect(value('D-7', { op: 'date_parse' })).toBe('2026-08-02')
  })

  it('상시는 실패가 아니라 "가리킬 날짜가 없음"(null) 이다', () => {
    expect(value('상시', { op: 'date_parse' })).toBeNull()
  })

  it('날짜가 전혀 아니면 실패', () => {
    expect(error('!!!', { op: 'date_parse' }).length).toBeGreaterThan(0)
  })
})

describe('number_parse — normalize/number 의 파서를 그대로 쓴다', () => {
  it('콤마를 턴다', () => {
    expect(value('100,000', { op: 'number_parse' })).toBe(100000)
  })

  it('꼬리표가 붙어 있어도 숫자만 남긴다', () => {
    expect(value('32건', { op: 'number_parse' })).toBe(32)
  })

  it('한국 단위 승수도 파서가 안다', () => {
    expect(value('1억 5천만', { op: 'number_parse' })).toBe(150000000)
  })
})

describe('multiply — 단위 승수', () => {
  it('천원 → ×1000', () => {
    expect(value(100000, { op: 'multiply', by: 1000 })).toBe(100000000)
  })

  it('문자열 숫자도 받는다', () => {
    expect(value('5,000', { op: 'multiply', by: 10000 })).toBe(50000000)
  })

  it('숫자가 아니면 실패', () => {
    expect(error('협의', { op: 'multiply', by: 1000 })).toContain('숫자가 아니')
  })
})

describe('absolute_url — 상대경로를 절대 URL 로', () => {
  it('ctx.baseUrl 을 기준으로 붙인다', () => {
    expect(value('/contest/1', { op: 'absolute_url' })).toBe('https://thinkcontest.com/contest/1')
  })

  it('op.base 가 ctx 를 이긴다', () => {
    expect(value('/a', { op: 'absolute_url', base: 'https://bizinfo.go.kr/' })).toBe('https://bizinfo.go.kr/a')
  })

  it('기준이 없으면 실패 — 절반짜리 링크를 내보내지 않는다', () => {
    const out = applyTransformOp('/a', op({ op: 'absolute_url' }), {})
    expect(out.ok).toBe(false)
  })
})

describe('template — {value} 를 끼워 조립', () => {
  it('기획서 11장 link 예시', () => {
    expect(
      value(174233, {
        op: 'template',
        value: 'https://www.k-startup.go.kr/web/contents/detail?sn={value}',
      }),
    ).toBe('https://www.k-startup.go.kr/web/contents/detail?sn=174233')
  })

  it('{value} 가 없는 템플릿은 스펙 단계에서 거부된다', () => {
    expect(() => op({ op: 'template', value: '고정문자열' })).toThrow()
  })
})

describe('map — enum 값 매핑', () => {
  it('표에 있으면 바꾼다', () => {
    expect(value('기술개발', { op: 'map', mapping: { 기술개발: 'rnd' } })).toBe('rnd')
  })

  it('표에 없고 fallback 이 있으면 fallback', () => {
    expect(value('알수없음', { op: 'map', mapping: { 기술개발: 'rnd' }, fallback: 'etc' })).toBe('etc')
  })

  it('표에 없고 fallback 도 없으면 원값을 통과시킨다', () => {
    expect(value('알수없음', { op: 'map', mapping: { 기술개발: 'rnd' } })).toBe('알수없음')
  })
})

describe('default — 실패를 흡수하는 유일한 연산자', () => {
  it('값이 비어 있으면 채운다', () => {
    expect(value('', { op: 'default', value: '미정' })).toBe('미정')
  })

  it('값이 있으면 건드리지 않는다', () => {
    expect(value('있음', { op: 'default', value: '미정' })).toBe('있음')
  })

  it('isEmptyValue 의 판정', () => {
    expect(isEmptyValue(null)).toBe(true)
    expect(isEmptyValue(undefined)).toBe(true)
    expect(isEmptyValue('   ')).toBe(true)
    expect(isEmptyValue([])).toBe(true)
    expect(isEmptyValue(Number.NaN)).toBe(true)
    expect(isEmptyValue(0)).toBe(false)
    expect(isEmptyValue('가')).toBe(false)
  })
})

describe('join — 배열을 문자열로', () => {
  it('기본 구분자는 ", "', () => {
    expect(value(['가', '나'], { op: 'join' })).toBe('가, 나')
  })

  it('구분자를 준다', () => {
    expect(value(['가', '나'], { op: 'join', separator: ' / ' })).toBe('가 / 나')
  })

  it('배열이 아니면 그대로 문자열로', () => {
    expect(value('가', { op: 'join' })).toBe('가')
  })
})

// ── 파이프라인 ─────────────────────────────────────────────────────────

describe('runTransformPipeline', () => {
  it('기획서 11장 amount 파이프라인 — regex_extract → number_parse → multiply', () => {
    const out = runTransformPipeline(
      '최대 100,000천원',
      pipeline([
        { op: 'regex_extract', pattern: '[\\d,]+' },
        { op: 'number_parse' },
        { op: 'multiply', by: 1000 },
      ]),
      CTX,
    )
    expect(out.ok).toBe(true)
    expect(out.value).toBe(100000000)
  })

  it('기획서 11장 deadline 파이프라인 — regex_extract → date_parse', () => {
    const out = runTransformPipeline(
      '접수기간 2026.08.01 ~ 2026.08.21',
      pipeline([{ op: 'regex_extract', pattern: '\\d{4}[.-]\\d{2}[.-]\\d{2}' }, { op: 'date_parse' }]),
      CTX,
    )
    expect(out.value).toBe('2026-08-01')
  })

  it('파이프라인이 없으면 입력을 그대로 흘린다', () => {
    expect(runTransformPipeline('가', undefined, CTX).value).toBe('가')
  })

  it('한 번 실패하면 뒤 연산자는 건너뛴다', () => {
    const out = runTransformPipeline(
      '상시모집',
      pipeline([{ op: 'regex_extract', pattern: '[\\d,]+' }, { op: 'multiply', by: 1000 }]),
      CTX,
    )
    expect(out.ok).toBe(false)
    expect(out.failedOp).toBe('regex_extract')
    expect(out.value).toBeNull()
    expect(out.error).toContain('상시모집')
  })

  it('default 를 만나면 실패에서 되살아난다', () => {
    const out = runTransformPipeline(
      '상시모집',
      pipeline([
        { op: 'regex_extract', pattern: '[\\d,]+' },
        { op: 'number_parse' },
        { op: 'default', value: 0 },
      ]),
      CTX,
    )
    expect(out.ok).toBe(true)
    expect(out.value).toBe(0)
    expect(out.recoveredByDefault).toBe(true)
    expect(out.failedOp).toBeNull()
  })

  it('실패하지 않았으면 default 는 흔적을 남기지 않는다', () => {
    const out = runTransformPipeline('1,000', pipeline([{ op: 'number_parse' }, { op: 'default', value: 0 }]), CTX)
    expect(out.value).toBe(1000)
    expect(out.recoveredByDefault).toBe(false)
  })

  it('어떤 입력에도 throw 하지 않는다 — 한 값이 수집 전체를 죽이면 안 된다', () => {
    const nasty: unknown[] = [null, undefined, {}, [], Number.NaN, Symbol('x'), () => 1]
    const ops = pipeline([
      { op: 'trim' },
      { op: 'regex_extract', pattern: '\\d+' },
      { op: 'number_parse' },
      { op: 'multiply', by: 10 },
      { op: 'date_parse' },
      { op: 'absolute_url' },
      { op: 'join' },
    ])
    for (const input of nasty) {
      expect(() => runTransformPipeline(input, ops, CTX)).not.toThrow()
    }
  })
})
