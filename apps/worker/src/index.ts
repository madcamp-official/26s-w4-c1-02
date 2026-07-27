// @endpointer/worker — 부팅 (기획서 8장 앱 구성 · 9-3 · 9-4 · ADR A8 · 15장)
//
// 이 프로세스가 하는 일은 세 가지뿐이다:
//   ① 큐 세 개에 워커를 붙인다 (collect / heal / deliver)
//   ② DB 의 소스 목록과 Redis 의 반복 스케줄을 한 번 맞춘다 (repeatable job = 크론 · ADR A8)
//   ③ 종료 신호를 받으면 **돌고 있는 잡을 끝까지 마치고** 내려간다
//
// ── QueueScheduler 에 대하여 ────────────────────────────────────────────
// BullMQ v4 부터 `QueueScheduler` 클래스는 사라졌다. 지연·반복 잡의 승격은 Worker 가 직접
// 맡고, 스케줄 등록은 `Queue.upsertJobScheduler` 가 한다 (queues.ts). 그래서 "스케줄러 배선"
// 은 이 파일에서 별도 객체를 만드는 일이 아니라, **워커가 떠 있는 것 자체**다.
// 워커가 하나도 안 떠 있으면 반복 잡은 시간이 지나도 실행되지 않는다.
//
// ── 죽는 방식 ───────────────────────────────────────────────────────────
// Redis 나 DB 가 없을 때 스택 트레이스를 토하지 않는다. 한 줄 안내 후 종료한다.
// 개발자가 5일 동안 가장 자주 보게 될 화면이 이것이라, 여기가 불친절하면 하루를 잃는다.

import { Worker, type Job } from 'bullmq'

import { geminiStatus } from './compile'
import { getConfig } from './config'
import { logger } from './logger'
import {
  QUEUE_COLLECT,
  QUEUE_DELIVER,
  QUEUE_HEAL,
  QUEUE_PREFIX,
  closeQueues,
  collectLimiter,
  syncSourceSchedules,
  type CollectJobData,
  type DeliverJobData,
  type HealJobData,
} from './queues'
import { closeRedis, getRedis, pingRedis } from './redis'

const cfg = getConfig()

/** 한 줄 안내 후 종료. 스택 트레이스를 남기지 않는다 */
function bail(message: string): never {
  logger.error(message)
  process.exit(1)
}

async function main(): Promise<void> {
  // ── 전제 조건 확인 ───────────────────────────────────────────────────
  if (cfg.databaseUrl === undefined) {
    bail('DATABASE_URL 이 비어 있습니다. 레포 루트에 `.env` 를 만들고(.env.example 참고) 다시 실행해 주세요.')
  }

  const redis = await pingRedis()
  if (!redis.ok) bail(redis.message)

  // 키가 없어도 계속 간다 — 새 사이트를 읽어내는 기능만 꺼진다 (원칙 ④)
  const gemini = geminiStatus()
  if (!gemini.ready) logger.warn(gemini.message)

  // ── 잡 구현을 늦게 불러온다 ─────────────────────────────────────────
  // jobs/* 는 `./db` 를 타고 postgres 커넥션 풀을 만든다. 정적 import 로 두면 위의
  // 친절한 안내가 나오기도 전에 모듈 평가 단계에서 던진다.
  const [{ runCollectJob }, { runHealJob }, { runDeliverJob }, channels] = await Promise.all([
    import('./jobs/collect'),
    import('./jobs/heal'),
    import('./jobs/deliver'),
    import('./jobs/channels'),
    // 채널 구현체 등록 (ADR A11) — 인터페이스가 먼저 있고 구현체가 자기를 꽂는다
  ])
  const { registerDeliverer, registeredChannels } = channels
  const { webhookDeliverer } = await import('./jobs/channels/webhook')
  const { emailDeliverer } = await import('./jobs/channels/email')
  registerDeliverer(webhookDeliverer)
  registerDeliverer(emailDeliverer)

  // ── 스케줄 동기화 (ADR A8) ──────────────────────────────────────────
  const { listSchedulableSources } = await import('./db')
  try {
    const sources = await listSchedulableSources()
    const synced = await syncSourceSchedules(sources)
    logger.info({ sources: sources.length, ...synced }, '수집 스케줄 동기화')
  } catch {
    // DB 가 아직 마이그레이션 전일 수 있다. 스케줄이 없어도 워커는 떠 있어야 한다
    // (수동 수집과 컬렉션 생성 흐름은 스케줄 없이도 잡을 민다).
    logger.warn('수집 스케줄을 동기화하지 못했습니다. `pnpm --filter @endpointer/core db:migrate` 를 확인해 주세요.')
  }

  // ── 워커 세 개 ──────────────────────────────────────────────────────
  const connection = getRedis()
  const common = { connection, prefix: QUEUE_PREFIX } as const

  const collectWorker = new Worker<CollectJobData>(
    QUEUE_COLLECT,
    async (job: Job<CollectJobData>) => runCollectJob(job.data),
    {
      ...common,
      concurrency: cfg.workerConcurrency,
      // 전체 처리량 상한. 호스트별 진짜 예의는 fetchers/http.ts 의 throttle 이 지킨다 (6장)
      limiter: collectLimiter(),
    },
  )

  const healWorker = new Worker<HealJobData>(
    QUEUE_HEAL,
    async (job: Job<HealJobData>) => runHealJob(job.data),
    {
      ...common,
      // 치유는 Gemini 호출과 브라우저를 동시에 쓴다. 브라우저 동시성 이하로 묶어야
      // Playwright 가 메모리를 먹고 프로세스를 죽이는 사고를 막는다 (15장).
      concurrency: cfg.browserConcurrency,
    },
  )

  const deliverWorker = new Worker<DeliverJobData>(
    QUEUE_DELIVER,
    async (job: Job<DeliverJobData>) => runDeliverJob(job.data),
    { ...common, concurrency: cfg.workerConcurrency },
  )

  const workers = [collectWorker, healWorker, deliverWorker]

  for (const worker of workers) {
    worker.on('failed', (job, err) => {
      // 여기 남는 건 개발자용이다. 사용자가 읽는 문구는 `runs.error_summary` 에 있다 (B4)
      logger.error({ queue: worker.name, job: job?.name, err: err.message }, '잡 실패')
    })
    worker.on('error', (err) => {
      logger.error({ queue: worker.name, err: err.message }, '워커 오류')
    })
  }

  // 화면이 파이프라인을 부르는 문 (ADR A30). 토큰이 없으면 열리지 않는다.
  const { startHttpServer } = await import('./http')
  const httpServer = startHttpServer()

  logger.info(
    {
      queues: [QUEUE_COLLECT, QUEUE_HEAL, QUEUE_DELIVER],
      concurrency: cfg.workerConcurrency,
      browser_concurrency: cfg.browserConcurrency,
      channels: registeredChannels(),
      gemini: gemini.ready ? gemini.model : 'off',
      http: httpServer === null ? 'off' : cfg.workerHttpPort,
    },
    '워커 시작',
  )

  // ── graceful shutdown ───────────────────────────────────────────────
  //
  // 수집 도중에 프로세스가 사라지면 `runs` 행이 finished_at 없이 남아 화면에
  // "수집 중" 이 영원히 걸린다. 그래서 돌고 있는 잡은 끝까지 마치고 내려간다.
  let closing = false
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return
    closing = true
    logger.info({ signal }, '종료 신호 — 하던 일을 마치고 내려갑니다')

    const timer = setTimeout(() => {
      logger.warn('정리에 시간이 너무 걸려 강제로 종료합니다')
      process.exit(1)
    }, 20_000)
    timer.unref()

    try {
      httpServer?.close()
      await Promise.all(workers.map((w) => w.close()))
      await closeQueues()
      const { closeDb } = await import('@endpointer/core/db')
      await closeDb()
      await closeRedis()
    } catch {
      // 정리 중의 오류로 종료 코드를 더럽히지 않는다
    }
    clearTimeout(timer)
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  // 잡 안에서 새어 나온 rejection 으로 워커가 통째로 죽지 않게 한다 (원칙 ④)
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason: String(reason) }, '처리되지 않은 오류')
  })
}

void main()
