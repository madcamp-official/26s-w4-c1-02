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
