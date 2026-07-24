"""타격 검출 — 녹음에서 타격(트랜지언트) 시각들을 찾는다. (D1~D2)"""

import numpy as np


def detect_hits(audio: np.ndarray, sr: int) -> list[float]:
    """오디오에서 타격 시각(초) 리스트를 반환.

    다중 타격 분리 포함: 인접 타격의 울림이 겹쳐도 onset 을 나눠야 한다.
    """
    raise NotImplementedError("TODO(D2)")
