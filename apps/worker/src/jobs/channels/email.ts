// 이메일 발송 — **자리만 잡아둔 구현체** (기획서 P7 · ADR A11 · G3 판정 조건)
//
// G3 트랙 B 판정 조건: "발송 채널이 인터페이스로 추상화되어 있다
// (이메일 구현체를 추가할 자리가 비어 있다)". 그 자리가 이 파일이다.
//
// ── 왜 웹훅보다 늦나 ────────────────────────────────────────────────────
// 웹훅은 사용자가 준 주소 하나면 끝이다. 이메일은 발송 도메인·SPF·DKIM 검증이 필요하고
// 그건 코드가 아니라 DNS 작업이라 5일 안에 확실히 끝난다는 보장이 없다. 그래서 P7 은
// "웹훅 먼저, 이메일 이어서" 로 쪼개져 있고 `.env.example` 도 "이메일은 G4 에서 붙인다" 라고 적혀 있다.
//
// ── 지금 하는 일 ────────────────────────────────────────────────────────
// 등록은 된다. 다만 `isConfigured()` 가 false 라 발송 잡이 채널을 못 찾고 조용히 넘어간다
// (`deliver.ts` 의 `channel_unavailable`). 죽지 않는 것이 요점이다 — 이메일 키가 없다고
// 웹훅 구독까지 멈추면 안 된다 (원칙 ④).
//
// TODO(G4): Resend 로 실제 발송. HTML 템플릿은 payload.items 를 표로 그린다.
//   1. `resend` 패키지 추가 (또는 fetch 로 https://api.resend.com/emails 직접 호출 — 의존 0)
//   2. 제목은 payload.summary 그대로. 본문은 항목 제목 + 마감일 + 원문 링크.
//   3. 수신 거부 링크가 없으면 스팸으로 분류된다. 구독 해지 경로를 반드시 넣어라.

import { getConfig } from '../../config'
import type { Deliverer, DeliveryOutcome, DeliveryPayload } from './index'

export const emailDeliverer: Deliverer = {
  channel: 'email',

  isConfigured(): boolean {
    const cfg = getConfig()
    // 보내는 주소가 없으면 Resend 가 받아주지 않는다. 둘 다 있어야 켜진 것으로 본다.
    return cfg.resendApiKey !== undefined && cfg.subscriptionFromEmail !== undefined
  },

  async deliver(_target: string, _payload: DeliveryPayload): Promise<DeliveryOutcome> {
    // TODO(G4): Resend 호출. 지금은 "설정이 안 됐다" 와 구분되는 상태로만 돌려준다.
    return {
      ok: false,
      // 코드가 없어서 못 보내는 것이지 받는 쪽 문제가 아니다. 재시도해도 같다.
      retryable: false,
      message: '메일로 보내는 기능은 아직 준비 중이에요. 지금은 웹훅으로만 보낼 수 있습니다.',
    }
  },
}
