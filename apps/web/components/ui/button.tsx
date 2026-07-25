// shadcn/ui 는 설치돼 있지 않다. 5일짜리에 필요한 만큼만 얇게 짠다.
// 훅을 쓰지 않으므로 서버 컴포넌트에서도 그대로 쓸 수 있다.

import type { ButtonHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

export type ButtonVariant = 'primary' | 'outline' | 'ghost'
export type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-ink hover:bg-accent-hover border border-transparent',
  outline: 'bg-surface text-ink border border-border-strong hover:bg-raised',
  ghost: 'bg-transparent text-muted border border-transparent hover:bg-raised hover:text-ink',
}

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm rounded-lg',
  md: 'h-10 px-4 text-sm rounded-lg',
  lg: 'h-12 px-6 text-base rounded-xl',
}

/** 버튼 모양만 필요한 곳(링크 등)에서 쓴다 */
export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md'): string {
  return cn(
    'inline-flex items-center justify-center gap-2 font-medium transition-colors',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
    'disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap',
    VARIANT[variant],
    SIZE[size],
  )
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({ className, variant = 'primary', size = 'md', ...rest }: ButtonProps) {
  return <button className={cn(buttonClass(variant, size), className)} {...rest} />
}
