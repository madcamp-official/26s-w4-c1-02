'use client'

import { useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { COPY } from '@/lib/labels'
import { cn } from '@/lib/utils'

/**
 * 첫 화면의 주인공 (기획서 2장 설계 원칙 · 보장선 B1).
 * 사용자가 입력하는 것은 주소 하나뿐이다. 여기에 다른 입력칸을 늘리는 순간 B1 이 깨진다.
 *
 * TODO(G1): 제출하면 목록 구조를 살펴보고 이미 채워진 표를 돌려준다.
 *           지금은 받은 주소를 확인해 주는 데까지만 한다.
 */
export function UrlPasteForm({ className, autoFocus }: { className?: string; autoFocus?: boolean }) {
  const [value, setValue] = useState('')
  const [accepted, setAccepted] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const raw = value.trim()
    if (raw === '') {
      setHint('주소를 붙여넣어 주세요.')
      setAccepted(null)
      return
    }
    let normalized: URL
    try {
      normalized = new URL(raw.startsWith('http') ? raw : `https://${raw}`)
    } catch {
      setHint('주소처럼 보이지 않아요. 브라우저 주소창의 내용을 그대로 붙여넣어 주세요.')
      setAccepted(null)
      return
    }
    setHint(null)
    setAccepted(normalized.toString())
  }

  return (
    <div className={cn('w-full', className)}>
      <form onSubmit={onSubmit} className="flex w-full flex-col gap-2 sm:flex-row">
        <label htmlFor="entry-url" className="sr-only">
          {COPY.heroTitle}
        </label>
        <input
          id="entry-url"
          name="entry-url"
          type="text"
          inputMode="url"
          autoComplete="url"
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={COPY.heroPlaceholder}
          className={cn(
            'h-12 min-w-0 flex-1 rounded-xl border border-border-strong bg-surface px-4',
            'text-base text-ink placeholder:text-faint',
            'focus:border-accent focus:outline-2 focus:outline-offset-2 focus:outline-accent',
          )}
        />
        <Button type="submit" size="lg">
          {COPY.heroSubmit}
        </Button>
      </form>

      {hint !== null && <p className="mt-2 text-sm text-attention">{hint}</p>}

      {accepted !== null && (
        <p className="mt-2 text-sm text-muted">
          주소를 받았어요 — <span className="font-mono text-xs break-all">{accepted}</span>. 표를 만들어
          주는 기능은 곧 이어집니다.
        </p>
      )}
    </div>
  )
}
