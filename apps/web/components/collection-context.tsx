'use client'

// 컬렉션 이름을 사이드바로 전달하는 작은 방송 장치.
//
// 사이드바는 root 레이아웃(클라이언트)에 있고 컬렉션 셸([slug]/layout, 서버)과는
// 형제 트리다 — React 컨텍스트는 형제로 흐르지 않으므로, 셸이 이 컴포넌트를 그려서
// 모듈 수준 스토어에 이름을 적고 사이드바가 useSyncExternalStore 로 구독한다.

import { useEffect, useSyncExternalStore } from 'react'

let currentName: string | null = null
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function broadcast(name: string | null) {
  currentName = name
  for (const listener of listeners) listener()
}

/** 사이드바에서 현재 컬렉션 이름을 읽는다 (컬렉션 밖이면 null) */
export function useCollectionName(): string | null {
  // 서버 스냅숏은 null — 첫 그림에는 이름이 없다가 하이드레이션 직후 채워진다
  return useSyncExternalStore(
    subscribe,
    () => currentName,
    () => null,
  )
}

/** 컬렉션 셸이 그려 두는 보이지 않는 방송 — 벗어나면 지운다 */
export function CollectionNameBroadcast({ name }: { name: string }) {
  useEffect(() => {
    broadcast(name)
    return () => broadcast(null)
  }, [name])
  return null
}
