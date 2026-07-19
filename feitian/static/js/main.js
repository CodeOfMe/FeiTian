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
let settings = { mode: 2, rcThrottle: false, deadzone: 0.08, smooth: 0.18 };

// Persisted mode presets: [throttle, yaw, pitch, roll] → physical axis index
const MODE_PRESETS = {
    1: { throttle: 3, yaw: 0, pitch: 3, roll: 2 },
    2: { throttle: 1, yaw: 0, pitch: 3, roll: 2 },
    3: { throttle: 3, yaw: 2, pitch: 1, roll: 0 },
    4: { throttle: 1, yaw: 2, pitch: 3, roll: 0 },
};

let inputState = null; // created after launch or early for calibration

// ── Load saved settings ──────────────────────────────────────
try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) settings = { ...settings, ...JSON.parse(raw) };
} catch (e) {}

function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
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
        syncMapSelects();
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

    // ── Calibration ──────────────────────────────────────
    $('#btn-calib').addEventListener('click', () => {
        if (inputState._calibrating) {
            inputState._toggleCalibration();
            $('#btn-calib').textContent = '开始校准';
            $('#btn-calib').classList.remove('active');
        } else {
            inputState._toggleCalibration();
            $('#btn-calib').textContent = '完成校准';
            $('#btn-calib').classList.add('active');
        }
    });
    $('#btn-calib-reset').addEventListener('click', () => {
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
    syncMapSelects();
    applyModeToInput();

    // ── Start launcher update loop ───────────────────────
    requestAnimationFrame(launcherTick);
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
    ['throttle','yaw','pitch','roll'].forEach(name => {
        const sel = $('#map-' + name);
        sel.innerHTML = '';
        for (let i = 0; i <= 7; i++) {
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = '轴 ' + i;
            sel.appendChild(opt);
        }
        sel.addEventListener('change', () => {
            if (inputState) {
                inputState._axisMap[name] = +sel.value;
            }
        });
    });
}

function syncMapSelects() {
    if (!inputState) return;
    const preset = MODE_PRESETS[settings.mode];
    ['throttle','yaw','pitch','roll'].forEach(name => {
        const val = preset[name] ?? ({throttle:1,yaw:0,pitch:3,roll:2}[name]);
        $('#map-' + name).value = val;
        inputState._axisMap[name] = val;
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

    // Selection
    list.querySelectorAll('.device-item').forEach(item => {
        item.addEventListener('click', () => {
            list.querySelectorAll('.device-item').forEach(x => x.classList.remove('selected'));
            item.classList.add('selected');
        });
    });

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

    // Input processing (even in launcher)
    inputState.update(0.016);

    // Controller status
    const status = $('#device-status');
    if (inputState.gamepadConnected) {
        status.className = 'device-status ok';
        status.textContent = '已连接: ' + inputState.gamepadName;
    }

    // Live axis bars
    if (inputState.gamepadConnected) {
        const gp = navigator.getGamepads()[inputState._gpIndex];
        if (gp && gp.axes) {
            ['throttle','yaw','pitch','roll'].forEach(name => {
                const idx = inputState._axisMap[name] ?? ({throttle:1,yaw:0,pitch:3,roll:2}[name]);
                const raw = (idx < gp.axes.length) ? gp.axes[idx] : 0;
                const clamped = Math.max(-1, Math.min(1, raw));
                const pct = Math.round((clamped + 1) * 50);
                const bar = $('#bar-' + name);
                const val = $('#val-' + name);

                if (clamped >= 0) {
                    bar.style.left = '50%';
                    bar.style.width = (clamped * 50) + '%';
                } else {
                    bar.style.left = (50 + clamped * 50) + '%';
                    bar.style.width = (-clamped * 50) + '%';
                }
                val.textContent = clamped.toFixed(2);
            });
        }
    }

    // Calibration button state
    if (inputState._calibrating) {
        $('#btn-calib').textContent = '完成校准';
        $('#btn-calib').classList.add('active');
    }
}

// ═══════════════════════════════════════════════════════════════
// LAUNCH → SIMULATOR TRANSITION
// ═══════════════════════════════════════════════════════════════

function launchSimulator() {
    // Apply final settings
    applyModeToInput();
    saveSettings();

    launcher.classList.add('hidden');
    simulator.classList.remove('hidden');

    initSimulator();
}

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
                // Return to launcher
                simulator.classList.add('hidden');
                launcher.classList.remove('hidden');
                loadDeviceList();
                requestAnimationFrame(launcherTick);
                break;
        }
    });

    // Game loop
    function animate(now) {
        if (simulator.classList.contains('hidden')) return;

        requestAnimationFrame(animate);

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
