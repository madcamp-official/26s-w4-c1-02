'use client'

import { useMemo, useState } from 'react'
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'

import type { ApiItem, FieldDef } from '@endpointer/core'

import { Badge } from '@/components/ui/badge'
import { Table, TBody, TableShell, TD, TH, THead, TR } from '@/components/ui/table'
import { FIELD_TYPE_HINT } from '@/lib/labels'
import { cn } from '@/lib/utils'

// ── 값 그리기 ────────────────────────────────────────────────────────────

const EMPTY_MARK = '—'
const NEW_WINDOW_DAYS = 3

function readKey(item: ApiItem, key: string): unknown {
  return (item as unknown as Record<string, unknown>)[key]
}

const numberFormat = new Intl.NumberFormat('ko-KR')

function formatValue(value: unknown, field: FieldDef): string {
  if (value === null || value === undefined || value === '') return EMPTY_MARK
  switch (field.type) {
    case 'money':
      return typeof value === 'number' ? `${numberFormat.format(value)}원` : String(value)
    case 'number':
      return typeof value === 'number' ? numberFormat.format(value) : String(value)
    case 'enum':
      // 저장된 값은 정규화된 키(`rnd`)다. 화면에는 사람 말로 돌려놓는다 (보장선 B2).
      // API 응답은 키를 그대로 유지한다 — `?category=rnd` 가 성립해야 하므로 (기획서 12장).
      return field.value_labels?.[String(value)] ?? String(value)
    default:
      return String(value)
  }
}

/** 마감까지 남은 날. 날짜 타입에만 붙는다 */
function daysLeft(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const target = Date.parse(`${value}T23:59:59+09:00`)
  if (Number.isNaN(target)) return null
  return Math.ceil((target - Date.now()) / 86_400_000)
}

function isRecentlyAdded(item: ApiItem): boolean {
  const seen = Date.parse(item._first_seen_at)
  if (Number.isNaN(seen)) return false
  return Date.now() - seen < NEW_WINDOW_DAYS * 86_400_000
}

/** 출처 칩 색 — 호스트마다 다른 톤이 돌아가며 붙는다 (디자인 시안의 SRC_STYLE) */
const HOST_TONES = ['accent', 'ok', 'healing'] as const

function hostTone(host: string): (typeof HOST_TONES)[number] {
  let hash = 0
  for (const ch of host) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return HOST_TONES[Math.abs(hash) % HOST_TONES.length] ?? 'accent'
}

/**
 * 원문 대조 (기획서 5장 신뢰 계층 · 10장).
 * provenance 가 가리키는 경로로 raw 에서 원문 조각을 꺼낸다.
 */
function rawFragment(item: ApiItem, key: string): string | null {
  const provenance = readKey(item, '_provenance')
  const raw = readKey(item, '_raw')
  if (typeof provenance !== 'object' || provenance === null) return null
  if (typeof raw !== 'object' || raw === null) return null
  const path = (provenance as Record<string, unknown>)[key]
  if (typeof path !== 'string') return null
  const original = (raw as Record<string, unknown>)[path]
  if (original === null || original === undefined) return null
  return typeof original === 'string' ? original : JSON.stringify(original)
}

/** 값 한 칸. 마우스를 올리면 그 값이 원문에서 어떻게 적혀 있었는지 보인다 */
function ValueCell({ item, field }: { item: ApiItem; field: FieldDef }) {
  const value = readKey(item, field.key)
  const fragment = rawFragment(item, field.key)

  if (field.type === 'link') {
    const href = typeof value === 'string' ? value : null
    if (href === null) return <span className="text-faint">{EMPTY_MARK}</span>
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="text-accent underline underline-offset-2 hover:text-accent-hover"
      >
        원문 보기
      </a>
    )
  }

  const text = formatValue(value, field)
  const left = field.type === 'date' ? daysLeft(value) : null

  return (
    <span className="group/cell relative inline-flex items-center gap-1.5">
      <span
        className={cn(
          fragment !== null && 'decoration-border-strong decoration-dotted underline-offset-4',
          fragment !== null && 'underline',
        )}
      >
        {text}
      </span>

      {left !== null && left >= 0 && (
        <Badge tone={left <= 7 ? 'attention' : 'accent'} className="font-extrabold">
          {left === 0 ? '오늘까지' : `D-${left}`}
        </Badge>
      )}

      {fragment !== null && (
        <span
          role="note"
          className={cn(
            'pointer-events-none absolute top-full left-0 z-20 mt-1 hidden w-max max-w-xs',
            'rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs shadow-lg',
            'group-hover/cell:block',
          )}
        >
          <span className="block text-faint">원문에는 이렇게 적혀 있어요</span>
          <span className="block font-mono break-all text-ink">{fragment}</span>
        </span>
      )}
    </span>
  )
}

// ── 표 ───────────────────────────────────────────────────────────────────

export interface CollectionTableProps {
  fields: readonly FieldDef[]
  items: ApiItem[]
  /** 출처 고르기 드롭다운에 쓸 호스트 목록 */
  hosts: readonly string[]
}

export function CollectionTable({ fields, items, hosts }: CollectionTableProps) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [keyword, setKeyword] = useState('')
  const [host, setHost] = useState<string>('')

  const data = useMemo(
    () => (host === '' ? items : items.filter((item) => item._source === host)),
    [items, host],
  )

  const columns = useMemo<ColumnDef<ApiItem>[]>(() => {
    const sourceColumn: ColumnDef<ApiItem> = {
      id: '_source',
      header: '출처',
      accessorFn: (row) => row._source,
      cell: ({ row }) => (
        <span className="flex items-center gap-1.5">
          <Badge tone={hostTone(row.original._source)} className="font-mono font-semibold">
            {row.original._source}
          </Badge>
          {isRecentlyAdded(row.original) && (
            <Badge tone="accent" className="font-extrabold">
              NEW
            </Badge>
          )}
        </span>
      ),
    }

    const fieldColumns: ColumnDef<ApiItem>[] = fields.map((field) => ({
      id: field.key,
      header: field.label,
      accessorFn: (row) => readKey(row, field.key),
      sortUndefined: 'last',
      cell: ({ row }) => <ValueCell item={row.original} field={field} />,
    }))

    return [sourceColumn, ...fieldColumns]
  }, [fields])

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter: keyword },
    onSortingChange: setSorting,
    onGlobalFilterChange: setKeyword,
    globalFilterFn: (row, _columnId, filterValue) => {
      const term = String(filterValue).trim().toLowerCase()
      if (term === '') return true
      return Object.values(row.original as unknown as Record<string, unknown>).some(
        (value) => typeof value === 'string' && value.toLowerCase().includes(term),
      )
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  const rows = table.getRowModel().rows
  const fieldTypeByKey = new Map(fields.map((f) => [f.key, f.type]))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="표 안에서 찾기"
          className={cn(
            'h-9 min-w-52 flex-1 rounded-lg border border-border bg-surface px-3 text-sm',
            'placeholder:text-faint focus:border-accent focus:outline-none',
          )}
        />
        <select
          value={host}
          onChange={(e) => setHost(e.target.value)}
          aria-label="출처 고르기"
          className="h-9 rounded-lg border border-border bg-surface px-2 text-sm"
        >
          <option value="">출처 전체</option>
          {hosts.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted">{rows.length}개 보이는 중</span>
      </div>

      <TableShell>
        <Table>
          <THead>
            {table.getHeaderGroups().map((group) => (
              <TR key={group.id}>
                {group.headers.map((header) => {
                  const sorted = header.column.getIsSorted()
                  const hint = fieldTypeByKey.get(header.column.id)
                  return (
                    <TH key={header.id}>
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="flex items-center gap-1 hover:text-ink"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {hint && <span className="font-normal text-faint">· {FIELD_TYPE_HINT[hint]}</span>}
                        <span aria-hidden className="text-faint">
                          {sorted === 'asc' ? '↑' : sorted === 'desc' ? '↓' : '↕'}
                        </span>
                      </button>
                    </TH>
                  )
                })}
              </TR>
            ))}
          </THead>
          <TBody>
            {rows.map((row) => (
              <TR key={row.id} className="hover:bg-raised/50">
                {row.getVisibleCells().map((cell) => (
                  <TD key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TD>
                ))}
              </TR>
            ))}
          </TBody>
        </Table>
      </TableShell>

      {rows.length === 0 && (
        <p className="text-sm text-muted">
          찾는 조건에 맞는 항목이 없어요. 검색어를 지우거나 출처를 전체로 바꿔보세요.
        </p>
      )}
    </div>
  )
}
