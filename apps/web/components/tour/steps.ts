// 둘러보기(투어) 스텝 정의 — 문구·앵커·챕터가 전부 여기 있다. 튜닝은 이 파일만 고친다.
//
// 챕터 2개로 쪼갠 이유: 컬렉션이 0개인 첫 화면엔 표·뷰·연결 탭이 존재하지 않는다.
// 개념은 **쓸 수 있게 된 순간에** 가르친다 — 콘솔 투어는 첫 방문에, 컬렉션 투어는
// 첫 컬렉션의 대시보드에 처음 들어온 순간에 뜬다.
//
// 앵커는 전부 사이드바 탭·상단 버튼(항상 존재하는 크롬)에 건다 — 데이터 유무와 무관하게 안정적이다.
// 문구는 보장선 B2 를 지킨다: 컬렉션 · 사이트 · 뷰 · 항목 외의 내부 명사를 쓰지 않는다.

export interface TourStep {
  /** 대상 요소의 data-tour 값. 화면에서 못 찾으면 그 스텝은 조용히 건너뛴다 */
  anchor: string
  body: string
}

export interface TourChapter {
  /** localStorage 키(ep:tour:{id})와 재생 판정에 쓴다 */
  id: 'console' | 'collection'
  /** 시작 전 중앙 환영 카드 (없으면 바로 1번 스텝부터) */
  welcome?: { title: string; body: string }
  steps: TourStep[]
  /** 마지막 스텝 뒤 중앙 마무리 카드 — CTA 하나로 다음 행동을 가리킨다 */
  final?: { body: string; ctaLabel: string; ctaHref: string }
}

export const TOUR_CHAPTERS: Record<TourChapter['id'], TourChapter> = {
  // ── 챕터 ① 콘솔 투어 — 첫 방문 (내 컬렉션 화면) ──────────────────────
  console: {
    id: 'console',
    welcome: {
      title: '환영해요!',
      body: '30초면 둘러봐요',
    },
    steps: [
      { anchor: 'nav-my', body: '만든 컬렉션이 여기 쌓여요' },
      {
        anchor: 'new-collection',
        body: '지켜보고 싶은 목록 페이지 주소를 붙여넣어 한 눈에 봐요',
      },
      { anchor: 'nav-gallery', body: '남이 만든 컬렉션을 복제해서 시작할 수도 있어요' },
    ],
    final: {
      body: '첫 컬렉션을 만들어 보세요',
      ctaLabel: '첫 컬렉션 만들기 →',
      ctaHref: '/collections/new',
    },
  },

  // ── 챕터 ② 컬렉션의 네 얼굴 — 첫 대시보드 진입 시 ────────────────────
  collection: {
    id: 'collection',
    steps: [
      { anchor: 'tab-table', body: '여러 사이트의 항목이 여기 한 표로 모여요' },
      {
        anchor: 'tab-views',
        body: '표에서 조건을 걸고 저장하면 ‘뷰’가 돼요 — 조건에 새로 걸리는 항목이 생기면 알려드려요',
      },
      { anchor: 'tab-sources', body: '새로운 사이트를 함께 관찰하고 싶으면 여기서 붙여 넣어요' },
      { anchor: 'tab-connect', body: '주소(API)와 쓰시는 AI로도 꺼내 쓸 수 있어요' },
    ],
  },
}
