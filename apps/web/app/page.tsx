import { redirect } from 'next/navigation'

import { currentUser, isAuthReady } from '@/auth'
import { AuthNotice, SignInHero } from '@/components/auth-actions'
import { Icon, type IconName } from '@/components/ui/icon'

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
  ['merge', '여러 사이트, 하나의 스키마', '두 번째 사이트를 붙여도 같은 열, 같은 형식으로 맞춰 담겨요.'],
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
              세상의 모든 페이지를,
              <br />
              <span
                className="bg-clip-text text-transparent"
                style={{ backgroundImage: 'var(--gradient-connect)' }}
              >
                당신의 도구로.
              </span>
            </h1>
            {/* break-keep — 한글이 "코드 없/이"처럼 글자 중간에서 꺾이지 않게 어절 단위로 줄바꿈 */}
            <p className="mt-5 max-w-[460px] text-[17px] leading-[1.65] break-keep text-muted">
              웹에 있는 어떤 목록이든, 붙여넣는 순간 당신의 데이터가 돼요. 갱신도 알림도 알아서 —
              당신은 꺼내 쓰기만 하세요.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-2.5">
              {isAuthReady ? <SignInHero /> : <AuthNotice />}
            </div>
          </div>
          <ConnectDiagram />
        </div>
      </section>

      {/* 두 사용자층 — 제목도 배지도 없이, 화면을 좌우로 가르는 한 문장짜리 비교.
          두 제목을 잇는 가는 선이 "같은 것을 두 방식으로"라는 말을 대신한다 */}
      <section className="grid border-y border-divider md:grid-cols-2">
        {/* 왼쪽 — 시트. 순백 면이라 오른쪽 잉크와 정면으로 맞선다 */}
        <div className="bg-white px-6 py-16 md:py-24 md:pr-0 md:pl-12">
          <div className="w-full md:ml-auto md:max-w-[560px]">
            <div className="flex items-center gap-5">
              <h3 className="shrink-0 text-[35px] font-bold tracking-[-0.03em] text-ink">
                시트로 관리하거나,
              </h3>
              {/* 오른쪽 제목까지 이어지는 선 — 경계(가운데)를 향해 옅어진다 */}
              <div aria-hidden className="h-[3px] flex-1 bg-gradient-to-r from-ink to-ink/25" />
            </div>

            {/* 표 스케치 — 머리 행만 진하고, 아래로 갈수록 사라진다 */}
            <div aria-hidden className="mt-10 flex max-w-[420px] flex-col gap-[7px]">
              <div className="grid grid-cols-4 gap-[7px]">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-8 rounded-[7px] bg-ink" />
                ))}
              </div>
              {[0.3, 0.23, 0.16, 0.1].map((opacity) => (
                <div key={opacity} className="grid grid-cols-4 gap-[7px]">
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-8 rounded-[7px] bg-ink"
                      style={{ opacity }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 오른쪽 — 코드. 잉크 면 위에 코드 패널 하나 */}
        <div className="bg-[var(--surface-inverse)] px-6 py-16 md:py-24 md:pr-12 md:pl-0">
          <div className="w-full md:mr-auto md:max-w-[560px]">
            <div className="flex items-center gap-5">
              {/* 왼쪽에서 넘어온 선의 끝자락 */}
              <div aria-hidden className="hidden h-[3px] w-12 shrink-0 bg-white/50 md:block" />
              <h3 className="text-[35px] font-bold tracking-[-0.03em] text-white">
                하나의 API로 다루거나.
              </h3>
            </div>

            <div className="mt-10 rounded-xl bg-white/[0.06] px-7 py-6 font-mono text-[15.5px] leading-[2.1] ring-1 ring-white/10 md:ml-[68px]">
              <span className="text-[var(--ep-green-500)]">GET</span>{' '}
              <span className="text-[var(--ink-100)]">/api/v1/my-collection?d_within=7</span>
              <br />
              <span className="text-[var(--ep-blue-200)]">mcp</span>{' '}
              <span className="text-[var(--ink-100)]">tools/call list_items</span>
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
