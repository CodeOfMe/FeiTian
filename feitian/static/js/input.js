// input.js — Keyboard + Gamepad/RC transmitter input handler for FPV drone
//
// Supports:
//   - Keyboard (W/S throttle, arrows pitch/roll, A/D yaw)
//   - Standard gamepads (Xbox, PlayStation, etc.) — Mode 2
//   - RC transmitters via USB HID (EdgeTX/OpenTX: Radiomaster, Jumper, FrSky, etc.)
//   - Per-axis calibration with localStorage persistence
//   - Non-self-centering throttle (RC mode)
//   - Backend HID scanning (calls /api/controllers for system-level detection)

const STORAGE_KEY = 'feitian_calibration';

// ── Default axis mapping for Mode 2 ────────────────────────────
// Logical axis → physical Gamepad axis index (default)
const DEFAULT_AXIS_MAP = {
    throttle: 1,  // left stick Y  (inverted: up = -1 → positive throttle)
    yaw:      0,  // left stick X
    pitch:    3,  // right stick Y (inverted: up = -1 → nose forward)
    roll:     2,  // right stick X
};

// Keyboard → logical axis mapping
const KEY_MAP = {
    // Pitch
    ArrowUp:    { axis: 'pitch',   value: -1 },
    ArrowDown:  { axis: 'pitch',   value:  1 },

    // Roll
    ArrowLeft:  { axis: 'roll',    value: -1 },
    ArrowRight: { axis: 'roll',    value:  1 },

    // Throttle
    KeyW:       { axis: 'throttle', value:  1 },
    KeyS:       { axis: 'throttle', value: -1 },
    Space:      { axis: 'throttle', value:  1 },
    ShiftLeft:  { axis: 'throttle', value: -1 },
    ShiftRight: { axis: 'throttle', value: -1 },

    // Yaw
    KeyA:       { axis: 'yaw',     value: -1 },
    KeyD:       { axis: 'yaw',     value:  1 },
    KeyQ:       { axis: 'yaw',     value: -1 },
    KeyE:       { axis: 'yaw',     value:  1 },
};

const GAMEPAD_POLL_INTERVAL = 16; // ms (~60 Hz)

// ── Per-axis calibration ──────────────────────────────────────
// Each logical axis can have independent calibration.
// If uncalibrated, rawMin/Max default to -1/1, center to 0.
class AxisCalibration {
    constructor() {
        this.rawMin = -1;
        this.rawMax = 1;
        this.center = 0;
        this.deadzone = 0.08;
        // RC throttle: map full range [-1,1] → [0,1] instead of self-centering
        this.rcThrottle = false;
    }

    /** Apply calibration: raw [-1,1] → normalized output */
    apply(raw) {
        // Deadzone around center
        const halfRange = Math.max(this.rawMax - this.center, this.center - this.rawMin, 0.01);
        const dead = this.deadzone * halfRange;

        if (Math.abs(raw - this.center) < dead) return 0;

        if (raw > this.center) {
            return (raw - this.center - dead) / (this.rawMax - this.center - dead);
        } else {
            return (raw - this.center + dead) / (this.center - this.rawMin - dead);
        }
    }
}

// ── InputState ─────────────────────────────────────────────────

export class InputState {
    constructor() {
        // Smoothed output values (fed to physics)
        this.throttle = 0;
        this.pitch = 0;
        this.roll = 0;
        this.yaw = 0;

        // Raw target before smoothing
        this._target = { throttle: 0, pitch: 0, roll: 0, yaw: 0 };

        // Key state
        this._keys = {};
        ['throttle','pitch','roll','yaw'].forEach(a => {
            this._keys[a + '_p'] = false;
            this._keys[a + '_n'] = false;
        });

        // Gamepad
        this._gpIndex = -1;
        this._gpName = '';
        this._gpConnected = false;
        this._axisMap = { ...DEFAULT_AXIS_MAP };
        this._calibration = {
            throttle: new AxisCalibration(),
            pitch:    new AxisCalibration(),
            roll:     new AxisCalibration(),
            yaw:      new AxisCalibration(),
        };

        // Calibration mode
        this._calibrating = false;
        this._calibSamples = {}; // { axisName: { min, max, center } }

        // Smoothing factor
        this._smoothFactor = 0.18;

        // Status messages (consumed by HUD)
        this.hintMsg = '';
        this.hidDevices = []; // from backend scan

        // External HID data (via WebSocket)
        this._extAxes = null;  // [t, y, p, r] from external HID reader
        this._extConnected = false;

        // ── Load saved calibration ─────────────────────────────
        this._loadCalibration();

        // ── Fetch HID devices from backend ─────────────────────
        this._fetchHidDevices();

        // ── Listeners ──────────────────────────────────────────
        this._onKeyDown = this._onKeyDown.bind(this);
        this._onKeyUp = this._onKeyUp.bind(this);
        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);
        window.addEventListener('gamepadconnected', (e) => this._onGPConnect(e));
        window.addEventListener('gamepaddisconnected', (e) => this._onGPDisconnect(e));

        // Poll gamepads (some don't fire connect events reliably)
        this._pollTimer = setInterval(() => this._pollGamepads(), GAMEPAD_POLL_INTERVAL);
    }

    // ── Public read-only state ─────────────────────────────────
    get gamepadConnected() { return this._gpConnected; }
    get gamepadName()      { return this._gpName; }
    get calibrating()      { return this._calibrating; }

    // ── Keyboard ───────────────────────────────────────────────

    _onKeyDown(e) {
        if (e.repeat) return;

        // Calibration toggle (C key)
        if (e.code === 'KeyC' && !e.ctrlKey && !e.metaKey) {
            this._toggleCalibration();
            return;
        }

        const mapping = KEY_MAP[e.code];
        if (!mapping) return;
        e.preventDefault();
        const dir = mapping.value > 0 ? 'p' : 'n';
        this._keys[mapping.axis + '_' + dir] = true;
    }

    _onKeyUp(e) {
        const mapping = KEY_MAP[e.code];
        if (!mapping) return;
        e.preventDefault();
        const dir = mapping.value > 0 ? 'p' : 'n';
        this._keys[mapping.axis + '_' + dir] = false;
    }

    // ── Gamepad ────────────────────────────────────────────────

    _onGPConnect(e) {
        this._gpConnected = true;
        this._gpIndex = e.gamepad.index;
        this._gpName = e.gamepad.id;
        console.log(`Gamepad connected [${e.gamepad.index}]: ${e.gamepad.id}`);
    }

    _onGPDisconnect(e) {
        if (e.gamepad.index === this._gpIndex) {
            this._gpConnected = false;
            this._gpIndex = -1;
            this._gpName = '';
            console.log(`Gamepad disconnected [${e.gamepad.index}]`);
        }
    }

    /** Poll for gamepads that connected before the page loaded */
    _pollGamepads() {
        if (this._gpConnected && this._calibrating) return; // already have one

        const gps = navigator.getGamepads();
        for (const gp of gps) {
            if (gp && gp.connected && gp.mapping === 'standard') {
                if (!this._gpConnected) {
                    this._gpConnected = true;
                    this._gpIndex = gp.index;
                    this._gpName = gp.id;
                    console.log(`Gamepad detected [${gp.index}]: ${gp.id}`);
                }
                return;
            }
            // Also accept non-standard mapping (RC transmitters often don't have 'standard' mapping)
            if (gp && gp.connected && gp.axes.length >= 4) {
                if (!this._gpConnected) {
                    this._gpConnected = true;
                    this._gpIndex = gp.index;
                    this._gpName = gp.id;
                    console.log(`Controller detected [${gp.index}]: ${gp.id} (axes: ${gp.axes.length}, buttons: ${gp.buttons.length})`);
                }
                return;
            }
        }
    }

    // ── Calibration ────────────────────────────────────────────

    _toggleCalibration() {
        if (!this._gpConnected) {
            console.log('No controller connected — calibration skipped.');
            this._dispatchEvent('calibration-skipped');
            return;
        }

        if (!this._calibrating) {
            // Start calibration
            this._calibrating = true;
            this._calibSamples = {};
            ['throttle','pitch','roll','yaw'].forEach(a => {
                this._calibSamples[a] = { min: Infinity, max: -Infinity, sum: 0, count: 0 };
            });
            console.log('Calibration started! Move ALL sticks to their extremes (full circles). Press C again to finish.');
            this._dispatchEvent('calibration-start');
        } else {
            // Finish calibration
            this._calibrating = false;
            this._applyCalibration();
            console.log('Calibration saved!', this._calibration);
            this._dispatchEvent('calibration-end');
        }
    }

    _applyCalibration() {
        ['throttle','pitch','roll','yaw'].forEach((axis, i) => {
            const samples = this._calibSamples[axis];
            if (!samples || samples.count < 10) return; // not enough data

            const cal = this._calibration[axis];
            cal.rawMin = samples.min;
            cal.rawMax = samples.max;
            cal.center = samples.sum / samples.count;
            cal.deadzone = Math.max(0.02, (samples.max - samples.min) * 0.03);

            // Auto-detect: if center is far from 0, axis may be non-self-centering (RC throttle)
            // Also: if (max - center) / (center - min) ratio > 1.5 or < 0.67, it's asymmetric
            const rangeAbove = cal.rawMax - cal.center;
            const rangeBelow = cal.center - cal.rawMin;
            if (rangeBelow > rangeAbove * 2.5 || rangeAbove > rangeBelow * 2.5) {
                cal.rcThrottle = true;
            }
        });

        this._saveCalibration();
    }

    _saveCalibration() {
        const data = {};
        ['throttle','pitch','roll','yaw'].forEach(axis => {
            data[axis] = {
                rawMin: this._calibration[axis].rawMin,
                rawMax: this._calibration[axis].rawMax,
                center: this._calibration[axis].center,
                deadzone: this._calibration[axis].deadzone,
                rcThrottle: this._calibration[axis].rcThrottle,
            };
        });
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (e) { /* storage full or unavailable */ }
    }

    _loadCalibration() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const data = JSON.parse(raw);
            ['throttle','pitch','roll','yaw'].forEach(axis => {
                if (data[axis]) {
                    Object.assign(this._calibration[axis], data[axis]);
                }
            });
            console.log('Calibration loaded from storage.');
        } catch (e) { /* ignore */ }
    }

    /** Reset calibration to defaults */
    resetCalibration() {
        ['throttle','pitch','roll','yaw'].forEach(axis => {
            this._calibration[axis] = new AxisCalibration();
        });
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
        console.log('Calibration reset to defaults.');
        this._dispatchEvent('calibration-reset');
    }

    _dispatchEvent(name) {
        window.dispatchEvent(new CustomEvent('feitian:' + name, {
            detail: {
                calibrating: this._calibrating,
                connected: this._gpConnected,
                name: this._gpName,
                calibration: this._calibration,
            }
        }));
    }

    // ── Update (called every frame) ────────────────────────────

    update(dt) {
        // Keyboard
        this._target.throttle = (this._keys.throttle_p ? 1 : 0) + (this._keys.throttle_n ? -1 : 0);
        this._target.pitch    = (this._keys.pitch_p    ? 1 : 0) + (this._keys.pitch_n    ? -1 : 0);
        this._target.roll     = (this._keys.roll_p     ? 1 : 0) + (this._keys.roll_n     ? -1 : 0);
        this._target.yaw      = (this._keys.yaw_p      ? 1 : 0) + (this._keys.yaw_n      ? -1 : 0);

        // Gamepad
        if (this._gpConnected) {
            const gp = navigator.getGamepads()[this._gpIndex];
            if (gp) {
                const rawAxes = gp.axes;

                // Read each logical axis through calibration
                const readAxis = (name) => {
                    const idx = this._axisMap[name];
                    if (idx >= rawAxes.length) return 0;
                    let raw = rawAxes[idx];
                    // Clamp to reasonable range
                    raw = Math.max(-1.5, Math.min(1.5, raw));
                    return raw;
                };

                // In calibration mode, collect samples
                if (this._calibrating) {
                    ['throttle','pitch','roll','yaw'].forEach(name => {
                        const raw = readAxis(name);
                        const s = this._calibSamples[name];
                        if (!s) return;
                        s.min = Math.min(s.min, raw);
                        s.max = Math.max(s.max, raw);
                        s.sum += raw;
                        s.count++;
                    });
                }

                // Apply calibration
                const calThrottle = this._calibration.throttle.apply(readAxis('throttle'));
                const calPitch    = this._calibration.pitch.apply(readAxis('pitch'));
                const calRoll     = this._calibration.roll.apply(readAxis('roll'));
                const calYaw      = this._calibration.yaw.apply(readAxis('yaw'));

                // For RC throttle mode, map [-1, 1] → [0, 1]
                let throttleVal = calThrottle;
                if (this._calibration.throttle.rcThrottle) {
                    throttleVal = (calThrottle + 1) / 2;
                }

                // Only override keyboard if controller is actively used
                if (Math.abs(calPitch) > 0.01 || Math.abs(calRoll) > 0.01 || Math.abs(calYaw) > 0.01 || Math.abs(calThrottle) > 0.01) {
                    this._target.throttle = throttleVal;
                    this._target.pitch    = -calPitch;   // invert: stick up = nose down = negative pitch input
                    this._target.roll     = calRoll;
                    this._target.yaw      = calYaw;
                }
            } else {
                // Gamepad disconnected without event
                this._gpConnected = false;
                this._gpIndex = -1;
                this._gpName = '';
            }
        }

        // External HID axes (from WebSocket) override everything
        if (this._extAxes) {
            this._target.throttle = this._extAxes[0];
            this._target.yaw      = this._extAxes[1];
            this._target.pitch    = -this._extAxes[2];
            this._target.roll     = this._extAxes[3];
        }

        // Exponential smoothing
        const a = 1 - Math.exp(-this._smoothFactor * 60 * Math.min(dt, 0.05));
        this.throttle += (this._target.throttle - this.throttle) * a;
        this.pitch    += (this._target.pitch    - this.pitch)    * a;
        this.roll     += (this._target.roll     - this.roll)     * a;
        this.yaw      += (this._target.yaw      - this.yaw)      * a;
    }

    /** Write smoothed values into a physics state.input object */
    applyTo(stateInput) {
        stateInput.throttle = this.throttle;
        stateInput.pitch    = this.pitch;
        stateInput.roll     = this.roll;
        stateInput.yaw      = this.yaw;
    }

    /** Feed axis data from external HID reader (WebSocket). axes = [t, y, p, r] each [-1,1] */
    setExternalAxes(axes) {
        this._extAxes = axes;
        this._extConnected = true;
    }

    clearExternalAxes() {
        this._extAxes = null;
        this._extConnected = false;
    }

    /** Query backend for HID devices at the OS level */
    async _fetchHidDevices() {
        try {
            const resp = await fetch('/api/controllers');
            const data = await resp.json();
            this.hidDevices = data.controllers || [];

            if (this.hidDevices.length > 0 && !this._gpConnected) {
                this.hintMsg = `Found ${this.hidDevices.length} HID device(s) — connect & press C to calibrate`;
                setTimeout(() => { if (this.hintMsg === `Found ${this.hidDevices.length} HID device(s) — connect & press C to calibrate`) this.hintMsg = ''; }, 8000);
            }
        } catch (e) {
            // Backend not available (browser dev mode), ignore
        }
    }

    destroy() {
        window.removeEventListener('keydown', this._onKeyDown);
        window.removeEventListener('keyup', this._onKeyUp);
        clearInterval(this._pollTimer);
    }
}
