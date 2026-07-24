"""D1 CLI — 녹음 wav → 모드 추출 → 재합성 wav.

사용법:
    python -m cli.analyze input.wav --out resynth.wav --json modes.json

D1 오후의 핵심 도구. 낮에 녹음한 컵 소리를 넣고, 재합성이 원본과
닮았는지 귀로 판정한다. 추출 변형 선발전도 이 CLI 로 돌린다.
"""

import argparse


def main() -> None:
    parser = argparse.ArgumentParser(description="녹음에서 모드 추출 후 재합성")
    parser.add_argument("input", help="입력 wav (AGC 끄고 녹음한 것)")
    parser.add_argument("--out", default="resynth.wav", help="재합성 wav 출력 경로")
    parser.add_argument("--json", default=None, help="추출 모드 (f,d,a) JSON 출력 경로")
    parser.add_argument("--method", choices=["fft", "stft", "esprit"], default="fft",
                        help="추출 변형 (D1 선발전용)")
    args = parser.parse_args()
    raise NotImplementedError("TODO(D1): detect_hits → extract_modes → resynthesize 연결")


if __name__ == "__main__":
    main()
