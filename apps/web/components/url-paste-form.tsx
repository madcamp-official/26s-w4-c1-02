'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { COPY } from '@/lib/labels'
import { cn } from '@/lib/utils'

/**
 * 첫 화면·목록의 주소 입력 (기획서 2장 설계 원칙 · 보장선 B1).
 * 사용자가 입력하는 것은 주소 하나뿐이다. 여기에 다른 입력칸을 늘리는 순간 B1 이 깨진다.
 * 제출하면 생성 플로우(/collections/new)로 넘어가 이미 채워진 표를 받는다.
 */
export function UrlPasteForm({ className, autoFocus }: { className?: string; autoFocus?: boolean }) {
  const router = useRouter()
  const [value, setValue] = useState('')
  const [hint, setHint] = useState<string | null>(null)

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const raw = value.trim()
    if (raw === '') {
      setHint('주소를 붙여넣어 주세요.')
      return
    }
    let normalized: URL
    try {
      normalized = new URL(raw.startsWith('http') ? raw : `https://${raw}`)
    } catch {
      setHint('주소처럼 보이지 않아요. 브라우저 주소창의 내용을 그대로 붙여넣어 주세요.')
      return
    }
    setHint(null)
    router.push(`/collections/new?url=${encodeURIComponent(normalized.toString())}`)
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
            'h-12 min-w-0 flex-1 rounded-[9px] border-[1.5px] border-border-strong bg-raised px-4',
            'font-mono text-sm text-ink placeholder:text-faint',
            'focus:border-accent focus:outline-2 focus:outline-offset-2 focus:outline-accent',
          )}
        />
        <Button type="submit" size="lg">
          {COPY.heroSubmit}
        </Button>
      </form>

      {hint !== null && <p className="mt-2 text-sm text-attention">{hint}</p>}

      {/* 주소를 모르는 사람의 입구 (ADR A42) — URL 없이 생성 화면으로. 거기서 자연어로 후보를 찾는다 */}
      <p className="mt-2.5 text-[13px] text-faint">
        주소를 모르겠으면?{' '}
        <Link href="/collections/new" className="font-semibold text-accent hover:underline">
          모으고 싶은 걸 말로 적어보세요 →
        </Link>
      </p>
    </div>
  )
}
