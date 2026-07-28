// 화면 접근 판정 (ADR A40) — 사실(주인인가·멤버인가)은 여기서 조회하고,
// 판정 규칙 자체는 core 의 canViewCollection/canManageCollection 이 정한다.
//
// 화면은 주인과 멤버만 연다. visibility 는 REST·MCP 의 공개 범위이지 화면 열쇠가 아니다 —
// 이 구분이 없던 것이 "slug 만 알면 남의 컬렉션 화면이 열리던" 구멍이다.

import { canManageCollection, canViewCollection, type MemberRole } from '@endpointer/core'

import { currentUser, isAuthReady } from '@/auth'

import { safeQuery } from './db'

export interface CollectionAccess {
  userId: string | null
  isOwner: boolean
  memberRole: MemberRole | null
  canView: boolean
  canManage: boolean
}

const CLOSED: CollectionAccess = {
  userId: null,
  isOwner: false,
  memberRole: null,
  canView: false,
  canManage: false,
}

/** 로그인 설정 전(데모)에는 주인으로 취급한다 — actions.ts 의 ownedCollection 과 같은 관례 */
export async function resolveCollectionAccess(collection: {
  id: string
  owner_id: string
}): Promise<CollectionAccess> {
  if (!isAuthReady) {
    return { userId: null, isOwner: true, memberRole: null, canView: true, canManage: true }
  }

  const user = await currentUser()
  if (user === null) return CLOSED

  const isOwner = user.id === collection.owner_id

  let memberRole: MemberRole | null = null
  if (!isOwner) {
    const found = await safeQuery(async (core) => {
      const rows = await core.queryClient<{ role: string }[]>`
        select role from collection_members
        where collection_id = ${collection.id} and user_id = ${user.id}
        limit 1
      `
      return rows[0]?.role ?? null
    })
    // 조회 실패는 닫힌 쪽으로 — 열람 판정에서 기본값은 언제나 잠금이다
    memberRole = found.ok && found.data === 'viewer' ? 'viewer' : null
  }

  const input = { isOwner, memberRole }
  return {
    userId: user.id,
    isOwner,
    memberRole,
    canView: canViewCollection(input),
    canManage: canManageCollection(input),
  }
}
