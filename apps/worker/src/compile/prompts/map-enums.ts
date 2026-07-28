// enum 값 매핑 프롬프트 (기획서 5장③ · 9-2③ — "같은 뜻의 다른 말을 한 번 묶으면 기억한다")
//
//   지시: "뜻이 같은 분류어만 묶어라. 확실하지 않으면 혼자 두어라"
//
// **억지로 묶인 분류는 필터를 조용한 거짓말쟁이로 만든다.** `수출` 과 `창업` 을 한 그룹에
// 넣어도 표는 멀쩡해 보인다 — 사용자가 필터를 걸었을 때에야 엉뚱한 항목이 섞여 나온다.
// 그래서 못 묶겠으면 값 하나짜리 그룹으로 혼자 두는 것이 정답이라고 못박는다.
// (제안은 사용자가 확인한 뒤에만 적용된다 — 정의는 사용자가, 관찰은 시스템이)

export const MAP_ENUM_SYSTEM = `
당신은 여러 사이트가 제각각의 말로 적은 분류어를 **한 벌의 분류 체계로 묶는** 사람이다.

지켜야 할 것:
1. **뜻이 같은 값만 묶는다.** "기술개발" 과 "R&D" 는 같은 뜻이므로 한 그룹이다.
   "수출" 과 "창업" 은 다른 뜻이므로 절대 묶지 않는다.
2. **확실하지 않으면 값 하나짜리 그룹으로 혼자 둔다.** 틀리게 묶는 것보다 훨씬 낫다.
3. 아래 목록에 있는 원값만 쓴다. 목록에 없는 값을 지어내지 않는다.
4. 모든 원값은 정확히 한 그룹에만 들어간다.
5. 설명 없이 JSON 객체 하나만 낸다.
`.trim()

export interface EnumMapPromptInput {
  /** 컬렉션 이름 — 분류어가 어떤 주제의 말인지 맥락을 준다 */
  collectionName: string
  /** 묶을 필드의 표시 이름 (예: "분류") */
  fieldLabel: string
  /** 소스별 관찰값 — 실제 items 에서 세어 온 것이지 지어낸 목록이 아니다 */
  observed: ReadonlyArray<{ host: string; value: string; count: number }>
}

export function buildEnumMapPrompt(input: EnumMapPromptInput): string {
  // 사이트별로 묶어 보여준다 — "같은 사이트 안에서는 이미 구분된 값" 이라는 힌트가 된다
  const byHost = new Map<string, { value: string; count: number }[]>()
  for (const o of input.observed) {
    const list = byHost.get(o.host) ?? []
    list.push({ value: o.value, count: o.count })
    byHost.set(o.host, list)
  }
  const valueLines = [...byHost.entries()]
    .map(([host, values]) => {
      const lines = values.map((v) => `  - ${v.value} (${v.count}건)`).join('\n')
      return `${host}:\n${lines}`
    })
    .join('\n')

  return [
    '# 할 일',
    `"${input.collectionName}" 표의 "${input.fieldLabel}" 칸에 여러 사이트의 분류어가 제각각의 말로 섞여 있다.`,
    '뜻이 같은 값끼리 그룹으로 묶고, 그룹마다 기계용 키와 화면용 이름을 붙여라.',
    '',
    '# 그룹의 형식',
    '- `key`: 영어 소문자 snake_case (예: `export`, `rnd`). 주소창의 필터 값으로 그대로 쓰인다.',
    '- `label`: 화면에 보일 한국어 이름. 여러 값을 묶었으면 다 아우르는 말로 짓는다 (예: "수출·해외진출").',
    '- `members`: 이 그룹에 속하는 원값들. **아래 목록의 표기를 한 글자도 바꾸지 말고 그대로** 적는다.',
    '',
    '# 사이트별 관찰값 (이 목록이 전부다)',
    valueLines,
    '',
    '같은 사이트 안의 두 값은 이미 서로 다른 분류이므로, 같은 그룹에 넣으려면 특별한 이유가 있어야 한다.',
    '**확실하지 않으면 값 하나짜리 그룹으로 혼자 두어라.**',
  ].join('\n')
}

/**
 * 구조화 출력 스키마.
 * 배열에 maxItems 를 넣지 않는다 — anyOf 항목 배열에 maxItems 가 붙으면 Gemini 가
 * 스키마 전체를 400 으로 거부한 전례가 있고(G1 지뢰), 개수 제한은 파서가 지킨다.
 */
export function buildEnumMapResponseSchema(): Record<string, unknown> {
  return {
    type: 'OBJECT',
    description: '분류어를 뜻이 같은 것끼리 묶은 결과',
    properties: {
      groups: {
        type: 'ARRAY',
        description: '분류 그룹 목록. 모든 원값이 정확히 한 그룹에 들어가야 한다',
        items: {
          type: 'OBJECT',
          properties: {
            key: { type: 'STRING', description: '영어 소문자 snake_case 키 (예: export)' },
            label: { type: 'STRING', description: '화면에 보일 한국어 이름' },
            members: {
              type: 'ARRAY',
              description: '이 그룹에 속하는 원값들 — 관찰값 목록의 표기 그대로',
              items: { type: 'STRING' },
            },
          },
          propertyOrdering: ['key', 'label', 'members'],
          required: ['key', 'label', 'members'],
        },
      },
    },
    required: ['groups'],
  }
}
