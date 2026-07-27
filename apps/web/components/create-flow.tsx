'use client'

import { useEffect, useRef, useState } from 'react'
import { useActionState } from 'react'

import type { FieldDef } from '@endpointer/core'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FIELD_TYPE_HINT } from '@/lib/labels'
import type { CreatePreview } from '@/lib/create'
import { cn } from '@/lib/utils'

// 상태 타입이 여기 있는 이유: lib/create.ts 는 lib/db.ts 를 물고 있어서
// 클라이언트가 import 하면 postgres 가 브라우저 번들로 딸려 온다 (subscribe-form 과 동일).

export interface PreviewActionState {
  status: 'idle' | 'ready' | 'problem'
  message: string | null
  preview: CreatePreview | null
}

export interface CreateActionState {
  status: 'idle' | 'problem'
  message: string | null
}

const PREVIEW_IDLE: PreviewActionState = { status: 'idle', message: null, preview: null }
const CREATE_IDLE: CreateActionState = { status: 'idle', message: null }

/** 살펴보는 동안 보여줄 단계 (기획서 9-1 의 사람 말 버전 — 내부 명사 없음 · B2) */
const PROBE_STEPS = [
  '페이지를 열어봤어요',
  '목록 구조를 찾았어요',
  '열 이름과 종류를 추측했어요',
  '날짜·금액을 같은 형식으로 맞췄어요',
] as const

// 실제 파이프라인은 수 초~수십 초 걸린다. 마지막 단계에서 멈춰 기다린다
const STEP_INTERVAL_MS = 2500

const numberFormat = new Intl.NumberFormat('ko-KR')

/** 정규화된 값을 표시용으로. 표 화면(collection-table)과 같은 규칙이다 */
function formatValue(value: unknown, field: FieldDef): string {
  if (value === null || value === undefined || value === '') return '—'
  switch (field.type) {
    case 'money':
      return typeof value === 'number' ? `${numberFormat.format(value)}원` : String(value)
    case 'number':
      return typeof value === 'number' ? numberFormat.format(value) : String(value)
    case 'enum':
      return field.value_labels?.[String(value)] ?? String(value)
    default:
      return String(value)
  }
}

function ProbeSteps({ activeStep, allDone }: { activeStep: number; allDone: boolean }) {
  return (
    <div className="mt-6 flex flex-col gap-3 border-t border-divider pt-5">
      {PROBE_STEPS.map((label, index) => {
        const done = allDone || index < activeStep
        const active = !allDone && index === activeStep
        return (
          <div key={label} className="flex items-center gap-3">
            <span
              className={cn(
                'inline-flex size-[22px] items-center justify-center rounded-full text-xs font-bold',
                done && 'bg-ok-soft text-ok',
                active &&
                  'animate-spin rounded-full border-[2.5px] border-accent-line border-t-accent',
                !done && !active && 'bg-divider text-faint',
              )}
            >
              {done ? '✓' : active ? '' : index + 1}
            </span>
            <span
              className={cn(
                'text-sm',
                done || active ? 'font-semibold text-ink' : 'text-faint',
              )}
            >
              {label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/**
 * 컬렉션 생성 플로우 (기획서 9-1 · 보장선 B1·B3 · ADR A30).
 * 사용자가 입력하는 것은 주소뿐이고, 빈 스키마 에디터 대신 워커가 실제로 수집해
 * 정규화까지 마친 "이미 채워진 표"를 받는다. 사용자는 이름을 바꾸고 열을 지울 뿐이다.
 *
 * TODO(G2): 못 찾은 열을 값 붙여넣기로 해결하는 경로(기능 ② · traceValue)는
 *           "사이트 붙이기" 화면에서 이어진다 — 워커의 attach 경로가 그 담당이다.
 */
export function CreateFlow({
  initialUrl,
  preview: previewAction,
  create: createAction,
}: {
  initialUrl: string
  preview: (prev: PreviewActionState, formData: FormData) => Promise<PreviewActionState>
  create: (prev: CreateActionState, formData: FormData) => Promise<CreateActionState>
}) {
  const [url, setUrl] = useState(initialUrl)
  const [previewState, previewFormAction, previewPending] = useActionState(
    previewAction,
    PREVIEW_IDLE,
  )
  const [createState, createFormAction, createPending] = useActionState(createAction, CREATE_IDLE)

  // 살펴보는 동안의 단계 연출 — 마지막 단계에서 멈춰 서버 응답을 기다린다
  const [activeStep, setActiveStep] = useState(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (previewPending) {
      setActiveStep(0)
      timer.current = setInterval(
        () => setActiveStep((s) => Math.min(s + 1, PROBE_STEPS.length - 1)),
        STEP_INTERVAL_MS,
      )
    }
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [previewPending])

  // 편집 상태 — 미리보기에서 지운 열
  const [removedKeys, setRemovedKeys] = useState<string[]>([])
  const [name, setName] = useState('')

  const preview = previewState.preview
  useEffect(() => {
    if (preview) {
      setRemovedKeys([])
      setName(preview.suggestedName)
    }
  }, [preview])

  const keptFields = preview ? preview.fields.filter((f) => !removedKeys.includes(f.key)) : []

  return (
    <div className="flex flex-col gap-7">
      {/* 1. 주소 입력 (보장선 B1 — 다른 건 묻지 않는다) */}
      <section className="rounded-card border border-border bg-surface p-6">
        <form action={previewFormAction} className="flex flex-col gap-2.5 sm:flex-row">
          <label htmlFor="create-url" className="sr-only">
            지켜보고 싶은 목록 페이지 주소
          </label>
          <input
            id="create-url"
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
            표 만들기
          </Button>
        </form>

        {previewState.status === 'problem' && previewState.message !== null && (
          <p className="mt-3 rounded-[10px] bg-attention-soft px-4 py-3 text-sm text-attention">
            {previewState.message}
          </p>
        )}

        {(previewPending || preview !== null) && (
          <ProbeSteps activeStep={activeStep} allDone={preview !== null && !previewPending} />
        )}
      </section>

      {/* 2. 이미 채워진 표 (보장선 B3) — 워커가 실제로 수집·정규화한 값이다 */}
      {preview !== null && !previewPending && (
        <section className="flex flex-col gap-4">
          <div className="flex items-center gap-2.5">
            <span className="flex size-6 items-center justify-center rounded-full bg-ok-soft text-[13px] font-extrabold text-ok">
              ✓
            </span>
            <div>
              <div className="text-base font-bold text-ink">표가 준비됐어요</div>
              <div className="text-[13px] text-faint">
                <span className="font-mono">{preview.host}</span> 에서 {preview.rows.length}개
                항목을 담아왔어요. 이름을 바꾸거나, 필요 없는 열은 ✕로 지워보세요.
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {keptFields.map((f) => (
              <span
                key={f.key}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-surface py-1.5 pr-2 pl-3.5 text-[13px] font-semibold text-ink"
              >
                {f.label}
                <Badge tone="accent">{FIELD_TYPE_HINT[f.type]}</Badge>
                {keptFields.length > 1 && (
                  <button
                    type="button"
                    aria-label={`${f.label} 열 지우기`}
                    onClick={() => setRemovedKeys((prev) => [...prev, f.key])}
                    className="flex size-[18px] items-center justify-center rounded-full text-[11px] text-faint hover:bg-divider hover:text-ink"
                  >
                    ✕
                  </button>
                )}
              </span>
            ))}
            {removedKeys.length > 0 && (
              <button
                type="button"
                onClick={() => setRemovedKeys([])}
                className="text-[13px] text-faint underline underline-offset-2 hover:text-accent"
              >
                지운 열 되살리기
              </button>
            )}
          </div>

          <div className="scroll-x rounded-card border border-border bg-surface">
            <table className="w-full border-collapse text-[13px]">
              <thead className="bg-canvas">
                <tr>
                  {keptFields.map((f) => (
                    <th
                      key={f.key}
                      className="border-b border-border px-4 py-2.5 text-xs font-bold whitespace-nowrap text-muted"
                    >
                      {f.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 8).map((row, rowIndex) => (
                  <tr key={rowIndex} className="border-b border-divider last:border-b-0">
                    {keptFields.map((f) => (
                      <td
                        key={f.key}
                        className="max-w-[320px] overflow-hidden px-4 py-3 text-ellipsis whitespace-nowrap text-ink"
                      >
                        {formatValue(row[f.key], f)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.rows.length > 8 && (
            <p className="-mt-2 text-xs text-faint">
              미리보기는 8개까지만 — 만들고 나면 전부 표에 담깁니다.
            </p>
          )}

          {/* 3. 확정 — 주소만 다시 보낸다. 지운 열은 저장 뒤 표 구성에서 빠진다 */}
          <form action={createFormAction} className="flex flex-col gap-3">
            <input type="hidden" name="entry_url" value={preview.entryUrl} />
            <input
              type="hidden"
              name="kept_keys"
              value={JSON.stringify(keptFields.map((f) => f.key))}
            />
            <label htmlFor="create-name" className="text-[13px] font-bold text-muted">
              컬렉션 이름
            </label>
            <input
              id="create-name"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={cn(
                'h-11 max-w-md rounded-[9px] border-[1.5px] border-border-strong bg-surface px-3.5',
                'text-sm font-semibold text-ink focus:border-accent focus:outline-none',
              )}
            />
            {createState.status === 'problem' && createState.message !== null && (
              <p className="rounded-[10px] bg-attention-soft px-4 py-3 text-sm text-attention">
                {createState.message}
              </p>
            )}
            <div>
              <Button type="submit" size="lg" disabled={createPending}>
                {createPending ? '만드는 중이에요…' : '이 표로 컬렉션 만들기'}
              </Button>
            </div>
          </form>
        </section>
      )}
    </div>
  )
}
