// Auth.js 콜백 엔드포인트 (P4).
// 자격증명이 없으면 provider 가 0개인 채로 뜬다 — 부팅은 성공하고, 화면이 안내를 띄운다.

import { handlers } from '@/auth'

export const { GET, POST } = handlers
