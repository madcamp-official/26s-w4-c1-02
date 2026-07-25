// DB 접근 — 실패해도 화면이 죽지 않는다.
//
// `@endpointer/core/db` 는 **모듈을 읽는 순간** DATABASE_URL 을 검증한다. 정적 import 로 두면
// .env 가 비어 있을 때 `next build` 가 통째로 깨진다. 그래서 동적 import 로 감싼다 —
// 실패는 예외가 아니라 값으로 돌려주고, 화면은 상태 문구를 그린다 (보장선 B4 와 같은 원칙).

// (`server-only` 패키지는 아직 설치돼 있지 않다. 대신 이 파일은 서버 컴포넌트와
//  라우트 핸들러에서만 import 한다 — 클라이언트 컴포넌트에서 부르면 안 된다.)

type CoreDb = typeof import('@endpointer/core/db')

let cached: CoreDb | null = null

/** 못 읽으면 null. 이유는 로그로만 남기고 화면에는 사람 문장을 낸다 */
export async function loadCore(): Promise<CoreDb | null> {
  if (cached !== null) return cached
  try {
    cached = await import('@endpointer/core/db')
    return cached
  } catch (cause) {
    console.warn('[endpointer/web] 데이터 저장소 설정을 읽지 못했습니다', cause)
    return null
  }
}

/** 성공/실패를 값으로 나르는 봉투. throw 를 화면까지 올려보내지 않는다 */
export type Loaded<T> = { ok: true; data: T } | { ok: false; message: string }

/** 저장소에 못 닿았을 때 화면이 그대로 보여줄 문장 (내부 용어 없음) */
export const STORAGE_UNAVAILABLE =
  '지금은 저장해 둔 내용을 불러오지 못하고 있어요. 잠시 뒤에 다시 열어봐 주세요.'

/**
 * 조회 하나를 통째로 감싼다. 연결 거부·설정 누락·쿼리 실패가 전부 여기서 흡수된다.
 */
export async function safeQuery<T>(run: (core: CoreDb) => Promise<T>): Promise<Loaded<T>> {
  const core = await loadCore()
  if (core === null) return { ok: false, message: STORAGE_UNAVAILABLE }
  try {
    return { ok: true, data: await run(core) }
  } catch (cause) {
    console.warn('[endpointer/web] 조회에 실패했습니다', cause)
    return { ok: false, message: STORAGE_UNAVAILABLE }
  }
}
