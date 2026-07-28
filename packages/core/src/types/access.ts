// 컬렉션 접근 판정 (ADR A40) — web 화면과 mcp 가 같은 규칙을 봐야 한다.
//
// 순수 함수만 둔다. DB 조회(멤버십·키 해시 대조)는 호출하는 쪽 몫이고,
// 여기는 "그 사실들이 주어졌을 때 무엇이 허용되는가"만 답한다 —
// 판정 규칙이 두 앱에 복사되면 서서히 갈라진다 (apps/mcp/src/auth.ts 의 TODO 가 이 자리다).
//
// visibility 는 여기 안 나온다. 그건 REST·MCP(공개 API)의 공개 범위이고,
// 화면은 관리 정보가 섞인 표면이라 주소를 안다고 열리지 않는다 — 주인과 멤버만이다.
// 이 구분이 무너지면 unlisted 컬렉션에서 초대 링크가 장식이 된다.

import type { MemberRole } from './collection'

/** 접근 판정에 필요한 사실 묶음. DB 조회 결과를 이 모양으로 접어서 넘긴다 */
export interface CollectionAccessInput {
  /** 로그인한 사용자가 owner_id 와 같은가 */
  isOwner: boolean
  /** collection_members 에 있으면 그 역할, 없으면 null */
  memberRole: MemberRole | null
}

/** 화면 열람 — 표·뷰·읽기 피드·연결 문자열을 볼 수 있는가. 주인과 멤버만이다 */
export function canViewCollection(access: CollectionAccessInput): boolean {
  return access.isOwner || access.memberRole !== null
}

/**
 * 관리 — 이름 변경·삭제·사이트 붙이기·스키마·구독 채널·링크 관리 전부.
 * v1 의 멤버는 전원 viewer 이므로 주인만이다. 편집자 역할이 생기면(델타 §9) 여기만 넓힌다.
 */
export function canManageCollection(access: CollectionAccessInput): boolean {
  return access.isOwner
}
