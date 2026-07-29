// shadcn/ui 는 설치돼 있지 않다. 5일짜리에 필요한 만큼만 얇게 짠다.
// 훅을 쓰지 않으므로 서버 컴포넌트에서도 그대로 쓸 수 있다.

import type { ButtonHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

export type ButtonVariant = 'primary' | 'outline' | 'ghost'
export type ButtonSize = 'sm' | 'md' | 'lg'

// 원본 components/buttons/Button.jsx 를 그대로 이식 (스타일은 app/ds.css 의 .ds-btn-* 에).
// API 는 앱 기존대로 (outline = 원본 secondary).
const VARIANT: Record<ButtonVariant, string> = {
  primary: 'ds-btn-primary',
  outline: 'ds-btn-outline',
  ghost: 'ds-btn-ghost',
}

const SIZE: Record<ButtonSize, string> = {
  sm: 'ds-btn-sm',
  md: 'ds-btn-md',
  lg: 'ds-btn-lg',
}

/** 버튼 모양만 필요한 곳(링크 등)에서 쓴다 */
export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md'): string {
  return cn('ds-btn', VARIANT[variant], SIZE[size])
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({ className, variant = 'primary', size = 'md', ...rest }: ButtonProps) {
  return <button className={cn(buttonClass(variant, size), className)} {...rest} />
}
