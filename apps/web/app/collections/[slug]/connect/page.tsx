import { notFound } from 'next/navigation'

import { CopyButton } from '@/components/copy-button'
import { DeveloperDetails } from '@/components/developer-details'
import { UnavailableState } from '@/components/empty-state'
import { HeroBand } from '@/components/hero-band'
import { resolveCollectionAccess } from '@/lib/access'
import { fetchCollectionPage, getCollectionBySlug } from '@/lib/collections'
import { COPY } from '@/lib/labels'
import { apiUrlFor, mcpUrlFor } from '@/lib/urls'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ slug: string }>
}

const STEPS = [COPY.connectStep1, COPY.connectStep2, COPY.connectStep3] as const

/**
 * 연결 탭. 주인공은 MCP (보장선 B7 — 주소 한 줄 복사 → 커넥터에 붙여넣기).
 * REST API 는 개발자용이라 접혀 있다 (보장선 B5).
 */
export default async function CollectionConnectPage({ params }: PageProps) {
  const { slug } = await params

  const found = await getCollectionBySlug(slug)
  if (!found.ok) return <UnavailableState message={found.message} />
  if (found.data === null) notFound()

  const collection = found.data

  // 주인·멤버가 아니면 없는 것과 같다 (ADR A40). 함께 보기 관리는 설정 탭으로 옮겨갔다
  const access = await resolveCollectionAccess(collection)
  if (!access.canView) notFound()

  const mcpUrl = mcpUrlFor(collection.slug)

  // 응답 JSON 샘플 — 지어내지 않고 실제로 2건 조회해 그 형태를 보여준다 (없으면 그 탭을 숨긴다)
  const samplePage = await fetchCollectionPage(collection, 'limit=2')
  const sampleJson =
    samplePage.ok && samplePage.data.items.length > 0
      ? JSON.stringify(samplePage.data, null, 2)
      : null

  return (
    <HeroBand
      dense
      overlap={false}
      title="연결"
      sub="같은 표가 나가는 네 출구 — 화면 · 피드 · 주소 · AI"
    >
    <div className="grid items-start gap-4 lg:grid-cols-2">
      {/* 두 카드는 같은 껍데기를 쓴다 — 제목 한 줄 + 설명 한 줄 + 본문 (아래 DeveloperDetails 와 대칭) */}
      <section className="rounded-card border border-border bg-surface p-7">
        <h2 className="mb-1 text-base font-bold text-ink">{COPY.connectTitle}</h2>
        <p className="mb-4 text-[13px] leading-relaxed text-faint">{COPY.connectBody}</p>

        <div className="mb-4 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-[9px] border border-border bg-canvas px-3.5 py-2.5 font-mono text-[12.5px] text-muted">
            {mcpUrl}
          </code>
          <CopyButton value={mcpUrl} label={COPY.copy} />
        </div>

        <ol className="mb-6 flex flex-col gap-2.5">
          {STEPS.map((step, index) => (
            <li key={step} className="flex items-center gap-2.5 text-[13.5px] text-muted">
              <span
                aria-hidden
                className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-extrabold text-brand"
              >
                {index + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>

        {/* 붙여넣고 나면 이런 대화가 된다 — 장식이 아니라 사용법 안내다 */}
        <div className="flex flex-col gap-2.5 rounded-xl bg-canvas p-4 text-[13.5px]">
          <p className="max-w-[85%] self-end rounded-[13px] rounded-br-[3px] bg-accent px-4 py-2.5 text-accent-ink">
            이 컬렉션에서 이번 주 마감 뭐 있어?
          </p>
          <p className="max-w-[90%] self-start rounded-[13px] rounded-bl-[3px] border border-border bg-surface px-4 py-3 leading-relaxed">
            컬렉션에 담긴 항목을 바로 읽고, 마감이 가까운 것부터 알려드려요.
          </p>
        </div>
      </section>

      <DeveloperDetails
        apiUrl={apiUrlFor(collection.slug)}
        fields={collection.schema_json}
        sampleJson={sampleJson}
      />
    </div>
    </HeroBand>
  )
}
