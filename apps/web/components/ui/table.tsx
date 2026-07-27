// 표의 껍데기만. 정렬·필터는 TanStack Table 이 하고 여기는 모양만 잡는다.

import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

/** 넓은 표가 페이지 전체를 가로로 밀지 않게 자기 안에서만 스크롤한다 */
export function TableShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('scroll-x rounded-card border border-border bg-surface', className)}>
      {children}
    </div>
  )
}

export function Table({ className, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return <table className={cn('w-full border-collapse text-sm', className)} {...rest} />
}

export function THead({ className, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('bg-canvas', className)} {...rest} />
}

export function TBody({ className, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={className} {...rest} />
}

export function TR({ className, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('border-b border-border last:border-b-0', className)} {...rest} />
}

export function TH({ className, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn('px-3 py-2.5 text-xs font-semibold text-muted whitespace-nowrap', className)}
      {...rest}
    />
  )
}

export function TD({ className, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-3 py-2.5 align-top', className)} {...rest} />
}
