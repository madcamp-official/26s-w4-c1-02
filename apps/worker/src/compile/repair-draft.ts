// LLM 이 낸 스펙 초안의 **기계적 표기 실수**를 검증 전에 교정한다.
//
// 왜 있나: gemini-*-lite 급 모델이 브라우저 경로 사이트에서 두 가지 실수를 거의 매번 낸다 —
//   ① wait_for 에 'css:' 접두사를 빼먹는다 ('div.list > ul')
//   ② pagination 을 page_param 으로 내면서 fetch.url 에 {page} 자리표시자를 안 넣는다
// 재생성(2회)으로는 같은 실수가 반복돼 생성 자체가 죽는다 — 실측: wevity·bizinfo·korea.kr 전멸.
//
// 이것은 닫힌 연산자 집합을 넓히는 것이 아니다 (원칙 ② · ADR A2 그대로).
// 교정하는 것은 **의미가 하나로 확정되는 표기**뿐이고, 결과는 반드시 기존 관문
// (parseDiscoveryOutput → validateSpec)을 다시 통과한다. 여기서 못 고치는 것은
// 손대지 않고 그대로 관문에 넘겨 원래 실패 문장이 나오게 둔다.

const FENCE = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/

function tryParse(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim()
  const body = FENCE.exec(trimmed)?.[1] ?? trimmed
  try {
    const parsed: unknown = JSON.parse(body)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 정규식 메타문자를 이스케이프한다 (param 이름을 패턴에 넣을 때) */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 스펙 초안(문자열 또는 객체)을 받아 교정된 객체를 돌려준다.
 * JSON 이 아니거나 형태가 다르면 **원본을 그대로** 돌려준다 — 실패 경로를 바꾸지 않는다.
 */
export function repairSpecDraft(raw: unknown): unknown {
  const draft = typeof raw === 'string' ? tryParse(raw) : isRecord(raw) ? raw : null
  if (draft === null) return raw

  const fetch = draft.fetch
  if (!isRecord(fetch)) return draft

  // ① browser 모드의 wait_for — 'networkidle' 도 'css:' 도 아닌 문자열이면 CSS 선택자로 쓴 것이다
  if (
    fetch.mode === 'browser' &&
    typeof fetch.wait_for === 'string' &&
    fetch.wait_for !== 'networkidle' &&
    !fetch.wait_for.startsWith('css:')
  ) {
    fetch.wait_for = `css:${fetch.wait_for}`
  }

  // ② page_param 인데 URL 에 {page} 가 없다 — param 이름을 알면 자리표시자를 복원할 수 있다
  const pagination = draft.pagination
  if (
    isRecord(pagination) &&
    pagination.kind === 'page_param' &&
    typeof fetch.url === 'string' &&
    !fetch.url.includes('{page}')
  ) {
    const param = typeof pagination.param === 'string' ? pagination.param.trim() : ''
    if (param === '') {
      // 어느 파라미터인지 모르면 페이지를 넘기지 않는 게 정직하다
      draft.pagination = { kind: 'none' }
    } else {
      const pattern = new RegExp(`([?&]${escapeRegExp(param)}=)[^&#]*`)
      fetch.url = pattern.test(fetch.url)
        ? // URL 에 이미 그 파라미터가 있으면 값만 {page} 로 바꾼다 (?page=1 → ?page={page})
          fetch.url.replace(pattern, '$1{page}')
        : // 없으면 붙인다
          `${fetch.url}${fetch.url.includes('?') ? '&' : '?'}${param}={page}`
    }
  }

  return draft
}
