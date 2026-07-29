// 공개 주소. core 의 env 프록시를 쓰지 않는 이유는 그쪽이 DATABASE_URL 을 함께 검증하기
// 때문이다 — 주소 한 줄 읽으려다 .env 가 빈 상태에서 화면이 통째로 죽으면 안 된다.

const trimSlash = (value: string): string => value.replace(/\/+$/, '')

export const PUBLIC_API_BASE_URL: string = trimSlash(
  process.env['PUBLIC_API_BASE_URL']?.trim() || 'http://localhost:3000/api/v1',
)

export const PUBLIC_MCP_BASE_URL: string = trimSlash(
  process.env['PUBLIC_MCP_BASE_URL']?.trim() || 'http://localhost:3002',
)

/** 화면 자신의 공개 주소 — 초대 링크가 이 위에 만들어진다. 배포에서는 AUTH_URL 이 곧 APP_DOMAIN 이다 */
export const PUBLIC_APP_BASE_URL: string = trimSlash(
  process.env['AUTH_URL']?.trim() || 'http://localhost:3000',
)

/** 초대 링크 한 줄 (ADR A40) — 만든 직후 한 번만 보인다 */
export function inviteUrlFor(token: string): string {
  return `${PUBLIC_APP_BASE_URL}/invite/${token}`
}

/** `GET {여기}` 로 그대로 붙여 쓸 수 있는 한 줄 */
export function apiUrlFor(slug: string): string {
  return `${PUBLIC_API_BASE_URL}/${slug}`
}

/** 커넥터 설정에 붙여넣는 한 줄 (보장선 B7) */
export function mcpUrlFor(slug: string): string {
  return `${PUBLIC_MCP_BASE_URL}/${slug}`
}

/**
 * 사용자가 붙여넣은 주소를 살펴볼 수 있는 형태로. 못 읽으면 null (부르는 쪽이 사람 문장을 낸다 · B4).
 *
 * 생짜 공백 뒤를 버리는 것이 핵심이다. 주소창에서 복사한 주소에는 공백이 이미 인코딩돼
 * 들어오므로, 공백이 남아 있다는 건 붙여넣다 옆 글자까지 딸려온 것이다. 그냥 두면
 * `new URL` 이 `%20` 으로 감싸 **엉뚱한 주소를 조용히 살펴본다** — 화면은 "목록을 못 찾았어요"
 * 라고만 말하므로 사용자는 자기 주소가 바뀐 줄 모른다 (실제로 칩의 ✕ 가 딸려 들어온 적이 있다).
 */
export function normalizeEntryUrl(raw: string): string | null {
  const trimmed = raw.trim().split(/\s/)[0] ?? ''
  if (trimmed === '') return null

  // `file://` · `ftp://` 처럼 다른 스킴이면 여기서 끝낸다. 앞에 https:// 를 덧붙이면
  // `https://file///etc/passwd` 같은 엉터리 주소가 되어, 못 읽는다는 말 대신 헛다리를 짚는다.
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(trimmed)
  if (scheme !== null && scheme[1] !== undefined) {
    const named = scheme[1].toLowerCase()
    if (named !== 'http' && named !== 'https') return null
  }

  try {
    const url = new URL(scheme !== null ? trimmed : `https://${trimmed}`)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}
