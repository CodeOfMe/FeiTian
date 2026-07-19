"""FeiTian server — FastAPI + WebSocket HID streaming."""
import json, os, socket, sys
from pathlib import Path
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from feitian.controller_scanner import scan_controllers
from feitian.hid_reader import start_reader, stop_reader, get_reader

STATIC = Path(__file__).parent / "static"
PORT = 9999

def _get_port():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", PORT)); s.close(); return PORT
    except OSError:
        s.close()
    # occupied — try kill
    import subprocess, time
    try:
        out = subprocess.check_output(f'netstat -ano | findstr "LISTENING" | findstr ":{PORT} "', shell=True, text=True, timeout=5)
        pid = out.strip().split()[-1] if out.strip() else None
        if pid:
            subprocess.run(f'taskkill /F /PID {pid}', shell=True, timeout=5, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            time.sleep(.8)
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            try: s.bind(("127.0.0.1", PORT)); s.close(); return PORT
            except OSError: s.close()
    except: pass
    # fallback
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close()
    print(f"  {PORT} 被占用，使用 {p}", flush=True); return p

def create_app():
    app = FastAPI(title="FeiTian", docs_url=None, redoc_url=None)

    @app.get("/")
    async def index():
        controllers = scan_controllers()
        html = (STATIC / "index.html").read_text(encoding="utf-8")
        return HTMLResponse(html.replace("{{DEVICES_JSON}}", json.dumps(controllers)))

    @app.get("/api/controllers")
    async def list_ctrl():
        return JSONResponse({"controllers": scan_controllers()})

    @app.websocket("/ws/controller")
    async def ws_ctrl(ws: WebSocket):
        await ws.accept(); active = False
        try:
            while True:
                msg = await ws.receive_json()
                if msg.get("action") == "open":
                    r = start_reader(int(msg["vid"], 16), int(msg["pid"], 16))
                    if r: active = True; await ws.send_json({"status": "opened"})
                    else: await ws.send_json({"status": "error"})
                elif msg.get("action") == "close":
                    stop_reader(); active = False; await ws.send_json({"status": "closed"})
                elif msg.get("action") == "poll":
                    r = get_reader()
                    if r and r.connected: await ws.send_json({"status": "data", **r.get_state()})
                    else: await ws.send_json({"status": "disconnected"})
        except WebSocketDisconnect: pass
        finally:
            if active: stop_reader()

    app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")
    return app

def main():
    sys.stdout.reconfigure(encoding="utf-8")
    port = _get_port()
    print(f"\n  FeiTian 飞天 已启动\n  http://127.0.0.1:{port}\n", flush=True)
    uvicorn.run(create_app(), host="127.0.0.1", port=port, log_level="info")
