/**
 * 연주 화면 (D1 초기 → D3 완성) — 탐색/고정/연주 3단계.
 *
 * 1. 탐색: 사진 전체 터치 가능, 탭 지점 IDW 진폭으로 발화 + 파문.
 * 2. 고정: 길게 눌러 핫스팟 저장 (최대 6개).
 * 3. 연주: 상하 분할 — 위 사진, 아래 핫스팟 패드. 가로=음색, 세로=음정.
 *
 * TODO(D1): 목 .inst 로드 → 탭 → ResonatorBank.trigger(idwAmps(...)).
 *           실기에서 터치→소리 30ms 체감 검증 + 타격 순간 20ms 햅틱.
 * TODO(D3): 핫스팟 패드, 누르기=음소거, 반음 스냅 음정 시프트.
 */
export default function PlayPage() {
  return <p>연주 화면 — TODO(D1)</p>;
}
