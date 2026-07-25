// 두 번째 소스 필드 매핑 프롬프트 (기획서 9-2② · 기능 ② · 제품의 정체성)
//
//   지시: "기존 필드를 이 데이터에서 찾아라. 없으면 없다고 답하라"
//
// **"없으면 없다고 답하라" 가 이 프롬프트의 핵심이다.** 억지로 채운 매핑은
// 사용자가 나중에 발견하는 거짓말이 되고, 그 순간 제품 신뢰가 무너진다.
// 못 찾았다고 답하면 사용자에게 그 칸만 물어보면 된다 (보장선 B1).

import type { CollectionSchemaJson } from '@endpointer/core'

import { jsonBlock, KOREAN_LIST_SITE_NOTES, PATH_SYNTAX } from './shared'

export const MATCH_SYSTEM = `
당신은 이미 있는 표에 새 사이트의 데이터를 **끼워 맞추는** 사람이다.

지켜야 할 것:
1. 표의 각 칸에 해당하는 값이 새 데이터의 어디에 있는지 찾는다.
2. **확실하지 않으면 못 찾았다고 답한다.** 비슷해 보인다고 넣지 않는다.
   못 찾은 칸은 사람이 직접 알려줄 것이므로, 틀린 답보다 "없음" 이 훨씬 낫다.
3. 확신도를 정직하게 매긴다. 값의 모양까지 맞으면 높게, 키 이름만 비슷하면 낮게.
4. 설명 없이 JSON 객체 하나만 낸다.
`.trim()

export interface MatchPromptInput {
  /** 기존 컬렉션 스키마 */
  schema: CollectionSchemaJson
  /** 이미 표에 들어 있는 아이템 표본 — "이 칸에는 이런 값이 들어간다" 의 실례 */
  existingSample: unknown[]
  /** 새 사이트의 후보 데이터 표본 */
  candidateSample: unknown[]
  /** 새 사이트 주소 */
  url: string
  /** 새 후보의 fetch 모드 (경로 문법이 갈린다) */
  fetchMode: 'json' | 'html' | 'browser'
}

export function buildMatchPrompt(input: MatchPromptInput): string {
  const fieldLines = input.schema
    .map((f) => `- \`${f.key}\` (${f.label}) · 타입 ${f.type}${f.required ? ' · 필수' : ''}`)
    .join('\n')

  return [
    '# 할 일',
    `이미 쓰고 있는 표에 ${input.url} 의 데이터를 합치려 한다.`,
    '표의 각 칸에 해당하는 값이 새 데이터의 어디에 있는지 찾아라.',
    '**찾지 못한 칸은 missing 에 넣어라. 지어내지 마라.**',
    '',
    '# 표의 칸들',
    fieldLines,
    '',
    PATH_SYNTAX,
    `이번 데이터는 ${input.fetchMode} 방식이다.`,
    '',
    KOREAN_LIST_SITE_NOTES,
    '',
    jsonBlock('지금 표에 들어 있는 값의 예 (이런 모양이어야 한다)', input.existingSample, 4_000),
    '',
    jsonBlock('새 사이트에서 찾은 항목 표본', input.candidateSample, 8_000),
  ].join('\n')
}

/**
 * 매핑 결과의 구조화 출력 스키마.
 * core 의 `GeminiSchema` 와 같은 모양이지만 스펙 스키마가 아니라 매핑 전용이라 여기서 만든다.
 */
export function buildMatchResponseSchema(schema: CollectionSchemaJson): Record<string, unknown> {
  const matched: Record<string, unknown> = {}
  for (const field of schema) {
    matched[field.key] = {
      type: 'OBJECT',
      description: `${field.label} 을(를) 새 데이터에서 찾은 위치. 못 찾았으면 이 칸을 비운다`,
      properties: {
        path: { type: 'STRING', description: '항목 하나를 기준으로 한 경로' },
        confidence: { type: 'NUMBER', description: '0~1. 값의 모양까지 확인했으면 높게' },
        why: { type: 'STRING', description: '왜 이게 그 값이라고 판단했는지 한 문장 (한국어)' },
      },
      propertyOrdering: ['path', 'confidence', 'why'],
      required: ['path', 'confidence'],
    }
  }

  return {
    type: 'OBJECT',
    description: '기존 표의 칸들을 새 데이터에서 찾은 결과',
    properties: {
      list: { type: 'STRING', description: '항목 하나하나를 집는 경로' },
      dedupe_key: { type: 'STRING', description: '항목의 고유 식별자 위치. 안정적인 것이 없으면 비운다' },
      matched: {
        type: 'OBJECT',
        description: '찾은 칸들',
        properties: matched,
        propertyOrdering: Object.keys(matched),
      },
      missing: {
        type: 'ARRAY',
        description: '찾지 못한 칸의 키 목록. 사람에게 물어볼 것들이다',
        items: { type: 'STRING' },
      },
    },
    propertyOrdering: ['list', 'dedupe_key', 'matched', 'missing'],
    required: ['list', 'matched', 'missing'],
  }
}
