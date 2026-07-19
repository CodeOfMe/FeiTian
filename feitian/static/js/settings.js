// settings.js — Controller settings panel (Escape to toggle)

const SETTINGS_KEY = 'feitian_settings';

// Mode presets: [throttle, yaw, pitch, roll] physical axis indices
const MODE_PRESETS = {
    1: { throttle: 3, yaw: 0, pitch: 3, roll: 2 },  // Right stick throttle+pitch
    2: { throttle: 1, yaw: 0, pitch: 3, roll: 2 },  // Left stick throttle+yaw ← default
    3: { throttle: 3, yaw: 2, pitch: 1, roll: 0 },
    4: { throttle: 1, yaw: 2, pitch: 3, roll: 0 },
};

export class SettingsPanel {
    constructor(inputState) {
        this._input = inputState;
        this._settings = this._load();
        this._mode = this._settings.mode || 2;

        this._buildDOM();
        this._bindKeys();
        this._syncFromInput();

        // Apply saved settings to input
        this._applyToInput();
    }

    // ── Load / Save ──────────────────────────────────────────

    _load() {
        try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            if (raw) return JSON.parse(raw);
        } catch (e) { /* ignore */ }
        return { mode: 2, rcThrottle: false, deadzone: 0.08, smooth: 0.18 };
    }

    _save() {
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this._settings)); } catch (e) {}
    }

    _applyToInput() {
        const preset = MODE_PRESETS[this._mode];
        Object.assign(this._input._axisMap, preset);

        ['throttle','pitch','roll','yaw'].forEach(axis => {
            this._input._calibration[axis].deadzone = this._settings.deadzone;
        });
        this._input._calibration.throttle.rcThrottle = this._settings.rcThrottle;
        this._input._smoothFactor = this._settings.smooth;
    }

    // ── DOM ──────────────────────────────────────────────────

    _buildDOM() {
        const overlay = document.createElement('div');
        overlay.id = 'feitian-settings-overlay';
        overlay.className = 'hidden';
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.hide();
        });

        overlay.innerHTML = `
        <div id="feitian-settings">
          <h2>⚙ 遥控器设置 <button class="close-btn" id="settings-close">✕</button></h2>
          <div class="settings-body">
            <div class="settings-section" id="sect-controller">
              <h3>🎮 控制器状态</h3>
              <div class="ctrl-info">
                <span class="status-dot" id="ctrl-dot"></span>
                <span class="name" id="ctrl-name">未检测到控制器</span>
              </div>
              <div class="hint-text" id="ctrl-hid-hint"></div>
            </div>

            <div class="settings-section">
              <h3>📐 操控模式</h3>
              <div class="mode-btns" id="mode-btns">
                <button class="mode-btn" data-mode="1">Mode 1<br><small>右手油门</small></button>
                <button class="mode-btn active" data-mode="2">Mode 2<br><small>左手油门</small></button>
                <button class="mode-btn" data-mode="3">Mode 3<br><small>右手油门</small></button>
                <button class="mode-btn" data-mode="4">Mode 4<br><small>左手油门</small></button>
              </div>
            </div>

            <div class="settings-section">
              <h3>📊 实时通道</h3>
              <div id="axis-bars">
                ${['油门','偏航','俯仰','横滚'].map((name, i) => `
                  <div class="axis-row">
                    <span class="label">${name}</span>
                    <div class="bar-wrap">
                      <div class="bar-center"></div>
                      <div class="bar-fill" id="bar-${i}" style="width:0%"></div>
                    </div>
                    <span class="value" id="val-${i}">0.00</span>
                    <select class="map-select" id="map-${i}">
                      <option value="0">轴 0</option><option value="1">轴 1</option>
                      <option value="2">轴 2</option><option value="3">轴 3</option>
                      <option value="4">轴 4</option><option value="5">轴 5</option>
                    </select>
                  </div>
                `).join('')}
              </div>
            </div>

            <div class="settings-section">
              <h3>🔧 校准</h3>
              <div class="calib-status" id="calib-status">
                <span class="ready">● 已校准</span>
              </div>
              <div class="calib-btns">
                <button class="primary" id="btn-calib-start">开始校准</button>
                <button id="btn-calib-reset">恢复默认</button>
              </div>
              <div class="hint-text">校准：按开始后，将摇杆推到所有极限位置画圈，再按完成</div>
            </div>

            <div class="settings-section">
              <h3>🎛 参数调整</h3>
              <div class="setting-row">
                <span class="slabel">死区</span>
                <input type="range" id="slider-deadzone" min="0" max="30" value="8" step="1">
                <span class="sval" id="sval-deadzone">8%</span>
              </div>
              <div class="setting-row">
                <span class="slabel">平滑度</span>
                <input type="range" id="slider-smooth" min="5" max="50" value="18" step="1">
                <span class="sval" id="sval-smooth">0.18</span>
              </div>
              <div class="toggle-row">
                <input type="checkbox" id="toggle-rc-throttle">
                <label for="toggle-rc-throttle">RC 油门模式（非自回中油门杆）</label>
              </div>
            </div>
          </div>
          <div class="settings-bottom">
            <button id="btn-reset-settings">恢复默认设置</button>
            <button class="primary" id="btn-close-settings">完成</button>
          </div>
        </div>`;

        document.body.appendChild(overlay);
        this._overlay = overlay;
        this._bindDOM();
    }

    _bindDOM() {
        const $ = (sel) => this._overlay.querySelector(sel);

        $('#settings-close').addEventListener('click', () => this.hide());
        $('#btn-close-settings').addEventListener('click', () => this.hide());

        // Mode buttons
        $('#mode-btns').addEventListener('click', (e) => {
            const btn = e.target.closest('.mode-btn');
            if (!btn) return;
            this._mode = parseInt(btn.dataset.mode);
            this._overlay.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            this._applyToInput();
            this._settings.mode = this._mode;
            this._save();
            this._syncMapSelects();
        });

        // Axis map selects
        ['throttle','yaw','pitch','roll'].forEach((name, i) => {
            $(`#map-${i}`).addEventListener('change', () => {
                const val = parseInt($(`#map-${i}`).value);
                this._input._axisMap[name] = val;
            });
        });

        // Calibration
        $('#btn-calib-start').addEventListener('click', () => {
            if (this._input._calibrating) {
                this._input._toggleCalibration(); // finish
                $('#btn-calib-start').textContent = '开始校准';
                $('#calib-status').innerHTML = '<span class="ready">● 已校准</span>';
            } else {
                this._input._toggleCalibration(); // start
                $('#btn-calib-start').textContent = '完成校准';
                $('#calib-status').innerHTML = '<span class="active">◉ 校准中 — 摇动所有摇杆到极限...</span>';
            }
        });
        $('#btn-calib-reset').addEventListener('click', () => {
            this._input.resetCalibration();
            $('#calib-status').innerHTML = '<span class="ready">● 已重置为默认</span>';
        });

        // Sliders
        const bindSlider = (id, key, fmt) => {
            const slider = $(`#slider-${id}`);
            const display = $(`#sval-${id}`);
            slider.value = this._settings[key] * (id === 'deadzone' ? 100 : 100);
            display.textContent = fmt(this._settings[key]);
            slider.addEventListener('input', () => {
                const raw = parseInt(slider.value);
                const val = id === 'deadzone' ? raw / 100 : raw / 100;
                this._settings[key] = val;
                display.textContent = fmt(val);
                this._applyToInput();
                this._save();
            });
        };
        bindSlider('deadzone', 'deadzone', v => Math.round(v * 100) + '%');
        bindSlider('smooth', 'smooth', v => v.toFixed(2));

        // RC throttle toggle
        const toggle = $('#toggle-rc-throttle');
        toggle.checked = this._settings.rcThrottle;
        toggle.addEventListener('change', () => {
            this._settings.rcThrottle = toggle.checked;
            this._applyToInput();
            this._save();
        });

        // Reset all
        $('#btn-reset-settings').addEventListener('click', () => {
            this._settings = { mode: 2, rcThrottle: false, deadzone: 0.08, smooth: 0.18 };
            this._mode = 2;
            this._save();
            this._applyToInput();
            this._input.resetCalibration();
            this._syncToDOM();
        });
    }

    _bindKeys() {
        window.addEventListener('keydown', (e) => {
            if (e.code === 'Escape') {
                e.preventDefault();
                this.toggle();
            }
        });
    }

    // ── Sync ──────────────────────────────────────────────────

    _syncToDOM() {
        const $ = (sel) => this._overlay.querySelector(sel);

        // Mode
        this._overlay.querySelectorAll('.mode-btn').forEach(b => {
            b.classList.toggle('active', parseInt(b.dataset.mode) === this._mode);
        });

        // RC throttle
        $('#toggle-rc-throttle').checked = this._settings.rcThrottle;

        // Sliders
        $('#slider-deadzone').value = Math.round(this._settings.deadzone * 100);
        $('#sval-deadzone').textContent = Math.round(this._settings.deadzone * 100) + '%';
        $('#slider-smooth').value = Math.round(this._settings.smooth * 100);
        $('#sval-smooth').textContent = this._settings.smooth.toFixed(2);

        this._syncMapSelects();
    }

    _syncMapSelects() {
        const $ = (sel) => this._overlay.querySelector(sel);
        ['throttle','yaw','pitch','roll'].forEach((name, i) => {
            $(`#map-${i}`).value = this._input._axisMap[name] ?? i;
        });
    }

    _syncFromInput() {
        if (this._input._calibration) {
            const cal = this._input._calibration;
            this._settings.rcThrottle = cal.throttle.rcThrottle;
            this._settings.deadzone = cal.throttle.deadzone;
        }
        this._syncToDOM();
    }

    // ── Update every frame ───────────────────────────────────

    update() {
        if (this._overlay.classList.contains('hidden')) return;

        const $ = (sel) => this._overlay.querySelector(sel);

        // Controller status
        const dot = $('#ctrl-dot');
        const name = $('#ctrl-name');
        const hint = $('#ctrl-hid-hint');

        if (this._input.gamepadConnected) {
            dot.className = 'status-dot connected';
            name.innerHTML = this._input.gamepadName || 'Controller';
        } else {
            dot.className = 'status-dot';
            name.textContent = '未检测到控制器 — 请连接 USB 遥控器或手柄';
        }

        // HID devices from backend
        if (this._input.hidDevices && this._input.hidDevices.length > 0) {
            const devNames = this._input.hidDevices.slice(0, 5).map(d => d.name).join(' · ');
            hint.textContent = `系统检测到 ${this._input.hidDevices.length} 个 HID 设备: ${devNames}`;
        } else {
            hint.textContent = '';
        }

        // Calibration status
        if (this._input._calibrating) {
            $('#btn-calib-start').textContent = '完成校准';
            $('#calib-status').innerHTML = '<span class="active">◉ 校准中 — 摇动所有摇杆到极限...</span>';
        } else {
            $('#btn-calib-start').textContent = '开始校准';
        }

        // Axis bars
        if (this._input.gamepadConnected) {
            const gp = navigator.getGamepads()[this._input._gpIndex];
            if (gp && gp.axes) {
                ['throttle','yaw','pitch','roll'].forEach((name, i) => {
                    const idx = this._input._axisMap[name] ?? i;
                    const raw = (idx < gp.axes.length) ? gp.axes[idx] : 0;
                    const clamped = Math.max(-1, Math.min(1, raw));
                    const pct = Math.round((clamped + 1) * 50);
                    $(`#bar-${i}`).style.width = pct + '%';
                    $(`#val-${i}`).textContent = clamped.toFixed(2);
                });
            }
        } else {
            for (let i = 0; i < 4; i++) {
                $(`#bar-${i}`).style.width = '50%';
                $(`#val-${i}`).textContent = '0.00';
            }
        }
    }

    // ── Show / Hide ──────────────────────────────────────────

    toggle() {
        this._overlay.classList.toggle('hidden');
        if (!this._overlay.classList.contains('hidden')) {
            this._syncToDOM();
        }
    }

    show() { this._overlay.classList.remove('hidden'); this._syncToDOM(); }
    hide() { this._overlay.classList.add('hidden'); }

    get visible() { return !this._overlay.classList.contains('hidden'); }
}
