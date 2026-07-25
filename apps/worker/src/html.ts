// HTML 다루기 — 눈에 보이는 텍스트 추출과 LLM 입력 다이어트
//
// "눈에 보이는 텍스트" 가 중요한 이유: 후보 순위 판정이 전부 여기 걸려 있다 (기획서 9-1 · 15장).
// script·style·svg 안의 글자는 화면에 안 보이므로 세면 안 된다 — 인라인 JSON 을 그대로 세면
// 후보 데이터와 100% 겹쳐서 판정이 무의미해진다.

import { load } from 'cheerio'

/** 화면에 보이지 않는 요소들 */
const INVISIBLE = 'script, style, noscript, svg, template, iframe, head'

export interface ExtractedPage {
  title: string | null
  text: string
  /** `<script>` 별 내용 — 인라인 JSON 스캔이 쓴다 */
  scripts: { id: string | null; type: string | null; content: string }[]
}

export function extractPage(html: string): ExtractedPage {
  let $
  try {
    $ = load(html)
  } catch {
    return { title: null, text: '', scripts: [] }
  }

  const scripts: ExtractedPage['scripts'] = []
  $('script').each((_i, el) => {
    const node = $(el)
    const content = node.html() ?? ''
    if (content.trim() === '') return
    scripts.push({ id: node.attr('id') ?? null, type: node.attr('type') ?? null, content })
  })

  const title = $('title').first().text().trim() || null

  $(INVISIBLE).remove()
  const text = collapse($('body').length > 0 ? $('body').text() : $.root().text())

  return { title, text, scripts }
}

/** 화면에 보이는 텍스트만. 후보 순위 판정의 기준 */
export function visibleText(html: string): string {
  return extractPage(html).text
}

function collapse(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

/**
 * LLM 프롬프트에 넣기 전 HTML 다이어트 (`LLM_HTML_TRIM`).
 * script·style·svg·주석·data URI 를 지운다. 보통 60~90% 줄어든다.
 */
export function trimHtmlForLlm(html: string, maxChars: number): string {
  let out: string
  try {
    const $ = load(html)
    $('script, style, noscript, svg, link, meta').remove()
    $('*').each((_i, el) => {
      if (!('attribs' in el)) return
      for (const [name, value] of Object.entries(el.attribs)) {
        if (typeof value === 'string' && value.startsWith('data:')) $(el).removeAttr(name)
      }
    })
    out = $.html()
  } catch {
    out = html
  }
  out = out.replace(/<!--[\s\S]*?-->/g, '').replace(/\n\s*\n+/g, '\n')
  return out.length > maxChars ? `${out.slice(0, maxChars)}\n<!-- 이후 생략 -->` : out
}

/** 문자열을 프롬프트·로그에 넣을 만한 길이로 자른다 */
export function clip(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`
}
