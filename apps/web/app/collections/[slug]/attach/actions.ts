'use server'

// 사이트 붙이기 서버 액션 (기능 ② · G2). 실패는 사람 문장으로 (보장선 B4).

import { redirect } from 'next/navigation'

import { currentUser, isAuthReady } from '@/auth'
import type { AttachActionState } from '@/components/attach-flow'
import type { SuggestActionState } from '@/components/create-flow'
import { attachPreviewViaWorker, attachSaveViaWorker } from '@/lib/attach'
import { getCollectionBySlug, listSites } from '@/lib/collections'
import { suggestSourcesViaWorker } from '@/lib/create'

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

/** 붙이기는 표의 데이터를 바꾸므로 주인만 (컬렉션 상세는 누구나 보지만) */
async function ownedOrProblem(slug: string): Promise<string | null> {
  const found = await getCollectionBySlug(slug)
  if (!found.ok) return found.message
  if (found.data === null) return '이 컬렉션을 찾지 못했어요. 화면을 새로 고쳐 주세요.'
  if (isAuthReady) {
    const user = await currentUser()
    if (user === null || user.id !== found.data.owner_id) {
      return '이 표의 주인만 사이트를 붙일 수 있어요.'
    }
  }
  return null
}

/** formData 의 pasted_<필드키> 입력을 모은다 */
function pastedFrom(formData: FormData): Record<string, string> {
  const pasted: Record<string, string> = {}
  for (const [name, value] of formData.entries()) {
    if (name.startsWith('pasted_') && typeof value === 'string' && value.trim() !== '') {
      pasted[name.slice('pasted_'.length)] = value.trim()
    }
  }
  return pasted
}

export async function previewAttachAction(
  slug: string,
  _prev: AttachActionState,
  formData: FormData,
): Promise<AttachActionState> {
  const url = normalizeUrl(String(formData.get('entry_url') ?? ''))
  if (url === null) {
    return {
      status: 'problem',
      message: '주소처럼 보이지 않아요. 브라우저 주소창의 내용을 그대로 붙여넣어 주세요.',
      url: '',
      pasted: {},
      preview: null,
    }
  }

  const problem = await ownedOrProblem(slug)
  if (problem !== null) return { status: 'problem', message: problem, url, pasted: {}, preview: null }

  const pasted = pastedFrom(formData)
  const result = await attachPreviewViaWorker({ slug, url, pasted })
  if (!result.ok) {
    return { status: 'problem', message: result.message, url, pasted, preview: null }
  }
  return { status: 'ready', message: null, url, pasted, preview: result.data }
}

export async function saveAttachAction(
  slug: string,
  _prev: AttachActionState,
  formData: FormData,
): Promise<AttachActionState> {
  const url = normalizeUrl(String(formData.get('entry_url') ?? ''))
  if (url === null) {
    return { status: 'problem', message: '처음부터 다시 시도해 주세요. 주소가 흐려졌어요.', url: '', pasted: {}, preview: null }
  }

  const problem = await ownedOrProblem(slug)
  if (problem !== null) return { status: 'problem', message: problem, url, pasted: {}, preview: null }

  // 미리보기의 스펙을 돌려받지 않는다 — 주소와 붙여넣은 값만 다시 보낸다 (워커 쪽 원칙)
  const pasted = pastedFrom(formData)
  const saved = await attachSaveViaWorker({ slug, url, pasted })
  if (!saved.ok) {
    return { status: 'problem', message: saved.message, url, pasted, preview: null }
  }

  redirect(`/collections/${slug}/sources`)
}

/**
 * 자연어 → 붙일 사이트 후보 (ADR A42). 생성 화면과 같은 기능을 붙이기에도.
 * 붙이기는 표 맥락이 있으므로 그 주제에 맞춰 추천하고, 이미 붙은 사이트는 후보에서 뺀다.
 */
export async function suggestAttachSourcesAction(
  slug: string,
  _prev: SuggestActionState,
  formData: FormData,
): Promise<SuggestActionState> {
  const rawQuery = String(formData.get('query') ?? '').trim()
  if (rawQuery === '') {
    return { status: 'idle', message: null, candidates: [] }
  }

  const found = await getCollectionBySlug(slug)
  if (!found.ok || found.data === null) {
    return { status: 'problem', message: '이 컬렉션을 찾지 못했어요.', candidates: [] }
  }
  if (isAuthReady) {
    const user = await currentUser()
    if (user === null || user.id !== found.data.owner_id) {
      return { status: 'problem', message: '이 표의 주인만 사이트를 찾을 수 있어요.', candidates: [] }
    }
  }

  // 이미 붙은 사이트는 다시 추천하지 않는다
  const sites = await listSites(found.data.id)
  const already = sites.ok ? sites.data.map((s) => s.entry_url) : []

  // 표 주제를 맥락으로 얹어 관련 사이트로 좁힌다 (붙이기는 "이 표에 더" 이므로)
  const query = `${rawQuery} — 이미 "${found.data.name}" 표에 비슷한 목록을 모으는 중`

  const result = await suggestSourcesViaWorker({ query, ownerId: found.data.owner_id, already })
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
