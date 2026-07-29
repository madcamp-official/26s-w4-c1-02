import type { FieldDef } from '@endpointer/core'
import { RANGE_FIELD_TYPES } from '@endpointer/core/query'

import { ApiSnippets } from '@/components/api-snippets'
import { CopyButton } from '@/components/copy-button'
import { FIELD_TYPE_HINT } from '@/lib/labels'
import { COPY } from '@/lib/labels'

/** 이 칸에 걸 수 있는 API 파라미터 — 실제 파서(query/params.ts)와 같은 규칙이라야 한다 */
function paramsFor(field: FieldDef): string[] {
  const out = [`${field.key}=`]
  if (RANGE_FIELD_TYPES.includes(field.type)) out.push(`${field.key}_gte=`, `${field.key}_lte=`)
  return out
}

/**
 * 보장선 B5·B7 — 개발자를 위한 것은 **빼지 않는다.**
 *
 * '연결' 탭에서는 AI 연결 카드와 나란히 **상시 펼쳐** 둔다. 두 출구는 대등하고
 * 어느 쪽을 쓸지는 사람마다 다른데, 한쪽만 접어 두면 그 자체가 순위 매김이 된다.
 * (표 탭처럼 개발자용이 곁다리인 화면에서 쓸 거면 `collapsible` 을 켠다.)
 *
 * mcpUrl 을 주지 않으면 API 부분만 그린다 (MCP 는 '연결' 탭의 왼쪽 카드가 담당).
 * fields 를 주면 응답 스키마(칸·타입·파라미터)를 같이 보여준다 — 주소만으론 뭘 쓸 수 있는지 모른다.
 */
export function DeveloperDetails({
  apiUrl,
  mcpUrl,
  fields,
  sampleJson,
  collapsible = false,
}: {
  apiUrl: string
  mcpUrl?: string
  fields?: readonly FieldDef[]
  /** 실제 응답 샘플(JSON 문자열). 지어내지 않고 서버가 실제로 조회해 넘긴다 */
  sampleJson?: string | null
  /** 접었다 펼 수 있게 할지. 기본은 상시 펼침 (머리말 참조) */
  collapsible?: boolean
}) {
  const body = (
    <>
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-muted">{COPY.apiLabel}</span>
        <div className="flex flex-wrap items-center gap-2">
          <code className="scroll-x rounded-lg bg-[oklch(0.2_0.008_277)] px-4 py-3 font-mono text-xs text-[oklch(0.89_0.005_277)]">
            <span className="text-[oklch(0.67_0.007_277)]">GET</span> {apiUrl}
          </code>
          <CopyButton value={apiUrl} />
        </div>
        <p className="text-xs leading-relaxed text-faint">
          응답에는 <code className="font-mono">items · sources · schema_version</code> 이 항상 함께
          와요 — 사이트 하나가 아파도 나머지는 정상 응답이에요.
          <br />
          공통: 정렬 <code className="font-mono">?sort=-amount</code> · 신규만{' '}
          <code className="font-mono">?since=2026-07-20</code> · 출처{' '}
          <code className="font-mono">?source=…</code> · 검색 <code className="font-mono">?q=…</code>
        </p>
      </div>

        {/* 코드로 붙이기 — cURL·JS·Python·응답 JSON 을 골라 복사 */}
        <ApiSnippets apiUrl={apiUrl} sampleJson={sampleJson ?? null} />

        {/* 응답 스키마 — 어떤 칸이 오고, 칸마다 어떤 조건을 걸 수 있나 (get_schema 와 같은 내용) */}
        {fields !== undefined && fields.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-muted">응답 칸 · 걸 수 있는 조건</span>
            <div className="scroll-x rounded-lg border border-border">
              <table className="w-full border-collapse text-xs">
                <thead className="bg-canvas text-faint">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">칸</th>
                    <th className="px-3 py-2 text-left font-semibold">종류</th>
                    <th className="px-3 py-2 text-left font-semibold">파라미터</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((field) => {
                    const enumKeys =
                      field.type === 'enum' && field.value_labels
                        ? Object.keys(field.value_labels)
                        : []
                    return (
                      <tr key={field.key} className="border-t border-divider">
                        <td className="px-3 py-2 align-top">
                          <code className="font-mono text-ink">{field.key}</code>
                          <span className="ml-1.5 text-faint">{field.label}</span>
                        </td>
                        <td className="px-3 py-2 align-top whitespace-nowrap text-muted">
                          {FIELD_TYPE_HINT[field.type]}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <span className="flex flex-wrap gap-1">
                            {paramsFor(field).map((p) => (
                              <code
                                key={p}
                                className="rounded bg-raised px-1.5 py-0.5 font-mono text-[11px] text-muted"
                              >
                                ?{p}
                              </code>
                            ))}
                          </span>
                          {enumKeys.length > 0 && (
                            <span className="mt-1 block text-[11px] text-faint">
                              값: {enumKeys.map((k) => `${k}`).join(' · ')}
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-faint">
              필터·정렬은 응답의 <code className="font-mono">items</code> 를 그대로 좁혀요 — 표에서 건
              조건이 곧 이 파라미터예요.
            </p>
          </div>
        )}

      {mcpUrl !== undefined && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-muted">{COPY.mcpLabel}</span>
          <p className="text-xs text-faint">{COPY.mcpHelp}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="scroll-x rounded-lg bg-raised px-3 py-2 font-mono text-xs text-ink">
              {mcpUrl}
            </code>
            <CopyButton value={mcpUrl} label="주소 복사" />
          </div>
        </div>
      )}
    </>
  )

  // 곁다리로 쓰는 화면(표 탭 등)에서만 접는다
  if (collapsible) {
    return (
      <details className="group rounded-card border border-border bg-surface">
        <summary className="flex cursor-pointer list-none items-center gap-2.5 px-5 py-3.5 text-[13.5px] font-semibold text-muted select-none hover:text-accent">
          <span className="inline-block text-[11px] transition-transform group-open:rotate-90">▸</span>
          {COPY.developerSummary}
        </summary>
        <div className="flex flex-col gap-5 border-t border-divider px-5 py-4">{body}</div>
      </details>
    )
  }

  // 기본 — AI 연결 카드와 같은 껍데기(제목 + 설명 + 본문)로 상시 펼침
  return (
    <section className="rounded-card border border-border bg-surface p-7">
      <h2 className="mb-1 text-base font-bold text-ink">{COPY.developerSummary}</h2>
      <p className="mb-4 text-[13px] leading-relaxed text-faint">{COPY.developerBody}</p>
      <div className="flex flex-col gap-5">{body}</div>
    </section>
  )
}
