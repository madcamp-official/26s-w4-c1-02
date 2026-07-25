'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { COPY } from '@/lib/labels'

/**
 * 한 줄 복사. 보장선 B7 의 실체다 —
 * 주소를 복사해 커넥터에 붙여넣는 것으로 끝나야 하므로 여기서 파일을 만들거나 받게 하지 않는다.
 */
export function CopyButton({ value, label }: { value: string; label?: string }) {
  const [done, setDone] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // 클립보드를 막아둔 브라우저를 위한 대비책
      const area = document.createElement('textarea')
      area.value = value
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      area.remove()
    }
    setDone(true)
    window.setTimeout(() => setDone(false), 1600)
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={copy} aria-live="polite">
      {done ? COPY.copied : (label ?? COPY.copy)}
    </Button>
  )
}
