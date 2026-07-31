// 웹훅 발송 — 의존성 0 (기획서 9-4 · P7 "웹훅 먼저")
//
// fetch POST 로 JSON 을 보낸다. 그게 전부다. 이메일과 달리 발송 도메인·SPF·DKIM 이 없어서
// 오늘 바로 동작한다. 그래서 이게 먼저다.
//
// **여기도 사용자가 준 주소로 서버가 나간다.** 수집과 다른 점은 본문까지 실어 보낸다는 것이라,
// 막지 않으면 내부망을 두드리는 데 그치지 않고 수집한 내용을 내부 주소로 보내게 된다.

import { childLogger } from '../../logger'
import { checkOutboundUrl } from '../../fetchers/guard'
import { guardedDispatcher } from '../../fetchers/guarded-dispatcher'
import type { Deliverer, DeliveryOutcome, DeliveryPayload } from './index'

const log = childLogger({ mod: 'deliver:webhook' })

const TIMEOUT_MS = 10_000

// ── 디스코드 웹훅 특례 ──────────────────────────────────────────────────
// 디스코드는 자기 형식({"content": ...})이 아니면 400 으로 거절한다 — 우리 JSON 을
// 그대로 보내면 알림이 조용히 증발한다 (리허설 실측). 주소가 디스코드면 형식을 맞춰준다.
// 다른 수신자(자체 서버·Zapier 등)는 기존 그대로 우리 페이로드를 받는다.

const DISCORD_HOSTS = new Set(['discord.com', 'discordapp.com', 'ptb.discord.com', 'canary.discord.com'])

function isDiscordWebhook(url: URL): boolean {
  return DISCORD_HOSTS.has(url.hostname) && url.pathname.startsWith('/api/webhooks/')
}

/** 항목의 "부르는 이름" — title 우선, 없으면 첫 텍스트 값 (스키마가 표마다 다르므로) */
function itemTitle(item: Record<string, unknown>): string {
  const t = item['title']
  if (typeof t === 'string' && t.trim() !== '') return t.trim()
  for (const [key, value] of Object.entries(item)) {
    if (key.startsWith('_') || key === 'link') continue
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return '새 항목'
}

/** 디스코드 메시지 본문 — summary 한 줄 + 항목 몇 개 + 컬렉션 주소. 2000자 제한 준수 */
function discordBody(payload: DeliveryPayload): string {
  const MAX_ITEMS = 5
  const lines = payload.items.slice(0, MAX_ITEMS).map((raw) => {
    const item = raw as unknown as Record<string, unknown>
    const link =
      typeof item['_link'] === 'string' ? item['_link'] : typeof item['link'] === 'string' ? item['link'] : null
    return link === null ? `• ${itemTitle(item)}` : `• ${itemTitle(item)}\n  ${link}`
  })
  const parts = [`**${payload.summary}**`, ...lines]
  const rest = payload.items.length - MAX_ITEMS
  if (rest > 0) parts.push(`…외 ${rest}건`)
  parts.push(payload.collection.url)
  return JSON.stringify({ content: parts.join('\n').slice(0, 1990) })
}

export const webhookDeliverer: Deliverer = {
  channel: 'webhook',

  isConfigured(): boolean {
    // 웹훅은 사용자가 준 주소 하나면 끝이다. 서버 쪽 설정이 필요 없다.
    return true
  },

  async deliver(target: string, payload: DeliveryPayload): Promise<DeliveryOutcome> {
    const checked = await checkOutboundUrl(target)
    if (!checked.ok) {
      // 주소가 잘못된 것이므로 다시 보내도 같다
      return { ok: false, retryable: false, message: '이 주소로는 보낼 수 없어요. 주소를 확인해 주세요.' }
    }
    const url = checked.url

    try {
      const init: RequestInit = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'endpointer-webhook/0.1',
          // 수신자가 어느 컬렉션인지 본문을 열지 않고도 알 수 있게
          'X-Endpointer-Collection': payload.collection.slug,
        },
        body: isDiscordWebhook(url) ? discordBody(payload) : JSON.stringify(payload),
        // 따라가지 않는다. 확인한 주소가 아닌 곳으로 본문이 가면 안 된다.
        // 수집(`fetchers/http.ts`)은 홉마다 다시 확인하며 따라가지만, 발송은 그럴 이유가 없다 —
        // 받는 주소는 사용자가 직접 적은 것이라 넘길 일이 있으면 제대로 적으면 된다.
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }
      // 접속 직전 이름 풀기까지 관문을 건다 (ADR A41). 발송은 본문을 실어 보내므로
      // 리바인딩이 뚫리면 수집한 내용이 내부 주소로 새어 나간다 — 여기가 더 위험하다.
      ;(init as { dispatcher?: unknown }).dispatcher = guardedDispatcher()
      const res = await fetch(url, init)

      if (res.status >= 300 && res.status < 400) {
        return { ok: false, retryable: false, message: '받는 쪽이 다른 주소로 넘기고 있어요. 주소를 확인해 주세요.' }
      }

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
