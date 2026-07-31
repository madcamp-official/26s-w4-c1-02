// CSS 선택자에 클래스 이름을 안전하게 넣기.
//
// Tailwind 를 쓰는 사이트의 클래스에는 `sm:w-auto` 처럼 **콜론**이 들어간다. 이걸 그대로
// `span.sm:w-auto` 로 이어 붙이면 CSS 파서가 `:w-auto` 를 가상클래스로 읽고 던진다
// (`Unknown pseudo-class :w-auto` — cse.snu.ac.kr 등록일 수리에서 실측).
//
// 던지는 자리가 하필 **값 역추적**(보장선 B1 의 뼈대)이라, 이 한 줄이 없으면 Tailwind 사이트에서는
// "값을 붙여넣어 고치기" 와 "못 찾은 칸 물어보기" 가 통째로 죽는다.
//
// 규칙은 CSS 식별자 이스케이프 그대로다: 영숫자·`_`·`-`·비ASCII 를 뺀 나머지 앞에 `\` 를 붙인다.

/** 이스케이프 없이 그대로 둬도 되는 글자 */
const SAFE = /[a-zA-Z0-9_-]/

/** 클래스 이름 하나를 선택자에 넣을 수 있는 형태로 (`sm:w-auto` → `sm\:w-auto`) */
export function escapeCssClass(name: string): string {
  let out = ''
  for (const ch of name) {
    // 비ASCII(한글 클래스 등)는 CSS 식별자로 그대로 쓸 수 있다
    const code = ch.codePointAt(0) ?? 0
    out += SAFE.test(ch) || code > 0x7f ? ch : `\\${ch}`
  }
  return out
}

/** `tag.a.b` 를 만든다 — 클래스가 없으면 태그만 */
export function tagWithClasses(tag: string, classes: readonly string[]): string {
  if (classes.length === 0) return tag
  return `${tag}.${classes.map(escapeCssClass).join('.')}`
}
