// 채널의 신원 (A36 · 계약 §4-b)
//
// dedupe 의 키는 채널 **행**이 아니라 목적지다 — 같은 슬랙 URL 이 구독 두 행으로
// 등록돼 있어도 항목당 사건당 1회만 가야 한다. 해시를 쓰는 이유는 두 가지:
// 키가 notification_log 에 남는데 웹훅 URL 은 자격증명에 준하고(델타 9-3),
// target 이 아무리 길어도 키 길이가 일정해야 하기 때문이다.
//
// db 를 모르는 순수 모듈이다 — evaluate-views 와 테스트가 같이 쓴다.

import { hashString } from '@endpointer/core/spec'

export function channelKeyOf(channel: string, target: string): string {
  return `${channel}:${hashString(`${channel}|${target.trim().toLowerCase()}`)}`
}
