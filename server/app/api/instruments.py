"""채집 처리 API — 업로드된 녹음/영상에서 .inst 를 만들어 돌려준다. (D2)

계약: 응답 JSON 은 docs/inst-schema.md 의 .inst v0.2 를 따른다.
스키마 변경은 두 사람 합의 + 버전 업으로만.
"""

from fastapi import APIRouter, HTTPException, UploadFile

router = APIRouter(prefix="/api")


@router.post("/instruments")
async def create_instrument(audio: UploadFile, video: UploadFile | None = None) -> dict:
    """녹음(+영상)을 받아 타격 검출 → 모드 추출 → 모드 정렬 → .inst 생성.

    TODO(D2): app.dsp 파이프라인 연결. 위치 자동 검출이 막히면 프론트의
    수동 탭 지정 폴백을 쓰므로, 앵커 좌표를 요청으로 받는 형태도 지원할 것.
    """
    raise HTTPException(status_code=501, detail="TODO(D2): DSP 파이프라인 연결")


@router.post("/ringtone")
async def export_ringtone(inst: dict) -> dict:
    """.inst 를 알림음 오디오 파일로 렌더링해 내려준다. (D3, 최우선 실용 기능)"""
    raise HTTPException(status_code=501, detail="TODO(D3): 알림음 렌더링")
