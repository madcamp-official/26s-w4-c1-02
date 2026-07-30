'use client'

import { useState } from 'react'
import { useActionState } from 'react'

import type { AttachPreview } from '@/lib/attach'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useActionToast } from '@/components/ui/toast'
import type { SuggestActionState } from '@/components/create-flow'
import { cn } from '@/lib/utils'

// 상태 타입이 여기 있는 이유: lib/attach.ts 는 서버 전용 모듈을 물고 있어서
// 클라이언트가 값을 import 하면 번들이 깨진다 (create-flow 와 동일한 규칙).

export interface AttachActionState {
  status: 'idle' | 'ready' | 'problem'
  message: string | null
  url: string
  pasted: Record<string, string>
  preview: AttachPreview | null
}

const ATTACH_IDLE: AttachActionState = {
  status: 'idle',
  message: null,
  url: '',
  pasted: {},
  preview: null,
}

const numberFormat = new Intl.NumberFormat('ko-KR')

function cell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'number') return numberFormat.format(value)
  return String(value)
}

function confidenceLabel(confidence: number): string {
  const percent = Math.round(confidence <= 1 ? confidence * 100 : confidence)
  return `확신 ${percent}%`
}

/**
 * 사이트 붙이기 (기능 ② — 제품의 정체성 · 보장선 B1).
 * 기존 열은 자동으로 찾아보고, 못 찾은 것만 값 붙여넣기로 묻는다. 셀렉터는 없다.
 */
const SUGGEST_IDLE: SuggestActionState = { status: 'idle', message: null, candidates: [] }

export function AttachFlow({
  initialUrl,
  preview: previewAction,
  save: saveAction,
  suggest: suggestAction,
}: {
  initialUrl: string
  preview: (prev: AttachActionState, formData: FormData) => Promise<AttachActionState>
  save: (prev: AttachActionState, formData: FormData) => Promise<AttachActionState>
  suggest: (prev: SuggestActionState, formData: FormData) => Promise<SuggestActionState>
}) {
  const [url, setUrl] = useState(initialUrl)
  const [previewState, previewFormAction, previewPending] = useActionState(
    previewAction,
    ATTACH_IDLE,
  )
  const [saveState, saveFormAction, savePending] = useActionState(saveAction, ATTACH_IDLE)
  const [suggestState, suggestFormAction, suggestPending] = useActionState(
    suggestAction,
    SUGGEST_IDLE,
  )
  const [pasteInputs, setPasteInputs] = useState<Record<string, string>>({})

  // 실패 문구는 오른쪽 위 팝업으로 (성공은 message 가 null 이라 아무것도 안 뜬다)
  useActionToast(previewState)
  useActionToast(saveState)

  const preview = previewState.preview

  return (
    <div className="flex flex-col gap-5">
      {/* 1. 주소 — 사용자가 입력하는 것은 이것과 값 붙여넣기뿐 (B1) */}
      <section className="rounded-card border border-border bg-surface p-6">
        <form action={previewFormAction} className="flex flex-col gap-2.5 sm:flex-row">
          <label htmlFor="attach-url" className="sr-only">
            붙일 사이트 주소
          </label>
          <input
            id="attach-url"
            name="entry_url"
            type="text"
            inputMode="url"
            autoComplete="url"
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            className={cn(
              'h-12 min-w-0 flex-1 rounded-[9px] border-[1.5px] border-border-strong bg-raised px-4',
              'font-mono text-sm text-ink placeholder:text-faint',
              'focus:border-accent focus:outline-2 focus:outline-offset-2 focus:outline-accent',
            )}
          />
          <Button type="submit" size="lg" disabled={previewPending}>
            {previewPending ? '맞춰보는 중…' : '이 사이트 붙이기'}
          </Button>
        </form>

        {previewPending && (
          <div className="mt-5 flex items-center gap-3 border-t border-divider pt-4">
            <span className="inline-block size-[18px] animate-spin rounded-full border-[2.5px] border-accent-line border-t-accent" />
            <span className="text-sm text-muted">기존 열을 이 사이트에서 찾아보는 중이에요…</span>
          </div>
        )}

        {/* 자연어로 붙일 사이트 찾기 (ADR A42) — 후보를 누르면 위 주소칸이 채워진다 */}
        <details className="group mt-4 border-t border-divider pt-4">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-[13px] font-semibold text-muted select-none hover:text-accent">
            <span className="inline-block text-[11px] transition-transform group-open:rotate-90">▸</span>
            주소를 모르겠으면 — 이 표에 더할 걸 말로 적어보세요
          </summary>
          <form action={suggestFormAction} className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              name="query"
              type="text"
              placeholder="예: 디자인 공모전도 더 모으고 싶어"
              className={cn(
                'h-11 min-w-0 flex-1 rounded-[9px] border-[1.5px] border-border-strong bg-raised px-4',
                'text-sm text-ink placeholder:text-faint',
                'focus:border-accent focus:outline-2 focus:outline-offset-2 focus:outline-accent',
              )}
            />
            <Button type="submit" variant="outline" disabled={suggestPending}>
              {suggestPending ? '찾는 중…' : '후보 찾기'}
            </Button>
          </form>

          {suggestState.message !== null && (
            <p className="mt-2 text-[13px] text-faint">{suggestState.message}</p>
          )}

          {suggestState.candidates.length > 0 && (
            <div className="mt-3 flex flex-col gap-2">
              <p className="text-xs text-faint">
                아래는 추천일 뿐이에요 — 누르면 위 주소칸에 채워져요. 붙이기 전에 실제로 확인해요.
              </p>
              {suggestState.candidates.map((c) => {
                const isCurrent = c.url === url.trim()
                return (
                  <div
                    key={c.url}
                    className="flex items-start gap-3 rounded-[10px] border border-border bg-surface px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] font-semibold text-ink">{c.title}</div>
                      <div className="truncate font-mono text-xs text-faint">{c.url}</div>
                      {c.why !== null && <div className="mt-0.5 text-xs text-muted">{c.why}</div>}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant={isCurrent ? 'ghost' : 'outline'}
                      disabled={isCurrent}
                      onClick={() => setUrl(c.url)}
                    >
                      {isCurrent ? '골랐음' : '이 주소로'}
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </details>
      </section>

      {/* 2. 맞춰본 결과 */}
      {preview !== null && !previewPending && (
        <section className="flex flex-col gap-4 rounded-card border border-border bg-surface p-6">
          <div className="text-[15px] font-bold text-ink">
            {preview.attached.length + preview.missing.length}개 열 중 {preview.attached.length}개를
            찾았어요
          </div>

          <div className="flex flex-col gap-2.5">
            {preview.attached.map((field) => (
              <div
                key={field.key}
                className="flex flex-wrap items-center gap-3 rounded-[9px] bg-raised px-3.5 py-2.5"
              >
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-ok-soft text-[11px] font-extrabold text-ok">
                  ✓
                </span>
                <span className="min-w-[90px] text-sm font-semibold text-ink">{field.label}</span>
                <Badge tone={field.origin === 'pasted' ? 'accent' : 'neutral'}>
                  {field.origin === 'pasted' ? '붙여넣은 값으로 찾음' : confidenceLabel(field.confidence)}
                </Badge>
                {field.samples.length > 0 && (
                  <span className="min-w-0 flex-1 truncate text-[13px] text-faint">
                    예: {field.samples.slice(0, 2).join(' · ')}
                  </span>
                )}
              </div>
            ))}

            {preview.missing.map((field) => (
              <div
                key={field.key}
                className="flex flex-col gap-2.5 rounded-xl border border-healing-line bg-healing-soft px-4 py-3.5"
              >
                <div className="text-sm font-bold text-healing-deep">
                  ‘{field.label}’ 은(는) 이 사이트에서 못 찾았어요
                </div>
                <div className="text-[13px] text-healing-deep/80">
                  이 사이트에서 {field.label}에 해당하는 값을 하나 복사해 붙여넣어 주세요. 위치는
                  저희가 찾을게요.
                </div>
                {/* 아래 입력은 위 미리보기 폼과 같이 제출된다 — form 속성으로 연결 */}
                <input
                  form="attach-preview-retry"
                  name={`pasted_${field.key}`}
                  value={pasteInputs[field.key] ?? ''}
                  onChange={(e) =>
                    setPasteInputs((prev) => ({ ...prev, [field.key]: e.target.value }))
                  }
                  placeholder="예: 최대 100,000천원 · D-32"
                  className={cn(
                    'h-10 rounded-lg border-[1.5px] border-healing-line bg-surface px-3.5 text-[13px]',
                    'placeholder:text-faint focus:border-accent focus:outline-none',
                  )}
                />
              </div>
            ))}
          </div>

          {/* 붙여넣기 처리 결과 */}
          {preview.pasted.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {preview.pasted.map((report) => (
                <p
                  key={report.key}
                  className={cn(
                    'text-[13px] font-semibold',
                    report.ok ? 'text-ok' : 'text-attention',
                  )}
                >
                  {report.ok
                    ? `✓ 붙여넣은 값의 위치를 찾았어요 — 표본: ${report.found}`
                    : `✗ ${report.message}`}
                </p>
              ))}
            </div>
          )}

          {preview.warnings.length > 0 && (
            <div className="flex flex-col gap-1">
              {preview.warnings.map((warning) => (
                <p key={warning} className="text-[13px] text-healing-deep">
                  ⚠ {warning}
                </p>
              ))}
            </div>
          )}

          {/* 못 찾은 칸에 값을 넣고 다시 맞춰보기 — 같은 미리보기 액션을 다시 부른다 */}
          {preview.missing.length > 0 && (
            <form id="attach-preview-retry" action={previewFormAction}>
              <input type="hidden" name="entry_url" value={previewState.url} />
              {Object.entries(previewState.pasted).map(([key, value]) => (
                <input key={key} type="hidden" name={`pasted_${key}`} value={value} />
              ))}
              <Button type="submit" variant="outline" disabled={previewPending}>
                이 값으로 찾기
              </Button>
            </form>
          )}

          {/* 미리보기 표 */}
          {preview.rows.length > 0 && (
            <div className="scroll-x rounded-card border border-border bg-surface">
              <table className="w-full border-collapse text-[13px]">
                <thead className="bg-canvas">
                  <tr>
                    {preview.attached.map((field) => (
                      <th
                        key={field.key}
                        className="border-b border-border px-4 py-2.5 text-xs font-bold whitespace-nowrap text-muted"
                      >
                        {field.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 6).map((row, rowIndex) => (
                    <tr key={rowIndex} className="border-b border-divider last:border-b-0">
                      {preview.attached.map((field) => (
                        <td
                          key={field.key}
                          className="max-w-[300px] overflow-hidden px-4 py-2.5 text-ellipsis whitespace-nowrap text-ink"
                        >
                          {cell(row[field.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 3. 합류 — 주소와 붙여넣은 값만 다시 보낸다 */}
          <form action={saveFormAction} className="flex flex-col gap-2.5">
            <input type="hidden" name="entry_url" value={previewState.url} />
            {Object.entries(previewState.pasted).map(([key, value]) => (
              <input key={key} type="hidden" name={`pasted_${key}`} value={value} />
            ))}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" size="lg" disabled={savePending}>
                {savePending ? '합류하는 중…' : '표에 합류하기 →'}
              </Button>
              {preview.missing.length > 0 && (
                <span className="text-[13px] text-faint">
                  못 찾은 열이 남아 있어도 합류할 수 있어요 — 그 열만 비어 있게 됩니다.
                </span>
              )}
            </div>
          </form>
        </section>
      )}
    </div>
  )
}
