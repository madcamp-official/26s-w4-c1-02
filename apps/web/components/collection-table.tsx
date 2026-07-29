'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnOrderState,
  type SortingState,
} from '@tanstack/react-table'

import type { ApiItem, FieldDef } from '@endpointer/core'

import { Badge } from '@/components/ui/badge'
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
  const raw = readKey(item, '_raw')
  if (typeof raw !== 'object' || raw === null) return null
  const rawObj = raw as Record<string, unknown>

  // 파이프라인 형태 — `{_row, _fields}`. `_fields` 가 필드별 변환 전 원값이다 (interpret.ts).
  // 이 형태를 안 읽어서 실수집 항목에서 툴팁이 통째로 사라져 있었다 (day2 §8).
  const fields = rawObj['_fields']
  if (typeof fields === 'object' && fields !== null) {
    const original = (fields as Record<string, unknown>)[key]
    if (original !== null && original !== undefined) {
      return typeof original === 'string' ? original : JSON.stringify(original)
    }
  }

  // 경로 키 형태 — 예전 시드가 만든 항목. 다시 시드하기 전의 DB 도 계속 보여야 한다
  const provenance = readKey(item, '_provenance')
  if (typeof provenance !== 'object' || provenance === null) return null
  const path = (provenance as Record<string, unknown>)[key]
  if (typeof path !== 'string') return null
  const original = rawObj[path]
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
  /** 열 순서를 이 컬렉션 앞으로 기억한다 (localStorage 키) */
  storageKey: string
}

/**
 * 기본 열 순서 — 출처가 맨 앞, **원문 링크(link 타입)는 맨 뒤**로 민다.
 * 링크는 값이 아니라 "원문 보기" 버튼이라 가운데 끼면 표가 읽기 나빠진다.
 * 사용자가 드래그로 바꾸면 그 순서가 이긴다.
 */
function defaultColumnOrder(fields: readonly FieldDef[]): ColumnOrderState {
  const links: string[] = []
  const rest: string[] = []
  for (const f of fields) (f.type === 'link' ? links : rest).push(f.key)
  return ['_source', ...rest, ...links]
}

export function CollectionTable({ fields, items, hosts, storageKey }: CollectionTableProps) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [keyword, setKeyword] = useState('')
  const [host, setHost] = useState<string>('')

  // 열 순서 — 기본값으로 먼저 그리고(서버·첫 렌더 일치), 저장된 순서가 있으면 그 뒤에 얹는다.
  const baseOrder = useMemo(() => defaultColumnOrder(fields), [fields])
  const orderStoreKey = `endpointer:colorder:${storageKey}`
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(baseOrder)
  const [reordered, setReordered] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(orderStoreKey)
      if (saved === null) return
      const parsed = JSON.parse(saved) as unknown
      // 스키마가 바뀌었으면(열 추가·삭제) 저장분을 버리고 기본값으로 — 유령 열이 안 생기게
      if (
        Array.isArray(parsed) &&
        parsed.length === baseOrder.length &&
        parsed.every((id) => typeof id === 'string' && baseOrder.includes(id))
      ) {
        setColumnOrder(parsed as ColumnOrderState)
        setReordered(true)
      }
    } catch {
      // 저장분이 깨졌으면 기본값 그대로
    }
  }, [orderStoreKey, baseOrder])

  const dragId = useRef<string | null>(null)

  function moveColumn(fromId: string, toId: string): void {
    if (fromId === toId) return
    setColumnOrder((prev) => {
      const next = [...prev]
      const fromIdx = next.indexOf(fromId)
      const toIdx = next.indexOf(toId)
      if (fromIdx < 0 || toIdx < 0) return prev
      next.splice(fromIdx, 1)
      next.splice(toIdx, 0, fromId)
      try {
        localStorage.setItem(orderStoreKey, JSON.stringify(next))
      } catch {
        // 저장 실패해도 이번 세션 순서는 유지된다
      }
      return next
    })
    setReordered(true)
  }

  function resetOrder(): void {
    setColumnOrder(baseOrder)
    setReordered(false)
    try {
      localStorage.removeItem(orderStoreKey)
    } catch {
      // 무시
    }
  }

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
    state: { sorting, globalFilter: keyword, columnOrder },
    onSortingChange: setSorting,
    onColumnOrderChange: setColumnOrder,
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

  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface">
      {/* 필터 바 — 원본 DetailTable: 패널 안 상단에 붙고 아래로 표가 이어진다 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-divider px-4 py-3">
        <input
          type="search"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="공고 검색"
          className={cn(
            'h-9 min-w-48 flex-1 rounded-lg border border-border bg-raised px-3 text-sm',
            'placeholder:text-faint focus:border-accent focus:outline-none',
          )}
        />
        <select
          value={host}
          onChange={(e) => setHost(e.target.value)}
          aria-label="출처 고르기"
          className="h-9 rounded-lg border border-border bg-raised px-2 text-sm"
        >
          <option value="">모든 출처</option>
          {hosts.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        {reordered && (
          <button
            type="button"
            onClick={resetOrder}
            className="text-xs text-faint underline underline-offset-2 hover:text-accent"
          >
            열 순서 초기화
          </button>
        )}
        <span className="ml-auto font-mono text-xs text-faint">{rows.length} rows</span>
      </div>

      <div className="scroll-x">
        <table className="w-full border-collapse text-sm">
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id} className="border-b border-divider">
                {group.headers.map((header) => {
                  const sorted = header.column.getIsSorted()
                  const colId = header.column.id
                  return (
                    <th
                      key={header.id}
                      draggable
                      onDragStart={() => {
                        dragId.current = colId
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault()
                        if (dragId.current !== null) moveColumn(dragId.current, colId)
                        dragId.current = null
                      }}
                      className="cursor-grab px-4 py-2.5 text-left text-[11px] font-semibold tracking-[0.07em] whitespace-nowrap text-faint uppercase active:cursor-grabbing"
                    >
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="flex items-center gap-1 uppercase hover:text-muted"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <span aria-hidden className="text-faint/70">
                          {sorted === 'asc' ? '↑' : sorted === 'desc' ? '↓' : ''}
                        </span>
                      </button>
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className="border-b border-divider last:border-b-0 hover:bg-raised/40"
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-2.5 align-top text-[13.5px] text-ink">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length === 0 && (
        <p className="px-4 py-4 text-sm text-muted">
          찾는 조건에 맞는 항목이 없어요. 검색어를 지우거나 출처를 전체로 바꿔보세요.
        </p>
      )}
    </div>
  )
}
