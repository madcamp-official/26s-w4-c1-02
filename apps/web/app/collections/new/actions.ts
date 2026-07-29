'use server'

// 컬렉션 생성 서버 액션 — 워커의 HTTP 진입점을 부른다 (ADR A30 · G2 배선 완료).

import { redirect } from 'next/navigation'

import { currentUser, isAuthReady } from '@/auth'
import type {
  CreateActionState,
  PreviewActionState,
  SuggestActionState,
} from '@/components/create-flow'
import {
  createWithSourcesViaWorker,
  demoOwnerId,
  fetchWorkerPreview,
  suggestSourcesViaWorker,
} from '@/lib/create'
import { normalizeEntryUrl } from '@/lib/urls'

/**
 * 로그인 사용자, 또는 (로그인이 아예 설정되지 않은 개발 환경에서만) 데모 주인.
 * 로그인이 붙어 있는데 세션이 없으면 null — 예전처럼 데모 주인으로 만들면
 * 남의 소유가 되어, 만들자마자 404 로 사라져 보이는 조용한 버그가 된다.
 */
async function resolveOwnerId(): Promise<string | null> {
  const user = await currentUser()
  if (user?.id) return user.id
  if (isAuthReady) return null
  const demo = await demoOwnerId()
  return demo.ok ? demo.data : null
}

export async function previewCollectionAction(
  _prev: PreviewActionState,
  formData: FormData,
): Promise<PreviewActionState> {
  const entryUrl = normalizeEntryUrl(String(formData.get('entry_url') ?? ''))
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

  const entryUrl = normalizeEntryUrl(String(formData.get('entry_url') ?? ''))
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

  // 추가 주소들 — 첫 표에 접합될 나머지 사이트 (기능 ②를 생성 단계로)
  let extraUrls: string[]
  try {
    const parsed: unknown = JSON.parse(String(formData.get('extra_urls') ?? '[]'))
    extraUrls = Array.isArray(parsed)
      ? parsed.map((u) => normalizeEntryUrl(String(u))).filter((u): u is string => u !== null)
      : []
  } catch {
    extraUrls = []
  }
  // 첫 주소와 겹치면 뺀다
  extraUrls = [...new Set(extraUrls)].filter((u) => u !== entryUrl)

  const ownerId = await resolveOwnerId()
  if (ownerId === null) {
    return {
      status: 'problem',
      message: '로그인이 풀린 것 같아요. 화면을 새로 고쳐 로그인한 뒤 다시 만들어 주세요.',
    }
  }

  const created = await createWithSourcesViaWorker({
    primaryUrl: entryUrl,
    extraUrls,
    ownerId,
    name,
    keptKeys,
  })
  if (!created.ok) return { status: 'problem', message: created.message }

  redirect(`/collections/${created.data.slug}/table`)
}

/** 자연어 → 소스 후보 제안 (ADR A42). 사용자가 요청할 때만 부른다 */
export async function suggestSourcesAction(
  _prev: SuggestActionState,
  formData: FormData,
): Promise<SuggestActionState> {
  const query = String(formData.get('query') ?? '').trim()
  if (query === '') {
    return { status: 'idle', message: null, candidates: [] }
  }

  let already: string[]
  try {
    const parsed: unknown = JSON.parse(String(formData.get('already') ?? '[]'))
    already = Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === 'string') : []
  } catch {
    already = []
  }

  const ownerId = await resolveOwnerId()
  if (ownerId === null) {
    return {
      status: 'problem',
      message: '로그인이 풀린 것 같아요. 화면을 새로 고쳐 로그인한 뒤 다시 찾아 주세요.',
      candidates: [],
    }
  }

  const result = await suggestSourcesViaWorker({ query, ownerId, already })
  if (!result.ok) return { status: 'problem', message: result.message, candidates: [] }
  if (result.data.length === 0) {
    return {
      status: 'empty',
      message: '딱 맞는 곳을 확실히 찾지 못했어요. 주소를 직접 붙여넣어 주세요.',
      candidates: [],
    }
  }
  return { status: 'ready', message: null, candidates: result.data }
}
