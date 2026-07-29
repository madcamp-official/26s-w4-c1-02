import Link from 'next/link'
import { redirect } from 'next/navigation'

import { currentUser, isAuthReady } from '@/auth'
import { AuthNotice, SignInHero } from '@/components/auth-actions'
import { Icon, type IconName } from '@/components/ui/icon'
import { listExampleCollections } from '@/lib/collections'
import { coverageCopy } from '@/lib/labels'

// 로그인 상태에 따라 갈라지므로 미리 만들어두지 않는다
export const dynamic = 'force-dynamic'

// 원본 ui_kits/website/Landing.jsx 를 이식한 랜딩.
// 콘솔은 화이트지만 랜딩은 크림 종이(--surface-page) 위에 산다 — 원본 그대로.

// 히어로 연결 다이어그램의 입출력 (원본 ConnectDiagram — 소스 알약 → 접점 → 세 출구)
const DIAGRAM_SOURCES = ['지원사업 공고', '공모전 목록', '채용 공고', '뉴스 목록'] as const
const DIAGRAM_OUTPUTS: ReadonlyArray<readonly [IconName, string]> = [
  ['table', '하나의 표'],
  ['bell', '알림'],
  ['terminal', '주소 · AI'],
]

// 기능 4단 (원본 Features 레이아웃 · 문구는 이 제품이 실제로 하는 것만)
const FEATURES: ReadonlyArray<readonly [IconName, string, string]> = [
  ['link2', '한 번의 붙여넣기', '목록 페이지 주소만 붙여넣으면 표가 돼요. 선택자도, 설정도 없어요.'],
  ['merge', '여러 사이트, 한 표', '두 번째 사이트를 붙여도 같은 열, 같은 형식으로 맞춰 담겨요.'],
  ['refresh', '스스로 고침', '사이트가 바뀌어 깨지면 스스로 고치고, 고친 기록을 보여드려요.'],
  ['plug', '네 가지 얼굴', '같은 내용을 표로, 읽기 피드로, 주소(API)로, 쓰시는 AI로 봐요.'],
]

function ConnectDiagram() {
  return (
    <div className="hidden items-center lg:flex">
      <div className="flex shrink-0 flex-col gap-3.5">
        {DIAGRAM_SOURCES.map((source) => (
          <span
            key={source}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-[13px] font-medium whitespace-nowrap text-muted shadow-[0_1px_3px_rgba(35,48,63,0.06)]"
          >
            <span aria-hidden className="size-2 rounded-full bg-accent" />
            {source}
          </span>
        ))}
      </div>
      <svg width="120" height="200" viewBox="0 0 120 200" fill="none" className="shrink-0">
        <path d="M4 24 C 70 24, 70 100, 116 100" stroke="var(--ink-300)" strokeWidth="2" strokeDasharray="4 5" />
        <path d="M4 75 C 60 75, 66 100, 116 100" stroke="var(--ink-300)" strokeWidth="2" strokeDasharray="4 5" />
        <path d="M4 125 C 60 125, 66 100, 116 100" stroke="var(--ink-300)" strokeWidth="2" strokeDasharray="4 5" />
        <path d="M4 176 C 70 176, 70 100, 116 100" stroke="var(--ink-300)" strokeWidth="2" strokeDasharray="4 5" />
      </svg>
      <span
        className="inline-flex size-14 shrink-0 items-center justify-center rounded-full text-white shadow-[0_8px_24px_rgba(35,48,63,0.18)]"
        style={{ background: 'var(--gradient-connect)' }}
      >
        <Icon name="merge" size={24} strokeWidth={2} />
      </span>
      <div className="h-0.5 w-[90px] shrink-0" style={{ background: 'var(--gradient-connect)' }} />
      <div className="flex shrink-0 flex-col gap-2.5">
        {DIAGRAM_OUTPUTS.map(([icon, label]) => (
          <span
            key={label}
            className="inline-flex items-center gap-2 rounded-[10px] bg-surface px-3.5 py-2 text-[13.5px] font-semibold whitespace-nowrap text-ink shadow-[0_1px_3px_rgba(35,48,63,0.08)]"
          >
            <Icon name={icon} size={16} className="text-[var(--ep-green-600)]" />
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}

export default async function HomePage() {
  const user = await currentUser()
  if (user) redirect('/collections')

  const examples = await listExampleCollections(3)
  const exampleList = examples.ok ? examples.data : []

  return (
    <div className="bg-[var(--surface-page)]">
      {/* nav (원본 EpNav) — 좁은 화면은 루트 상단바가 대신한다.
          px-6 은 header 쪽에 둔다 — 안쪽 컨테이너에 두면 히어로(max-w 만 있는)와 시작 x 가 24px 어긋난다 */}
      <header className="sticky top-0 z-50 hidden border-b border-divider bg-white/92 px-6 backdrop-blur md:block">
        <div className="mx-auto flex h-[60px] max-w-[1080px] items-center gap-7">
          <span className="text-[20px] font-bold tracking-[-0.04em] text-ink">
            Endpointer<span className="text-accent">.</span>
          </span>
        </div>
      </header>

      {/* 히어로 (원본 Hero) — 그라디언트 워드 + 연결 다이어그램 */}
      <section className="relative overflow-hidden px-6 pt-16 pb-16 md:pt-[88px] md:pb-[72px]">
        <img
          src="/diamond-motif.svg"
          alt=""
          aria-hidden
          className="pointer-events-none absolute -top-16 -right-16 h-[300px] opacity-15"
        />
        <div className="relative mx-auto grid max-w-[1080px] items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <h1 className="text-[38px] leading-[1.15] font-bold tracking-[-0.03em] text-ink sm:text-[52px]">
              세상의 모든 페이지를
              <br />
              <span
                className="bg-clip-text text-transparent"
                style={{ backgroundImage: 'var(--gradient-connect)' }}
              >
                당신의 도구로
              </span>
            </h1>
            {/* break-keep — 한글이 "코드 없/이"처럼 글자 중간에서 꺾이지 않게 어절 단위로 줄바꿈 */}
            <p className="mt-5 max-w-[440px] text-[17px] leading-[1.65] break-keep text-muted">
              비슷한 일을 하는 서로 다른 사이트들을 하나의 표로 합쳐요. 코드 없이 표와 알림으로,
              코드로는 주소(API)와 AI(MCP)로.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-2.5">
              {isAuthReady ? <SignInHero /> : <AuthNotice />}
            </div>
          </div>
          <ConnectDiagram />
        </div>
      </section>

      {/* 두 사용자층 (원본 TwoAudiences) — 노코드 / 개발자 */}
      <section className="border-y border-divider bg-surface px-6 py-16">
        <div className="mx-auto max-w-[1080px]">
          <h2 className="text-[30px] font-bold tracking-[-0.03em] text-ink">
            코드가 있든 없든, 같은 표
          </h2>
          <p className="mt-2.5 mb-8 text-[15px] text-muted">
            한 번 만들면 팀 전체가 각자의 방식으로 써요
          </p>
          <div className="grid gap-5 md:grid-cols-2">
            <div className="rounded-2xl bg-[var(--surface-page)] p-7 shadow-[0_1px_3px_rgba(35,48,63,0.06)]">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-ok-soft px-3 py-1 text-[12.5px] font-semibold text-ok">
                <span aria-hidden className="size-1.5 rounded-full bg-current" />
                코드 없이
              </span>
              <h3 className="mt-3.5 mb-2 text-[22px] font-semibold tracking-[-0.02em] text-ink">
                표와 알림으로
              </h3>
              <p className="mb-4 text-[14.5px] leading-[1.65] text-muted">
                여러 사이트의 목록이 하나의 표로 모여요. 조건을 저장해 두면 새 항목이 생길 때 알려
                드려요.
              </p>
              <div className="flex flex-wrap gap-2">
                {['하나의 표', '조건 알림', '읽기 피드'].map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-border bg-surface px-3 py-1 text-[12px] font-medium text-muted"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            <div className="rounded-2xl bg-[var(--surface-inverse)] p-7">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-[12.5px] font-semibold text-accent">
                <span aria-hidden className="size-1.5 rounded-full bg-current" />
                개발자
              </span>
              <h3 className="mt-3.5 mb-2 text-[22px] font-semibold tracking-[-0.02em] text-white">
                하나의 API로
              </h3>
              <div className="rounded-[10px] bg-[oklch(0.23_0.015_255)] px-4 py-3.5 font-mono text-[12.5px] leading-[1.8] text-[var(--ink-100)]">
                <span className="text-[var(--ep-green-500)]">GET</span> /api/v1/my-collection?d_within=7
                <br />
                <span className="text-[var(--ink-400)]">→ items · sources · schema 한 번에</span>
                <br />
                <br />
                <span className="text-[var(--ep-blue-200)]">mcp</span> tools/call list_items
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {['REST', 'MCP', '웹훅'].map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-[var(--ink-700)] px-3 py-1 font-mono text-[12px] text-[var(--ink-200)]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 기능 4단 (원본 Features) */}
      <section className="px-6 py-16">
        <div className="mx-auto grid max-w-[1080px] gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(([icon, title, body]) => (
            <div key={title}>
              <span className="inline-flex size-[38px] items-center justify-center rounded-full bg-accent-soft text-accent">
                <Icon name={icon} size={18} />
              </span>
              <h3 className="mt-3 mb-1.5 text-base font-semibold text-ink">{title}</h3>
              <p className="text-[13.5px] leading-[1.6] text-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 예시 컬렉션 — 빈 화면 금지 (델타 5-5). 로그인 없이 눌러서 구경한다 */}
      {exampleList.length > 0 && (
        <section className="px-6 pb-16">
          <div className="mx-auto max-w-[1080px]">
            <h2 className="mb-4 text-sm font-bold text-faint">
              이런 표가 이미 살아 있어요 — 눌러서 바로 구경해 보세요
            </h2>
            <div className="grid gap-4 sm:grid-cols-3">
              {exampleList.map((example) => (
                <Link
                  key={example.id}
                  href={`/collections/${example.slug}`}
                  className="flex flex-col gap-2 rounded-card border border-divider bg-surface p-5 shadow-[0_1px_3px_rgba(35,48,63,0.06)] transition-[border-color,box-shadow] hover:border-accent hover:no-underline hover:shadow-[0_4px_14px_rgba(30,86,200,0.12)]"
                >
                  <span className="text-[15px] font-semibold text-ink">{example.name}</span>
                  <span className="text-xs text-faint">
                    {coverageCopy(example.site_count, example.item_count)}
                  </span>
                  <span className="mt-auto flex flex-wrap gap-1.5 pt-1">
                    {example.hosts.slice(0, 3).map((host) => (
                      <span
                        key={host}
                        className="rounded-full border border-border bg-surface px-2 py-0.5 font-mono text-[11px] text-muted"
                      >
                        {host}
                      </span>
                    ))}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* CTA (원본 Cta) — 어두운 블록 */}
      <section className="px-6 pb-20">
        <div className="mx-auto flex max-w-[1080px] flex-wrap items-center gap-6 rounded-[20px] bg-[var(--surface-inverse)] px-8 py-12 md:px-12 md:py-14">
          <div className="min-w-[280px] flex-1">
            <h2 className="text-[30px] font-bold tracking-[-0.03em] text-white">첫 표까지 5분</h2>
            <p className="mt-2.5 text-[15px] text-[var(--ink-300)]">
              구글 로그인 하나면 돼요 · 기기가 바뀌어도 컬렉션이 남아요
            </p>
          </div>
          {isAuthReady && <SignInHero />}
        </div>
      </section>

      {/* 푸터 (원본 Footer) */}
      <footer className="border-t border-divider bg-surface px-6 py-8">
        <div className="mx-auto flex max-w-[1080px] flex-wrap items-center gap-5 text-[13px] text-faint">
          <span className="text-[15px] font-bold tracking-[-0.04em] text-ink">
            Endpointer<span className="text-accent">.</span>
          </span>
          <span>세상의 모든 페이지를 당신의 도구로</span>
        </div>
      </footer>
    </div>
  )
}
