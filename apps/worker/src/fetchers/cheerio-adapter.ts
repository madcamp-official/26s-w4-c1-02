// core 의 `HtmlAdapter` 를 cheerio 로 구현한다.
//
// **해석기가 core 에 있고 cheerio 가 worker 에 있는 이유가 이것이다.**
// core 는 웹(브라우저 번들)에도 들어가므로 cheerio 를 의존할 수 없다. 그래서 core 는
// "HTML 문자열에 선택자를 적용하는 능력" 만 인터페이스로 뚫어두고 호출자가 주입한다.
// 워커는 cheerio 를, 화면 미리보기는 cheerio 나 DOMParser 를 넣는다 — 해석기 코드는 하나다.

import { load, type CheerioAPI } from 'cheerio'

import type { HtmlAdapter, HtmlNode } from '@endpointer/core/spec'

/**
 * `$(...)` 가 돌려주는 선택 결과.
 *
 * cheerio 의 `Cheerio<T>` 를 직접 쓰려면 노드 타입을 `domhandler` 에서 가져와야 하는데,
 * domhandler 는 cheerio 의 전이 의존이라 worker 의 package.json 에 없다 (있는 것처럼 쓰면
 * pnpm 의 엄격한 격리 때문에 타입이 안 잡힌다). 호출 시그니처에서 뽑아 쓰면 의존이 늘지 않는다.
 */
type Selection = ReturnType<CheerioAPI>

/** 같은 HTML 을 여러 번 파싱하지 않게 최근 것 하나만 들고 있는다 (행마다 필드를 다시 평가하므로 잦다) */
let lastHtml: string | null = null
let lastApi: CheerioAPI | null = null

function apiFor(html: string): CheerioAPI {
  if (lastHtml === html && lastApi !== null) return lastApi
  // 세 번째 인자가 `isDocument` 다. **false 여야 한다.**
  //
  // 해석기는 목록에서 행을 집은 뒤 행의 outerHTML 을 다시 파싱해 필드를 뽑는다
  // (core `interpret.ts` — `selectCssNodes(...).map((node) => node.html())`).
  // 그런데 `<tr>…</tr>` 같은 조각을 문서 모드로 파싱하면 HTML 표준 규칙대로
  // **표 밖의 tr·td 가 통째로 버려진다.** 태그가 사라지므로 `css:td.title a` 류의
  // 필드 경로가 전부 0개를 집고, 표로 된 사이트는 모든 값이 빈 채로 수집된다.
  //
  // 온전한 문서를 넣어도 fragment 모드의 결과가 같아서(`<html>` 이 있으면 그대로 산다)
  // 문서와 조각을 나누지 않는다 — 나누면 "지금 들어온 게 조각인가" 를 매번 맞혀야 한다.
  const $ = load(html, null, false)
  lastHtml = html
  lastApi = $
  return $
}

class CheerioHtmlNode implements HtmlNode {
  readonly #$: CheerioAPI
  readonly #el: Selection

  constructor($: CheerioAPI, el: Selection) {
    this.#$ = $
    this.#el = el
  }

  text(): string {
    return this.#el.text()
  }

  attr(name: string): string | undefined {
    return this.#el.attr(name)
  }

  /** core 주석대로 outerHTML 이어야 한다 — 행 안에서 필드 경로를 다시 평가하기 때문 */
  html(): string {
    return this.#$.html(this.#el)
  }
}

export const cheerioAdapter: HtmlAdapter = {
  select(html: string, selector: string): HtmlNode[] {
    let $: CheerioAPI
    try {
      $ = apiFor(html)
    } catch {
      return []
    }
    let found: Selection
    try {
      found = $(selector) as unknown as Selection
    } catch {
      // 선택자 문법이 틀린 경우. 해석기가 빈 결과로 받고 fieldStats 에 남긴다.
      return []
    }
    const out: HtmlNode[] = []
    found.each((_i, el) => {
      out.push(new CheerioHtmlNode($, $(el) as unknown as Selection))
    })
    return out
  },
}

/** 파싱 캐시를 비운다 (테스트·장시간 실행 시) */
export function resetHtmlCache(): void {
  lastHtml = null
  lastApi = null
}
