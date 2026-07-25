// pino 로거 — stdout 은 개발자용 디버그 로그다 (기획서 8장).
// 사용자에게 보여줄 로그는 `runs` 테이블에 남기고, 여기에는 내부 용어를 써도 된다.

import pino from 'pino'

import { getConfig } from './config'

const cfg = getConfig()

const usePretty = cfg.nodeEnv !== 'production'

export const logger: pino.Logger = pino({
  level: cfg.logLevel,
  base: { app: 'worker' },
  ...(usePretty
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,app' },
        },
      }
    : {}),
})

/** 잡·소스 단위로 컨텍스트를 붙인 자식 로거 */
export function childLogger(bindings: Record<string, unknown>): pino.Logger {
  return logger.child(bindings)
}

export type Logger = pino.Logger
