// enum 값 매핑 제안 (기획서 5장③ · 9-2③ — 기능 ③ 타입 정규화의 마지막 조각)
//
//   입력: 소스별 관찰값 (items 에서 실제로 센 것)
//   출력: `mapping`(원값→키) + `value_labels`(키→표시 이름) + 묶이지 않은 값 목록
//
// LLM 은 여기서 **제안만** 한다. 스키마에 앉히는 것은 사용자가 제안을 보고 승인한
// 다음이고(CLI `map-enums` 의 --apply), 앉힌 뒤에는 정기 수집이 LLM 없이
// `parseEnum` 매핑 테이블만으로 돈다 (원칙 ① — LLM 은 만들 때와 고칠 때만).
//
// 파서가 관문이다: 지어낸 원값 제거 · 키 패턴 강제 · 중복 원값은 첫 그룹 승리.
// 관찰값 목록 밖의 member 를 통과시키면 "말한 것과 저장한 것"이 갈라진다.

import { getConfig } from '../config'
import { childLogger } from '../logger'
import { generateJson, type GeminiFailureReason } from './gemini'
import { buildEnumMapPrompt, buildEnumMapResponseSchema, MAP_ENUM_SYSTEM } from './prompts/map-enums'

const log = childLogger({ mod: 'map-enums' })

/** enum 값 키의 형태 — 필드 키와 같은 규칙 (REST `?category=export` 로 그대로 나간다) */
const VALUE_KEY_PATTERN = /^[a-z][a-z0-9_]*$/

export interface EnumValueMapping {
  /** `FieldDef.mapping` 에 그대로 들어갈 원값→키 */
  mapping: Record<string, string>
  /** `FieldDef.value_labels` 에 그대로 들어갈 키→표시 이름 */
  value_labels: Record<string, string>
  /** 제안에서 빠졌거나 관문에서 걸러져 아직 묶이지 않은 원값 */
  unmapped: string[]
}

export type MapEnumsOutcome =
  | { ok: true; result: EnumValueMapping }
  | { ok: false; reason: GeminiFailureReason | 'bad_output'; message: string }

export interface MapEnumsInput {
  collection_id: string
  collectionName: string
  fieldKey: string
  fieldLabel: string
  /** 소스별 관찰값 — CLI 가 items 에서 세어 온다 */
  observed: ReadonlyArray<{ host: string; value: string; count: number }>
}

export async function mapEnumValues(input: MapEnumsInput): Promise<MapEnumsOutcome> {
  const cfg = getConfig()

  const out = await generateJson({
    // 필드 매핑과 같은 계열의 판단이라 모델도 예산 계정도 match 를 같이 쓴다
    model: cfg.geminiModelMatch,
    system: MAP_ENUM_SYSTEM,
    prompt: buildEnumMapPrompt({
      collectionName: input.collectionName,
      fieldLabel: input.fieldLabel,
      observed: input.observed,
    }),
    responseSchema: buildEnumMapResponseSchema(),
    scope: { kind: 'match', collection_id: input.collection_id },
    purpose: `map-enums-${input.fieldKey}`,
  })

  if (!out.ok) return { ok: false, reason: out.reason, message: out.message }

  const parsed = parseEnumMapOutput(
    out.text,
    input.observed.map((o) => o.value),
  )
  if (parsed === null) {
    return { ok: false, reason: 'bad_output', message: '분류를 묶어내지 못했어요. 잠시 뒤 다시 시도해 주세요.' }
  }

  log.info(
    {
      field: input.fieldKey,
      values: input.observed.length,
      groups: new Set(Object.values(parsed.mapping)).size,
      unmapped: parsed.unmapped.length,
    },
    'enum 값 매핑 제안',
  )
  return { ok: true, result: parsed }
}

interface RawGroup {
  key: string
  label: string
  members: string[]
}

/** zod 없이 손으로 굳힌다 — worker 는 zod 를 직접 물지 않는다 (match-fields 와 같은 선례) */
function readGroups(input: unknown): RawGroup[] | null {
  if (input === null || typeof input !== 'object') return null
  const groups = (input as Record<string, unknown>)['groups']
  if (!Array.isArray(groups)) return null

  const out: RawGroup[] = []
  for (const g of groups) {
    if (g === null || typeof g !== 'object') return null
    const { key, label, members } = g as Record<string, unknown>
    if (typeof key !== 'string' || typeof label !== 'string' || !Array.isArray(members)) return null
    if (!members.every((m): m is string => typeof m === 'string')) return null
    out.push({ key, label, members })
  }
  return out
}

/**
 * 모델 출력을 EnumValueMapping 으로 굳힌다. 실패는 null.
 *
 * 관문 규칙 — 하나라도 어기면 그 조각만 버리고 나머지는 살린다 (부분 성공이 1급 시민):
 * - 관찰값 목록에 없는 member 는 버린다 (지어낸 값)
 * - 키가 snake_case 가 아니면 그 그룹을 통째로 버린다 (URL 에 나가는 값이다)
 * - 같은 원값이 두 그룹에 나오면 첫 그룹이 이긴다
 * - label 이 비면 첫 member 를 표시 이름으로 쓴다
 */
export function parseEnumMapOutput(raw: unknown, observedValues: readonly string[]): EnumValueMapping | null {
  let input: unknown = raw
  if (typeof raw === 'string') {
    try {
      input = JSON.parse(stripFence(raw))
    } catch {
      return null
    }
  }

  const groups = readGroups(input)
  if (groups === null) return null

  const observed = new Set(observedValues)
  const mapping: Record<string, string> = {}
  const value_labels: Record<string, string> = {}

  for (const group of groups) {
    const key = group.key.trim()
    if (!VALUE_KEY_PATTERN.test(key)) continue

    const members = group.members.map((m) => m.trim()).filter((m) => observed.has(m) && !(m in mapping))
    if (members.length === 0) continue

    for (const m of members) mapping[m] = key
    // 같은 키가 두 그룹에 나오면 먼저 정한 표시 이름을 지킨다
    if (!(key in value_labels)) {
      const label = group.label.trim()
      value_labels[key] = label !== '' ? label : (members[0] ?? key)
    }
  }

  if (Object.keys(mapping).length === 0) return null

  const unmapped = observedValues.filter((v) => !(v in mapping))
  return { mapping, value_labels, unmapped }
}

function stripFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
}
