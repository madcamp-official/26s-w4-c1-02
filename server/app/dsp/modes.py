"""모드 추출 — 타격 하나의 울림에서 (f, d, a) 삼중항들을 뽑는다. (D1)

D1 계획: 변형 3개를 병렬 구현해 실측으로 선발한다.
  ① FFT 피크 → f, 힐베르트 포락선 로그 피팅 → d, 피크 크기 → a
  ② STFT 피크 추적
  ③ ESPRIT / Prony
판정 기준: 재합성이 원본과 닮았는가 / 모드 수 5~20개 / 타격 간 f 안정성
(마지막이 공간 보간의 전제).

주의: 녹음 시 AGC 를 꺼야 감쇠값(d)이 오염되지 않는다.
"""

from dataclasses import dataclass

import numpy as np


@dataclass
class Mode:
    f: float  # 공진 주파수 (Hz) — 물체 전역
    d: float  # 감쇠 계수 — 물체 전역
    a: float  # 진폭 — 타격 위치 종속


def extract_modes(ring: np.ndarray, sr: int, max_modes: int = 20) -> list[Mode]:
    """타격 직후 울림 구간에서 모드 리스트를 추출. 변형 ① 기본."""
    raise NotImplementedError("TODO(D1)")
