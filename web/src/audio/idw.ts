import type { InstAnchor } from "../inst/types";

/**
 * 탭 좌표 → 모드별 진폭 벡터. 역거리 가중(IDW) 보간.
 * 앵커에서 멀수록 자연히 소리가 작아진다 (마스크 없는 경우의 감쇠 역할).
 */
export function idwAmps(
  anchors: InstAnchor[],
  x: number,
  y: number,
  power = 2,
): number[] {
  const nModes = anchors[0]?.amps.length ?? 0;
  const amps = new Array<number>(nModes).fill(0);
  let weightSum = 0;

  for (const a of anchors) {
    const d2 = (a.x - x) ** 2 + (a.y - y) ** 2;
    // 앵커 바로 위를 탭하면 그 앵커 값을 그대로 사용
    if (d2 < 1e-8) return [...a.amps];
    const w = 1 / Math.pow(Math.sqrt(d2), power);
    weightSum += w;
    for (let i = 0; i < nModes; i++) amps[i] += w * a.amps[i];
  }
  if (weightSum === 0) return amps;
  return amps.map((v) => v / weightSum);
}
