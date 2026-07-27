// LLM 호출 예산 — Redis 카운터 (기획서 15장)
//
// 로컬 Redis(docker) 가 떠 있으면 진짜 Redis 경로를 탄다. 스코프 id 를 매번 새로 만들어
// 개발 중인 실제 카운터를 건드리지 않는다. Redis 가 없으면 메모리 폴백 경로를 타는데,
// 의미는 같으므로 테스트도 같다 (폴백의 존재 이유 — 원칙 ④).

import { describe, expect, it } from 'vitest'

import { consumeBudget, peekBudget } from './budget'

/** 테스트마다 다른 계정 — 실제 카운터·다른 테스트와 안 섞이게 */
const freshScope = () =>
  ({ kind: 'heal', source_id: `test-${Date.now()}-${Math.random().toString(36).slice(2)}` }) as const

describe('consumeBudget', () => {
  it('상한까지 허용하고 그다음부터 거절한다', async () => {
    const scope = freshScope()
    const limit = (await peekBudget(scope)).limit

    for (let i = 1; i <= limit; i += 1) {
      const v = await consumeBudget(scope)
      expect(v.allowed).toBe(true)
      expect(v.used).toBe(i)
    }
    const over = await consumeBudget(scope)
    expect(over.allowed).toBe(false)
    expect(over.message).not.toBeNull()
  })

  it('거절 문구는 사람 말이다 (B2·B4) — 내부 명사가 없다', async () => {
    const scope = freshScope()
    const limit = (await peekBudget(scope)).limit
    for (let i = 0; i <= limit; i += 1) await consumeBudget(scope)

    const over = await consumeBudget(scope)
    expect(over.message).not.toMatch(/budget|quota|llm|gemini|adapter|heal/i)
  })

  it('계정이 다르면 서로의 상한을 갉아먹지 않는다', async () => {
    const a = freshScope()
    const b = freshScope()
    await consumeBudget(a)
    expect((await peekBudget(b)).used).toBe(0)
  })
})

describe('peekBudget', () => {
  it('보기만 하고 쓰지 않는다', async () => {
    const scope = freshScope()
    await consumeBudget(scope)
    await peekBudget(scope)
    await peekBudget(scope)
    expect((await peekBudget(scope)).used).toBe(1)
  })
})
