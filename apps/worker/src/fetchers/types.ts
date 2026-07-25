// fetchers 공통 타입
//
// 해석기(core)는 순수 함수이고 네트워크를 타지 않는다. 그 경계가 여기다 —
// fetchers 는 "무엇을 받아왔는가" 까지만 책임지고, "그게 무슨 뜻인가" 는 core 가 한다.

/** 페이지 하나를 받아온 결과. payload 는 그대로 `interpretSpec` 에 들어간다 */
export type PageFetchOutcome =
  | {
      ok: true
      /** json 모드면 파싱된 JSON, html·browser 모드면 HTML 문자열 */
      payload: unknown
      finalUrl: string
      cached: boolean
    }
  | { ok: false; message: string }
