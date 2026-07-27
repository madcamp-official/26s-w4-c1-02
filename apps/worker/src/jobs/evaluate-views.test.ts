// 채널의 신원 (A36 · 계약 §4-b) — dedupe 의 키가 흔들리면 안전판이 전부 무너진다.
// 무거운 의미론(차집합·재진입·24시간)은 views CLI 실측으로 판정했다 (gates.md G3(A)).

import { describe, expect, it } from 'vitest'

import { channelKeyOf } from './channel-key'

describe('channelKeyOf', () => {
  it('같은 목적지는 같은 키 — 행이 두 개라도 사건당 1회의 근거', () => {
    expect(channelKeyOf('webhook', 'https://hooks.slack.com/x')).toBe(
      channelKeyOf('webhook', 'https://hooks.slack.com/x'),
    )
  })

  it('공백·대소문자가 달라도 같은 목적지다', () => {
    expect(channelKeyOf('webhook', ' https://Hooks.Slack.com/X ')).toBe(
      channelKeyOf('webhook', 'https://hooks.slack.com/x'),
    )
  })

  it('종류가 다르면 다른 채널이다 — 같은 주소라도 웹훅과 메일은 별개', () => {
    expect(channelKeyOf('webhook', 'a@b.com')).not.toBe(channelKeyOf('email', 'a@b.com'))
  })

  it('키에 목적지 원문이 들어가지 않는다 — 로그에 남는 값이라 주소를 노출하면 안 된다', () => {
    const key = channelKeyOf('webhook', 'https://hooks.slack.com/services/SECRET')
    expect(key).not.toContain('SECRET')
    expect(key).not.toContain('slack.com')
  })
})
