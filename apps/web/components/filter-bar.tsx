// 표 위 필터 바 (델타 2-10 — 뷰 편집은 폼이 아니라 표 위에서).
// GET 폼이라 자바스크립트 없이 돈다. 파라미터 규약은 lib/views.ts conditionsFromParams 참조.
// 여기서 거는 필터는 임시 조회다 — "이 조건 저장"을 눌러야 뷰가 된다.

import Link from 'next/link'

import type { FieldDef } from '@endpointer/core'

import { Button } from '@/components/ui/button'

const DATE_OPTIONS = [
  { value: '', label: '전체' },
  { value: 'this_week', label: '이번 주' },
  { value: 'this_month', label: '이번 달' },
  { value: '7', label: 'D-7 이내' },
  { value: '30', label: 'D-30 이내' },
] as const

const selectClass =
  'h-9 rounded-lg border border-border bg-surface px-2 text-[13px] text-ink focus:border-accent focus:outline-none'
const inputClass =
  'h-9 w-28 rounded-lg border border-border bg-surface px-2.5 text-[13px] text-ink placeholder:text-faint focus:border-accent focus:outline-none'

/** enum 필드가 고를 수 있는 값 목록 — value_labels 우선, 없으면 mapping 의 정규화 키 */
function enumOptions(field: FieldDef): { value: string; label: string }[] {
  if (field.value_labels !== null) {
    return Object.entries(field.value_labels).map(([value, label]) => ({ value, label }))
  }
  if (field.mapping !== null) {
    const keys = [...new Set(Object.values(field.mapping))]
    return keys.map((value) => ({ value, label: value }))
  }
  return []
}

export function FilterBar({
  basePath,
  fields,
  values,
}: {
  /** 폼이 제출될 경로 (= 표 탭) */
  basePath: string
  fields: readonly FieldDef[]
  /** 현재 적용된 파라미터 (필터 상태 복원용) */
  values: Record<string, string>
}) {
  const dateFields = fields.filter((f) => f.type === 'date')
  const enumFields = fields.filter((f) => f.type === 'enum' && enumOptions(f).length > 0)
  const amountFields = fields.filter((f) => f.type === 'money' || f.type === 'number')
  if (dateFields.length + enumFields.length + amountFields.length === 0) return null

  const hasValues = Object.values(values).some((v) => v !== '')

  return (
    <form action={basePath} className="flex flex-wrap items-end gap-3 rounded-card border border-border bg-surface px-4 py-3">
      {dateFields.map((field) => (
        <label key={field.key} className="flex flex-col gap-1 text-xs font-semibold text-faint">
          {field.label}
          <select name={`d_${field.key}`} defaultValue={values[`d_${field.key}`] ?? ''} className={selectClass}>
            {DATE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ))}

      {enumFields.map((field) => (
        <label key={field.key} className="flex flex-col gap-1 text-xs font-semibold text-faint">
          {field.label}
          <select name={`e_${field.key}`} defaultValue={values[`e_${field.key}`] ?? ''} className={selectClass}>
            <option value="">전체</option>
            {enumOptions(field).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ))}

      {amountFields.map((field) => (
        <label key={field.key} className="flex flex-col gap-1 text-xs font-semibold text-faint">
          {field.label}
          <span className="flex items-center gap-1.5">
            <input
              name={`min_${field.key}`}
              defaultValue={values[`min_${field.key}`] ?? ''}
              inputMode="numeric"
              placeholder="이상"
              className={inputClass}
            />
            <span className="text-faint">~</span>
            <input
              name={`max_${field.key}`}
              defaultValue={values[`max_${field.key}`] ?? ''}
              inputMode="numeric"
              placeholder="이하"
              className={inputClass}
            />
          </span>
        </label>
      ))}

      <div className="flex items-center gap-2 pb-0.5">
        <Button type="submit" size="sm" variant="outline">
          걸러보기
        </Button>
        {hasValues && (
          <Link href={basePath} className="text-[13px] text-faint hover:text-accent">
            지우기
          </Link>
        )}
      </div>
    </form>
  )
}
