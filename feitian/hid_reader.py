"""
Raw HID device reader for RC transmitters.

When a controller presents as a custom HID device (not a standard Gamepad),
this module reads raw HID reports and parses axis/button data.
"""

import struct
import threading
import time
from typing import Optional

try:
    import hid
    _HAS_HID = True
except ImportError:
    _HAS_HID = False


class HIDReader:
    """
    Opens a HID device by VID/PID and continuously reads reports.
    Provides decoded axis values (4 channels) normalized to [-1, 1].
    """

    def __init__(self, vid: int, pid: int):
        self.vid = vid
        self.pid = pid
        self._dev: Optional[hid.device] = None
        self._running = False
        self._thread: Optional[threading.Thread] = None

        # Latest decoded values
        # axes: [throttle, yaw, pitch, roll]  each [-1, 1]
        self.axes = [0.0, 0.0, 0.0, 0.0]
        self.buttons = 0
        self.connected = False
        self.raw_bytes = [0] * 8  # latest 8 raw bytes (hex)
        self._lock = threading.Lock()

    def open(self) -> bool:
        if not _HAS_HID:
            return False
        try:
            self._dev = hid.device()
            self._dev.open(self.vid, self.pid)
            self._dev.set_nonblocking(False)  # blocking for reliable reads
            self.connected = True
            self._running = True
            self._thread = threading.Thread(target=self._read_loop, daemon=True)
            self._thread.start()
            return True
        except Exception:
            self.connected = False
            return False

    def close(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=1)
        if self._dev:
            try:
                self._dev.close()
            except Exception:
                pass
            self._dev = None
        self.connected = False

    def _read_loop(self):
        """Continuously read HID reports, decode axes."""
        while self._running and self._dev:
            try:
                data = self._dev.read(64, timeout_ms=100)
                if data and len(data) >= 8:
                    self._decode(data)
                elif data:
                    pass  # short packet, ignore
            except Exception:
                time.sleep(0.005)

    def _decode(self, data: bytes):
        """
        Decode 8-byte HID report from PhoenixRC-style controller.

        Observed format (8 bytes per report):
          byte 0: axis 0  (0x00–0xFF)  → throttle?
          byte 1: ?
          byte 2: axis 1  (0x00–0xFF)  → yaw?
          byte 3: ?
          byte 4: axis 2  (0x00–0xFF)  → pitch?
          byte 5: ?
          byte 6: axis 3  (0x00–0xFF)  → roll?
          byte 7: buttons / flags / counter

        Each axis is 8-bit, centered at 0x7F (127).
        Maps 0x00→-1.0, 0x7F→0.0, 0xFF→+1.0.
        """
        axes_raw = [
            data[0],
            data[2],
            data[3],  # corrected: PhoenixRC axes are at bytes 0,2,3,4
            data[4],
        ]

        with self._lock:
            for i, raw in enumerate(axes_raw):
                self.axes[i] = (raw - 127) / 127.0  # normalize to [-1, 1]
            self.buttons = data[7] if len(data) > 7 else 0
            self.raw_bytes = [data[i] if i < len(data) else 0 for i in range(8)]

    def get_state(self) -> dict:
        """Return current controller state as dict (thread-safe)."""
        with self._lock:
            return {
                "axes": list(self.axes),
                "buttons": self.buttons,
                "connected": self.connected,
                "raw": [b for b in self.raw_bytes],
            }


# ── Global registry ────────────────────────────────────────────

_reader: Optional[HIDReader] = None
_reader_lock = threading.Lock()


def get_reader() -> Optional[HIDReader]:
    with _reader_lock:
        return _reader


def start_reader(vid: int, pid: int) -> Optional[HIDReader]:
    global _reader
    with _reader_lock:
        if _reader:
            _reader.close()
        _reader = HIDReader(vid, pid)
        if _reader.open():
            return _reader
        _reader = None
        return None


def stop_reader():
    global _reader
    with _reader_lock:
        if _reader:
            _reader.close()
            _reader = None
