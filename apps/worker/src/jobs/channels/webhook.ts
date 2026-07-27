// 웹훅 발송 — 의존성 0 (기획서 9-4 · P7 "웹훅 먼저")
//
// fetch POST 로 JSON 을 보낸다. 그게 전부다. 이메일과 달리 발송 도메인·SPF·DKIM 이 없어서
// 오늘 바로 동작한다. 그래서 이게 먼저다.

import { childLogger } from '../../logger'
import type { Deliverer, DeliveryOutcome, DeliveryPayload } from './index'

const log = childLogger({ mod: 'deliver:webhook' })

const TIMEOUT_MS = 10_000

export const webhookDeliverer: Deliverer = {
  channel: 'webhook',

  isConfigured(): boolean {
    // 웹훅은 사용자가 준 주소 하나면 끝이다. 서버 쪽 설정이 필요 없다.
    return true
  },

  async deliver(target: string, payload: DeliveryPayload): Promise<DeliveryOutcome> {
    let url: URL
    try {
      url = new URL(target)
    } catch {
      return { ok: false, retryable: false, message: '보낼 주소를 읽을 수 없어요.' }
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return { ok: false, retryable: false, message: '보낼 주소가 웹 주소가 아니에요.' }
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'endpointer-webhook/0.1',
          // 수신자가 어느 컬렉션인지 본문을 열지 않고도 알 수 있게
          'X-Endpointer-Collection': payload.collection.slug,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })

      if (res.ok) {
        log.info({ host: url.host, items: payload.items.length }, '웹훅 발송')
        return { ok: true, detail: `${url.host} 로 ${payload.items.length}건` }
      }

      // 4xx 는 받는 쪽 설정 문제라 다시 보내도 같다. 5xx 만 재시도한다.
      const retryable = res.status >= 500
      return {
        ok: false,
        retryable,
        message: retryable
          ? '받는 쪽이 지금 응답하지 않아요. 잠시 뒤 다시 보낼게요.'
          : '받는 쪽에서 이 알림을 받지 못했어요. 주소를 확인해 주세요.',
      }
    } catch (e) {
      const timeout = e instanceof Error && e.name === 'TimeoutError'
      return {
        ok: false,
        retryable: true,
        message: timeout ? '받는 쪽 응답이 너무 늦어요.' : '받는 쪽에 연결하지 못했어요.',
      }
    }
  },
}
