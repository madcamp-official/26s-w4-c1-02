// probe CLI — `pnpm --filter @endpointer/worker probe <url>`
//
// ── 이게 G1 판정 도구다 ─────────────────────────────────────────────────
// 기획서 13장 G1(A) 판정 조건:
//   · 그 자리에서 정한 낯선 URL 3개 중 2개 이상에서 아이템이 나온다
//   · probe 가 어느 경로로 뚫렸는지가 로그에 구분돼 남는다
//
// 그래서 이 출력은 로그가 아니라 **판정문** 이다. 사람이 5초 안에
// "뚫렸나 / 어디로 뚫렸나 / 그게 맞는 목록인가" 를 읽을 수 있어야 한다.
// 마지막 질문의 답이 겹침률이고, 그래서 샘플 3개를 눈으로 볼 수 있게 같이 찍는다.
//
// DB 도 Redis 도 필요 없다. URL 하나만 있으면 돈다 (`./db` 를 import 하지 않는 이유).

import { resetConfigCache } from '../config'
import { PROBE_PATH_LABELS, probe, sampleRows, type ProbeResult } from '../probe'

const USAGE = `사용법: pnpm --filter @endpointer/worker probe <url> [옵션]

옵션
  --no-browser      브라우저를 쓰는 단계를 건너뛴다 (G1 강등 규칙 1)
  --no-dom          DOM 반복 구조 탐지를 건너뛴다 (G1 강등 규칙 2)
  --min-overlap=N   이 겹침률(0~1) 미만이면 다음 단계로 내려간다 (기본 0.3)
  --allow-private   사설망 주소를 허용한다 (로컬 픽스처 테스트용)
  --json            사람용 출력 대신 결과 JSON 을 그대로 찍는다
`

interface CliOptions {
  url: string
  skipBrowser: boolean
  skipDom: boolean
  minOverlap: number | undefined
  allowPrivate: boolean
  asJson: boolean
}

function parseArgs(argv: readonly string[]): CliOptions | null {
  let url: string | null = null
  let skipBrowser = false
  let skipDom = false
  let minOverlap: number | undefined
  let allowPrivate = false
  let asJson = false

  for (const arg of argv) {
    if (arg === '--no-browser') skipBrowser = true
    else if (arg === '--no-dom') skipDom = true
    else if (arg === '--allow-private') allowPrivate = true
    else if (arg === '--json') asJson = true
    else if (arg.startsWith('--min-overlap=')) {
      const n = Number.parseFloat(arg.slice('--min-overlap='.length))
      if (Number.isFinite(n)) minOverlap = n
    } else if (arg.startsWith('-')) {
      return null
    } else if (url === null) {
      url = arg
    }
  }

  if (url === null) return null
  // 스킴을 빼먹는 일이 잦다. 붙여준다.
  const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`
  return { url: normalized, skipBrowser, skipDom, minOverlap, allowPrivate, asJson }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))
  if (opts === null) {
    process.stdout.write(USAGE)
    process.exit(1)
  }

  // 나가는 요청 관문을 통째로 연다 (`config.ts` 의 allowPrivateHosts 주석)
  if (opts.allowPrivate) {
    process.env['ALLOW_PRIVATE_HOSTS'] = 'true'
    resetConfigCache()
  }

  const result = await probe(opts.url, {
    skipBrowser: opts.skipBrowser,
    skipDom: opts.skipDom,
    ...(opts.minOverlap !== undefined ? { minOverlap: opts.minOverlap } : {}),
  })

  if (opts.asJson) {
    process.stdout.write(`${JSON.stringify(result, replacer, 2)}\n`)
    process.exit(result.ok ? 0 : 2)
  }

  process.stdout.write(render(result))
  // 종료 코드로도 판정할 수 있게 — 스크립트로 3개를 연달아 돌릴 때 쓴다
  process.exit(result.ok ? 0 : 2)
}

// ── 사람이 읽는 출력 ───────────────────────────────────────────────────

function render(r: ProbeResult): string {
  const out: string[] = []
  const line = '─'.repeat(64)

  out.push('')
  out.push(line)
  out.push(`  ${r.url}`)
  if (r.final_url !== r.url) out.push(`  → ${r.final_url}`)
  out.push(line)

  // ① 뚫렸나 · 어디로 뚫렸나 (G1 판정 조건)
  if (r.ok && r.probe_path !== null) {
    out.push(`  결과      뚫림 — ${PROBE_PATH_LABELS[r.probe_path]} (${r.probe_path})`)
    out.push(`  수집 방식  ${r.fetch_mode}`)
  } else {
    out.push('  결과      못 뚫음')
  }
  out.push(`  걸린 시간  ${(r.duration_ms / 1000).toFixed(1)}초`)
  out.push('')

  // ② 단계별 기록 — "어느 경로로 뚫렸는지" 의 근거
  out.push('  단계')
  for (const step of r.steps) {
    const mark = step.ran ? (step.candidates > 0 ? '●' : '○') : '·'
    const label = PROBE_PATH_LABELS[step.path].padEnd(8, ' ')
    out.push(`    ${mark} ${label} 후보 ${String(step.candidates).padStart(2)}개  ${step.duration_ms}ms  ${step.note}`)
  }
  out.push('')

  // ③ 후보와 겹침률 — 사람이 "이게 그 목록이 맞나" 를 판단하는 재료 (14장)
  out.push(`  후보 ${r.candidates.length}개`)
  for (const [i, c] of r.candidates.slice(0, 5).entries()) {
    const head = i === 0 ? '  ★' : '   '
    out.push(`${head} ${pct(c.overlap).padStart(4)} 겹침 · 점수 ${c.score.toFixed(2)} · ${c.rows.length}개 · ${c.where}`)
    out.push(`      목록 경로  ${c.list_path}`)
    if (c.keys.length > 0) out.push(`      항목 이름  ${c.keys.slice(0, 10).join(', ')}`)
    if (i === 0) for (const reason of c.reasons) out.push(`      · ${reason}`)
  }
  out.push('')

  // ④ 뽑힌 아이템 샘플 3개 — 눈으로 보는 최종 판정
  if (r.best !== null) {
    out.push('  샘플 3개')
    for (const row of sampleRows(r.best.rows, 3)) {
      out.push(`    ${preview(row)}`)
    }
    out.push('')
  }

  if (r.warnings.length > 0) {
    out.push('  참고')
    for (const w of r.warnings) out.push(`    ${w}`)
    out.push('')
  }

  out.push(line)
  out.push('')
  return out.join('\n')
}

/** 후보 원소 한 줄 미리보기. JSON 이면 값들을, HTML 이면 텍스트를 보여준다 */
function preview(row: unknown, max = 110): string {
  if (typeof row === 'string') return clip(stripTags(row), max)
  if (row === null || typeof row !== 'object') return clip(String(row), max)

  const parts: string[] = []
  for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
    if (value === null || typeof value === 'object') continue
    const text = String(value).replace(/\s+/g, ' ').trim()
    if (text === '') continue
    parts.push(`${key}=${clip(text, 40)}`)
    if (parts.length >= 5) break
  }
  return clip(parts.join('  '), max)
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

/** `--json` 일 때 원소 전체를 쏟아내면 터미널이 넘친다 */
function replacer(key: string, value: unknown): unknown {
  if (key === 'rows' && Array.isArray(value)) return sampleRows(value, 3)
  if (key === 'text' && typeof value === 'string') return clip(value, 300)
  return value
}

void main()
