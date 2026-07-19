// main.js — FeiTian 飞天: launcher → simulator

import { initScene, getScene, getCamera, getRenderer } from './scene.js';
import { createDrone } from './drone.js';
import { createTerrain } from './terrain.js';
import { stepPhysics } from './physics.js';
import { InputState } from './input.js';
import { HUD } from './hud.js';

// ── DOM refs ──────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const launcher = $('#launcher');
const simulator = $('#simulator');

// ── Settings ──────────────────────────────────────────────────
const SETTINGS_KEY = 'feitian_settings';
const DEVICE_KEY = 'feitian_selected_device';
let settings = { mode: 2, rcThrottle: false, deadzone: 0.08, smooth: 0.18,
    chanMap: { throttle:0, yaw:2, pitch:4, roll:6 },
    chanInvert: { throttle:false, yaw:false, pitch:false, roll:false },
    chanSubtrim: { throttle:0, yaw:0, pitch:0, roll:0 },
    chanEndpointL: { throttle:100, yaw:100, pitch:100, roll:100 },
    chanEndpointR: { throttle:100, yaw:100, pitch:100, roll:100 },
};

// Persisted mode presets: [throttle, yaw, pitch, roll] → physical axis index
const MODE_PRESETS = {
    1: { throttle: 3, yaw: 0, pitch: 3, roll: 2 },
    2: { throttle: 1, yaw: 0, pitch: 3, roll: 2 },
    3: { throttle: 3, yaw: 2, pitch: 1, roll: 0 },
    4: { throttle: 1, yaw: 2, pitch: 3, roll: 0 },
};

let inputState = null;
let simulatorInitialized = false;
let animFrameId = null;

// ── Load saved settings ──────────────────────────────────────
try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) settings = { ...settings, ...JSON.parse(raw) };
} catch (e) {}

function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
}

function saveDevice(dev) {
    try { localStorage.setItem(DEVICE_KEY, JSON.stringify(dev)); } catch (e) {}
}

function loadDevice() {
    try {
        const raw = localStorage.getItem(DEVICE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
}

// ═══════════════════════════════════════════════════════════════
// LAUNCHER
// ═══════════════════════════════════════════════════════════════

function initLauncher() {
    inputState = new InputState(); // start Gamepad polling early

    // ── Apply saved settings to DOM ──────────────────────
    applySettingsToDOM();

    // ── Device list ──────────────────────────────────────
    loadDeviceList();
    $('#btn-rescan').addEventListener('click', loadDeviceList);

    // ── Mode buttons ─────────────────────────────────────
    $('#mode-select').addEventListener('click', e => {
        const btn = e.target.closest('button');
        if (!btn) return;
        settings.mode = +btn.dataset.mode;
        $('#mode-select').querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        applyModeToInput();
        saveSettings();
    });

    // ── Sliders ──────────────────────────────────────────
    bindSlider('slider-deadzone', 'deadzone', v => Math.round(v * 100) + '%');
    bindSlider('slider-smooth', 'smooth', v => v.toFixed(2));

    // ── RC throttle toggle ───────────────────────────────
    $('#toggle-rc-throttle').addEventListener('change', e => {
        settings.rcThrottle = e.target.checked;
        applyModeToInput();
        saveSettings();
    });

    // ── Reset mapping ────────────────────────────────────
    $('#btn-calib-reset').addEventListener('click', () => {
        settings.chanMap = { throttle:0, yaw:2, pitch:4, roll:6 };
        settings.chanInvert = { throttle:false, yaw:false, pitch:false, roll:false };
        settings.chanSubtrim = { throttle:0, yaw:0, pitch:0, roll:0 };
        settings.chanEndpointL = { throttle:100, yaw:100, pitch:100, roll:100 };
        settings.chanEndpointR = { throttle:100, yaw:100, pitch:100, roll:100 };
        saveSettings();
        populateMapSelects();
        inputState.resetCalibration();
    });

    // ── Launch ───────────────────────────────────────────
    $('#btn-launch').addEventListener('click', launchSimulator);
    window.addEventListener('keydown', e => {
        if (e.code === 'Enter' && !launcher.classList.contains('hidden')) {
            e.preventDefault();
            launchSimulator();
        }
    });

    // ── Populate axis map selects ────────────────────────
    populateMapSelects();
    applyModeToInput();

    // ── Start launcher update loop ───────────────────────
    requestAnimationFrame(launcherTick);
}

function launchSimulator() {
    applyModeToInput();
    saveSettings();
    navigateTo('flight');
}

function applySettingsToDOM() {
    // Mode
    $('#mode-select').querySelectorAll('button').forEach(b => {
        b.classList.toggle('active', +b.dataset.mode === settings.mode);
    });
    // Sliders
    const dz = Math.round(settings.deadzone * 100);
    $('#slider-deadzone').value = dz;
    $('#lbl-deadzone').textContent = dz + '%';

    const sm = Math.round(settings.smooth * 100);
    $('#slider-smooth').value = sm;
    $('#lbl-smooth').textContent = settings.smooth.toFixed(2);

    // RC throttle
    $('#toggle-rc-throttle').checked = settings.rcThrottle;
}

function bindSlider(id, key, fmt) {
    const slider = $('#' + id);
    const lbl = $('#lbl-' + id.replace('slider-', ''));
    slider.addEventListener('input', () => {
        const raw = +slider.value;
        settings[key] = raw / 100;
        lbl.textContent = fmt(settings[key]);
        applyModeToInput();
        saveSettings();
    });
}

function populateMapSelects() {
    // Build per-channel config rows
    const container = $('#axis-configs');
    if (!container) return;
    const chNames = ['throttle','yaw','pitch','roll'];
    const chLabels = ['油门','偏航','俯仰','横滚'];

    container.innerHTML = chNames.map((name, i) => `
        <div class="axis-config-row" id="cfg-${name}">
            <span class="ch-label">${chLabels[i]}</span>
            <div class="ch-bar-wrap"><div class="ch-bar-fill" id="chbar-${name}"></div></div>
            <span class="ch-val" id="chval-${name}">0.00</span>
            <select id="chsrc-${name}">
                ${[0,1,2,3,4,5,6,7].map(b => `<option value="${b}">B${b}</option>`).join('')}
            </select>
            <label class="ch-invert"><input type="checkbox" id="chinv-${name}">反</label>
            <input type="number" id="chsub-${name}" value="0" min="-127" max="127" step="1" title="Subtrim">
            <input type="number" id="chepl-${name}" value="100" min="10" max="200" step="1" title="Endpoint L%">
            <input type="number" id="chepr-${name}" value="100" min="10" max="200" step="1" title="Endpoint R%">
        </div>
    `).join('');

    // Wire events
    chNames.forEach(name => {
        $(`#chsrc-${name}`).value = settings.chanMap[name];
        $(`#chinv-${name}`).checked = settings.chanInvert[name];
        $(`#chsub-${name}`).value = settings.chanSubtrim[name];
        $(`#chepl-${name}`).value = settings.chanEndpointL[name];
        $(`#chepr-${name}`).value = settings.chanEndpointR[name];

        $(`#chsrc-${name}`).addEventListener('change', e => {
            settings.chanMap[name] = +e.target.value;
            saveSettings();
        });
        $(`#chinv-${name}`).addEventListener('change', e => {
            settings.chanInvert[name] = e.target.checked;
            saveSettings();
        });
        $(`#chsub-${name}`).addEventListener('change', e => {
            settings.chanSubtrim[name] = +e.target.value || 0;
            saveSettings();
        });
        $(`#chepl-${name}`).addEventListener('change', e => {
            settings.chanEndpointL[name] = +e.target.value || 100;
            saveSettings();
        });
        $(`#chepr-${name}`).addEventListener('change', e => {
            settings.chanEndpointR[name] = +e.target.value || 100;
            saveSettings();
        });
    });
}

function applyModeToInput() {
    if (!inputState) return;
    const preset = MODE_PRESETS[settings.mode];
    Object.assign(inputState._axisMap, preset);
    ['throttle','pitch','roll','yaw'].forEach(axis => {
        inputState._calibration[axis].deadzone = settings.deadzone;
    });
    inputState._calibration.throttle.rcThrottle = settings.rcThrottle;
    inputState._smoothFactor = settings.smooth;
}

// ── WebSocket HID bridge ──────────────────────────────────────
let hidWs = null;
let hidPollTimer = null;
let selectedDevice = null; // {vid, pid, name}

function connectHID(vid, pid) {
    if (hidWs && hidWs.readyState === WebSocket.OPEN) {
        hidWs.send(JSON.stringify({action: 'close'}));
        hidWs.close();
    }
    clearInterval(hidPollTimer);

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    hidWs = new WebSocket(`${proto}//${location.host}/ws/controller`);

    hidWs.onopen = () => {
        hidWs.send(JSON.stringify({action: 'open', vid, pid}));
        // Poll for axis data at 50Hz
        hidPollTimer = setInterval(() => {
            if (hidWs && hidWs.readyState === WebSocket.OPEN) {
                hidWs.send(JSON.stringify({action: 'poll'}));
            }
        }, 20);
    };

    hidWs.onmessage = (e) => {
        try {
            const msg = JSON.parse(e.data);
            if (msg.status === 'data') {
                if (msg.raw && inputState) {
                    inputState.setRawHidBytes(msg.raw);
                }
                if (msg.axes && inputState) {
                    inputState.setExternalAxes(msg.axes);
                }
            }
        } catch (err) {}
    };

    hidWs.onerror = () => { inputState && inputState.clearExternalAxes(); };
    hidWs.onclose = () => { inputState && inputState.clearExternalAxes(); };
}

function disconnectHID() {
    clearInterval(hidPollTimer);
    if (hidWs) {
        try { hidWs.send(JSON.stringify({action: 'close'})); } catch(e) {}
        hidWs.close();
        hidWs = null;
    }
    inputState && inputState.clearExternalAxes();
}

async function loadDeviceList() {
    const list = $('#device-list');
    list.innerHTML = '<div class="device-scanning">正在扫描 USB / HID 设备...</div>';

    let devices = [];
    try {
        const resp = await fetch('/api/controllers');
        const data = await resp.json();
        devices = data.controllers || [];
    } catch (e) { /* offline dev */ }

    if (devices.length === 0) {
        list.innerHTML = '<div class="device-scanning">未检测到 HID 设备 — 可使用键盘操控</div>';
        $('#device-status').className = 'device-status warn';
        $('#device-status').textContent = '等待 USB 遥控器连接...（键盘模式可用）';
        return;
    }

    list.innerHTML = devices.map((d, i) => `
        <div class="device-item${i === 0 ? ' selected' : ''}" data-idx="${i}">
            <div class="radio"></div>
            <div class="info">
                <div class="dev-name">${escapeHTML(d.name)}</div>
                <div class="dev-id">VID:${d.vid}  PID:${d.pid}</div>
            </div>
        </div>
    `).join('');

    // Selection — connect HID if not a standard Gamepad
    list.querySelectorAll('.device-item').forEach(item => {
        item.addEventListener('click', () => {
            list.querySelectorAll('.device-item').forEach(x => x.classList.remove('selected'));
            item.classList.add('selected');
            const idx = +item.dataset.idx;
            const dev = devices[idx];
            selectedDevice = dev;
            saveDevice({ vid: dev.vid, pid: dev.pid, name: dev.name, idx });

            // If Gamepad API already has a controller, skip HID
            if (!inputState.gamepadConnected && dev.vid && dev.pid) {
                connectHID(dev.vid, dev.pid);
                $('#device-status').className = 'device-status ok';
                $('#device-status').textContent = '已连接 HID: ' + dev.name;
            }
        });
    });

    // Auto-restore previously selected device
    const saved = loadDevice();
    if (saved && saved.idx != null && saved.idx < devices.length) {
        const items = list.querySelectorAll('.device-item');
        items.forEach(x => x.classList.remove('selected'));
        if (items[saved.idx]) {
            items[saved.idx].classList.add('selected');
            selectedDevice = devices[saved.idx];
            if (!inputState.gamepadConnected && saved.vid && saved.pid) {
                connectHID(saved.vid, saved.pid);
            }
        }
    }

    $('#device-status').className = 'device-status ok';
    $('#device-status').textContent = `检测到 ${devices.length} 个设备`;
}

function escapeHTML(s) {
    const el = document.createElement('span');
    el.textContent = s;
    return el.innerHTML;
}

// Launcher per-frame update — shows live axis values + controller status
function launcherTick(now) {
    if (!launcher.classList.contains('hidden')) {
        requestAnimationFrame(launcherTick);
        updateLauncherLive();
    }
}

function updateLauncherLive() {
    if (!inputState) return;

    inputState.update(0.016);

    const status = $('#device-status');
    if (inputState.gamepadConnected) {
        status.className = 'device-status ok';
        status.textContent = '已连接 Gamepad: ' + inputState.gamepadName;
    } else if (inputState._extConnected) {
        status.className = 'device-status ok';
        status.textContent = '已连接 HID 设备（原始读取）';
    }

    // ── Raw HID bytes display ─────────────────────────────
    const rawEl = $('#hid-raw');
    if (inputState._extConnected && inputState._rawHidBytes) {
        rawEl.textContent = 'RAW: ' + inputState._rawHidBytes.map(b =>
            b.toString(16).padStart(2,'0').toUpperCase()
        ).join(' ');
    } else {
        rawEl.textContent = 'RAW: -- -- -- -- -- -- -- --';
    }

    // ── Per-channel live bars (HID mode) ──────────────────
    const names = ['throttle','yaw','pitch','roll'];
    if (inputState._extConnected && inputState._rawHidBytes) {
        const raw = inputState._rawHidBytes;
        names.forEach(name => {
            const byteIdx = settings.chanMap[name] ?? ({throttle:0,yaw:2,pitch:4,roll:6}[name]);
            let val = (raw[byteIdx] || 0) - 127; // 0x7F center
            val = val / 127; // normalize [-1, 1]

            // Subtrim
            val += (settings.chanSubtrim[name] || 0) / 127;
            // Invert
            if (settings.chanInvert[name]) val = -val;
            // Endpoint
            if (val < 0) val *= (settings.chanEndpointL[name] || 100) / 100;
            else val *= (settings.chanEndpointR[name] || 100) / 100;
            val = Math.max(-1, Math.min(1, val));

            const bar = $('#chbar-' + name);
            const vdisp = $('#chval-' + name);
            if (val >= 0) {
                bar.style.left = '50%'; bar.style.width = (val * 50) + '%';
            } else {
                bar.style.left = (50 + val * 50) + '%'; bar.style.width = (-val * 50) + '%';
            }
            if (vdisp) vdisp.textContent = val.toFixed(2);
        });

        // Feed mapped axes to physics via setExternalAxes
        const mapped = names.map(name => {
            const byteIdx = settings.chanMap[name] ?? 0;
            let v = ((raw[byteIdx] || 0) - 127) / 127;
            v += (settings.chanSubtrim[name] || 0) / 127;
            if (settings.chanInvert[name]) v = -v;
            if (v < 0) v *= (settings.chanEndpointL[name] || 100) / 100;
            else v *= (settings.chanEndpointR[name] || 100) / 100;
            return Math.max(-1, Math.min(1, v));
        });
        inputState.setExternalAxes(mapped);
    } else if (inputState.gamepadConnected) {
        const gp = navigator.getGamepads()[inputState._gpIndex];
        if (gp && gp.axes) {
            names.forEach(name => {
                const idx = inputState._axisMap[name] ?? ({throttle:1,yaw:0,pitch:3,roll:2}[name]);
                const raw = (idx < gp.axes.length) ? gp.axes[idx] : 0;
                const clamped = Math.max(-1, Math.min(1, raw));
                const bar = $('#chbar-' + name);
                const vdisp = $('#chval-' + name);
                if (clamped >= 0) {
                    bar.style.left = '50%'; bar.style.width = (clamped * 50) + '%';
                } else {
                    bar.style.left = (50 + clamped * 50) + '%'; bar.style.width = (-clamped * 50) + '%';
                }
                if (vdisp) vdisp.textContent = clamped.toFixed(2);
            });
        }
    }

// ═══════════════════════════════════════════════════════════════
// HISTORY / NAVIGATION
// ═══════════════════════════════════════════════════════════════

function navigateTo(view, push = true) {
    if (push) {
        history.pushState({ view }, '', view === 'flight' ? '#flight' : '#launcher');
    } else {
        history.replaceState({ view }, '', view === 'flight' ? '#flight' : '#launcher');
    }
    _showView(view);
}

function _showView(view) {
    if (view === 'flight') {
        launcher.classList.add('hidden');
        simulator.classList.remove('hidden');
        if (!simulatorInitialized) {
            initSimulator();
            simulatorInitialized = true;
        }
    } else {
        // Back to launcher
        if (animFrameId) {
            cancelAnimationFrame(animFrameId);
            animFrameId = null;
        }
        simulator.classList.add('hidden');
        launcher.classList.remove('hidden');
        loadDeviceList();
        requestAnimationFrame(launcherTick);
    }
}

window.addEventListener('popstate', (e) => {
    const view = (e.state && e.state.view) || 'launcher';
    _showView(view);
});

// On initial load, use replaceState so we don't create an extra history entry
history.replaceState({ view: 'launcher' }, '', '#launcher');

// ═══════════════════════════════════════════════════════════════
// SIMULATOR
// ═══════════════════════════════════════════════════════════════

const state = {
    position: new THREE.Vector3(0, 2.5, 0),
    velocity: new THREE.Vector3(0, 0, 0),
    rotation: new THREE.Euler(0, 0, 0, 'YXZ'),
    angularVelocity: new THREE.Vector3(0, 0, 0),
    throttles: [0, 0, 0, 0],
    input: { throttle: 0, pitch: 0, roll: 0, yaw: 0 },
    cameraMode: 'third',
    lastTime: performance.now(),
    dt: 0,
};

function initSimulator() {
    const { scene } = initScene();
    createTerrain(scene);

    const { group: droneGroup, rotors } = createDrone();
    droneGroup.position.copy(state.position);
    scene.add(droneGroup);
    state.droneGroup = droneGroup;
    state.rotors = rotors;

    const hud = new HUD();

    // Keyboard extras
    window.addEventListener('keydown', (e) => {
        switch (e.code) {
            case 'KeyV':
                state.cameraMode = state.cameraMode === 'fpv' ? 'third' : 'fpv';
                break;
            case 'KeyR':
                state.position.set(0, 2.5, 0);
                state.velocity.set(0, 0, 0);
                state.rotation.set(0, 0, 0);
                state.angularVelocity.set(0, 0, 0);
                break;
            case 'Escape':
                // Back to launcher via browser history
                history.back();
                break;
        }
    });

    // Game loop
    function animate(now) {
        if (simulator.classList.contains('hidden')) return;

        animFrameId = requestAnimationFrame(animate);

        state.dt = Math.min((now - state.lastTime) / 1000, 0.05);
        state.lastTime = now;
        if (state.dt <= 0) return;

        inputState.update(state.dt);
        inputState.applyTo(state.input);
        stepPhysics(state, state.dt);

        droneGroup.position.copy(state.position);
        droneGroup.rotation.copy(state.rotation);

        rotors.forEach((rotor, i) => {
            rotor.rotation.y += (state.throttles[i] * 60 + 8) * state.dt;
        });

        // Camera
        if (state.cameraMode === 'fpv') {
            updateFPVCamera(droneGroup);
        } else {
            updateThirdPersonCamera(droneGroup, state);
        }

        // HUD
        hud.controllerConnected = inputState.gamepadConnected;
        hud.controllerName = inputState.gamepadName;
        hud.calibrating = inputState._calibrating;
        hud.hintMsg = inputState.hintMsg;
        hud.hidDevices = inputState.hidDevices;
        hud.draw(state);

        getRenderer().render(getScene(), getCamera());
    }

    requestAnimationFrame(animate);
}

// ── Camera helpers ────────────────────────────────────────────

import * as THREE from 'three';
const cameraOffset = new THREE.Vector3(0, 3, -10);

function updateThirdPersonCamera(droneGroup, st) {
    const cam = getCamera();
    const dronePos = droneGroup.position.clone();
    const droneQuat = new THREE.Quaternion().setFromEuler(st.rotation);
    const offset = cameraOffset.clone().applyQuaternion(droneQuat);
    const desiredPos = dronePos.clone().add(offset);
    desiredPos.y = Math.max(desiredPos.y, dronePos.y + 1.5);
    const lookTarget = dronePos.clone().add(new THREE.Vector3(0, 0.5, 2).applyQuaternion(droneQuat));
    const f = 1 - Math.exp(-6 * st.dt);
    cam.position.lerp(desiredPos, f);
    const cur = new THREE.Vector3(); cam.getWorldDirection(cur);
    const dLook = lookTarget.clone().sub(cam.position).normalize();
    cur.lerp(dLook, f);
    cam.lookAt(cam.position.clone().add(cur));
}

function updateFPVCamera(droneGroup) {
    const cam = getCamera();
    const dronePos = droneGroup.position.clone();
    const droneQuat = new THREE.Quaternion().setFromEuler(state.rotation);
    const forward = new THREE.Vector3(0, 0.15, 0.5).applyQuaternion(droneQuat);
    cam.position.copy(dronePos.clone().add(new THREE.Vector3(0, 0.2, 0)));
    cam.lookAt(dronePos.clone().add(forward));
}

// ═══════════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════════

initLauncher();
