// 공개 주소. core 의 env 프록시를 쓰지 않는 이유는 그쪽이 DATABASE_URL 을 함께 검증하기
// 때문이다 — 주소 한 줄 읽으려다 .env 가 빈 상태에서 화면이 통째로 죽으면 안 된다.

const trimSlash = (value: string): string => value.replace(/\/+$/, '')

export const PUBLIC_API_BASE_URL: string = trimSlash(
  process.env['PUBLIC_API_BASE_URL']?.trim() || 'http://localhost:3000/api/v1',
)

export const PUBLIC_MCP_BASE_URL: string = trimSlash(
  process.env['PUBLIC_MCP_BASE_URL']?.trim() || 'http://localhost:3002',
)

/** `GET {여기}` 로 그대로 붙여 쓸 수 있는 한 줄 */
export function apiUrlFor(slug: string): string {
  return `${PUBLIC_API_BASE_URL}/${slug}`
}

/** 커넥터 설정에 붙여넣는 한 줄 (보장선 B7) */
export function mcpUrlFor(slug: string): string {
  return `${PUBLIC_MCP_BASE_URL}/${slug}`
}
