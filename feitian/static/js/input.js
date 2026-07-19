// input.js — Keyboard + Gamepad input handler for FPV drone

/**
 * Key mappings (Mode 2 style for FPV drones):
 *
 *   Throttle:  W / S
 *   Pitch:     ArrowUp / ArrowDown  (nose forward/back)
 *   Roll:      ArrowLeft / ArrowRight (tilt left/right, but this is yaw for some...)
 *
 * Let's use a more intuitive layout:
 *   Arrow Up/Down  → Pitch  (forward/back tilt)
 *   Arrow Left/Right → Roll (left/right tilt)
 *   W / S          → Throttle (up/down)
 *   A / D          → Yaw (rotate)
 *   Space / Shift  → Alt Throttle
 *   Q / E          → Alt Yaw
 *   V              → Camera toggle
 *   R              → Reset
 */

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

const GAMEPAD_DEADZONE = 0.12;

/**
 * InputState tracks raw input and applies smoothing.
 */
export class InputState {
    constructor() {
        // Raw target values [-1, 1] from keys/gamepad
        this._target = { throttle: 0, pitch: 0, roll: 0, yaw: 0 };
        // Smoothed output values
        this.throttle = 0;
        this.pitch = 0;
        this.roll = 0;
        this.yaw = 0;

        // Per-axis key tracking: positive key held, negative key held
        this._keys = { throttle_p: false, throttle_n: false, pitch_p: false, pitch_n: false,
                       roll_p: false, roll_n: false, yaw_p: false, yaw_n: false };

        this._gamepadConnected = false;
        this._gamepadIndex = -1;
        this._smoothFactor = 0.15; // higher = faster response

        this._onKeyDown = this._onKeyDown.bind(this);
        this._onKeyUp = this._onKeyUp.bind(this);

        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);
        window.addEventListener('gamepadconnected', (e) => this._onGamepadConnect(e));
        window.addEventListener('gamepaddisconnected', (e) => this._onGamepadDisconnect(e));
    }

    // ── Keyboard ─────────────────────────────────────────────

    _onKeyDown(e) {
        if (e.repeat) return;
        const mapping = KEY_MAP[e.code];
        if (!mapping) return;
        e.preventDefault();

        const dir = mapping.value > 0 ? 'p' : 'n';
        this._keys[`${mapping.axis}_${dir}`] = true;
    }

    _onKeyUp(e) {
        const mapping = KEY_MAP[e.code];
        if (!mapping) return;
        e.preventDefault();

        const dir = mapping.value > 0 ? 'p' : 'n';
        this._keys[`${mapping.axis}_${dir}`] = false;
    }

    // ── Gamepad ──────────────────────────────────────────────

    _onGamepadConnect(e) {
        this._gamepadConnected = true;
        this._gamepadIndex = e.gamepad.index;
        console.log(`Gamepad connected: ${e.gamepad.id}`);
    }

    _onGamepadDisconnect(e) {
        if (e.gamepad.index === this._gamepadIndex) {
            this._gamepadConnected = false;
            this._gamepadIndex = -1;
        }
        console.log(`Gamepad disconnected: ${e.gamepad.id}`);
    }

    // ── Update (call every frame) ────────────────────────────

    update(dt) {
        // Start with keyboard
        this._target.throttle = (this._keys.throttle_p ? 1 : 0) + (this._keys.throttle_n ? -1 : 0);
        this._target.pitch    = (this._keys.pitch_p    ? 1 : 0) + (this._keys.pitch_n    ? -1 : 0);
        this._target.roll     = (this._keys.roll_p     ? 1 : 0) + (this._keys.roll_n     ? -1 : 0);
        this._target.yaw      = (this._keys.yaw_p      ? 1 : 0) + (this._keys.yaw_n      ? -1 : 0);

        // Gamepad overrides if connected
        if (this._gamepadConnected) {
            const gp = navigator.getGamepads()[this._gamepadIndex];
            if (gp) {
                const applyDeadzone = (v) => Math.abs(v) < GAMEPAD_DEADZONE ? 0 :
                    (v > 0 ? (v - GAMEPAD_DEADZONE) / (1 - GAMEPAD_DEADZONE)
                           : (v + GAMEPAD_DEADZONE) / (1 - GAMEPAD_DEADZONE));

                // Mode 2: left stick Y=throttle X=yaw, right stick Y=pitch X=roll
                const lt = applyDeadzone(-gp.axes[1]); // throttle — negative because up is -1
                const ly = applyDeadzone(gp.axes[0]);   // yaw
                const ry = applyDeadzone(-gp.axes[3]);  // pitch — negative because up is -1
                const rx = applyDeadzone(gp.axes[2]);   // roll

                if (Math.abs(lt) > 0.01) this._target.throttle = lt;
                if (Math.abs(ly) > 0.01) this._target.yaw = ly;
                if (Math.abs(ry) > 0.01) this._target.pitch = ry;
                if (Math.abs(rx) > 0.01) this._target.roll = rx;
            }
        }

        // Exponential smoothing
        const a = 1 - Math.exp(-this._smoothFactor * 60 * Math.min(dt, 0.05));
        this.throttle += (this._target.throttle - this.throttle) * a;
        this.pitch    += (this._target.pitch    - this.pitch)    * a;
        this.roll     += (this._target.roll     - this.roll)     * a;
        this.yaw      += (this._target.yaw      - this.yaw)      * a;
    }

    /** Read smoothed inputs into a state.input-compatible object */
    applyTo(stateInput) {
        stateInput.throttle = this.throttle;
        stateInput.pitch    = this.pitch;
        stateInput.roll     = this.roll;
        stateInput.yaw      = this.yaw;
    }

    destroy() {
        window.removeEventListener('keydown', this._onKeyDown);
        window.removeEventListener('keyup', this._onKeyUp);
    }
}
