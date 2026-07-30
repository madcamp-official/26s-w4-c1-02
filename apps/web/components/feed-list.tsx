// 읽기 피드의 목록 (기획서 3장 — 표가 아니라 흐름으로 소비하는 화면).
// 훅이 없으므로 서버 컴포넌트로 그대로 그려진다.

import type { ApiItem, FieldDef } from '@endpointer/core'

import { Badge } from '@/components/ui/badge'

const DAY_MS = 86_400_000
const EMPTY_MARK = '—'
const NEW_WINDOW_DAYS = 3

function readKey(item: ApiItem, key: string): unknown {
  return (item as unknown as Record<string, unknown>)[key]
}

/** 제목으로 쓸 필드 — 첫 글 필드, 없으면 첫 필드 */
function titleFieldOf(fields: readonly FieldDef[]): FieldDef | null {
  return fields.find((f) => f.type === 'text') ?? fields[0] ?? null
}

/** 날짜(YYYY-MM-DD)까지 남은 날. collection-table 의 판정과 같은 기준(Asia/Seoul) */
function daysLeft(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const target = Date.parse(`${value}T23:59:59+09:00`)
  if (Number.isNaN(target)) return null
  return Math.ceil((target - Date.now()) / DAY_MS)
}

function isRecentlyAdded(item: ApiItem): boolean {
  const seen = Date.parse(item._first_seen_at)
  if (Number.isNaN(seen)) return false
  return Date.now() - seen < NEW_WINDOW_DAYS * DAY_MS
}

const numberFormat = new Intl.NumberFormat('ko-KR')

export function FeedList({
  items,
  fields,
  dateField,
}: {
  items: ApiItem[]
  fields: readonly FieldDef[]
  /** D-day 배지의 기준이 되는 날짜 필드. 없으면 배지를 생략한다 */
  dateField: FieldDef | null
}) {
  const titleField = titleFieldOf(fields)
  const orgField = fields.filter((f) => f.type === 'text')[1] ?? null
  const moneyField = fields.find((f) => f.type === 'money') ?? null

  return (
    <ul className="flex max-w-[760px] flex-col gap-3">
      {items.map((item, index) => {
        const rawTitle = titleField === null ? null : readKey(item, titleField.key)
        const title =
          rawTitle === null || rawTitle === undefined || rawTitle === ''
            ? EMPTY_MARK
            : String(rawTitle)
        const link = typeof item._link === 'string' ? item._link : null
        const dateValue = dateField === null ? null : readKey(item, dateField.key)
        const left = daysLeft(dateValue)
        const org = orgField === null ? null : readKey(item, orgField.key)
        const money = moneyField === null ? null : readKey(item, moneyField.key)

        return (
          <li key={`${item._source}-${index}`}>
            <article className="flex items-center gap-4 rounded-[13px] border border-border bg-surface px-5 py-4 transition-colors hover:border-accent">
              {left !== null && left >= 0 && (
                <Badge
                  tone={left <= 7 ? 'attention' : 'accent'}
                  // 고정 폭 + 가운데 정렬 — "D-1"과 "오늘까지"가 같은 크기라야 줄이 맞는다
                  className="min-w-[62px] shrink-0 justify-center rounded-[7px] px-2 py-1.5 text-center font-extrabold"
                >
                  {left === 0 ? '오늘까지' : `D-${left}`}
                </Badge>
              )}

              <div className="min-w-0 flex-1">
                <div className="mb-0.5 flex items-center gap-2">
                  {link !== null ? (
                    <a
                      href={link}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="truncate text-[15px] font-bold text-ink underline-offset-4 hover:text-accent"
                    >
                      {title}
                    </a>
                  ) : (
                    <span className="truncate text-[15px] font-bold text-ink">{title}</span>
                  )}
                  {isRecentlyAdded(item) && (
                    <Badge tone="accent" className="shrink-0 font-extrabold">
                      NEW
                    </Badge>
                  )}
                </div>
                <p className="truncate text-[13px] text-faint">
                  {typeof org === 'string' && org !== '' && <span>{org} · </span>}
                  <span className="font-mono">{item._source}</span>
                  {dateField !== null && typeof dateValue === 'string' && dateValue !== '' && (
                    <span>
                      {' '}
                      · {dateField.label} {dateValue}
                    </span>
                  )}
                </p>
              </div>

              {typeof money === 'number' && (
                <span className="shrink-0 text-sm font-bold whitespace-nowrap text-brand">
                  {numberFormat.format(money)}원
                </span>
              )}
            </article>
          </li>
        )
      })}
    </ul>
  )
}
