// 화면에 나가는 말. 보장선 B2·B4 가 여기서 결정된다.
//
// 상태를 화면에 그릴 때 코드가 직접 문자열을 만들지 않고 반드시 이 표를 거친다.
// 문구가 한 곳에 모여 있어야 lib/guardrails.test.ts 가 지킬 수 있고,
// 급할 때 붙인 한 줄이 보장선을 깨는 일이 줄어든다.

import type { FieldType, SourceStatus } from '@endpointer/core'

export type Tone = 'ok' | 'healing' | 'attention' | 'paused' | 'neutral' | 'accent'

export interface StatusCopy {
  tone: Tone
  /** 알약 안에 들어갈 짧은 말 */
  short: string
  /** 알약 옆이나 아래에 붙는 사람 문장 */
  sentence: string
}

/** 사이트 상태 → 색 + 사람 문장. HTTP 코드도 스택도 여기 없다 (보장선 B4) */
export const SOURCE_STATUS_COPY: Record<SourceStatus, StatusCopy> = {
  ok: {
    tone: 'ok',
    short: '잘 되고 있어요',
    sentence: '마지막으로 확인했을 때 이 사이트는 문제가 없었어요.',
  },
  healing: {
    tone: 'healing',
    short: '다시 맞추는 중',
    sentence: '이 사이트 구조가 바뀐 것 같아요. 다시 맞추는 중이라 그동안은 마지막으로 받아둔 내용을 보여드려요.',
  },
  needs_attention: {
    tone: 'attention',
    short: '봐주셔야 해요',
    sentence: '혼자 힘으로는 다시 맞추지 못했어요. 한 번 확인해 주세요.',
  },
  paused: {
    tone: 'paused',
    short: '잠시 멈춤',
    sentence: '지금은 이 사이트를 새로 보지 않고 있어요.',
  },
}

/** 공개 범위 — 사용자에게 보이는 말 */
export const VISIBILITY_COPY: Record<'private' | 'unlisted' | 'public', string> = {
  private: '나만 보기',
  unlisted: '주소를 아는 사람만',
  public: '누구나',
}

/** 필드 타입 → 열 머리에 붙는 아주 짧은 힌트. 타입 코드를 그대로 보여주지 않는다 */
export const FIELD_TYPE_HINT: Record<FieldType, string> = {
  text: '글',
  date: '날짜',
  money: '금액',
  number: '숫자',
  link: '주소',
  enum: '분류',
}

/** 자주 쓰는 안내 문장. 한곳에 모아 문체를 맞춘다 */
export const COPY = {
  /** 첫 화면의 주인공 (기획서 2장 설계 원칙) */
  heroTitle: '목록이 있는 페이지 주소를 붙여넣어 주세요',
  heroSubtitle: '표로 만들어 드릴게요. 여러 사이트를 붙이면 하나의 표에 같이 담깁니다.',
  heroPlaceholder: 'https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do',
  heroSubmit: '표 만들기',
  /** 아직 만든 것이 없을 때. 빈 표를 주지 않는다 (보장선 B3) */
  emptyTitle: '아직 만든 표가 없어요',
  emptyBody: '주소 하나만 있으면 됩니다. 나머지는 저희가 채워서 보여드릴게요.',
  googleNotConfigured:
    '구글 로그인 설정이 아직 안 됐습니다. 설정을 마치기 전까지는 미리 담아둔 예시 내용을 볼 수 있어요.',
  signIn: '구글로 시작하기',
  signOut: '로그아웃',
  /** 개발자용 서랍 (보장선 B5·B7 — 빼지 않고 접는다) */
  developerSummary: '개발자용 — API 주소 / AI에 연결',
  developerNote: '필요한 사람만 열어보면 됩니다. 표를 쓰는 데는 없어도 괜찮아요.',
  apiLabel: '내 API 주소',
  mcpLabel: 'AI에 연결',
  mcpHelp: '아래 한 줄을 복사해 쓰시는 AI의 커넥터 설정에 붙여넣으면 끝입니다.',
  copy: '복사',
  copied: '복사했어요',
  /** 읽기 피드 (기획서 3장 — 훑는 사람 · G3 트랙 B) */
  feedOpen: '읽기로 보기',
  feedBack: '표로 보기',
  feedFreshTitle: '새로 올라온 것',
  feedFreshBody: '표에 새로 담긴 순서예요.',
  feedClosingTitle: '마감 임박',
  feedEmpty: '아직 보여드릴 항목이 없어요. 사이트에서 새 내용을 받아오면 여기부터 채워집니다.',
  /** 새 항목 받아보기 (기획서 9-4 · P7 — 웹훅 먼저) */
  subscribeTitle: '새 항목을 알아서 받아보기',
  subscribeBody: '매번 들어와서 확인하지 않아도 돼요 — 정해진 시각에 새 것만 묶어서 보내드려요.',
  subscribeTargetLabel: '어디로 보낼까요? — 웹훅 주소 하나면 끝, 슬랙·노션에 바로',
  subscribeSchedule: '매일 오전 9시에 보내드려요. 같은 항목을 두 번 보내지 않아요.',
  subscribePlaceholder: 'https://hooks.slack.com/services/…',
  subscribeSubmit: '받아보기',
  subscribeStop: '그만 받기',
  subscribeNeverSent: '아직 보낸 적은 없어요',
  /** AI에 연결 (기획서 12장 · 보장선 B7) */
  connectPill: 'AI에 연결',
  connectTitle: '내 AI가 이 컬렉션을 직접 봐요',
  connectBody:
    '주소 한 줄을 복사해서 쓰는 AI의 커넥터 설정에 붙여넣으면 끝이에요. 설정 파일도, 설치도 없어요.',
  connectStep1: '아래 주소를 복사해요',
  connectStep2: '쓰는 AI의 ‘커넥터 추가’에 붙여넣어요',
  connectStep3: '그냥 물어보면 돼요',
} as const

/** "이번 달 자동 복구 N회" — 기획서 5장④. 조용히 고치지 않고 쌓아서 보여준다 */
export function healedCopy(count: number): string {
  return count === 0
    ? '이번 달에는 고칠 일이 없었어요'
    : `이번 달 자동 복구 ${count}회`
}

/** 소스가 몇 곳인지 · 항목이 몇 개인지 */
export function coverageCopy(siteCount: number, itemCount: number): string {
  return `사이트 ${siteCount}곳 · 항목 ${itemCount}개`
}

/** 컬렉션 카드의 상태 한 줄 — 나쁜 순서대로 하나만 말한다 */
export function cardStatusCopy(healing: number, attention: number): StatusCopy {
  if (attention > 0)
    return { tone: 'attention', short: `사이트 ${attention}곳 봐주셔야 해요`, sentence: SOURCE_STATUS_COPY.needs_attention.sentence }
  if (healing > 0)
    return { tone: 'healing', short: `사이트 ${healing}곳 다시 맞추는 중`, sentence: SOURCE_STATUS_COPY.healing.sentence }
  return { tone: 'ok', short: '전부 정상', sentence: SOURCE_STATUS_COPY.ok.sentence }
}

/** "마감 임박" 절의 설명 — 기준이 된 날짜 열의 이름을 그대로 보여준다 */
export function closingCopy(fieldLabel: string): string {
  return `${fieldLabel}이(가) 가까운 순서예요. 오늘 이후의 항목만 보여드려요.`
}

/** 마지막으로 보낸 시각 문구 */
export function lastSentCopy(formatted: string): string {
  return `마지막으로 보낸 시각 — ${formatted}`
}
