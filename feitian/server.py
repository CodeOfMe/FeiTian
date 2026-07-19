"""
FeiTian server — FastAPI backend + pywebview desktop window.

Starts a FastAPI server on a random port, serves the WebGL flight simulator
frontend, then opens a native WebView window pointing at it.
"""

import os
import socket
import threading
from pathlib import Path

import uvicorn
import webview
from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from feitian.controller_scanner import scan_controllers

STATIC_DIR = Path(__file__).parent / "static"


def _find_free_port() -> int:
    """Find a free TCP port on localhost."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def create_app() -> FastAPI:
    """Build the FastAPI application, mounting the static directory."""
    app = FastAPI(title="FeiTian", docs_url=None, redoc_url=None)

    @app.get("/")
    async def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    @app.get("/api/controllers")
    async def list_controllers() -> JSONResponse:
        """Scan for connected HID controllers / RC transmitters."""
        controllers = scan_controllers()
        return JSONResponse(content={"controllers": controllers})

    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    return app


def main() -> None:
    """Start the FeiTian simulator."""
    port = _find_free_port()
    app = create_app()

    server_thread = threading.Thread(
        target=uvicorn.run,
        args=(app,),
        kwargs={"host": "127.0.0.1", "port": port, "log_level": "warning"},
        daemon=True,
    )
    server_thread.start()

    webview.create_window(
        title="FeiTian 飞天 — FPV Drone Simulator",
        url=f"http://127.0.0.1:{port}",
        width=1280,
        height=720,
        min_size=(800, 600),
        resizable=True,
        fullscreen=False,
        easy_drag=False,
    )

    webview.start(debug=False)
