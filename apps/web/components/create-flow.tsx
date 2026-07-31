'use client'

import { useEffect, useRef, useState } from 'react'
import { useActionState } from 'react'

import type { FieldDef } from '@endpointer/core'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useActionToast } from '@/components/ui/toast'
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

/** 자연어 추천 결과 (ADR A42). 후보는 제안일 뿐 — 사용자가 골라 담는다 */
export interface SourceSuggestionView {
  url: string
  title: string
  why: string | null
}

export interface SuggestActionState {
  status: 'idle' | 'ready' | 'empty' | 'problem'
  message: string | null
  candidates: SourceSuggestionView[]
}

const PREVIEW_IDLE: PreviewActionState = { status: 'idle', message: null, preview: null }
const CREATE_IDLE: CreateActionState = { status: 'idle', message: null }
const SUGGEST_IDLE: SuggestActionState = { status: 'idle', message: null, candidates: [] }

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
    <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-5">
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
 * 왼쪽에서 주소를 담고(직접 붙여넣기 · 말로 찾기), 오른쪽 "담은 사이트" 카드에서 만든다 —
 * 입력과 실행을 분리해 "무엇으로 만드는지"가 항상 눈에 보이게 한다.
 * 빈 스키마 에디터 대신 워커가 실제로 수집·정규화한 "이미 채워진 표"를 받고,
 * 사용자는 이름을 바꾸고 열을 지울 뿐이다.
 */
export function CreateFlow({
  initialUrl,
  preview: previewAction,
  create: createAction,
  suggest: suggestAction,
}: {
  initialUrl: string
  preview: (prev: PreviewActionState, formData: FormData) => Promise<PreviewActionState>
  create: (prev: CreateActionState, formData: FormData) => Promise<CreateActionState>
  suggest: (prev: SuggestActionState, formData: FormData) => Promise<SuggestActionState>
}) {
  // 입력칸의 현재 글자 — "담기"를 누르면 바구니로 들어간다
  const [draft, setDraft] = useState('')
  // 담은 주소들. 첫 화면에서 주소를 들고 왔으면(?url=) 이미 담긴 채로 시작한다
  const [basket, setBasket] = useState<string[]>(() => {
    const seeded = initialUrl.trim()
    return seeded === '' ? [] : [seeded]
  })
  const [previewState, previewFormAction, previewPending] = useActionState(
    previewAction,
    PREVIEW_IDLE,
  )
  const [createState, createFormAction, createPending] = useActionState(createAction, CREATE_IDLE)
  const [suggestState, suggestFormAction, suggestPending] = useActionState(
    suggestAction,
    SUGGEST_IDLE,
  )

  // 실패 문구는 오른쪽 위 팝업으로 (성공은 message 가 null 이라 아무것도 안 뜬다)
  useActionToast(previewState)
  useActionToast(createState)

  // 만들기의 대상은 **담긴 주소뿐**이다. 입력칸의 글자는 "담기"를 눌러야 바구니로 들어간다 —
  // 담지 않은 글자는 목록에도, 만들기 대상에도 들어가지 않는다.
  const typed = draft.trim()
  const leadUrl = basket[0] ?? ''
  const mergeUrls = basket.slice(1)
  const canBuild = basket.length > 0
  // 추천 중복 제거·"담음" 표시에 쓰는 이미-아는 주소 집합 (입력 중인 것도 다시 추천하지 않게)
  const knownUrls = typed !== '' && !basket.includes(typed) ? [...basket, typed] : basket

  function addToBasket(candidate: string): void {
    const trimmed = candidate.trim()
    if (trimmed === '' || basket.includes(trimmed)) return
    setBasket((prev) => [...prev, trimmed])
  }

  function removeUrl(target: string): void {
    setBasket((prev) => prev.filter((u) => u !== target))
  }

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
    <div className="flex flex-col gap-5">
      {/* ── 1. 담기(왼쪽) + 담은 사이트·만들기(오른쪽) ── */}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* 왼쪽 — 주소를 담는 카드 (보장선 B1 — 다른 건 묻지 않는다) */}
        <section className="rounded-card border border-border bg-surface p-6">
          <div className="flex flex-col gap-2.5 sm:flex-row">
            <label htmlFor="create-url" className="sr-only">
              지켜보고 싶은 목록 페이지 주소
            </label>
            <input
              id="create-url"
              type="text"
              inputMode="url"
              autoComplete="url"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addToBasket(draft)
                  setDraft('')
                }
              }}
              placeholder="https://…"
              className={cn(
                'h-12 min-w-0 flex-1 rounded-[9px] border-[1.5px] border-border-strong bg-raised px-4',
                'font-mono text-sm text-ink placeholder:text-faint',
                'focus:border-accent focus:outline-2 focus:outline-offset-2 focus:outline-accent',
              )}
            />
            <Button
              type="button"
              size="lg"
              variant="outline"
              disabled={typed === ''}
              onClick={() => {
                addToBasket(draft)
                setDraft('')
              }}
            >
              담기
            </Button>
          </div>

          {/* 자연어로 사이트 찾기 (ADR A42) — 무엇을 모을지 말하면 후보를 제시한다. 붙이기는 사용자가 고른다.
              아직 아무것도 안 담겼으면(=막막한 사람) 펼친 채로 시작한다 */}
          <details
            className="group mt-4 border-t border-divider pt-4"
            open={initialUrl.trim() === ''}
          >
            <summary className="flex cursor-pointer list-none items-center gap-2 text-[13px] font-semibold text-muted select-none hover:text-accent">
              <span className="inline-block text-[11px] transition-transform group-open:rotate-90">▸</span>
              주소를 모르겠으면 — 무엇을 모으고 싶은지 말로 적어보세요
            </summary>
            <form action={suggestFormAction} className="mt-3 flex flex-col gap-2">
              <input type="hidden" name="already" value={JSON.stringify(knownUrls)} />
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  name="query"
                  type="text"
                  placeholder="예: 경기도 창업 지원사업 공고"
                  className={cn(
                    'h-11 min-w-0 flex-1 rounded-[9px] border-[1.5px] border-border-strong bg-raised px-4',
                    'text-sm text-ink placeholder:text-faint',
                    'focus:border-accent focus:outline-2 focus:outline-offset-2 focus:outline-accent',
                  )}
                />
                <Button type="submit" variant="outline" disabled={suggestPending}>
                  {suggestPending ? '찾는 중…' : '후보 찾기'}
                </Button>
              </div>
            </form>

            {suggestState.message !== null && (
              <p className="mt-2 text-[13px] text-faint">{suggestState.message}</p>
            )}

            {suggestState.candidates.length > 0 && (
              <div className="mt-3 flex flex-col gap-2">
                <p className="text-xs text-faint">
                  아래는 추천일 뿐이에요 — 눌러서 담으면 만들 때 실제로 확인해요.
                </p>
                {suggestState.candidates.map((c) => {
                  const added = basket.includes(c.url)
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
                        variant={added ? 'ghost' : 'outline'}
                        disabled={added}
                        onClick={() => addToBasket(c.url)}
                      >
                        {added ? '담음' : '담기'}
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}
          </details>
        </section>

        {/* 오른쪽 — 담은 사이트와 만들기 버튼 (스케치의 오른쪽 카드) */}
        <section className="flex flex-col gap-3 rounded-card border border-border bg-surface p-5 lg:sticky lg:top-6">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13.5px] font-bold text-ink">
              담은 사이트 {basket.length}곳
            </span>
            {/* 만들기의 실체는 미리보기 요청이다 — 대표 주소로 표를 만들어 아래에 보여준다 */}
            <form action={previewFormAction}>
              <input type="hidden" name="entry_url" value={leadUrl} />
              <Button type="submit" disabled={previewPending || !canBuild}>
                {previewPending ? '만드는 중…' : '컬렉션 만들기 →'}
              </Button>
            </form>
          </div>

          {basket.length === 0 ? (
            <p className="rounded-[10px] border border-dashed border-border-strong bg-raised px-4 py-4 text-[13px] text-muted">
              아직 담은 사이트가 없어요. 주소를 붙여넣고 “담기”를 누르거나, 말로 찾아 담아보세요.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {basket.map((u, index) => {
                const isLead = index === 0
                return (
                  <li
                    key={u}
                    className={cn(
                      'flex items-center gap-2 rounded-[10px] border py-2 pr-2 pl-3',
                      isLead ? 'border-accent bg-accent-soft' : 'border-border bg-surface',
                    )}
                  >
                    {/* 장식 글자는 선택에서 뺀다 — 칩째로 복사해도 주소만 딸려가야 한다.
                        (실제로 ✕ 가 주소 끝에 붙어 들어와 엉뚱한 페이지를 살펴본 적이 있다) */}
                    {isLead && (
                      <span className="shrink-0 text-[11px] font-bold text-accent select-none">
                        대표
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink">
                      {u}
                    </span>
                    <button
                      type="button"
                      aria-label="이 사이트 빼기"
                      onClick={() => removeUrl(u)}
                      className="flex size-[18px] shrink-0 items-center justify-center rounded-full text-[11px] text-faint select-none hover:bg-divider hover:text-ink"
                    >
                      <span aria-hidden>✕</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          {basket.length > 1 && (
            <p className="text-xs text-faint">
              대표 사이트로 표를 만들고, 나머지 {basket.length - 1}곳을 같은 표에 합쳐요.
            </p>
          )}
        </section>
      </div>

      {(previewPending || preview !== null) && (
        <ProbeSteps activeStep={activeStep} allDone={preview !== null && !previewPending} />
      )}

      {/* ── 2. 이미 채워진 표 (보장선 B3) — 워커가 실제로 수집·정규화한 값이다 ── */}
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
                    className="flex size-[18px] items-center justify-center rounded-full text-[11px] text-faint select-none hover:bg-divider hover:text-ink"
                  >
                    <span aria-hidden>✕</span>
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
            {/* 대표를 뺀 나머지만 접합 대상이다 (대표는 이미 이 표의 뼈대가 됐다) */}
            <input type="hidden" name="extra_urls" value={JSON.stringify(mergeUrls)} />
            <input
              type="hidden"
              name="kept_keys"
              value={JSON.stringify(keptFields.map((f) => f.key))}
            />
            {mergeUrls.length > 0 && (
              <p className="text-[13px] text-muted">
                이 표를 만들면서 <b>{mergeUrls.length}곳</b>을 같은 표에 함께 담아요. 각 사이트를
                살펴보느라 조금 더 걸려요.
              </p>
            )}
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
