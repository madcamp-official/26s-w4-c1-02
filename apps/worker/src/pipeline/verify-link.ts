// 링크가 진짜 그 항목으로 가는지 열어서 확인한다
//
// ── 왜 필요한가 ─────────────────────────────────────────────────────────
// 목록 사이트의 링크가 `javascript:go_view(178642);` 인 곳이 흔하다. 실제 주소는 JS 가
// 만들기 때문에 HTML 어디에도 없다. LLM 은 번호를 뽑아 주소 틀에 끼우는 변환을 내는데,
// **그 주소 틀을 지어낸다.** 실제로 이렇게 나왔다:
//
//     https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do?view=178642
//     → HTTP 200 · 그런데 열리는 건 목록 페이지다 (`?view` 를 서버가 무시한다)
//     실제 주소는 .../detail.do?sn=178642
//
// **이 실패는 우리가 가진 어떤 검사도 통과한다.** 주소 문법 맞고, 칸이 비지도 않고,
// 항목마다 값이 다 다르고, 미리보기에서 완벽해 보인다. 사용자는 링크를 눌러 보고서야 안다.
// 그때는 이미 "이 제품은 거짓말을 한다" 가 된다 (기획서 9-2 프롬프트 주석).
//
// ── 어떻게 잡는가 ───────────────────────────────────────────────────────
// 첫 항목의 링크를 **한 번 열어 본다.** 열린 페이지에 **다른 항목들의 제목이 여러 개** 있으면
// 그건 항목 상세가 아니라 목록이다. 이 판정이 좋은 이유:
//   · 상세 페이지가 JS 로 그려져 제목이 없는 경우와 구분된다 (그건 아무 제목도 없다)
//   · 요청 한 번이면 된다
//
// 확실하지 않으면 **통과시킨다.** 멀쩡한 링크를 의심해 사용자에게 물어보면
// "할 일이 늘어나는" 쪽이고, 그건 기능 ②가 지려는 싸움이다.

import type { CollectionSchemaJson } from '@endpointer/core'
import type { InterpretedItem } from '@endpointer/core/spec'

import { httpGet } from '../fetchers'
import { childLogger } from '../logger'

const log = childLogger({ mod: 'verify-link' })

/** 열어 본 페이지에 다른 항목 제목이 이만큼 이상 있으면 목록으로 본다 */
const LIST_LIKE_HITS = 2

/** 제목 비교에 쓸 최소 길이. 짧은 제목은 우연히 겹친다 */
const MIN_TITLE_LENGTH = 8

export type LinkVerdict =
  /** 항목 상세로 보인다 — 또는 판단할 근거가 없어서 통과시켰다 */
  | { ok: true; reason: string }
  /** 열어 봤더니 목록이었다 */
  | { ok: false; reason: string }

/**
 * 링크 칸 하나를 확인한다. `type: 'link'` 인 칸에만 쓴다.
 *
 * 요청을 한 번 낸다 — 캐시에 있으면 그것도 안 낸다.
 */
export async function verifyLinkField(
  items: readonly InterpretedItem[],
  schema: CollectionSchemaJson,
  key: string,
): Promise<LinkVerdict> {
  const titleKey = titleFieldOf(schema)
  if (titleKey === null) return { ok: true, reason: '견줄 제목 칸이 없어 확인하지 않았습니다' }

  const first = items.find((item) => typeof item.data[key] === 'string' && String(item.data[key]).startsWith('http'))
  if (first === undefined) return { ok: true, reason: '열어 볼 링크가 없습니다' }

  // 첫 항목 자신을 뺀 나머지 제목들 — 이게 "목록인가" 의 판정 재료다
  const others = items
    .filter((item) => item !== first)
    .map((item) => String(item.data[titleKey] ?? '').trim())
    .filter((t) => t.length >= MIN_TITLE_LENGTH)
  if (others.length < LIST_LIKE_HITS) return { ok: true, reason: '견줄 항목이 모자라 확인하지 않았습니다' }

  const url = String(first.data[key])
  const res = await httpGet(url)
  // 못 열었으면 여기서 판단하지 않는다. 네트워크 사정으로 멀쩡한 링크를 버리면 안 된다.
  if (!res.ok || !res.response.ok) return { ok: true, reason: '링크를 열어 보지 못해 확인하지 않았습니다' }

  const text = squash(stripTags(res.response.body))
  const hits = others.filter((t) => text.includes(squash(t))).length

  if (hits >= LIST_LIKE_HITS) {
    log.warn({ key, url, hits }, '링크가 항목이 아니라 목록으로 간다')
    return { ok: false, reason: `열어 보니 목록 페이지였습니다 (다른 항목 ${hits}개가 그대로 있음)` }
  }
  return { ok: true, reason: '항목 상세로 보입니다' }
}

/** 견줄 제목 칸 — 스키마에서 첫 `text` 칸을 쓴다 (컬럼 순서가 곧 중요도다) */
function titleFieldOf(schema: CollectionSchemaJson): string | null {
  return schema.find((f) => f.type === 'text')?.key ?? null
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
}

function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}
