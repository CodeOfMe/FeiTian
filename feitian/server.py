"""
FeiTian server — FastAPI + WebSocket for HID controller data streaming.
"""

import asyncio
import socket
import sys
from pathlib import Path

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from feitian.controller_scanner import scan_controllers
from feitian.hid_reader import start_reader, stop_reader, get_reader

STATIC_DIR = Path(__file__).parent / "static"


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def create_app() -> FastAPI:
    app = FastAPI(title="FeiTian", docs_url=None, redoc_url=None)

    @app.get("/")
    async def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    @app.get("/api/controllers")
    async def list_controllers() -> JSONResponse:
        controllers = scan_controllers()
        return JSONResponse(content={"controllers": controllers})

    @app.websocket("/ws/controller")
    async def controller_ws(ws: WebSocket):
        """Stream raw HID controller data to frontend."""
        await ws.accept()

        vid = pid = None
        active = False

        try:
            while True:
                msg = await ws.receive_json()

                if msg.get("action") == "open":
                    vid = int(msg["vid"], 16)
                    pid = int(msg["pid"], 16)
                    reader = start_reader(vid, pid)
                    if reader:
                        active = True
                        await ws.send_json({"status": "opened", "vid": msg["vid"], "pid": msg["pid"]})
                    else:
                        await ws.send_json({"status": "error", "message": "Cannot open HID device (hidapi not installed?)"})

                elif msg.get("action") == "close":
                    stop_reader()
                    active = False
                    await ws.send_json({"status": "closed"})

                elif msg.get("action") == "poll":
                    reader = get_reader()
                    if reader and reader.connected:
                        await ws.send_json({"status": "data", **reader.get_state()})
                    else:
                        await ws.send_json({"status": "disconnected"})

        except WebSocketDisconnect:
            pass
        finally:
            if active:
                stop_reader()

    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
    return app


def main() -> None:
    """Start FeiTian headless — prints the URL, stays running."""
    sys.stdout.reconfigure(encoding="utf-8")

    port = _find_free_port()
    app = create_app()
    url = f"http://127.0.0.1:{port}"

    print(f"\n  FeiTian 飞天 已启动", flush=True)
    print(f"  {url}\n", flush=True)

    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
