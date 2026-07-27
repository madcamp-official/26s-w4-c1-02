'use server'

// 컬렉션 생성 서버 액션 — 워커의 HTTP 진입점을 부른다 (ADR A30 · G2 배선 완료).

import { redirect } from 'next/navigation'

import { currentUser } from '@/auth'
import type { CreateActionState, PreviewActionState } from '@/components/create-flow'
import { createViaWorker, demoOwnerId, fetchWorkerPreview } from '@/lib/create'

function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  try {
    const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

export async function previewCollectionAction(
  _prev: PreviewActionState,
  formData: FormData,
): Promise<PreviewActionState> {
  const entryUrl = normalizeUrl(String(formData.get('entry_url') ?? ''))
  if (entryUrl === null) {
    return {
      status: 'problem',
      message: '주소처럼 보이지 않아요. 브라우저 주소창의 내용을 그대로 붙여넣어 주세요.',
      preview: null,
    }
  }

  const preview = await fetchWorkerPreview(entryUrl)
  if (!preview.ok) return { status: 'problem', message: preview.message, preview: null }
  return { status: 'ready', message: null, preview: preview.data }
}

export async function createCollectionAction(
  _prev: CreateActionState,
  formData: FormData,
): Promise<CreateActionState> {
  const name = String(formData.get('name') ?? '').trim()
  if (name === '') return { status: 'problem', message: '컬렉션 이름을 지어 주세요.' }

  const entryUrl = normalizeUrl(String(formData.get('entry_url') ?? ''))
  if (entryUrl === null) {
    return { status: 'problem', message: '처음부터 다시 시도해 주세요. 주소가 흐려졌어요.' }
  }

  let keptKeys: string[]
  try {
    const parsed: unknown = JSON.parse(String(formData.get('kept_keys') ?? '[]'))
    keptKeys = Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []
  } catch {
    keptKeys = []
  }
  if (keptKeys.length === 0) {
    return { status: 'problem', message: '열이 최소 하나는 있어야 해요.' }
  }

  const user = await currentUser()
  let ownerId = user?.id ?? null
  if (ownerId === null) {
    // 로그인 설정 전 데모 경로 (listCollections 와 같은 이유)
    const demo = await demoOwnerId()
    ownerId = demo.ok ? demo.data : null
  }
  if (ownerId === null) {
    return { status: 'problem', message: '로그인하고 다시 시도해 주세요.' }
  }

  const created = await createViaWorker({ url: entryUrl, ownerId, name, keptKeys })
  if (!created.ok) return { status: 'problem', message: created.message }

  redirect(`/collections/${created.data.slug}`)
}
