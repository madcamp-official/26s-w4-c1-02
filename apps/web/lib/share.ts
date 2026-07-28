// 초대 링크 · 함께 보는 사람 (ADR A40 — 읽기 전용 공유)
//
// 링크 원문은 저장하지 않는다 — sha256 해시만 (api_key_hash 와 같은 규율).
// 그래서 링크는 만든 직후 딱 한 번 보인다. "다시 만들기"는 행 삭제가 아니라
// revoked_at 기록 + 새 행이다 (A38 과 같은 규율) — 누가 어느 링크로 들어왔는지가 남는다.

import { createHash, randomBytes } from 'node:crypto'

import { safeQuery, type Loaded } from './db'

const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex')

/** URL 에 넣어도 안전한 32글자 — 추측 불가능성이 이 기능의 전부다 */
const newToken = (): string => randomBytes(24).toString('base64url')

export interface InviteStatus {
  active: boolean
  created_at: Date | null
}

/** 살아 있는 링크가 있는가 — 원문은 없으므로 상태만 말한다 */
export async function getInviteStatus(collectionId: string): Promise<Loaded<InviteStatus>> {
  return safeQuery(async (core) => {
    const rows = await core.queryClient<{ created_at: Date }[]>`
      select created_at from collection_invites
      where collection_id = ${collectionId} and revoked_at is null
      order by created_at desc
      limit 1
    `
    const row = rows[0]
    // 드라이버 설정에 따라 문자열로 올 수 있다 — 화면에 닿기 전에 Date 로 접는다
    return row
      ? { active: true, created_at: new Date(row.created_at) }
      : { active: false, created_at: null }
  })
}

/** 기존 링크를 전부 끄고 새 링크를 만든다. 원문 토큰을 돌려준다 — 이 순간 한 번만 보인다 */
export async function issueInviteLink(
  collectionId: string,
  createdBy: string,
): Promise<Loaded<{ token: string }>> {
  const token = newToken()
  return safeQuery(async (core) => {
    await core.queryClient`
      update collection_invites set revoked_at = now()
      where collection_id = ${collectionId} and revoked_at is null
    `
    await core.queryClient`
      insert into collection_invites (collection_id, token_hash, created_by)
      values (${collectionId}, ${sha256Hex(token)}, ${createdBy})
    `
    return { token }
  })
}

/** 링크를 끈다 — 이미 들어온 사람은 그대로다 (내보내기는 removeMember) */
export async function disableInviteLinks(collectionId: string): Promise<Loaded<null>> {
  return safeQuery(async (core) => {
    await core.queryClient`
      update collection_invites set revoked_at = now()
      where collection_id = ${collectionId} and revoked_at is null
    `
    return null
  })
}

/**
 * 초대 수락. 살아 있는 링크면 멤버로 앉히고 컬렉션 slug 를 돌려준다.
 * 못 쓰는 링크(없음·꺼짐)는 null — 존재 여부를 문구로 가르지 않는다.
 * 주인이 자기 링크를 열면 멤버로 앉히지 않고 그냥 통과시킨다.
 */
export async function acceptInvite(
  token: string,
  userId: string,
): Promise<Loaded<{ slug: string } | null>> {
  return safeQuery(async (core) => {
    const rows = await core.queryClient<
      { invite_id: string; collection_id: string; slug: string; owner_id: string }[]
    >`
      select i.id as invite_id, c.id as collection_id, c.slug, c.owner_id
      from collection_invites i
      join collections c on c.id = i.collection_id
      where i.token_hash = ${sha256Hex(token)} and i.revoked_at is null
      limit 1
    `
    const row = rows[0]
    if (!row) return null
    if (row.owner_id !== userId) {
      await core.queryClient`
        insert into collection_members (collection_id, user_id, role, invite_id)
        values (${row.collection_id}, ${userId}, 'viewer', ${row.invite_id})
        on conflict (collection_id, user_id) do nothing
      `
    }
    return { slug: row.slug }
  })
}

export interface MemberRow {
  user_id: string
  /** 이름 → 메일 → "함께 보는 사람" 순서로 부를 말을 고른다 */
  label: string
  joined_at: Date
}

export async function listMembers(collectionId: string): Promise<Loaded<MemberRow[]>> {
  return safeQuery(async (core) => {
    const rows = await core.queryClient<
      { user_id: string; name: string | null; email: string | null; created_at: Date }[]
    >`
      select m.user_id, u.name, u.email, m.created_at
      from collection_members m
      join users u on u.id = m.user_id
      where m.collection_id = ${collectionId}
      order by m.created_at asc
    `
    return rows.map((row) => ({
      user_id: row.user_id,
      label: row.name ?? row.email ?? '함께 보는 사람',
      // 드라이버 설정에 따라 문자열로 올 수 있다 — 화면에 닿기 전에 Date 로 접는다
      joined_at: new Date(row.created_at),
    }))
  })
}

/** 내보내기. 다시 들어오려면 살아 있는 링크가 필요하다 */
export async function removeMember(collectionId: string, userId: string): Promise<Loaded<null>> {
  return safeQuery(async (core) => {
    await core.queryClient`
      delete from collection_members
      where collection_id = ${collectionId} and user_id = ${userId}
    `
    return null
  })
}
