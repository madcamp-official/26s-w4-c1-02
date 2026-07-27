// 발송 채널 추상화 (기획서 9-4 · P7 · ADR A11 · G3 판정 조건)
//
//   "채널을 처음부터 인터페이스로 뺀다. 웹훅과 이메일이 같은 '무엇을 보낼지' 로직을 공유하고,
//    다른 건 '어떻게 보낼지' 뿐이다. 이렇게 하면 P7의 '웹훅 먼저, 이메일 이어서'가
//    새 기능이 아니라 구현체 하나 추가가 된다."
//
// G3 트랙 B 판정 조건에 "발송 채널이 인터페이스로 추상화되어 있다 (이메일 구현체를 추가할
// 자리가 비어 있다)" 가 **명시돼 있다.** 그래서 이 파일이 먼저 있고 구현체가 나중이다.

import type { ApiItem, SubscriptionChannel } from '@endpointer/core'

/** 무엇을 보낼지 — 채널이 달라도 이건 같다 */
export interface DeliveryPayload {
  collection: {
    slug: string
    name: string
    /** 공개 주소. 웹훅 수신자가 원문을 보러 갈 수 있게 */
    url: string
  }
  /** 이번에 보낼 아이템. **신규만** 들어온다 (ADR A13) */
  items: ApiItem[]
  /** 사람이 읽는 한 줄. 이메일 제목·웹훅 메시지에 쓴다 */
  summary: string
  sent_at: string
}

export type DeliveryOutcome =
  | { ok: true; detail: string }
  | {
      ok: false
      /** 다시 시도할 만한 실패인지 (5xx·타임아웃) vs 영구 실패인지 (주소가 틀림) */
      retryable: boolean
      /** 사용자에게 보여줄 문구. 내부 용어·HTTP 코드 금지 (보장선 B4) */
      message: string
    }

/**
 * 채널 하나. 이 인터페이스를 구현하면 새 채널이 붙는다.
 * 여기에 "무엇을 보낼지" 를 넣지 않는 것이 이 설계의 전부다.
 */
export interface Deliverer {
  readonly channel: SubscriptionChannel
  /** 설정이 갖춰져 있는지 (이메일은 API 키가 있어야 한다). 없으면 발송하지 않고 상태로 남긴다 */
  isConfigured(): boolean
  /** target 은 웹훅 URL 또는 이메일 주소 */
  deliver(target: string, payload: DeliveryPayload): Promise<DeliveryOutcome>
}

const registry = new Map<SubscriptionChannel, Deliverer>()

export function registerDeliverer(deliverer: Deliverer): void {
  registry.set(deliverer.channel, deliverer)
}

export function getDeliverer(channel: SubscriptionChannel): Deliverer | null {
  return registry.get(channel) ?? null
}

export function registeredChannels(): SubscriptionChannel[] {
  return [...registry.keys()]
}
