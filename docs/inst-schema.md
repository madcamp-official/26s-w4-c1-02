# .inst 스키마 v0.2 — A/B 사이의 계약

**이 파일이 두 사람의 경계선이다.** A는 .inst를 만들고, B는 .inst를 소비한다.
**스키마 변경은 두 사람 합의 + 버전 업으로만.** 변경 시 양쪽 코드(server `app/`, web `src/inst/types.ts`) 동기화까지가 변경의 완료 조건.

## 설계 원칙

- **f·d는 물체 전역, a만 위치 종속** — 모달 합성의 물리를 그대로 반영한 구조.
- 좌표는 0~1 정규화 (화면 크기 독립).
- `amps`는 `modes` 배열 순서로 정렬. 길이가 항상 `modes.length`와 같아야 한다.
- a는 상대값. 절대 음량은 `playback.master_gain` (폰 AGC 때문에 절대 진폭은 신뢰 불가).
- 파일 크기 목표: 사진 포함 수백 KB (링크 공유 시 즉시 로드).

## 예시

```json
{
  "version": "0.2",
  "meta": { "name": "머그컵", "created_at": "...", "quality_score": null },
  "image": { "src": "photo.jpg", "width": 1080, "height": 1440 },
  "modes": [
    { "id": "m1", "f": 523.3, "d": 1.8 },
    { "id": "m2", "f": 1247.1, "d": 3.2 },
    { "id": "m3", "f": 2210.4, "d": 5.1 }
  ],
  "anchors": [
    { "x": 0.42, "y": 0.31, "amps": [1.0, 0.6, 0.3] },
    { "x": 0.45, "y": 0.78, "amps": [0.2, 1.0, 0.7] }
  ],
  "mask": { "src": "mask.png", "optional": true },
  "playback": {
    "interp": "idw", "idw_power": 2,
    "master_gain": 0.8, "pitch_snap": null
  }
}
```

## 필드 설명

| 필드 | 의미 |
|---|---|
| `modes[].f` | 공진 주파수 (Hz). 음정과 음색. 물체 전역 |
| `modes[].d` | 감쇠 계수. 얼마나 오래 울리는지 (금속 작음, 나무 큼). 물체 전역 |
| `anchors[].x,y` | 타격 지점 정규화 좌표 |
| `anchors[].amps` | 그 지점을 쳤을 때의 모드별 상대 진폭. 0 = 마디(안 울림) |
| `mask` | 옵셔널. 없으면 전체 탭 가능 — 앵커에서 멀수록 IDW가 자연히 소리를 줄임 |
| `playback.interp` | 런타임 보간 방식. v0.2는 `idw` 고정 |
| `playback.pitch_snap` | 반음 스냅 설정. null = 원음. 스냅 시 상위 모드 비율은 유지 |

## 런타임 규약 (B)

- 탭 좌표 → 앵커 IDW(역거리 가중, `idw_power`) 보간 → 모드별 진폭 → Web Audio 발화.
- 어떤 앵커에서 amps가 0인 모드는 "그 지점이 마디"라는 뜻 — 물리적으로 정당한 데이터이므로 버그로 취급하지 말 것.

## 폴백 (D2, 모드 정렬 난항 시)

앵커별 독립 모드 세트로 후퇴: `modes`를 각 anchor 안으로 옮긴 v0.1 핫스팟 구조.
후퇴 비용이 작도록 이 가능성을 염두에 두고 코드를 짤 것.

## 목 데이터

- [shared/examples/mock_glass.inst.json](../shared/examples/mock_glass.inst.json) — 유리 음색 (고주파·저감쇠), 앵커 5개: 위(입구)는 고주파 크게, 아래(바닥)는 저주파 크게
- [shared/examples/mock_wood.inst.json](../shared/examples/mock_wood.inst.json) — 나무 음색 (저주파·고감쇠)
- 같은 파일이 `web/public/examples/`에도 복사되어 있어 프론트에서 바로 fetch 가능.
