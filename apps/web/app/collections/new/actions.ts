'use server'

// 컬렉션 생성 서버 액션. 미리보기는 아직 목이다 — lib/create.ts 의 TODO(G2) 참조.

import { redirect } from 'next/navigation'

import { currentUser } from '@/auth'
import type { CreateActionState, PreviewActionState } from '@/components/create-flow'
import { CollectionSchemaJsonSchema } from '@endpointer/core'
import { buildMockPreview, createCollection, demoOwnerId } from '@/lib/create'

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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

  // TODO(G2): 트랙 A 파이프라인 호출로 교체 (합의된 인터페이스로).
  // 지금은 화면 흐름을 위해 살펴보는 시간만 흉내낸다.
  await sleep(2200)
  return { status: 'ready', message: null, preview: buildMockPreview(entryUrl) }
}

export async function createCollectionAction(
  _prev: CreateActionState,
  formData: FormData,
): Promise<CreateActionState> {
  const name = String(formData.get('name') ?? '').trim()
  if (name === '') return { status: 'problem', message: '컬렉션 이름을 지어 주세요.' }

  const entryUrl = normalizeUrl(String(formData.get('entry_url') ?? ''))
  const host = String(formData.get('host') ?? '').trim()
  if (entryUrl === null || host === '') {
    return { status: 'problem', message: '처음부터 다시 시도해 주세요. 주소가 흐려졌어요.' }
  }

  let fields: unknown
  try {
    fields = JSON.parse(String(formData.get('fields') ?? '[]'))
  } catch {
    return { status: 'problem', message: '표 구성을 읽지 못했어요. 화면을 새로 고쳐 주세요.' }
  }
  const parsed = CollectionSchemaJsonSchema.safeParse(fields)
  if (!parsed.success || parsed.data.length === 0) {
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

  const created = await createCollection({
    ownerId,
    name,
    entryUrl,
    host,
    fields: parsed.data,
  })
  if (!created.ok) return { status: 'problem', message: created.message }

  redirect(`/collections/${created.data.slug}`)
}
