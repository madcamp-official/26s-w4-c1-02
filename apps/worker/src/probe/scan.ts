// JSON 트리에서 "목록으로 보이는 배열" 을 찾는다.
//
// 인라인 JSON(9-1①-2) 과 네트워크 관찰(9-1①-3) 이 같은 판정을 쓴다. 기획서의 조건은 이것이다:
//   · 배열 길이 ≥ 3
//   · 원소 키가 반복됨
// "키가 반복됨" 을 이렇게 읽는다 — 원소 대부분이 객체이고, 그 객체들이 공통 키를 여러 개 공유한다.
// 이 조건 하나가 설정 객체·추적 배열·문자열 배열을 대부분 걸러낸다.

/** 트리 순회 상한 — 거대한 __NEXT_DATA__ 에서 폭주하지 않게 */
const MAX_DEPTH = 8
const MAX_NODES = 20_000

export interface ArrayCandidate {
  /** 배열 자체의 경로. 예: `$.data.items` */
  path: string
  /** 어댑터 스펙의 `list` 로 쓸 경로. 예: `$.data.items[*]` */
  list_path: string
  rows: Record<string, unknown>[]
  /** 원소의 60% 이상에 나타나는 키 */
  keys: string[]
  /** 원소 수 */
  size: number
}

export interface ScanOptions {
  minRows?: number
  /** 후보 하나가 들고 갈 원소 수 상한. 프롬프트·로그가 비대해지는 걸 막는다 */
  maxRows?: number
  /** 결과 개수 상한 */
  maxCandidates?: number
}

const BARE_KEY = /^[\p{L}\p{N}_$][\p{L}\p{N}_$-]*$/u

/** JSONPath 한 단계를 이어붙인다. core 의 parseJsonPath 가 읽을 수 있는 문법만 쓴다 */
export function joinJsonPath(base: string, key: string | number): string {
  if (typeof key === 'number') return `${base}[${key}]`
  if (BARE_KEY.test(key)) return `${base}.${key}`
  return `${base}[${JSON.stringify(key)}]`
}

/**
 * 트리를 훑어 목록 후보를 모은다. 깊은 것보다 얕은 것이 먼저 나온다(BFS 가 아니라 DFS 지만
 * 정렬로 맞춘다) — 얕은 배열이 대체로 "그 목록"이다.
 */
export function findRecordArrays(root: unknown, opts: ScanOptions = {}): ArrayCandidate[] {
  const minRows = opts.minRows ?? 3
  const maxRows = opts.maxRows ?? 60
  const maxCandidates = opts.maxCandidates ?? 12

  const found: (ArrayCandidate & { depth: number })[] = []
  let nodes = 0

  const walk = (node: unknown, path: string, depth: number): void => {
    if (depth > MAX_DEPTH || nodes > MAX_NODES) return
    nodes += 1

    if (Array.isArray(node)) {
      const shaped = shapeOf(node, minRows)
      if (shaped !== null) {
        found.push({
          path,
          list_path: `${path}[*]`,
          rows: shaped.rows.slice(0, maxRows),
          keys: shaped.keys,
          size: node.length,
          depth,
        })
        // 배열을 후보로 잡았어도 원소 안에 더 좋은 중첩 목록이 있을 수 있다.
        // 앞쪽 몇 개만 더 들어간다 (전부 들어가면 O(n²) 이 된다).
        for (let i = 0; i < Math.min(node.length, 3); i += 1) {
          walk(node[i], joinJsonPath(path, i), depth + 1)
        }
        return
      }
      for (let i = 0; i < Math.min(node.length, 20); i += 1) {
        walk(node[i], joinJsonPath(path, i), depth + 1)
      }
      return
    }

    if (node !== null && typeof node === 'object') {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        walk(value, joinJsonPath(path, key), depth + 1)
      }
    }
  }

  walk(root, '$', 0)

  // 얕고 큰 것부터. 같은 깊이면 원소가 많은 쪽.
  found.sort((a, b) => a.depth - b.depth || b.size - a.size)
  return found.slice(0, maxCandidates).map(({ depth: _depth, ...rest }) => rest)
}

interface Shape {
  rows: Record<string, unknown>[]
  keys: string[]
}

/**
 * 배열이 "레코드 목록" 인지 판정한다.
 * @returns 목록이면 공통 키와 원소들, 아니면 null
 */
function shapeOf(arr: readonly unknown[], minRows: number): Shape | null {
  if (arr.length < minRows) return null

  const objects: Record<string, unknown>[] = []
  for (const el of arr) {
    if (el !== null && typeof el === 'object' && !Array.isArray(el)) {
      objects.push(el as Record<string, unknown>)
    }
  }
  // 원소 대부분이 객체여야 한다. 문자열 배열·숫자 배열은 목록이 아니다.
  if (objects.length < minRows || objects.length < arr.length * 0.7) return null

  const freq = new Map<string, number>()
  for (const obj of objects) {
    for (const key of Object.keys(obj)) freq.set(key, (freq.get(key) ?? 0) + 1)
  }

  const threshold = objects.length * 0.6
  const keys = [...freq.entries()]
    .filter(([, n]) => n >= threshold)
    .map(([k]) => k)
    .sort()

  // 공통 키가 두 개 미만이면 "키가 반복됨" 이라고 보기 어렵다.
  if (keys.length < 2) return null
  // 값이 전부 객체·배열인 표(= 중간 구조)는 목록이 아니라 그릇일 확률이 높다.
  if (!keys.some((k) => objects.some((o) => isScalar(o[k])))) return null

  return { rows: objects, keys }
}

function isScalar(v: unknown): boolean {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
}

/** 프롬프트·로그에 넣을 표본. 앞·중간·뒤에서 고르게 뽑는다 */
export function sampleRows<T>(rows: readonly T[], n: number): T[] {
  if (rows.length <= n) return [...rows]
  const step = rows.length / n
  const out: T[] = []
  for (let i = 0; i < n; i += 1) {
    const row = rows[Math.floor(i * step)]
    if (row !== undefined) out.push(row)
  }
  return out
}
