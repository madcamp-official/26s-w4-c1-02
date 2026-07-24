"""처리 서버 진입점.

역할 A 담당. 녹음 업로드 → 모드 추출/정렬 → .inst 반환, 잼 세션 WebSocket.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.instruments import router as instruments_router
from app.ws.jam import router as jam_router

app = FastAPI(title="instrument-server")

# 개발 중에는 프론트(Vite dev server) 어디서든 접근 허용. 배포 전에 좁힌다.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(instruments_router)
app.include_router(jam_router)


@app.get("/health")
def health() -> dict:
    return {"ok": True}
