import Link from 'next/link'
import { redirect } from 'next/navigation'

import { currentUser, isAuthReady } from '@/auth'
import { AuthNotice, SignInHero } from '@/components/auth-actions'
import { listExampleCollections } from '@/lib/collections'
import { coverageCopy } from '@/lib/labels'

// 로그인 상태에 따라 갈라지므로 미리 만들어두지 않는다
export const dynamic = 'force-dynamic'

const SOURCE_EXAMPLES = ['k-startup.go.kr', 'bizinfo.go.kr', 'thinkcontest.com'] as const
const SURFACE_EXAMPLES = ['표 · 즐겨찾기', '읽기 피드 · 구독', 'REST API', 'MCP — AI에 연결'] as const

export default async function HomePage() {
  const user = await currentUser()
  if (user) redirect('/collections')

  const examples = await listExampleCollections(3)
  const exampleList = examples.ok ? examples.data : []

  return (
    <div className="flex flex-col gap-12">
      <section className="mx-auto flex max-w-[720px] flex-col items-center gap-0 pt-12 text-center">
        <span className="mb-7 inline-flex items-center gap-2 rounded-full border border-accent-line bg-accent-soft px-3.5 py-1.5 text-[13px] font-semibold text-brand">
          한 번 만들면, 살아서 갱신되는 컬렉션
        </span>
        <h1 className="mb-5 text-4xl leading-tight font-extrabold tracking-tight text-balance sm:text-[52px] sm:leading-[1.2]">
          아무 목록 페이지나
          <br />내 API로 — <span className="text-accent">내 방식대로.</span>
        </h1>
        <p className="mb-9 max-w-[620px] text-lg leading-relaxed text-pretty text-muted">
          다나와는 남이 정해준 카테고리만 비교할 수 있어요. 내가 궁금한 건 이번 달 마감인
          공모전인데요. URL 몇 개를 붙여넣으면 그 주제의 다나와가 생기고, 표로도 · 피드로도 ·
          API로도 · AI로도 쓸 수 있어요.
        </p>

        {isAuthReady ? (
          <>
            <SignInHero />
            <p className="mt-3 text-[13px] text-faint">
              계정은 이것 하나면 돼요 — 기기가 바뀌어도 컬렉션이 남아요
            </p>
          </>
        ) : (
          <AuthNotice />
        )}
      </section>

      {/* 예시 컬렉션 — 빈 화면 금지 (델타 5-5). 로그인 없이 열어본다: 정의권을 말로 하지 않고 보여준다 */}
      {exampleList.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-center text-sm font-bold text-faint">
            이런 표를 만들 수 있어요 — 눌러서 바로 구경해 보세요
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {exampleList.map((example) => (
              <Link
                key={example.id}
                href={`/collections/${example.slug}`}
                className="flex flex-col gap-2 rounded-card border border-border bg-surface p-5 transition-[border-color,box-shadow] hover:border-accent hover:no-underline hover:shadow-[0_4px_14px_rgba(30,86,200,0.12)]"
              >
                <span className="text-[15px] font-bold text-ink">{example.name}</span>
                <span className="text-xs text-faint">
                  {coverageCopy(example.site_count, example.item_count)}
                </span>
                <span className="mt-auto flex flex-wrap gap-1.5">
                  {example.hosts.slice(0, 3).map((host) => (
                    <span
                      key={host}
                      className="rounded-md bg-canvas px-2 py-0.5 font-mono text-[11px] text-muted"
                    >
                      {host}
                    </span>
                  ))}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 소스 → 컬렉션 → 표면. 제품의 두 동작이 한 장에 (기획서 2장) */}
      <section className="rounded-2xl border border-border bg-surface px-10 py-9 shadow-[0_1px_3px_rgba(35,48,63,0.05)]">
        <div className="flex flex-wrap items-center justify-center gap-7">
          <div className="flex flex-col gap-2.5">
            <span className="text-[11px] font-bold tracking-[1.5px] text-faint">SOURCES</span>
            {SOURCE_EXAMPLES.map((host) => (
              <span
                key={host}
                className="rounded-lg border border-border bg-canvas px-3.5 py-2 font-mono text-[13px]"
              >
                {host}
              </span>
            ))}
          </div>

          <span aria-hidden className="text-[22px] text-border-strong">
            →
          </span>

          <div className="rounded-[14px] bg-brand px-6 py-5 text-center text-canvas">
            <div className="mb-2 text-[11px] font-bold tracking-[1.5px] text-accent-line/80">
              COLLECTION
            </div>
            <div className="mb-1.5 text-base font-bold">하나의 스키마</div>
            <div className="text-[13px] text-accent-line">공고명 · 기관 · 마감일 · 금액</div>
            <div className="mt-2.5 border-t border-white/15 pt-2 text-[11px] text-accent-line/80">
              같은 형식으로 정리 · 깨지면 스스로 복구
            </div>
          </div>

          <span aria-hidden className="text-[22px] text-border-strong">
            →
          </span>

          <div className="flex flex-col gap-2.5">
            <span className="text-[11px] font-bold tracking-[1.5px] text-faint">SURFACES</span>
            {SURFACE_EXAMPLES.map((surface) => (
              <span
                key={surface}
                className="rounded-lg border border-accent-line bg-accent-soft px-3.5 py-2 text-[13px] font-semibold text-brand"
              >
                {surface}
              </span>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
