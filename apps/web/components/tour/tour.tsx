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
const BUBBLE_W = 300
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

  // 말풍선 위치 — 앵커 오른쪽 우선(앵커가 전부 왼쪽 사이드바라), 넘치면 아래로
  let bubbleStyle: React.CSSProperties = {}
  if (phase === 'step' && rect !== null) {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const fitsRight = rect.right + 14 + BUBBLE_W < vw - 16
    bubbleStyle = fitsRight
      ? { left: rect.right + 14, top: Math.min(Math.max(rect.top - 8, 16), vh - 180) }
      : {
          left: Math.min(Math.max(rect.left, 16), vw - BUBBLE_W - 16),
          top: Math.min(rect.bottom + 12, vh - 180),
        }
  }

  return createPortal(
    <div aria-live="polite">
      {/* 어두운 영역 클릭 = 종료. 중앙 카드 단계에선 이 레이어가 dim 역할까지 한다 */}
      <div
        className={
          phase === 'step'
            ? 'fixed inset-0 z-[100]'
            : 'fixed inset-0 z-[100] bg-[oklch(0.15_0.02_277/0.55)]'
        }
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
            boxShadow: '0 0 0 9999px oklch(0.15 0.02 277 / 0.55)',
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

      {/* 스텝 말풍선 */}
      {phase === 'step' && rect !== null && step !== undefined && (
        <div
          className="fixed z-[102] flex flex-col gap-2.5 rounded-card border border-border bg-surface p-4 shadow-[0_12px_40px_oklch(0.2_0.02_277/0.35)]"
          style={{ width: BUBBLE_W, ...bubbleStyle }}
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-[13.5px] leading-[1.6] break-keep text-ink">{step.body}</p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-faint">
              {index + 1}/{total}
            </span>
            <button
              type="button"
              onClick={() => finish('skipped')}
              className="text-xs text-faint hover:text-ink"
            >
              건너뛰기
            </button>
            <span className="flex-1" />
            {index > 0 && (
              <Button variant="ghost" size="sm" onClick={() => goToStep(index - 1)}>
                이전
              </Button>
            )}
            <Button size="sm" onClick={() => goToStep(index + 1)}>
              {index + 1 === total && !chapter.final ? '완료' : '다음'}
            </Button>
          </div>
        </div>
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
