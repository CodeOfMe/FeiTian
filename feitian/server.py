"""
FeiTian server — FastAPI backend, serves the WebGL flight simulator,
opens Firefox browser.
"""

import os
import socket
import subprocess
import sys
import threading
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from feitian.controller_scanner import scan_controllers

STATIC_DIR = Path(__file__).parent / "static"


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _find_firefox() -> str | None:
    """Locate Firefox executable on this system."""
    candidates = []
    if sys.platform == "win32":
        candidates = [
            os.path.expandvars(r"%ProgramFiles%\Mozilla Firefox\firefox.exe"),
            os.path.expandvars(r"%ProgramFiles(x86)%\Mozilla Firefox\firefox.exe"),
            os.path.expandvars(r"%LocalAppData%\Mozilla Firefox\firefox.exe"),
        ]
    elif sys.platform == "darwin":
        candidates = ["/Applications/Firefox.app/Contents/MacOS/firefox"]
    else:
        for name in ("firefox", "firefox-esr", "firefox-nightly"):
            try:
                subprocess.run(["which", name], capture_output=True, check=True)
                return name
            except Exception:
                pass
        return None

    for path in candidates:
        if os.path.isfile(path):
            return path
    return None


def create_app() -> FastAPI:
    app = FastAPI(title="FeiTian", docs_url=None, redoc_url=None)

    @app.get("/")
    async def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    @app.get("/api/controllers")
    async def list_controllers() -> JSONResponse:
        controllers = scan_controllers()
        return JSONResponse(content={"controllers": controllers})

    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
    return app


def main() -> None:
    """Start FeiTian simulator — opens in Firefox."""
    port = _find_free_port()
    app = create_app()

    server_thread = threading.Thread(
        target=uvicorn.run,
        args=(app,),
        kwargs={"host": "127.0.0.1", "port": port, "log_level": "warning"},
        daemon=True,
    )
    server_thread.start()

    url = f"http://127.0.0.1:{port}"
    print(f"[FeiTian] Server: {url}")

    firefox = _find_firefox()
    if firefox:
        print(f"[FeiTian] Launching Firefox: {firefox}")
        subprocess.Popen([firefox, url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        print("[FeiTian] Firefox not found, opening with default browser...")
        if sys.platform == "win32":
            os.startfile(url)
        else:
            import webbrowser
            webbrowser.open(url)

    print("[FeiTian] Running. Press Ctrl+C to stop.")
    try:
        import time
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("[FeiTian] Shutting down.")
