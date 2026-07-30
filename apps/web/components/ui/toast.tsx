'use client'

// 팝업 알림 (07-30) — 액션 결과 문구는 폼 옆이 아니라 오른쪽 위에 반투명 박스로 뜬다.
// ✕ 를 누르면 사라지고, 성공 알림은 잠시 후 스스로 사라진다 (문제 알림은 남는다 — 읽어야 하니까).
// 문구 자체는 서버 액션이 만든 사람 문장 그대로다 (B4 — 여기는 그릇일 뿐).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

export type ToastTone = 'ok' | 'problem'

interface ToastItem {
  id: number
  tone: ToastTone
  message: string
}

/** 성공 알림이 스스로 사라지기까지 */
const OK_AUTO_DISMISS_MS = 6000

const ToastContext = createContext<{ push: (tone: ToastTone, message: string) => void } | null>(
  null,
)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  const push = useCallback(
    (tone: ToastTone, message: string) => {
      const id = nextId.current++
      setToasts((current) => [...current, { id, tone, message }])
      if (tone === 'ok') setTimeout(() => dismiss(id), OK_AUTO_DISMISS_MS)
    },
    [dismiss],
  )

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      {/* 헤더(sticky)보다 위 — 화면 어디서 액션이 일어나도 같은 자리에 뜬다 */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-4 top-4 z-50 flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={cn(
              'pointer-events-auto flex items-start gap-2.5 rounded-[12px] border px-4 py-3 text-[13.5px] shadow-[0_8px_28px_oklch(0.2_0.02_277/0.18)] backdrop-blur-md',
              toast.tone === 'problem'
                ? 'border-attention/25 bg-attention-soft/85 text-attention'
                : 'border-ok-line/80 bg-ok-soft/85 font-semibold text-ok',
            )}
          >
            <span className="min-w-0 flex-1 leading-relaxed">{toast.message}</span>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="알림 닫기"
              className="mt-0.5 shrink-0 rounded-md p-0.5 opacity-60 hover:opacity-100"
            >
              <Icon name="x" size={14} strokeWidth={2.2} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): (tone: ToastTone, message: string) => void {
  const context = useContext(ToastContext)
  if (context === null) {
    // Provider 밖에서 불렸다 — 조용히 무시하면 알림이 증발하므로 개발 중에 바로 드러나게 한다
    throw new Error('useToast 는 ToastProvider 안에서만 쓸 수 있어요.')
  }
  return context.push
}

/**
 * useActionState 결과를 팝업으로 흘리는 공용 훅.
 * status 가 'problem' 이면 문제 톤, 나머지는 성공 톤. skip 에 든 status 는 띄우지 않는다
 * (예: 목록 갱신으로 이미 보이는 성공은 알림까지 반복하지 않는다).
 */
export function useActionToast(
  state: { status: string; message: string | null },
  skip: readonly string[] = [],
): void {
  const push = useToast()
  useEffect(() => {
    if (state.message === null) return
    if (skip.includes(state.status)) return
    push(state.status === 'problem' ? 'problem' : 'ok', state.message)
    // skip 은 호출부에서 리터럴로 오므로 join 으로 안정화한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, push, skip.join('|')])
}
