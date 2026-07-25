// "AI에 연결" 한 줄 — 보장선 B7 의 구현체
//
//   B7: MCP 연결은 **주소 한 줄 복사 → 커넥터에 붙여넣기**로 끝난다.
//       설정 JSON 편집이나 로컬 설치를 요구하면 위반.
//
// ── 왜 "URL 한 줄" 이고 왜 키가 URL 안에 들어가나 ────────────────────────
// 지금 커넥터들이 실제로 받아들이는 입력을 보면 갈래가 둘이다.
//
//   (가) 주소 칸 하나만 있는 것 — Claude·ChatGPT 의 커스텀 커넥터 추가 창처럼
//        원격 서버 URL 을 붙여넣으면 끝. 헤더를 손으로 넣는 칸이 없거나 접혀 있다.
//   (나) 설정 파일(`mcp.json` 류)을 직접 여는 것 — 편집기 계열. 여기서는 헤더도 쓸 수 있다.
//
// (나)는 B7 이 명시적으로 금지한 경로다. 그러므로 **기본형은 (가)에서 통하는 형태**여야
// 하고, (가)에서 통하는 유일한 단위는 URL 문자열 하나다. 따라서 키가 필요한 컬렉션은
// 키를 URL 안에 실어야 한 줄이 성립한다 (`?key=…`, auth.ts 의 KEY_QUERY_PARAM).
//
// 이 선택의 대가는 분명하다 — 질의 문자열은 접근 로그·프록시·브라우저 기록에 남는다.
// 그래서 세 가지로 완충한다:
//   1. 기본 공개 범위를 `unlisted` 로 둔다. 추측 불가 slug 자체가 열쇠이므로
//      **한 줄에 비밀이 아예 안 들어간다.** 이게 권장 경로다.
//   2. `private` 일 때만 `?key=` 를 붙인다.
//   3. 헤더를 지원하는 커넥터를 위해 `authorizationHeader` 를 같이 돌려준다.
//      화면에서는 접어 두고, 펼치면 보인다 (보장선 B5).
//
// TODO(G4): 커넥터의 OAuth 흐름(MCP Authorization spec)을 붙이면 `?key=` 는 없앨 수 있다.
//   5일 범위 밖이라 지금은 위 완충으로 간다.

import type { Visibility } from '@endpointer/core'

import { KEY_QUERY_PARAM } from './auth'

/** `PUBLIC_MCP_BASE_URL` 이 없을 때의 로컬 기본값 (.env.example 과 같은 값) */
export const DEFAULT_MCP_BASE_URL = 'http://localhost:3002'

/** `https://mcp.example.com/{collection}` — 기획서 12장 */
export function mcpUrlFor(slug: string, baseUrl: string = DEFAULT_MCP_BASE_URL): string {
  const base = baseUrl.replace(/\/+$/, '')
  return `${base}/${encodeURIComponent(slug)}`
}

export interface ConnectString {
  /** 커넥터의 주소 칸에 그대로 붙여넣는 한 줄. 클립보드에 들어가는 것이 이것이다 */
  url: string
  /** 키 없는 순수 주소. 화면에 보여줄 때(스크린샷·공유) 이쪽을 쓴다 */
  bareUrl: string
  /** 이 컬렉션이 키를 요구하는가 (= visibility 가 private) */
  requiresKey: boolean
  /** 키가 필요한데 아직 발급이 안 된 상태. 화면은 "연결" 버튼 대신 안내를 띄운다 */
  keyMissing: boolean
  /** 헤더를 지원하는 커넥터용. 기본은 접어 둔다 (B5). 필요 없으면 null */
  authorizationHeader: string | null
  /** 붙여넣기 안내 한 장. 한 줄씩 그대로 화면에 뿌린다 (한국어 · 내부 명사 없음) */
  guide: string[]
}

export interface ConnectStringInput {
  slug: string
  visibility: Visibility
  /**
   * 평문 API 키. **발급 직후 한 번만 손에 들어온다** — DB 에는 해시만 있으므로
   * 나중에 다시 만들어 줄 수 없다. private 컬렉션에서 이 값이 없으면 keyMissing 이 된다.
   */
  apiKey?: string | null
  /** 없으면 `PUBLIC_MCP_BASE_URL` 기본값 */
  baseUrl?: string
}

/**
 * 컬렉션 하나에 대한 "커넥터에 붙여넣을 한 줄".
 * web 의 "AI에 연결" 버튼이 이 함수의 `url` 을 클립보드에 넣고 `guide` 를 띄운다.
 */
export function buildConnectString(input: ConnectStringInput): ConnectString {
  const baseUrl = input.baseUrl ?? DEFAULT_MCP_BASE_URL
  const bareUrl = mcpUrlFor(input.slug, baseUrl)

  const requiresKey = input.visibility === 'private'
  const key = input.apiKey?.trim() ?? ''
  const keyMissing = requiresKey && key === ''

  const url = requiresKey && key !== '' ? `${bareUrl}?${KEY_QUERY_PARAM}=${encodeURIComponent(key)}` : bareUrl

  return {
    url,
    bareUrl,
    requiresKey,
    keyMissing,
    authorizationHeader: requiresKey && key !== '' ? `Authorization: Bearer ${key}` : null,
    guide: buildGuide({ requiresKey, keyMissing, visibility: input.visibility }),
  }
}

function buildGuide(o: { requiresKey: boolean; keyMissing: boolean; visibility: Visibility }): string[] {
  if (o.keyMissing) {
    return [
      '이 컬렉션은 나만 볼 수 있게 되어 있어서 연결 주소를 새로 만들어야 합니다.',
      '컬렉션 설정에서 연결 주소를 다시 만든 뒤 복사해 주세요.',
    ]
  }

  const lines = [
    '복사한 주소를 쓰는 AI 앱의 커넥터 추가 화면에 붙여넣으세요.',
    '연결되면 "이번 주 마감 뭐 있어?" 처럼 평소 말투로 물어보면 됩니다.',
  ]

  if (o.requiresKey) {
    // 비밀이 한 줄 안에 들어 있다는 사실을 숨기지 않는다. 숨기면 사용자가 아무 데나 붙여넣는다.
    lines.push('이 주소에는 나만 쓸 수 있는 열쇠가 들어 있습니다. 다른 사람에게 보내지 마세요.')
  } else if (o.visibility === 'unlisted') {
    lines.push('이 주소를 아는 사람은 누구나 볼 수 있습니다. 공개해도 괜찮은 내용인지 한 번만 확인해 주세요.')
  }

  return lines
}
