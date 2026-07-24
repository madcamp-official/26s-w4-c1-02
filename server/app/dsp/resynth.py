"""재합성 — 추출된 모드로 타격음을 다시 만든다. (D1 검증용 + D3 알림음 렌더링)

y(t) = Σᵢ aᵢ · e^(−dᵢ·t) · sin(2π fᵢ t)

D1 관문: 재합성이 원본과 귀로 듣기에 유사해야 하고, 추출 f 가
튜너 앱 측정값과 맞아야 한다 (오차 1% 목표).
"""

import numpy as np

from app.dsp.modes import Mode


def resynthesize(modes: list[Mode], sr: int = 44100, duration: float = 3.0) -> np.ndarray:
    """모드 리스트로부터 감쇠 사인파 합을 렌더링."""
    t = np.arange(int(sr * duration)) / sr
    y = np.zeros_like(t)
    for m in modes:
        y += m.a * np.exp(-m.d * t) * np.sin(2 * np.pi * m.f * t)
    peak = np.max(np.abs(y))
    return y / peak if peak > 0 else y
