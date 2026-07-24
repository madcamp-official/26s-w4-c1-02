/**
 * .inst v0.2 타입 정의 — A/B 사이의 계약.
 * 스키마 명세: docs/inst-schema.md. 변경은 두 사람 합의 + 버전 업으로만.
 */

export interface InstMode {
  id: string;
  /** 공진 주파수 (Hz) — 물체 전역 */
  f: number;
  /** 감쇠 계수 — 물체 전역. 금속은 작고 나무는 큼 */
  d: number;
}

export interface InstAnchor {
  /** 0~1 정규화 좌표 (화면 크기 독립) */
  x: number;
  y: number;
  /** modes 순서로 정렬된 상대 진폭. 0 = 그 지점에서 안 울리는 모드(마디) */
  amps: number[];
}

export interface Inst {
  version: "0.2";
  meta: { name: string; created_at: string; quality_score: number | null };
  image: { src: string; width: number; height: number };
  modes: InstMode[];
  anchors: InstAnchor[];
  mask?: { src: string; optional: boolean };
  playback: {
    interp: "idw";
    idw_power: number;
    /** 절대 음량 (AGC 때문에 a 는 상대값만 신뢰) */
    master_gain: number;
    /** 반음 스냅 설정. null = 원음 그대로 */
    pitch_snap: string | null;
  };
}
