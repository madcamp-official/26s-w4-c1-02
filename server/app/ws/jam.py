"""잼 세션 WebSocket — 같은 링크 = 같은 방. (D4)

터치 이벤트(좌표 + 세기)만 브로드캐스트한다. 소리는 각 클라이언트가
로컬 합성하므로 오디오 스트리밍은 없다. 정확한 박자 동기화는 목표가 아님
(soundscape 프레이밍) — 지연 보정 로직을 넣지 말 것.
"""

from fastapi import APIRouter, WebSocket

router = APIRouter()


@router.websocket("/ws/jam/{room_id}")
async def jam_room(ws: WebSocket, room_id: str) -> None:
    """TODO(D4): 방 입장/퇴장 관리, 터치 이벤트 브로드캐스트."""
    await ws.accept()
    await ws.close(code=1000, reason="TODO(D4): not implemented")
