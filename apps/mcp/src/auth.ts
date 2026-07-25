// 컬렉션 접근 판정 — 기획서 12장 "인증" 한 문단의 구현체
//
//   private   → `Authorization: Bearer {api_key}` 필수
//   unlisted  → 추측 불가 slug 만으로 접근 (무인증)
//   public    → 무인증
//
// ── web 과 갈라지면 안 된다 ─────────────────────────────────────────────
// 같은 판정이 web 의 `GET /api/v1/{slug}` 에도 있어야 한다. 지금 core 에 공용
// 구현이 없어서 여기에 짰다. **아래 `decideAccess` 가 그 판정의 전부이고, web 은
// 반드시 같은 규칙이어야 한다** — 한쪽만 고치면 "내 API 하나" 라는 약속이 깨진다.
//
// TODO(G1): 이 파일의 `hashApiKey` · `decideAccess` 를 core 로 올리고
//   (`packages/core/src/auth/collection-access.ts` 정도) web·mcp 가 그것을 import 하게 바꿔라.
//   그때까지 web 쪽에 같은 규칙이 복제돼 있어야 하며, 이 주석이 그 사실의 기록이다.

import { createHash, timingSafeEqual } from 'node:crypto'

import type { Db } from '@endpointer/core/db'
import type { ApiErrorCode, CollectionSchemaJson, Visibility } from '@endpointer/core'

/** 응답을 만드는 데 실제로 필요한 컬렉션 정보. `collections` 행의 부분집합 */
export interface AccessibleCollection {
  id: string
  slug: string
  name: string
  schema_json: CollectionSchemaJson
  schema_version: number
  visibility: Visibility
  api_key_hash: string | null
}

export type AccessGrant =
  | { ok: true; collection: AccessibleCollection }
  | { ok: false; code: Extract<ApiErrorCode, 'not_found' | 'unauthorized'>; message: string }

/** slug 규약 — URL 과 API 경로에 그대로 들어간다 (기획서 10장 `collections.slug`) */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug)
}

// ── 키 (순수) ────────────────────────────────────────────────────────────

/**
 * API 키는 사람이 고른 비밀번호가 아니라 **서버가 만든 고엔트로피 난수**다.
 * 그래서 bcrypt/argon2 같은 느린 해시가 필요 없다 — 그건 저엔트로피 입력의
 * 사전 공격을 늦추려는 장치다. 대신 매 요청마다 도는 경로이므로 빠른 SHA-256 을 쓰고,
 * 비교는 타이밍 안전하게 한다.
 *
 * **web 의 키 발급 코드도 반드시 이 함수와 같은 방식으로 해시해야 한다.**
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex')
}

/** 길이가 다르면 timingSafeEqual 이 던지므로 먼저 거른다 */
export function apiKeyMatches(presented: string | null, storedHash: string | null): boolean {
  if (!presented || !storedHash) return false
  const a = Buffer.from(hashApiKey(presented), 'hex')
  const b = Buffer.from(storedHash.trim().toLowerCase(), 'hex')
  if (a.length === 0 || a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * `Authorization: Bearer xxx` 에서 키를 꺼낸다. 다른 스킴이면 null.
 * 헤더가 배열로 오는 경우(중복 헤더)는 첫 번째만 본다.
 */
export function bearerToken(header: string | string[] | undefined): string | null {
  const raw = Array.isArray(header) ? header[0] : header
  if (typeof raw !== 'string') return null
  const m = /^Bearer[ \t]+(.+)$/i.exec(raw.trim())
  const token = m?.[1]?.trim()
  return token ? token : null
}

/**
 * 커넥터 대부분이 헤더 입력 칸 없이 **주소 한 줄**만 받는다. 보장선 B7 이 그 한 줄로
 * 끝나야 한다고 못박았으므로 `?key=` 도 헤더와 동등하게 받는다 (connect-string.ts 참조).
 */
export const KEY_QUERY_PARAM = 'key'

export function presentedKeyFrom(input: {
  authorization?: string | string[] | undefined
  queryKey?: string | string[] | undefined
}): string | null {
  const fromHeader = bearerToken(input.authorization)
  if (fromHeader) return fromHeader
  const raw = Array.isArray(input.queryKey) ? input.queryKey[0] : input.queryKey
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null
}

// ── 판정 (순수 · 여기가 web 과 맞춰야 하는 규칙 전부) ────────────────────

/**
 * 문구는 사용자의 AI 가 그대로 읽어서 사람에게 옮긴다. 한국어이고 내부 명사를 쓰지 않는다
 * (보장선 B2·B4). HTTP 코드나 원인 추적 문자열을 넣지 마라.
 */
export function decideAccess(
  collection: AccessibleCollection | null | undefined,
  presentedKey: string | null,
): AccessGrant {
  if (!collection) {
    return { ok: false, code: 'not_found', message: '그런 주소의 컬렉션을 찾지 못했습니다.' }
  }

  switch (collection.visibility) {
    case 'public':
    case 'unlisted':
      // unlisted 는 "추측 불가 slug 자체가 열쇠" 다 (기획서 12장). 키를 더 요구하지 않는다.
      return { ok: true, collection }
    case 'private': {
      if (!collection.api_key_hash) {
        // 비공개인데 열쇠가 없다 = 아직 아무도 못 연다. 존재를 흘리지 않는 쪽이 맞다.
        return { ok: false, code: 'not_found', message: '그런 주소의 컬렉션을 찾지 못했습니다.' }
      }
      if (!presentedKey) {
        return {
          ok: false,
          code: 'unauthorized',
          message: '비공개 컬렉션입니다. 컬렉션 화면의 "AI에 연결"에서 받은 주소를 그대로 써 주세요.',
        }
      }
      if (!apiKeyMatches(presentedKey, collection.api_key_hash)) {
        return {
          ok: false,
          code: 'unauthorized',
          message: '연결 주소가 맞지 않습니다. 컬렉션 화면에서 주소를 다시 복사해 주세요.',
        }
      }
      return { ok: true, collection }
    }
    default:
      // Visibility 가 늘어났는데 여기를 안 고쳤다는 뜻. 열어주지 않는 쪽으로 실패한다.
      return { ok: false, code: 'not_found', message: '그런 주소의 컬렉션을 찾지 못했습니다.' }
  }
}

// ── 조회 ─────────────────────────────────────────────────────────────────

const ACCESS_COLUMNS = {
  id: true,
  slug: true,
  name: true,
  schema_json: true,
  schema_version: true,
  visibility: true,
  api_key_hash: true,
} as const

/** slug 로 컬렉션을 찾고 위 규칙으로 접근을 판정한다. 여기서 throw 하지 않는다 */
export async function resolveCollectionAccess(
  db: Db,
  slug: string,
  presentedKey: string | null,
): Promise<AccessGrant> {
  if (!isValidSlug(slug)) {
    return { ok: false, code: 'not_found', message: '그런 주소의 컬렉션을 찾지 못했습니다.' }
  }

  const row = await db.query.collections.findFirst({
    where: (c, { eq }) => eq(c.slug, slug),
    columns: ACCESS_COLUMNS,
  })

  return decideAccess(row ?? null, presentedKey)
}
