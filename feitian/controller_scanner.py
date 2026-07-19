"""
HID controller scanner — detects RC transmitters and game controllers
connected to the system, even those that don't present as standard Gamepad.

Inspired by PhoenixSimRevived's device enumeration approach.
No dongle required — pure HID device scanning.
"""

import json
import os
import re
import subprocess
import sys
from typing import Optional


def _scan_windows_powershell() -> list[dict]:
    """
    Windows: use Get-PnpDevice + DEVPKEY_Device_BusReportedDeviceDesc
    to enumerate all HID devices with their real product names.

    This is the same approach PhoenixSimRevived uses — it finds devices
    that the Gamepad API can't see.
    """
    cmd = (
        'powershell -NoProfile -Command "'
        "$devices = Get-PnpDevice -Class HIDClass | Where-Object {$_.Status -eq 'OK'}; "
        "$out = foreach ($d in $devices) { "
        "  $desc = (Get-PnpDeviceProperty -InstanceId $d.InstanceId "
        "    -KeyName 'DEVPKEY_Device_BusReportedDeviceDesc' "
        "    -ErrorAction SilentlyContinue).Data; "
        "  [PSCustomObject]@{ "
        "    FriendlyName=$d.FriendlyName; "
        "    InstanceId=$d.InstanceId; "
        "    ProductName=$desc } }; "
        "$out | ConvertTo-Json -Compress\""
    )
    try:
        r = subprocess.run(
            cmd, capture_output=True, text=True, shell=True, timeout=20
        )
        devices = json.loads(r.stdout or "[]")
        if isinstance(devices, dict):
            devices = [devices]
    except (subprocess.TimeoutExpired, json.JSONDecodeError, Exception):
        return []

    # Build USB VID/PID → real name lookup from parent entries
    usb_names: dict[tuple[str, str], str] = {}
    for d in devices:
        iid = d.get("InstanceId", "")
        product = d.get("ProductName") or ""
        if iid.startswith("USB\\") and product:
            m = re.search(r"VID_([0-9A-Fa-f]{4})&PID_([0-9A-Fa-f]{4})", iid)
            if m:
                key = (m.group(1).upper(), m.group(2).upper())
                usb_names[key] = product

    # Filter to likely game controllers / RC transmitters
    generic_names = {
        "hid-compliant game controller",
        "usb input device",
        "hid-compliant device",
        "hid-compliant vendor-defined device",
        "hid-compliant consumer control device",
        "hid-compliant system controller",
    }

    controllers: list[dict] = []
    seen: set[tuple[str, str]] = set()

    for d in devices:
        iid = d.get("InstanceId", "")
        friendly = d.get("FriendlyName", "")
        product = d.get("ProductName") or ""

        m = re.search(r"VID_([0-9A-Fa-f]{4})&PID_([0-9A-Fa-f]{4})", iid)
        if not m:
            continue

        vid, pid = m.group(1).upper(), m.group(2).upper()
        if (vid, pid) in seen:
            continue
        seen.add((vid, pid))

        # Priority: USB parent name > BusReportedDeviceDesc > FriendlyName
        name = usb_names.get((vid, pid)) or product or friendly
        if not name or name.lower() in generic_names:
            name = friendly if friendly.lower() not in generic_names else f"HID Device {vid}:{pid}"

        # Skip obvious non-controller HIDs (mice, keyboards, etc.)
        lower = name.lower()
        if any(kw in lower for kw in ["mouse", "keyboard", "touchpad", "touchscreen",
                                        "pen", "digitizer", "sensor hub", "radio",
                                        "bluetooth", "infrared"]):
            # Still include if it has "controller" or "transmitter" in the name
            if not any(kw in lower for kw in ["controller", "gamepad", "joystick",
                                                "transmitter", "simulator", "rc",
                                                "spektrum", "futaba", "frsky",
                                                "flysky", "radiomaster", "jumper",
                                                "taranis", "turnigy", "hitec",
                                                "graupner", "jeti", "dx", "tx",
                                                "interlink"]):
                continue

        controllers.append({
            "name": name,
            "vid": vid,
            "pid": pid,
            "instance_id": iid,
        })

    return controllers


def _scan_hidapi() -> list[dict]:
    """
    Cross-platform fallback using hidapi library.
    Install with: pip install hidapi
    """
    try:
        import hid
    except ImportError:
        return []

    controllers: list[dict] = []
    skip_kw = ["mouse", "keyboard", "touchpad", "touchscreen", "pen", "digitizer",
               "multitouch", "button over interrupt", "sensor", "radio", "infrared",
               "system control", "consumer control", "vendor-defined"]
    try:
        for dev in hid.enumerate():
            vid = f"{dev['vendor_id']:04X}"
            pid = f"{dev['product_id']:04X}"
            name = dev.get("product_string", "") or f"HID {vid}:{pid}"
            mfr = dev.get("manufacturer_string", "") or ""

            # Skip obvious non-controllers
            lower = (name + " " + mfr).lower()
            if any(kw in lower for kw in skip_kw):
                continue

            controllers.append({
                "name": name,
                "vid": vid,
                "pid": pid,
                "manufacturer": mfr,
                "path": str(dev.get("path", "")),
            })
    except Exception:
        pass

    return controllers


def _scan_linux_lsusb() -> list[dict]:
    """Linux fallback: parse lsusb output."""
    try:
        r = subprocess.run(["lsusb"], capture_output=True, text=True, timeout=5)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return []

    controllers: list[dict] = []
    pattern = re.compile(
        r"Bus\s+\d+\s+Device\s+\d+:\s+ID\s+([0-9a-f]{4}):([0-9a-f]{4})\s+(.+)",
        re.IGNORECASE,
    )
    for line in r.stdout.strip().split("\n"):
        m = pattern.search(line)
        if not m:
            continue
        vid, pid, desc = m.group(1).upper(), m.group(2).upper(), m.group(3).strip()
        controllers.append({"name": desc, "vid": vid, "pid": pid})
    return controllers


def scan_controllers() -> list[dict]:
    """
    Scan for connected HID controllers.

    hidapi first (~50ms), PowerShell fallback if too few results.
    """
    result = _scan_hidapi()

    # Explicitly probe known RC controller VIDs that hidapi may miss
    # (custom HID usage_page devices like PhoenixRC)
    KNOWN_RC = [
        (0x1781, 0x0898, "RC Simulator - PhoenixRC Controller"),
        (0x1781, 0x0938, "PhoenixRC USB Interface"),
    ]
    seen = {(r["vid"], r["pid"]) for r in result}
    try:
        import hid
        for vid, pid, name in KNOWN_RC:
            if (f"{vid:04X}", f"{pid:04X}") not in seen:
                devs = hid.enumerate(vid, pid)
                if devs:
                    result.append({
                        "name": name,
                        "vid": f"{vid:04X}",
                        "pid": f"{pid:04X}",
                        "manufacturer": "",
                        "path": "",
                    })
                    seen.add((f"{vid:04X}", f"{pid:04X}"))
    except ImportError:
        pass

    if not result and sys.platform.startswith("linux"):
        result = _scan_linux_lsusb()

    return result
