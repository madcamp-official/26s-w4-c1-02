// 컬렉션 생성 CLI — `pnpm --filter @endpointer/worker create-collection <url>`
//
// ── 이게 G1→G2 판정 도구다 ──────────────────────────────────────────────
// `probe` CLI 가 "목록을 찾았나" 까지 본다면, 이건 그 다음을 본다:
//   · 표가 만들어지나 (어떤 칸이 생겼나)
//   · 그 방법으로 실제로 항목이 뽑히나
//   · 날짜와 금액이 정규화된 값으로 나오나        ← G1(A) 판정 조건
//
// 기본은 **저장하지 않는다.** 표를 눈으로 보고 판단하는 게 먼저다 (기획서 14장
// "사람이 판단할 것: 후보 목록이 맞는가 / 정규화가 맞는가"). `--save` 를 줘야 DB 에 앉는다.
//
// 저장하지 않으면 DB 도 Redis 도 필요 없다 — Gemini 키만 있으면 돈다.
// 그래서 `./db` 를 정적으로 import 하지 않는다 (import 하는 순간 DATABASE_URL 을 요구한다).

import { geminiStatus } from '../compile'
import {
  collectionNameFrom,
  createCollectionFromUrl,
  normalizeUrl,
  slugFrom,
  type CreateCollectionOutcome,
} from '../pipeline'
import { PROBE_PATH_LABELS } from '../probe'

const USAGE = `사용법: pnpm --filter @endpointer/worker create-collection <url> [옵션]

옵션
  --save            결과를 DB 에 저장한다 (기본은 보여주기만 한다)
  --owner=<id>      저장할 때의 소유자. 기본은 시드가 만든 데모 사용자
  --name=<이름>     컬렉션 이름. 기본은 페이지 제목에서 짓는다
  --slug=<슬러그>   API 경로에 쓸 이름. 기본은 주소에서 짓는다
  --pages=N         받아볼 페이지 수 (기본 1, 최대 3)
  --no-browser      브라우저를 쓰는 단계를 건너뛴다 (G1 강등 규칙 1)
  --no-dom          DOM 반복 구조 탐지를 건너뛴다 (G1 강등 규칙 2)
  --allow-private   사설망 주소를 허용한다 (로컬 픽스처 테스트용)
  --json            사람용 출력 대신 결과 JSON 을 찍는다
`

/** 시드가 만드는 데모 사용자. `pnpm db:seed` 를 돌렸다면 존재한다 */
const DEMO_USER_EMAIL = 'demo@endpointer.local'

interface CliOptions {
  url: string
  save: boolean
  owner: string | undefined
  name: string | undefined
  slug: string | undefined
  pages: number | undefined
  skipBrowser: boolean
  skipDom: boolean
  allowPrivate: boolean
  asJson: boolean
}

function parseArgs(argv: readonly string[]): CliOptions | null {
  let url: string | null = null
  let save = false
  let owner: string | undefined
  let name: string | undefined
  let slug: string | undefined
  let pages: number | undefined
  let skipBrowser = false
  let skipDom = false
  let allowPrivate = false
  let asJson = false

  for (const arg of argv) {
    if (arg === '--save') save = true
    else if (arg === '--no-browser') skipBrowser = true
    else if (arg === '--no-dom') skipDom = true
    else if (arg === '--allow-private') allowPrivate = true
    else if (arg === '--json') asJson = true
    else if (arg.startsWith('--owner=')) owner = arg.slice('--owner='.length)
    else if (arg.startsWith('--name=')) name = arg.slice('--name='.length)
    else if (arg.startsWith('--slug=')) slug = arg.slice('--slug='.length)
    else if (arg.startsWith('--pages=')) {
      const n = Number.parseInt(arg.slice('--pages='.length), 10)
      if (Number.isFinite(n)) pages = n
    } else if (arg.startsWith('-')) return null
    else if (url === null) url = arg
  }

  if (url === null) return null
  return { url, save, owner, name, slug, pages, skipBrowser, skipDom, allowPrivate, asJson }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))
  if (opts === null) {
    process.stdout.write(USAGE)
    process.exit(1)
  }

  // 주소부터 본다. 키 얘기를 먼저 하면 주소를 잘못 넣은 사람이 엉뚱한 곳을 고치게 된다.
  if (normalizeUrl(opts.url) === null) {
    process.stdout.write(`\n  주소처럼 보이지 않습니다: ${opts.url}\n\n`)
    process.exit(2)
  }

  // 키가 없으면 표를 만들 수 없다. 스택 트레이스 대신 한 줄로 안내한다.
  const gemini = geminiStatus()
  if (!gemini.ready) {
    process.stdout.write(`\n  ${gemini.message}\n\n`)
    process.exit(1)
  }

  const result = await createCollectionFromUrl({
    url: opts.url,
    skipBrowser: opts.skipBrowser,
    skipDom: opts.skipDom,
    allowPrivateHosts: opts.allowPrivate,
    ...(opts.pages !== undefined ? { maxPages: opts.pages } : {}),
  })

  if (opts.asJson) {
    process.stdout.write(`${JSON.stringify(result, replacer, 2)}\n`)
    process.exit(result.ok ? 0 : 2)
  }

  process.stdout.write(render(result))

  if (!result.ok) process.exit(2)
  if (!opts.save) {
    process.stdout.write('  저장하지 않았습니다. DB 에 앉히려면 --save 를 붙이세요.\n\n')
    process.exit(0)
  }

  // ── 저장 ──────────────────────────────────────────────────────────────
  // 여기서 처음으로 DB 를 만진다. 늦게 import 하는 이유는 파일 머리말에 있다.
  const { persistNewCollection } = await import('../pipeline/persist')
  const { db } = await import('../db')

  let ownerId = opts.owner
  if (ownerId === undefined) {
    const demo = await db.query.users.findFirst({
      where: (u, { eq }) => eq(u.email, DEMO_USER_EMAIL),
      columns: { id: true },
    })
    if (demo === undefined) {
      process.stdout.write(
        `  저장할 소유자를 찾지 못했습니다. \`pnpm db:seed\` 를 돌리거나 --owner=<id> 를 주세요.\n\n`,
      )
      process.exit(3)
    }
    ownerId = demo.id
  }

  const saved = await persistNewCollection({
    owner_id: ownerId,
    name: opts.name ?? collectionNameFrom(result.page_title, result.host),
    slug: opts.slug ?? slugFrom(result.host, result.page_title),
    schema: result.schema,
    host: result.host,
    entry_url: result.final_url,
    fetch_mode: result.spec.fetch.mode,
    spec: result.spec,
    items: result.items,
    report: result.report,
  })

  process.stdout.write(
    [
      '  저장했습니다',
      `    컬렉션   ${saved.collection.name}  (/${saved.collection.slug})`,
      `    항목     ${saved.items_inserted}개`,
      `    API      GET /api/v1/${saved.collection.slug}`,
      '',
      '',
    ].join('\n'),
  )
  process.exit(0)
}

// ── 사람이 읽는 출력 ───────────────────────────────────────────────────

function render(r: CreateCollectionOutcome): string {
  const out: string[] = []
  const line = '─'.repeat(72)

  out.push('')
  out.push(line)
  out.push(`  ${r.url}`)
  out.push(line)

  if (!r.ok) {
    const STAGE_LABEL: Record<typeof r.stage, string> = {
      url: '주소 확인',
      probe: '목록 찾기',
      compile: '표 만들기',
      execute: '항목 뽑기',
    }
    out.push(`  결과      실패 — ${STAGE_LABEL[r.stage]} 단계`)
    out.push(`  안내 문구  ${r.message}`)
    if (r.trace.probe_path != null) {
      out.push(`  뚫린 경로  ${PROBE_PATH_LABELS[r.trace.probe_path]}`)
    }
    if (r.errors.length > 0) {
      out.push('')
      out.push('  개발자용 상세')
      for (const e of r.errors.slice(0, 8)) out.push(`    · ${e}`)
    }
    out.push('')
    out.push(line)
    out.push('')
    return out.join('\n')
  }

  // ① 어디로 뚫렸나 (G1 판정 조건)
  const path = r.trace.probe_path
  out.push(`  결과      표를 만들었다`)
  out.push(`  뚫린 경로  ${path === null ? '?' : `${PROBE_PATH_LABELS[path]} (${path})`}`)
  out.push(`  수집 방식  ${r.trace.fetch_mode} · 겹침 ${pct(r.trace.overlap)}`)
  out.push(`  LLM 호출   ${r.trace.compile_attempts}회 · 걸린 시간 ${(r.trace.duration_ms / 1000).toFixed(1)}초`)
  out.push('')

  // ② 만들어진 표의 칸 — 사용자가 첫 화면에서 보는 것 (보장선 B3)
  out.push(`  표 구성 ${r.schema.length}칸`)
  for (const f of r.schema) {
    const req = f.required ? ' *' : '  '
    const spec = r.spec.fields[f.key]
    const ops = spec?.transform?.map((t) => t.op).join(' → ') ?? ''
    out.push(`    ${req} ${f.label.padEnd(12, ' ')} ${f.type.padEnd(6, ' ')} ${spec?.path ?? '?'}`)
    if (ops !== '') out.push(`         ${' '.repeat(12)} ${' '.repeat(6)} ${ops}`)
  }
  out.push('')

  // ③ 뽑힌 항목 — 정규화가 맞는지 눈으로 본다 (G1 "날짜와 금액이 정규화된 값으로")
  out.push(`  항목 ${r.items.length}개 · 아래 3개`)
  for (const item of r.items.slice(0, 3)) {
    out.push(`    ─ ${item.external_key}`)
    for (const f of r.schema) {
      const value = item.data[f.key]
      out.push(`        ${f.label.padEnd(12, ' ')} ${format(value)}`)
    }
  }
  out.push('')

  // ④ 필드별 빈 값 비율 — 드리프트 기준선의 첫 값이자 "이 표가 쓸 만한가" 의 답
  const weak = Object.entries(r.report.fields).filter(([, s]) => s.null_ratio > 0.3)
  if (weak.length > 0) {
    out.push('  값이 자주 비는 칸')
    for (const [key, stat] of weak) {
      const label = r.schema.find((f) => f.key === key)?.label ?? key
      out.push(`    ${label.padEnd(12, ' ')} 빈 값 ${pct(stat.null_ratio)} · 형식 실패 ${pct(stat.type_fail_ratio)}`)
    }
    out.push('')
  }

  if (r.warnings.length > 0) {
    out.push('  참고')
    for (const w of r.warnings.slice(0, 5)) out.push(`    ${w}`)
    out.push('')
  }

  out.push(line)
  out.push('')
  return out.join('\n')
}

function format(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'object') return clip(JSON.stringify(value), 80)
  return clip(String(value).replace(/\s+/g, ' ').trim(), 80)
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

/** `--json` 일 때 원본 조각까지 쏟아내면 터미널이 넘친다 */
function replacer(key: string, value: unknown): unknown {
  if (key === 'raw' && typeof value === 'object') return '…'
  if (key === 'text' && typeof value === 'string') return clip(value, 300)
  return value
}

void main()
