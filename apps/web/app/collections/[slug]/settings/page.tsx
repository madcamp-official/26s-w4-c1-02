import { notFound } from 'next/navigation'

import { DeleteZone, RenameForm } from '@/components/collection-manage'
import { UnavailableState } from '@/components/empty-state'
import { HeroBand } from '@/components/hero-band'
import { ShareManage, type ShareMemberItem } from '@/components/share-manage'
import { VisibilityForm } from '@/components/visibility-form'
import { resolveCollectionAccess } from '@/lib/access'
import { getCollectionBySlug } from '@/lib/collections'
import { getInviteStatus, listMembers } from '@/lib/share'

import {
  deleteCollectionAction,
  renameCollectionAction,
  updateVisibilityAction,
} from '../actions'
import {
  createInviteLinkAction,
  disableInviteLinkAction,
  removeMemberAction,
} from '../share-actions'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ slug: string }>
}

const JOINED_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  month: 'long',
  day: 'numeric',
  timeZone: 'Asia/Seoul',
})

/** 설정 (원본 Settings) — 공개범위 · 함께 보기 · 이름 · 삭제. 주인만 들어온다 */
export default async function CollectionSettingsPage({ params }: PageProps) {
  const { slug } = await params

  const found = await getCollectionBySlug(slug)
  if (!found.ok) return <UnavailableState message={found.message} />
  if (found.data === null) notFound()

  const collection = found.data

  // 설정은 주인 전용이다 (ADR A40)
  const access = await resolveCollectionAccess(collection)
  if (!access.canManage) notFound()

  const [invite, memberRows] = await Promise.all([
    getInviteStatus(collection.id),
    listMembers(collection.id),
  ])
  const members: ShareMemberItem[] =
    memberRows.ok === true
      ? memberRows.data.map((m) => ({
          id: m.user_id,
          label: m.label,
          joinedLabel: JOINED_FORMAT.format(m.joined_at),
        }))
      : []

  return (
    <HeroBand dense overlap={false} title="설정" sub="공개범위 · 함께 보기 · 이름 · 삭제">
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <section className="rounded-card border border-divider bg-surface p-5 shadow-[0_4px_20px_oklch(0.2_0.02_277/0.10)]">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-semibold text-ink">공개범위</h2>
            <span className="text-[12.5px] text-faint">주소(API) 인증도 이걸 따라가요</span>
          </div>
          <VisibilityForm
            current={collection.visibility}
            save={updateVisibilityAction.bind(null, collection.slug)}
          />
        </section>

        <section className="rounded-card border border-divider bg-surface p-5 shadow-[0_4px_20px_oklch(0.2_0.02_277/0.10)]">
          <h2 className="mb-3 text-[15px] font-semibold text-ink">이름</h2>
          <RenameForm
            name={collection.name}
            rename={renameCollectionAction.bind(null, collection.slug)}
          />
        </section>
      </div>

      <ShareManage
        inviteActive={invite.ok === true && invite.data.active}
        inviteCreatedLabel={
          invite.ok === true && invite.data.created_at !== null
            ? JOINED_FORMAT.format(invite.data.created_at)
            : null
        }
        members={members}
        create={createInviteLinkAction.bind(null, collection.slug)}
        disable={disableInviteLinkAction.bind(null, collection.slug)}
        removeMember={removeMemberAction.bind(null, collection.slug)}
      />

      {/* 위험 구역 — 지우기는 이름을 그대로 적어야 한다 */}
      <section className="rounded-card border border-attention/25 bg-surface p-5">
        <h2 className="mb-3 text-[15px] font-semibold text-ink">지우기</h2>
        <DeleteZone
          name={collection.name}
          remove={deleteCollectionAction.bind(null, collection.slug)}
        />
      </section>
    </HeroBand>
  )
}
