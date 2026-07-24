"""모드 정렬 — 진짜 난제. (D1 초기 버전 → D2 완성)

타격 N개에서 나온 N개의 피크 리스트를 주파수 허용오차(±1~2%)로
클러스터링해 전역 모드 세트 + 앵커별 진폭 벡터를 만든다.
("1번 타격의 523Hz 와 3번 타격의 527Hz 는 같은 모드")

- f, d 는 클러스터 중앙값.
- 어떤 타격에서 안 보이는 모드는 a=0 (마디를 때린 것 — 물리적으로 정당).

폴백(D2): 정렬이 난항이면 앵커별 독립 모드 세트(v0.1 구조)로 후퇴 —
스키마상 modes 를 앵커 안으로 옮기면 끝.
"""

from app.dsp.modes import Mode


def align_modes(per_hit_modes: list[list[Mode]], tol: float = 0.02) -> tuple[list[Mode], list[list[float]]]:
    """(전역 모드 세트, 앵커별 amps 벡터) 를 반환. amps 는 전역 모드 순서 정렬."""
    raise NotImplementedError("TODO(D1-D2)")
