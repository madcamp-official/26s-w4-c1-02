// 429 를 원인별로 가르는 것 — 실측 오류 본문이 곧 테스트다.
//
// 2026-07-27 실측: 결제 잔액이 0 이 되어 받은 429 를 "오늘 분량을 다 썼다" 고 말했다.
// 그날 쓴 호출은 몇 건뿐이었고, 사람이 손대기 전에는 다음 날도 풀리지 않았다.
// 아래 문자열들은 손으로 지어낸 것이 아니라 Gemini 가 실제로 돌려주는 본문 형태다.

import { describe, expect, it } from 'vitest'

import { classifyRateLimit, RATE_LIMIT_MESSAGES } from './gemini'

/** 실제로 받았던 것 — 선불 잔액 소진 */
const PREPAY_DEPLETED =
  '[429 Too Many Requests] Your prepayment credits are depleted. Please purchase more credits to continue using the API.'

/** 무료 티어 하루 한도 — 본문에 "billing details" 가 들어간다는 점이 함정이다 */
const FREE_TIER_DAILY =
  '[429 Too Many Requests] You exceeded your current quota, please check your plan and billing details. ' +
  '[{"@type":"type.googleapis.com/google.rpc.QuotaFailure","violations":[{"quotaMetric":' +
  '"generativelanguage.googleapis.com/generate_content_free_tier_requests","quotaId":' +
  '"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]},{"@type":"type.googleapis.com/google.rpc.RetryInfo",' +
  '"retryDelay":"52s"}]'

/** 분당 한도 — 기다리면 풀린다 */
const PER_MINUTE =
  '[429 Too Many Requests] You exceeded your current quota, please check your plan and billing details. ' +
  '[{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}]'

describe('classifyRateLimit', () => {
  it('선불 잔액이 떨어진 429 를 결제 문제로 읽는다 — 실측 결함의 재현이자 수리', () => {
    expect(classifyRateLimit(PREPAY_DEPLETED)).toBe('billing')
  })

  it('무료 티어 하루 한도는 결제 문제가 아니다 — 본문의 "billing details" 에 속지 않는다', () => {
    expect(classifyRateLimit(FREE_TIER_DAILY)).toBe('daily')
  })

  it('분당 한도는 잠깐 몰린 것으로 읽는다', () => {
    expect(classifyRateLimit(PER_MINUTE)).toBe('burst')
  })

  it('갈리지 않으면 단정하지 않는다', () => {
    expect(classifyRateLimit('[429 Too Many Requests] Resource has been exhausted.')).toBe('unknown')
  })
})

describe('거절 문구', () => {
  it('기다려도 안 풀리는 경우에 "내일"을 약속하지 않는다 — 이 약속이 결함이었다', () => {
    expect(RATE_LIMIT_MESSAGES.billing).not.toMatch(/내일|잠시 뒤|1~2분/)
    expect(RATE_LIMIT_MESSAGES.daily).toMatch(/내일/)
  })

  it('전부 사람 말이다 (B2·B4) — 내부 명사도 HTTP 코드도 없다', () => {
    for (const message of Object.values(RATE_LIMIT_MESSAGES)) {
      expect(message).not.toMatch(/429|quota|llm|gemini|api|token|어댑터|스펙|컴파일/i)
    }
  })
})
