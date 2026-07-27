// attach CLI — `pnpm --filter @endpointer/worker attach <slug> <url>`
//
// ── 이게 G2 판정 도구다 ─────────────────────────────────────────────────
// 기획서 13장 G2 판정 조건: **두 번째 사이트가 같은 표에 같은 형식으로 담긴다.**
// 그리고 5장: "여기서 사용자가 할 일이 많아지면 아무도 두 번째 소스를 붙이지 않는다."
//
// 그래서 이 출력이 답해야 하는 질문은 하나다:
//   **사용자가 손으로 채워야 하는 칸이 몇 개인가.**
// 0개면 제품이 성립하고, 다섯 중 넷이면 손으로 하는 게 빠르다.
// 그래서 맨 위에 그 숫자를 찍고, 칸마다 실제로 뽑힌 값을 같이 보여준다.
//
// `--paste "칸=값"` 으로 못 찾은 칸을 채워 볼 수 있다 — 화면에서 사용자가 할 일과 같다.

import { resetConfigCache } from '../config'
import { loadCollectionForAttach } from '../db'
import { attachSourceToCollection, resolveByPastedValue, type AttachSourceOutcome } from '../pipeline'

const USAGE = `사용법: pnpm --filter @endpointer/worker attach <slug> <url> [옵션]

  <slug>  이미 있는 표 (예: contest)
  <url>   붙일 두 번째 사이트 주소

옵션
  --paste "칸=값"      못 찾은 칸을 값으로 채운다. 여러 번 쓸 수 있다
                       예: --paste "deadline=2026-08-14"
  --min-confidence=N   이 확신도(0~1) 미만이면 물어본다 (기본 0.6)
  --no-browser         브라우저를 쓰는 단계를 건너뛴다
  --no-dom             DOM 반복 구조 탐지를 건너뛴다
  --allow-private      사설망 주소를 허용한다
  --json               결과 JSON 을 그대로 찍는다
`

interface CliOptions {
  slug: string
  url: string
  paste: { key: string; value: string }[]
  minConfidence: number | undefined
  skipBrowser: boolean
  skipDom: boolean
  allowPrivate: boolean
  asJson: boolean
}

function parseArgs(argv: readonly string[]): CliOptions | null {
  const positional: string[] = []
  const paste: { key: string; value: string }[] = []
  let minConfidence: number | undefined
  let skipBrowser = false
  let skipDom = false
  let allowPrivate = false
  let asJson = false

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? ''
    if (arg === '--no-browser') skipBrowser = true
    else if (arg === '--no-dom') skipDom = true
    else if (arg === '--allow-private') allowPrivate = true
    else if (arg === '--json') asJson = true
    else if (arg === '--paste') {
      const next = argv[i + 1]
      if (next === undefined) return null
      i += 1
      const entry = splitPaste(next)
      if (entry === null) return null
      paste.push(entry)
    } else if (arg.startsWith('--paste=')) {
      const entry = splitPaste(arg.slice('--paste='.length))
      if (entry === null) return null
      paste.push(entry)
    } else if (arg.startsWith('--min-confidence=')) {
      const n = Number.parseFloat(arg.slice('--min-confidence='.length))
      if (Number.isFinite(n)) minConfidence = n
    } else if (arg.startsWith('-')) {
      return null
    } else {
      positional.push(arg)
    }
  }

  const slug = positional[0]
  const rawUrl = positional[1]
  if (slug === undefined || rawUrl === undefined) return null
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`

  return { slug, url, paste, minConfidence, skipBrowser, skipDom, allowPrivate, asJson }
}

/** `deadline=2026-08-14` → `{key,value}`. 값 안에 `=` 가 또 있어도 첫 번째에서만 자른다 */
function splitPaste(raw: string): { key: string; value: string } | null {
  const at = raw.indexOf('=')
  if (at <= 0) return null
  const key = raw.slice(0, at).trim()
  const value = raw.slice(at + 1).trim()
  return key === '' || value === '' ? null : { key, value }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))
  if (opts === null) {
    process.stdout.write(USAGE)
    process.exit(1)
  }

  if (opts.allowPrivate) {
    process.env['ALLOW_PRIVATE_HOSTS'] = 'true'
    resetConfigCache()
  }

  const loaded = await loadCollectionForAttach(opts.slug)
  if (loaded === null) {
    process.stdout.write(`\n  '${opts.slug}' 이라는 표가 없습니다.\n\n`)
    process.exit(2)
  }

  // ── 붙여넣은 값 → 경로 (보장선 B1) ─────────────────────────────────
  const resolved: Record<string, string> = {}
  const pasteNotes: string[] = []
  for (const { key, value } of opts.paste) {
    const r = await resolveByPastedValue({
      url: opts.url,
      key,
      value,
      skipBrowser: opts.skipBrowser,
      skipDom: opts.skipDom,
    })
    if (r.ok) {
      resolved[key] = r.path
      pasteNotes.push(`  ✓ ${key} — "${clip(r.found, 40)}" 를 찾았습니다 (다른 항목 ${pct(r.coverage)} 에도 있음)`)
    } else {
      pasteNotes.push(`  ✗ ${key} — ${r.message}`)
    }
  }

  const result = await attachSourceToCollection({
    collection_id: loaded.collection.id,
    schema: loaded.schema,
    existingSample: loaded.sample,
    url: opts.url,
    resolved,
    skipBrowser: opts.skipBrowser,
    skipDom: opts.skipDom,
    ...(opts.minConfidence !== undefined ? { minConfidence: opts.minConfidence } : {}),
  })

  if (opts.asJson) {
    process.stdout.write(`${JSON.stringify(result, replacer, 2)}\n`)
    process.exit(result.ok ? 0 : 2)
  }

  process.stdout.write(render(result, loaded.collection.name, pasteNotes))
  process.exit(result.ok ? 0 : 2)
}

// ── 사람이 읽는 출력 ───────────────────────────────────────────────────

function render(r: AttachSourceOutcome, collectionName: string, pasteNotes: readonly string[]): string {
  const out: string[] = []
  const line = '─'.repeat(72)

  out.push('')
  out.push(line)
  out.push(`  ${collectionName} ← ${r.url}`)
  out.push(line)

  if (pasteNotes.length > 0) {
    out.push('  붙여넣은 값')
    out.push(...pasteNotes)
    out.push('')
  }

  if (!r.ok) {
    out.push('  결과      못 붙임')
    out.push(`  안내 문구  ${r.message}`)
    if (r.missing.length > 0) {
      out.push('')
      out.push(`  물어볼 칸 ${r.missing.length}개`)
      for (const m of r.missing) out.push(`    ${m.label}  (--paste "${m.key}=값")`)
    }
    if (r.errors.length > 0) {
      out.push('')
      out.push('  개발자용 상세')
      for (const e of r.errors.slice(0, 5)) out.push(`    · ${e}`)
    }
    out.push('')
    out.push(line)
    out.push('')
    return out.join('\n')
  }

  // ── G2 판정문: 사용자가 손으로 채워야 하는 칸이 몇 개인가 ───────────
  out.push(
    r.missing.length === 0
      ? '  결과      전부 찾았다 — 사용자가 할 일 0개'
      : `  결과      ${r.attached.length}개 찾음 · **${r.missing.length}개는 물어봐야 한다**`,
  )
  out.push(`  항목      ${r.items.length}개 · ${(r.duration_ms / 1000).toFixed(1)}초`)
  out.push('')

  out.push('  붙은 칸')
  for (const f of r.attached) {
    const mark = f.origin === 'pasted' ? '✎' : '●'
    out.push(`    ${mark} ${f.label.padEnd(12, ' ')} ${pct(f.confidence).padStart(4)}  ${f.path}`)
    if (f.samples.length > 0) out.push(`        ${f.samples.slice(0, 2).join('  ·  ')}`)
    if (f.origin === 'matched' && f.why !== null) out.push(`        ${f.why}`)
  }
  out.push('')

  if (r.missing.length > 0) {
    out.push('  물어볼 칸 — 화면은 이 칸만 사용자에게 묻는다 (보장선 B1)')
    for (const m of r.missing) {
      out.push(`    ? ${m.label.padEnd(12, ' ')} "이 사이트에서 '${m.label}' 에 해당하는 값을 붙여넣어 주세요"`)
      out.push(`        다시 해보기: --paste "${m.key}=값"`)
    }
    out.push('')
  }

  if (r.warnings.length > 0) {
    out.push('  참고')
    for (const w of r.warnings.slice(0, 5)) out.push(`    ${w}`)
    out.push('')
  }

  out.push('  ※ 아직 저장하지 않았습니다.')
  out.push(line)
  out.push('')
  return out.join('\n')
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length <= max ? t : `${t.slice(0, max)}…`
}

function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

function replacer(key: string, value: unknown): unknown {
  if (key === 'items' && Array.isArray(value)) return value.slice(0, 3)
  return value
}

void main()
