// Redis 연결 — BullMQ 전용 (ADR A8)
//
// BullMQ 는 blocking 명령(BRPOPLPUSH 등)을 쓰므로 `maxRetriesPerRequest: null` 이 필수다.
// 그 설정 때문에 "Redis 가 안 떠 있으면 조용히 영원히 재시도" 가 되어버리므로,
// 부팅 전에 별도의 짧은 연결로 한 번 ping 해서 살아 있는지 먼저 확인한다.

import IORedis from 'ioredis'

import { getConfig } from './config'

let shared: IORedis | null = null

/** BullMQ Queue · Worker 가 공유하는 연결 */
export function getRedis(): IORedis {
  if (shared === null) {
    shared = new IORedis(getConfig().redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    })
    // 재연결 중의 에러가 unhandled 로 프로세스를 죽이지 않게 한다.
    shared.on('error', () => {})
  }
  return shared
}

export type RedisPingResult = { ok: true } | { ok: false; message: string }

/**
 * 부팅 전 생존 확인. 실패해도 스택 트레이스를 던지지 않고 한 줄짜리 안내 문장을 돌려준다.
 */
export async function pingRedis(timeoutMs = 2000): Promise<RedisPingResult> {
  const url = getConfig().redisUrl
  const probe = new IORedis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: timeoutMs,
    retryStrategy: () => null,
  })
  probe.on('error', () => {})

  try {
    await probe.connect()
    await probe.ping()
    return { ok: true }
  } catch {
    return {
      ok: false,
      message: `Redis(${url}) 에 연결하지 못했습니다. \`docker compose up -d redis\` 로 띄운 뒤 다시 실행해 주세요.`,
    }
  } finally {
    probe.disconnect()
  }
}

export async function closeRedis(): Promise<void> {
  if (shared === null) return
  const conn = shared
  shared = null
  try {
    await conn.quit()
  } catch {
    conn.disconnect()
  }
}
