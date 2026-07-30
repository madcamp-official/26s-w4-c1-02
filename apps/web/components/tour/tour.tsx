'use client'

// 둘러보기 오버레이 엔진 — 외부 라이브러리 없이 ~200줄 (스텝·문구는 steps.ts).
//
// ── 스포트라이트 메커니즘 ────────────────────────────────────────────────
// 대상 요소 rect 위치에 투명 div 를 놓고 거대한 box-shadow 로 나머지를 어둡게 한다.
// 요소만 밝고 주변이 죽는 고전 트릭 — 마스크·클립패스보다 단순하고 transition 이 공짜다.
//
// ── 견고성 규칙 (투어가 제품을 망가뜨리지 않게) ─────────────────────────
//  · 앵커를 2초 안에 못 찾으면 그 스텝을 조용히 건너뛴다 — 화면이 바뀌어도 깨진 채 뜨지 않는다
//  · ESC = 종료, 어두운 영역 클릭 = 종료 — 사용자를 가두지 않는다
//  · 모바일(<768px, 사이드바 숨음)에선 아예 뜨지 않는다
//  · 본 기록은 localStorage (기기별 UX 상태 — DB 스키마를 건드리지 않는다, G0)

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { Button } from '@/components/ui/button'
import { TOUR_CHAPTERS, type TourChapter } from './steps'

const PAD = 6
const TEXT_W = 280
/** 어둡기 — 주석(점선·화살표)이 배경 위에 떠 보이려면 충분히 어두워야 한다 */
const DIM = 'oklch(0.13 0.02 277 / 0.78)'
const FIND_TRIES = 20
const FIND_INTERVAL_MS = 100

const storageKey = (id: TourChapter['id']) => `ep:tour:${id}`

/** 재실행 입구가 쓴다 — 기록을 지우면 다음 방문에서 다시 뜬다 */
export function resetTours(): void {
  try {
    localStorage.removeItem(storageKey('console'))
    localStorage.removeItem(storageKey('collection'))
  } catch {
    /* 시크릿 모드 등 — 지울 게 없으면 그만 */
  }
}

type Phase = 'idle' | 'welcome' | 'step' | 'final'

export function Tour({ chapter: chapterId }: { chapter: TourChapter['id'] }) {
  const chapter = TOUR_CHAPTERS[chapterId]
  const [phase, setPhase] = useState<Phase>('idle')
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const targetRef = useRef<Element | null>(null)
  const findTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const finish = useCallback(
    (how: 'done' | 'skipped') => {
      try {
        localStorage.setItem(storageKey(chapter.id), how)
      } catch {
        /* 저장 실패해도 투어는 닫는다 */
      }
      if (findTimer.current) clearInterval(findTimer.current)
      targetRef.current = null
      setPhase('idle')
    },
    [chapter.id],
  )

  /** i번째 스텝의 앵커를 찾아 스포트라이트. 못 찾으면 다음 스텝으로 조용히 넘어간다 */
  const goToStep = useCallback(
    (i: number) => {
      if (findTimer.current) clearInterval(findTimer.current)
      if (i < 0) return
      if (i >= chapter.steps.length) {
        if (chapter.final) {
          targetRef.current = null
          setRect(null)
          setPhase('final')
        } else {
          finish('done')
        }
        return
      }

      const step = chapter.steps[i]
      if (step === undefined) return finish('done')

      let tries = 0
      const tryFind = (): boolean => {
        const el = document.querySelector(`[data-tour="${step.anchor}"]`)
        if (el === null) return false
        targetRef.current = el
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        setRect(el.getBoundingClientRect())
        setIndex(i)
        setPhase('step')
        return true
      }

      if (tryFind()) return
      findTimer.current = setInterval(() => {
        tries += 1
        if (tryFind() || tries >= FIND_TRIES) {
          if (findTimer.current) clearInterval(findTimer.current)
          if (tries >= FIND_TRIES) goToStep(i + 1)
        }
      }, FIND_INTERVAL_MS)
    },
    [chapter, finish],
  )

  // 발동 판정 — 본 적 없고, 사이드바가 보이는 폭일 때만
  useEffect(() => {
    let seen: string | null = null
    try {
      seen = localStorage.getItem(storageKey(chapter.id))
    } catch {
      return
    }
    if (seen !== null) return
    if (!window.matchMedia('(min-width: 768px)').matches) return

    if (chapter.welcome) setPhase('welcome')
    else goToStep(0)
    // 마운트 시 1회 판정이면 충분하다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 창 크기·스크롤 변화에 스포트라이트 재측정
  useEffect(() => {
    if (phase !== 'step') return
    const remeasure = () => {
      const el = targetRef.current
      if (el !== null) setRect(el.getBoundingClientRect())
    }
    window.addEventListener('resize', remeasure)
    window.addEventListener('scroll', remeasure, true)
    return () => {
      window.removeEventListener('resize', remeasure)
      window.removeEventListener('scroll', remeasure, true)
    }
  }, [phase])

  // ESC = 종료
  useEffect(() => {
    if (phase === 'idle') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish('skipped')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, finish])

  if (phase === 'idle' || typeof document === 'undefined') return null

  const step = chapter.steps[index]
  const total = chapter.steps.length

  // ── 주석 배치 계산 — 점선 꺾은선이 요소를 가리키고, 설명은 대각선 아래에 뜬다 ──
  // 앵커 옆 공간이 넓은 쪽(보통 오른쪽 — 앵커 대부분이 왼쪽 사이드바)을 골라 미러링한다.
  let anno: {
    side: 'right' | 'left'
    tipX: number // 화살촉 (요소 가장자리)
    cy: number
    bendX: number // 꺾이는 세로선 x
    textX: number
    textY: number
  } | null = null
  if (phase === 'step' && rect !== null) {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const cy = rect.top + rect.height / 2
    const side: 'right' | 'left' = rect.right + 90 + TEXT_W < vw - 16 ? 'right' : 'left'
    const tipX = side === 'right' ? rect.right + PAD + 6 : rect.left - PAD - 6
    const bendX = side === 'right' ? tipX + 40 : tipX - 40
    const textY = Math.max(48, Math.min(cy + 56, vh - 170))
    const textX = side === 'right' ? bendX + 24 : bendX - 24 - TEXT_W
    anno = { side, tipX, cy, bendX, textX, textY }
  }

  return createPortal(
    <div aria-live="polite">
      {/* 어두운 영역 클릭 = 종료. 중앙 카드 단계에선 이 레이어가 dim 역할까지 한다 */}
      <div
        className="fixed inset-0 z-[100]"
        style={phase === 'step' ? undefined : { background: DIM }}
        onClick={() => finish('skipped')}
      />

      {/* 스포트라이트 — 요소만 밝게, 나머지는 box-shadow 로 어둡게 */}
      {phase === 'step' && rect !== null && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[101] rounded-xl transition-all duration-200"
          style={{
            left: rect.left - PAD,
            top: rect.top - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: `0 0 0 9999px ${DIM}`,
          }}
        />
      )}

      {/* 환영 카드 (챕터에 있을 때만) */}
      {phase === 'welcome' && chapter.welcome && (
        <div className="fixed inset-0 z-[102] flex items-center justify-center p-6">
          <div className="flex w-full max-w-sm flex-col gap-3 rounded-card border border-border bg-surface p-6 text-center shadow-[0_12px_40px_oklch(0.2_0.02_277/0.35)]">
            <div className="text-[19px] font-bold tracking-tight text-ink">
              {chapter.welcome.title}
            </div>
            <p className="text-sm break-keep text-muted">{chapter.welcome.body}</p>
            <div className="mt-1 flex items-center justify-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => finish('skipped')}>
                건너뛰기
              </Button>
              <Button size="sm" onClick={() => goToStep(0)}>
                시작
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 스텝 주석 — 점선 꺾은선이 요소를 가리키고, 설명은 어두운 배경 위에 뜬다 (카드 없음) */}
      {phase === 'step' && rect !== null && step !== undefined && anno !== null && (
        <>
          {/* 꺾은선 + 화살촉 (SVG, 클릭 통과) */}
          <svg
            aria-hidden
            className="pointer-events-none fixed inset-0 z-[101] h-full w-full"
          >
            <path
              d={`M ${anno.textX + (anno.side === 'right' ? -8 : TEXT_W + 8)} ${anno.textY + 10}
                  L ${anno.bendX} ${anno.textY + 10}
                  L ${anno.bendX} ${anno.cy}
                  L ${anno.tipX + (anno.side === 'right' ? 8 : -8)} ${anno.cy}`}
              fill="none"
              stroke="rgba(255,255,255,0.85)"
              strokeWidth="1.5"
              strokeDasharray="5 5"
              strokeLinejoin="round"
            />
            {/* 화살촉 — 요소를 가리킨다 */}
            <polygon
              points={
                anno.side === 'right'
                  ? `${anno.tipX},${anno.cy} ${anno.tipX + 9},${anno.cy - 5} ${anno.tipX + 9},${anno.cy + 5}`
                  : `${anno.tipX},${anno.cy} ${anno.tipX - 9},${anno.cy - 5} ${anno.tipX - 9},${anno.cy + 5}`
              }
              fill="rgba(255,255,255,0.95)"
            />
          </svg>

          {/* 설명 텍스트 + 진행 컨트롤 — 흰 글자가 배경 위에 바로 뜬다 */}
          <div
            className="fixed z-[102] flex flex-col gap-3"
            style={{ left: anno.textX, top: anno.textY, width: TEXT_W }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[15px] leading-[1.65] font-medium break-keep text-white [text-shadow:0_1px_8px_rgba(0,0,0,0.5)]">
              {step.body}
            </p>
            <div className="flex items-center gap-3 text-[12.5px]">
              <span className="text-white/50">
                {index + 1}/{total}
              </span>
              {index > 0 && (
                <button
                  type="button"
                  onClick={() => goToStep(index - 1)}
                  className="text-white/70 hover:text-white"
                >
                  ← 이전
                </button>
              )}
              <button
                type="button"
                onClick={() => goToStep(index + 1)}
                className="font-bold text-white underline decoration-dashed underline-offset-4 hover:decoration-solid"
              >
                {index + 1 === total && !chapter.final ? '완료' : '다음 →'}
              </button>
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => finish('skipped')}
                className="text-white/50 hover:text-white"
              >
                건너뛰기
              </button>
            </div>
          </div>
        </>
      )}

      {/* 마무리 카드 — 다음 행동 하나를 가리킨다 */}
      {phase === 'final' && chapter.final && (
        <div className="fixed inset-0 z-[102] flex items-center justify-center p-6">
          <div className="flex w-full max-w-sm flex-col gap-3 rounded-card border border-border bg-surface p-6 text-center shadow-[0_12px_40px_oklch(0.2_0.02_277/0.35)]">
            <p className="text-[15px] font-semibold break-keep text-ink">{chapter.final.body}</p>
            <div className="mt-1 flex items-center justify-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => finish('done')}>
                닫기
              </Button>
              <Link
                href={chapter.final.ctaHref}
                onClick={() => finish('done')}
                className="ds-btn ds-btn-primary ds-btn-sm hover:no-underline"
              >
                {chapter.final.ctaLabel}
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}
