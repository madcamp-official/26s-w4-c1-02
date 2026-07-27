// 응답 바이트를 글자로 되돌린다
//
// `res.text()` 는 **응답 헤더의 charset 만** 본다. 헤더에 없으면 UTF-8 로 읽는다.
// 그런데 한국 사이트에는 헤더에 charset 을 안 적고 `<meta charset="euc-kr">` 로만
// 적어 둔 곳이 아직 있다 (대한상공회의소 korcham.net 이 그렇다).
//
// ── 이 실패가 위험한 이유 ───────────────────────────────────────────────
// 목록은 **멀쩡히 뚫린다.** 반복 구조도 찾고, 항목 수도 맞고, 날짜·번호처럼
// ASCII 로 된 필드는 정상이다. 겹침률조차 100% 로 나온다 — 화면 텍스트도 같이
// 깨져서 둘이 똑같기 때문이다. 우리가 가진 어떤 품질 신호에도 안 걸리고,
// 사람이 글자를 눈으로 보기 전까지 아무도 모른다.
//
// 그래서 브라우저와 같은 순서로 정한다: BOM → 헤더 → `<meta>` → UTF-8.
//
// 브라우저(Playwright) 경로는 이 파일을 안 탄다. 크롬이 이미 제대로 디코딩해서
// `page.content()` 가 문자열로 준다.

export interface DecodedBody {
  text: string
  /** 실제로 무엇으로 읽었는지. 로그와 probe 출력에 쓴다 — 안 보이면 고쳤는지도 모른다 */
  charset: string
}

/** `<meta charset>` 을 몇 바이트까지 뒤질지. HTML 명세는 1024지만 주석이 길게 붙은 곳이 있다 */
const SNIFF_BYTES = 4096

/**
 * WHATWG 인코딩 표준에 없는 이름들. 한국 사이트가 실제로 적는 것만 넣는다.
 * (`cp949` 는 표준 라벨이 아니라서 `TextDecoder` 가 거부한다 — 뜻은 euc-kr 과 같다)
 */
const ALIASES: Record<string, string> = {
  cp949: 'euc-kr',
  ms949: 'euc-kr',
  'x-windows-949': 'euc-kr',
  'ks-c-5601-1987': 'euc-kr',
  utf8: 'utf-8',
}

/** 응답 본문을 알맞은 인코딩으로 읽는다 */
export function decodeBody(bytes: Uint8Array, contentType: string): DecodedBody {
  // BOM 이 가장 세다. 헤더가 뭐라고 하든 바이트가 스스로 밝힌 것이다.
  const bom = fromBom(bytes)
  if (bom !== null) return decodeWith(bytes, bom)

  const declared = charsetOf(contentType)
  if (declared !== null) return decodeWith(bytes, declared)

  // JSON 은 명세가 UTF-8 로 못 박았다. 본문에 `<meta charset=` 처럼 보이는
  // 글자가 들어 있어도 그건 데이터이지 선언이 아니다.
  if (!looksJson(contentType)) {
    const sniffed = sniffMeta(bytes)
    if (sniffed !== null) return decodeWith(bytes, sniffed)
  }

  return decodeWith(bytes, 'utf-8')
}

/** `text/html; charset=euc-kr` → `euc-kr`. 없거나 모르는 이름이면 null */
export function charsetOf(contentType: string): string | null {
  const m = /charset\s*=\s*"?([^";,\s]+)"?/i.exec(contentType)
  return normalize(m?.[1])
}

function fromBom(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8'
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le'
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be'
  return null
}

function sniffMeta(bytes: Uint8Array): string | null {
  // 앞부분만 latin1 으로 편다. 바이트 하나가 글자 하나로 그대로 남아서,
  // 인코딩을 모르는 상태에서도 ASCII 로 적힌 태그를 안전하게 읽을 수 있다.
  const head = new TextDecoder('iso-8859-1').decode(bytes.subarray(0, SNIFF_BYTES))

  // `<meta charset="euc-kr">` 과 `<meta http-equiv=... content="text/html; charset=euc-kr">` 둘 다
  const meta = /<meta[^>]+charset\s*=\s*["']?\s*([a-z0-9_:.-]+)/i.exec(head)
  const found = normalize(meta?.[1])
  if (found !== null) return found

  // `<?xml version="1.0" encoding="euc-kr"?>` — RSS·XML 목록에서 나온다
  const xml = /<\?xml[^>]+encoding\s*=\s*["']([a-z0-9_:.-]+)["']/i.exec(head)
  return normalize(xml?.[1])
}

/**
 * 이름을 다듬고 **쓸 수 있는지까지 확인한다.**
 * 아는 인코딩 목록을 따로 들고 있으면 `TextDecoder` 가 아는 것과 반드시 어긋난다.
 * 그래서 판정을 `TextDecoder` 에게 맡긴다.
 */
function normalize(raw: string | undefined): string | null {
  if (raw === undefined) return null
  const label = raw.trim().toLowerCase().replace(/^["']|["']$/g, '')
  if (label === '') return null
  const mapped = ALIASES[label] ?? label
  try {
    new TextDecoder(mapped)
    return mapped
  } catch {
    return null
  }
}

function decodeWith(bytes: Uint8Array, charset: string): DecodedBody {
  try {
    // `fatal: false` (기본값) — 깨진 바이트가 하나 있다고 본문 전체를 잃으면 안 된다 (원칙 ④)
    return { text: new TextDecoder(charset).decode(bytes), charset }
  } catch {
    // normalize 를 통과했으면 여기 올 일이 없다. 그래도 본문을 통째로 버리진 않는다.
    return { text: new TextDecoder('utf-8').decode(bytes), charset: 'utf-8' }
  }
}

/**
 * http.ts 의 `isJsonContentType` 과 같은 판정이다. 불러 쓰면 두 파일이 서로를 import 하게 된다.
 * 여기서 쓰는 곳은 "`<meta>` 를 뒤질까" 한 군데뿐이라 그냥 둔다.
 */
function looksJson(contentType: string): boolean {
  const t = contentType.toLowerCase()
  return t.includes('application/json') || t.includes('+json') || t.includes('text/json')
}
