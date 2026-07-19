"""
FeiTian server — FastAPI backend, serves the WebGL flight simulator.
Headless by default — just prints the URL.
"""

import socket
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
    """Start FeiTian headless — prints the URL, stays running."""
    sys.stdout.reconfigure(encoding="utf-8")

    port = _find_free_port()
    app = create_app()
    url = f"http://127.0.0.1:{port}"

    print(f"\n  FeiTian 飞天 已启动", flush=True)
    print(f"  {url}\n", flush=True)

    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
