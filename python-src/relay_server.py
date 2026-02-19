"""
MojiNoYukue WebSocket Relay Server

Main App → (WebSocket) → このサーバ → (WebSocket) → Takeuchi App (投影PC)

使い方:
  python relay_server.py                     # デフォルト :8766
  python relay_server.py --port 8766         # ポート指定
  python relay_server.py --host 0.0.0.0      # IPv4全インターフェース
  python relay_server.py --host ::           # IPv6全インターフェース (デュアルスタック)
"""

import argparse
import asyncio
import json
import logging
import time
from typing import Any

try:
    import websockets
    from websockets.asyncio.server import serve, ServerConnection
except ImportError:
    print("websocketsライブラリが必要です: pip install websockets")
    raise SystemExit(1)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [relay] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("relay")


class WsHub:
    """WebSocket Pub/Sub ハブ (SseHubパターン踏襲)"""

    def __init__(self) -> None:
        self._clients: set[ServerConnection] = set()
        self._lock = asyncio.Lock()

    async def register(self, ws: ServerConnection) -> None:
        async with self._lock:
            self._clients.add(ws)
        hello = json.dumps(
            {"type": "relay-hello", "version": 1, "ts": time.time()},
            ensure_ascii=False,
        )
        try:
            await ws.send(hello)
        except Exception:
            pass
        log.info("client connected  (%d total)", len(self._clients))

    async def unregister(self, ws: ServerConnection) -> None:
        async with self._lock:
            self._clients.discard(ws)
        log.info("client disconnected (%d total)", len(self._clients))

    async def broadcast(self, message: dict[str, Any] | str) -> None:
        """全クライアントにメッセージを配信"""
        data = message if isinstance(message, str) else json.dumps(message, ensure_ascii=False)
        async with self._lock:
            clients = list(self._clients)
        if not clients:
            return
        disconnected: list[ServerConnection] = []
        for ws in clients:
            try:
                await ws.send(data)
            except Exception:
                disconnected.append(ws)
        if disconnected:
            async with self._lock:
                for ws in disconnected:
                    self._clients.discard(ws)

    @property
    def client_count(self) -> int:
        return len(self._clients)


hub = WsHub()


async def handler(ws: ServerConnection) -> None:
    """各WebSocket接続のハンドラ"""
    await hub.register(ws)
    try:
        async for raw in ws:
            # クライアントからのメッセージを受信し、全クライアントに中継
            try:
                msg = json.loads(raw) if isinstance(raw, str) else json.loads(raw.decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                continue

            msg_type = msg.get("type", "")

            # takeuchi-status は中継しない（サーバが受け取るだけ）
            if msg_type == "takeuchi-status":
                log.info("takeuchi status: %s", msg)
                continue

            # それ以外は全クライアントにブロードキャスト（送信元含む）
            await hub.broadcast(msg)

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        await hub.unregister(ws)


async def ping_loop(interval: float = 15.0) -> None:
    """定期的にpingを送信して接続を維持"""
    while True:
        await asyncio.sleep(interval)
        if hub.client_count > 0:
            await hub.broadcast({"type": "relay-ping", "ts": time.time()})


async def main(host: str, port: int) -> None:
    log.info("starting relay server on %s:%d", host, port)

    # pingループをバックグラウンドで起動
    asyncio.create_task(ping_loop())

    async with serve(handler, host, port) as server:
        log.info("relay server ready")
        await server.serve_forever()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="MojiNoYukue WebSocket Relay")
    parser.add_argument("--host", default="0.0.0.0", help="bind host (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8766, help="bind port (default: 8766)")
    args = parser.parse_args()
    asyncio.run(main(args.host, args.port))
