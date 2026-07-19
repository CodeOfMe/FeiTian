"""
FeiTian server — FastAPI + WebSocket for HID controller data streaming.
"""

import asyncio
import json
import socket
import sys
from pathlib import Path

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from feitian.controller_scanner import scan_controllers
from feitian.hid_reader import start_reader, stop_reader, get_reader

STATIC_DIR = Path(__file__).parent / "static"


DEFAULT_PORT = 9999


def _find_pid_on_port(port: int) -> str | None:
    """Return PID of the process listening on the given port, or None."""
    import subprocess
    try:
        out = subprocess.check_output(
            f'netstat -ano | findstr "LISTENING" | findstr ":{port} "',
            shell=True, text=True, timeout=5,
        )
        for line in out.strip().split('\n'):
            parts = line.split()
            if len(parts) >= 5 and parts[1].endswith(f':{port}'):
                return parts[-1]
    except Exception:
        pass
    return None


def _get_port() -> int:
    """Try default port 9999; offer to kill occupier, or fall back."""
    port = DEFAULT_PORT
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", port))
        s.close()
        return port
    except OSError:
        s.close()

    pid = _find_pid_on_port(port)

    # Interactive mode — ask user
    try:
        if sys.stdin.isatty():
            if pid:
                ans = input(
                    f"\n  端口 {port} 被 PID {pid} 占用，是否强制结束？[Y/n]: "
                ).strip().lower()
                if ans in ('', 'y', 'yes'):
                    import subprocess
                    subprocess.run(f'taskkill /F /PID {pid}', shell=True, timeout=5)
                    import time
                    time.sleep(0.5)
                    # Retry binding
                    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                    try:
                        s.bind(("127.0.0.1", port))
                        s.close()
                        print(f"  已释放端口 {port}", flush=True)
                        return port
                    except OSError:
                        print(f"  强制结束失败，换用其他端口", flush=True)
                        s.close()
            else:
                print(f"  端口 {port} 被占用（未能定位进程）", flush=True)

            # Prompt for alternative
            while True:
                try:
                    alt = input(f"  请输入新端口: ").strip()
                    if not alt:
                        continue
                    port = int(alt)
                    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                    s.bind(("127.0.0.1", port))
                    s.close()
                    return port
                except ValueError:
                    print("  请输入有效数字")
                except OSError:
                    print(f"  端口 {port} 也被占用")
                    s.close()
    except (EOFError, OSError):
        pass

    # Non-interactive or prompt failed — kill the occupier and retry
    if pid:
        import subprocess, time
        subprocess.run(f'taskkill /F /PID {pid}', shell=True, timeout=5,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(0.8)
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            s.bind(("127.0.0.1", port))
            s.close()
            print(f"  已强制结束 PID {pid}，使用端口 {port}", flush=True)
            return port
        except OSError:
            s.close()

    # Last resort — auto pick free port
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    print(f"  端口 {DEFAULT_PORT} 被占用，自动使用 {port}", flush=True)
    return port


def create_app() -> FastAPI:
    app = FastAPI(title="FeiTian", docs_url=None, redoc_url=None)

    # Disable caching so browser always gets latest JS/CSS
    class NoCacheMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request: Request, call_next):
            response = await call_next(request)
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
            return response
    app.add_middleware(NoCacheMiddleware)

    @app.get("/")
    async def index() -> HTMLResponse:
        controllers = scan_controllers()
        html = (STATIC_DIR / "index.html").read_text(encoding="utf-8")
        # Inject device list so frontend doesn't need to fetch
        injected = f"<script>window.__DEVICES__ = {json.dumps(controllers)};</script>"
        html = html.replace("</head>", injected + "\n</head>")
        return HTMLResponse(content=html)

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

    port = _get_port()
    app = create_app()
    url = f"http://127.0.0.1:{port}"

    print(f"\n  FeiTian 飞天 已启动", flush=True)
    print(f"  {url}\n", flush=True)

    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
