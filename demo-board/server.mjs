// 몰입캠프 분반 공지 게시판 — 알림·자가치유 데모용 사이트 (의존성 0, 단일 파일)
//
// 용도 (docs/demo-scenarios.md ④):
//   · 알림 데모  — /write 에서 글을 쓰면(자연스러운 행위) 다음 수집 때 새 항목 → 알림
//   · 치유 데모  — /admin 의 [개편] 버튼이 같은 데이터를 전혀 다른 마크업(v2)으로 렌더
//                  → 수집이 깨짐을 감지 → 재컴파일 → 복구. 토글이라 리허설 무한 반복
//
// 실행:  node server.mjs            (기본 포트 4400)
//        PORT=8081 DEMO_PW=비밀번호 node server.mjs
// 저장:  ./board-data.json (글 + 레이아웃 상태 — 재시작해도 유지)
//
// v1 ↔ v2 의 규칙: **데이터는 동일, 표현만 전면 교체.**
// 클래스명·태그 구조·날짜 표기(2026-08-15 ↔ 26.08.15(금))가 다 바뀌지만 글 목록은 같다 —
// 자가치유의 승격 관문(직전 성공 목록과의 겹침률)을 통과하려면 이 동일성이 필수다.

import { createServer } from 'node:http'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const PORT = Number(process.env.PORT ?? 4400)
const DEMO_PW = process.env.DEMO_PW ?? 'madcamp'
const DATA_FILE = join(dirname(fileURLToPath(import.meta.url)), 'board-data.json')

const CATEGORIES = ['공지', '행사', '먹거리', '스터디']

// ── 데이터 ──────────────────────────────────────────────────────────────

/** 시드 — 행사일은 "오늘 기준 상대"로 찍는다. 언제 초기화해도 '행사일 7일 이내' 뷰에 걸릴 글이 있게 */
function seedPosts() {
  const titles = [
    ['분반 회식 장소 투표', '먹거리', 2],
    ['체육대회 조 편성 안내', '행사', 4],
    ['금요일 발표 리허설 시간표', '공지', 5],
    ['야식 수요조사 (마라탕 vs 치킨)', '먹거리', 1],
    ['주말 등산 모임 모집', '행사', 9],
    ['코드리뷰 스터디 2기 모집', '스터디', 12],
    ['분반 대항 게임대회 규칙', '행사', 7],
    ['카레의 날 운영 안내', '먹거리', 3],
    ['노트북 거치대 공동구매', '공지', 14],
    ['종강 파티 장소 후보 공유', '행사', 17],
  ]
  const now = Date.now()
  return titles.map(([title, category, dPlus], i) => ({
    id: i + 1,
    title,
    category,
    event_date: isoDate(new Date(now + dPlus * 86400_000)),
    body: `${title}\n\n자세한 내용은 분반 채널을 확인해 주세요. 문의는 운영진에게 부탁드립니다.`,
    created_at: new Date(now - (titles.length - i) * 3600_000).toISOString(),
  }))
}

function load() {
  // BOM 제거 — 윈도우 편집기/PowerShell 이 붙인 BOM 에 JSON.parse 가 죽지 않게
  if (existsSync(DATA_FILE)) return JSON.parse(readFileSync(DATA_FILE, 'utf8').replace(/^﻿/, ''))
  const fresh = { layout: 'v1', posts: seedPosts() }
  save(fresh)
  return fresh
}
function save(data) {
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

let db = load()

// ── 렌더 도우미 ─────────────────────────────────────────────────────────

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

function isoDate(d) {
  const kst = new Date(d.getTime() + 9 * 3600_000)
  return kst.toISOString().slice(0, 10)
}
/** v2 의 날짜 표기 — 26.08.15(금). 정규화가 재적응해야 하는 지점 */
function shortDate(iso) {
  const [y, m, d] = iso.split('-')
  const day = ['일', '월', '화', '수', '목', '금', '토'][new Date(`${iso}T00:00:00+09:00`).getDay()]
  return `${y.slice(2)}.${m}.${d}(${day})`
}

function page(title, body, style) {
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
body{font-family:system-ui,'Apple SD Gothic Neo',sans-serif;margin:0;background:#f6f7f9;color:#1c2430}
main{max-width:760px;margin:0 auto;padding:24px 16px}
a{color:#274bd6;text-decoration:none} a:hover{text-decoration:underline}
.top{display:flex;align-items:baseline;gap:12px;margin-bottom:18px}
.top h1{font-size:22px;margin:0} .top .links{margin-left:auto;font-size:13px;display:flex;gap:10px}
${style}
</style></head><body><main>
<div class="top"><h1>몰입캠프 1분반 공지</h1><span class="links"><a href="/">목록</a><a href="/write">글쓰기</a></span></div>
${body}
</main></body></html>`
}

// ── v1: 클래식 게시판 테이블 ────────────────────────────────────────────

const V1_STYLE = `
table.notice-table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dde1e7}
.notice-table th{background:#eef1f5;border-bottom:1px solid #dde1e7;padding:9px 10px;font-size:13px;text-align:left}
.notice-table td{border-bottom:1px solid #eceff3;padding:10px;font-size:14px}
.notice-table td.cat{color:#5b6675;width:70px} .notice-table td.date{width:110px;color:#5b6675;font-variant-numeric:tabular-nums}
`
function renderListV1() {
  const rows = db.posts
    .map(
      (p) => `<tr>
  <td class="cat">${esc(p.category)}</td>
  <td class="title"><a href="/notice/${p.id}">${esc(p.title)}</a></td>
  <td class="date">${p.event_date}</td>
</tr>`,
    )
    .join('\n')
  return page(
    '몰입캠프 1분반 공지',
    `<table class="notice-table"><thead><tr><th>분류</th><th>제목</th><th>행사일</th></tr></thead><tbody>${rows}</tbody></table>`,
    V1_STYLE,
  )
}

// ── v2: "개편된" 카드 레이아웃 — 클래스·구조·날짜 표기 전면 교체 ─────────

const V2_STYLE = `
.board-wrap{display:flex;flex-direction:column;gap:10px}
.post-card{background:#fff;border:1px solid #e2e6ec;border-radius:12px;padding:14px 16px;display:flex;gap:12px;align-items:center}
.post-card .badge{font-size:12px;background:#eef2ff;color:#3450c8;border-radius:999px;padding:3px 10px;white-space:nowrap}
.post-card .subject{flex:1;font-size:15px;font-weight:600}
.post-card .when{font-size:12.5px;color:#8b93a1;white-space:nowrap}
`
function renderListV2() {
  const cards = db.posts
    .map(
      (p) => `<article class="post-card">
  <span class="badge">${esc(p.category)}</span>
  <span class="subject"><a href="/notice/${p.id}">${esc(p.title)}</a></span>
  <span class="when">행사일 ${shortDate(p.event_date)}</span>
</article>`,
    )
    .join('\n')
  return page('몰입캠프 1분반 공지', `<div class="board-wrap">${cards}</div>`, V2_STYLE)
}

// ── 상세 · 글쓰기 · 관리 ────────────────────────────────────────────────

function renderDetail(p) {
  return page(
    p.title,
    `<article style="background:#fff;border:1px solid #e2e6ec;border-radius:10px;padding:20px">
  <h2 style="margin:0 0 6px;font-size:19px">${esc(p.title)}</h2>
  <p style="margin:0 0 14px;color:#5b6675;font-size:13px">${esc(p.category)} · 행사일 ${p.event_date} · 작성 ${p.created_at.slice(0, 10)}</p>
  <p style="white-space:pre-wrap;font-size:14.5px;line-height:1.7">${esc(p.body)}</p>
</article>`,
    '',
  )
}

const FIELD = 'display:block;width:100%;box-sizing:border-box;margin:4px 0 14px;padding:9px 10px;border:1px solid #ccd2db;border-radius:8px;font-size:14px'
function renderWrite(msg = '') {
  return page(
    '글쓰기',
    `${msg ? `<p style="color:#c04545;font-size:13.5px">${esc(msg)}</p>` : ''}
<form method="post" action="/write" style="background:#fff;border:1px solid #e2e6ec;border-radius:10px;padding:20px;font-size:13.5px">
  <label>제목<input name="title" required maxlength="80" style="${FIELD}"></label>
  <label>분류<select name="category" style="${FIELD}">${CATEGORIES.map((c) => `<option>${c}</option>`).join('')}</select></label>
  <label>행사일<input name="event_date" type="date" required style="${FIELD}"></label>
  <label>내용<textarea name="body" rows="5" maxlength="2000" style="${FIELD}"></textarea></label>
  <label>비밀번호<input name="pw" type="password" required style="${FIELD}"></label>
  <button style="background:#274bd6;color:#fff;border:0;border-radius:8px;padding:10px 18px;font-size:14px;font-weight:700">올리기</button>
</form>`,
    '',
  )
}

function renderAdmin(msg = '') {
  return page(
    '관리',
    `${msg ? `<p style="color:#2c7a3f;font-size:13.5px">${esc(msg)}</p>` : ''}
<div style="background:#fff;border:1px solid #e2e6ec;border-radius:10px;padding:20px;font-size:14px">
  <p>현재 레이아웃: <b>${db.layout}</b> ${db.layout === 'v1' ? '(클래식 테이블)' : '(개편된 카드)'}</p>
  <form method="post" action="/admin" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
    <input name="pw" type="password" placeholder="비밀번호" required style="padding:8px 10px;border:1px solid #ccd2db;border-radius:8px">
    <button name="op" value="toggle" style="background:#274bd6;color:#fff;border:0;border-radius:8px;padding:9px 16px;font-weight:700">사이트 개편 (v1↔v2)</button>
    <button name="op" value="reset" style="background:#7b8494;color:#fff;border:0;border-radius:8px;padding:9px 16px;font-weight:700">글 초기화 (시드·오늘 기준 날짜)</button>
  </form>
</div>`,
    '',
  )
}

// ── 서버 ───────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve) => {
    let buf = ''
    req.on('data', (c) => {
      buf += c
      if (buf.length > 64 * 1024) req.destroy()
    })
    req.on('end', () => resolve(new URLSearchParams(buf)))
  })
}

const send = (res, code, html) => {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8' })
  res.end(html)
}
const redirect = (res, to) => {
  res.writeHead(303, { location: to })
  res.end()
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  const path = url.pathname

  if (req.method === 'GET' && path === '/') {
    return send(res, 200, db.layout === 'v1' ? renderListV1() : renderListV2())
  }

  const m = path.match(/^\/notice\/(\d+)$/)
  if (req.method === 'GET' && m) {
    const post = db.posts.find((p) => p.id === Number(m[1]))
    return post ? send(res, 200, renderDetail(post)) : send(res, 404, page('없음', '<p>그런 글이 없어요.</p>', ''))
  }

  if (path === '/write') {
    if (req.method === 'GET') return send(res, 200, renderWrite())
    const form = await readBody(req)
    if (form.get('pw') !== DEMO_PW) return send(res, 200, renderWrite('비밀번호가 달라요.'))
    const title = (form.get('title') ?? '').trim().slice(0, 80)
    const eventDate = form.get('event_date') ?? ''
    if (title === '' || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return send(res, 200, renderWrite('제목과 행사일을 확인해 주세요.'))
    const category = CATEGORIES.includes(form.get('category')) ? form.get('category') : '공지'
    db.posts.unshift({
      id: Math.max(0, ...db.posts.map((p) => p.id)) + 1,
      title,
      category,
      event_date: eventDate,
      body: (form.get('body') ?? '').trim().slice(0, 2000),
      created_at: new Date().toISOString(),
    })
    save(db)
    return redirect(res, '/')
  }

  if (path === '/admin') {
    if (req.method === 'GET') return send(res, 200, renderAdmin())
    const form = await readBody(req)
    if (form.get('pw') !== DEMO_PW) return send(res, 200, renderAdmin('비밀번호가 달라요.'))
    if (form.get('op') === 'reset') {
      db = { layout: db.layout, posts: seedPosts() }
      save(db)
      return send(res, 200, renderAdmin('글을 오늘 기준 시드로 초기화했어요.'))
    }
    db.layout = db.layout === 'v1' ? 'v2' : 'v1'
    save(db)
    return send(res, 200, renderAdmin(`레이아웃을 ${db.layout} 로 바꿨어요. 목록에서 확인해 보세요.`))
  }

  send(res, 404, page('없음', '<p>그런 페이지가 없어요.</p>', ''))
}).listen(PORT, () => {
  console.log(`분반 공지 게시판: http://localhost:${PORT}  (글쓰기/관리 비밀번호: ${DEMO_PW === 'madcamp' ? '기본값 madcamp' : '설정됨'})`)
})
