'use client'

// 개발자용 — API 를 코드로 바로 붙일 수 있게 (연결 탭).
//
// 왜 JSON 만이 아니라 여러 형식인가: REST API 를 처음 붙일 때 개발자가 실제로 복사하는 건
// 대개 "바로 실행되는" 것이다 — cURL 로 응답을 확인하고, fetch/requests 로 코드에 심는다.
// 응답 JSON 은 "받는 것"이라 형태를 눈으로 보려는 용도 → 실제 응답 샘플을 지어내지 않고 보여준다.

import { useState } from 'react'

import { CopyButton } from '@/components/copy-button'
import { cn } from '@/lib/utils'

type Format = 'cURL' | 'JavaScript' | 'Python' | 'JSON 응답'

const BASE_FORMATS: Format[] = ['cURL', 'JavaScript', 'Python']

function buildSnippet(format: Format, apiUrl: string, sampleJson: string | null): string {
  switch (format) {
    case 'cURL':
      return `curl "${apiUrl}?limit=20"`
    case 'JavaScript':
      return [
        `const res = await fetch("${apiUrl}?limit=20")`,
        `const { items, sources } = await res.json()`,
      ].join('\n')
    case 'Python':
      return [
        `import requests`,
        ``,
        `r = requests.get("${apiUrl}", params={"limit": 20})`,
        `data = r.json()`,
      ].join('\n')
    case 'JSON 응답':
      return sampleJson ?? ''
  }
}

export function ApiSnippets({ apiUrl, sampleJson }: { apiUrl: string; sampleJson: string | null }) {
  // 응답 샘플이 있을 때만 그 탭을 보인다 (빈 컬렉션이면 보여줄 응답이 없다)
  const formats: Format[] = sampleJson !== null ? [...BASE_FORMATS, 'JSON 응답'] : BASE_FORMATS
  const [format, setFormat] = useState<Format>('cURL')
  const snippet = buildSnippet(format, apiUrl, sampleJson)

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold text-muted">코드로 붙이기</span>

      <div className="flex flex-wrap gap-1">
        {formats.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFormat(f)}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-semibold transition-colors',
              format === f
                ? 'bg-[oklch(0.24_0.008_277)] text-white'
                : 'bg-raised text-muted hover:text-ink',
            )}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="relative">
        <pre className="scroll-x rounded-lg bg-[oklch(0.2_0.008_277)] px-4 py-3.5 font-mono text-xs leading-relaxed text-[oklch(0.89_0.005_277)]">
          {snippet}
        </pre>
        <div className="absolute top-2 right-2">
          <CopyButton value={snippet} label="복사" />
        </div>
      </div>

      {format === 'JSON 응답' && (
        <p className="text-xs text-faint">
          실제 응답의 일부예요. <code className="font-mono">items</code> 는 항목 배열,{' '}
          <code className="font-mono">sources</code> 는 사이트별 상태 — 하나가 아파도 나머지는 정상
          응답이에요.
        </p>
      )}
    </div>
  )
}
