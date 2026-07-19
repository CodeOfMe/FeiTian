// hud.js — Heads-Up Display overlay

/**
 * Render a HUD overlay on an HTML canvas element.
 * Displays: attitude indicator, altitude, vertical speed, throttle, speed,
 * camera mode, and control hints.
 */

export class HUD {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'hud';
        this.ctx = this.canvas.getContext('2d');

        // Style: fixed overlay on top of 3D canvas
        Object.assign(this.canvas.style, {
            position: 'fixed',
            top: '0', left: '0',
            width: '100%', height: '100%',
            pointerEvents: 'none',
            zIndex: '10',
        });

        document.body.appendChild(this.canvas);

        this._resize();
        window.addEventListener('resize', () => this._resize());

        // Controller info (updated from main)
        this.controllerName = '';
        this.controllerConnected = false;
        this.calibrating = false;
        this.calibrationMsg = '';
        this.hintMsg = '';
        this.hidDevices = [];

        // Listen for input events
        window.addEventListener('feitian:calibration-start', () => {
            this.calibrating = true;
            this.calibrationMsg = 'Move all sticks to extremes...';
        });
        window.addEventListener('feitian:calibration-end', () => {
            this.calibrating = false;
            this.calibrationMsg = 'Calibration saved!';
            setTimeout(() => { this.calibrationMsg = ''; }, 2000);
        });
        window.addEventListener('feitian:calibration-skipped', () => {
            this.calibrationMsg = 'No controller detected';
            setTimeout(() => { this.calibrationMsg = ''; }, 2000);
        });
        window.addEventListener('feitian:calibration-reset', () => {
            this.calibrationMsg = 'Calibration reset';
            setTimeout(() => { this.calibrationMsg = ''; }, 2000);
        });
    }

    _resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    /**
     * Draw the full HUD.
     * @param {Object} state — the simulation state
     */
    draw(state) {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;

        ctx.clearRect(0, 0, w, h);

        this._drawAttitudeIndicator(ctx, state, w, h);
        this._drawTelemetry(ctx, state, w, h);
        this._drawControlsHint(ctx, w, h);
        this._drawControllerStatus(ctx, w, h);
        this._drawCameraBadge(ctx, state, w, h);
    }

    // ── Attitude indicator (artificial horizon) ──────────────

    _drawAttitudeIndicator(ctx, state, w, h) {
        const cx = 140;
        const cy = h - 140;
        const r = 90;

        // Clip circle
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.clip();

        // Sky/ground fill
        const pitchDeg = state.rotation.x * (180 / Math.PI);
        const rollDeg = state.rotation.z * (180 / Math.PI);

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(-rollDeg * Math.PI / 180);

        // Sky
        const skyGrad = ctx.createLinearGradient(0, -r, 0, r);
        skyGrad.addColorStop(0, '#3b7dd8');
        skyGrad.addColorStop(0.48, '#7bb8f0');
        skyGrad.addColorStop(0.5, '#d4a040');
        skyGrad.addColorStop(0.52, '#b88830');
        skyGrad.addColorStop(1, '#6b4c1e');
        ctx.fillStyle = skyGrad;

        const pitchOffset = pitchDeg * 2.5; // pixels per degree
        ctx.fillRect(-r, -r + pitchOffset, r * 2, r * 2);

        // Horizon line
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-r, pitchOffset);
        ctx.lineTo(r, pitchOffset);
        ctx.stroke();

        // Pitch ladder
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1;
        ctx.font = '10px monospace';
        ctx.fillStyle = '#ffffff';
        for (let deg = -60; deg <= 60; deg += 10) {
            if (deg === 0) continue;
            const y = pitchOffset - deg * 2.5;
            if (Math.abs(y) > r + 20) continue;
            const len = deg % 20 === 0 ? 40 : 20;
            ctx.beginPath();
            ctx.moveTo(-len, y);
            ctx.lineTo(len, y);
            ctx.stroke();
            if (deg % 20 === 0) {
                ctx.fillText(String(deg), 25, y + 4);
                ctx.fillText(String(deg), -50, y + 4);
            }
        }

        ctx.restore(); // undo rotation

        // Outer ring
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Roll indicator ticks
        for (let deg = -60; deg <= 60; deg += 15) {
            const rad = (deg - 90) * Math.PI / 180;
            const x1 = cx + Math.cos(rad) * (r - 5);
            const y1 = cy + Math.sin(rad) * (r - 5);
            const x2 = cx + Math.cos(rad) * (r - 15);
            const y2 = cy + Math.sin(rad) * (r - 15);
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.strokeStyle = 'rgba(255,255,255,0.6)';
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        // Center aircraft symbol (fixed)
        ctx.strokeStyle = '#ffcc00';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - 20, cy);
        ctx.lineTo(cx - 8, cy);
        ctx.moveTo(cx + 8, cy);
        ctx.lineTo(cx + 20, cy);
        ctx.stroke();
        // Triangle
        ctx.beginPath();
        ctx.moveTo(cx, cy - 8);
        ctx.lineTo(cx + 6, cy + 3);
        ctx.lineTo(cx - 6, cy + 3);
        ctx.closePath();
        ctx.fillStyle = '#ffcc00';
        ctx.fill();

        ctx.restore(); // undo clip

        // Label
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = '11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('ATT', cx, cy - r - 8);
    }

    // ── Telemetry panel (bottom-right) ───────────────────────

    _drawTelemetry(ctx, state, w, h) {
        const alt = state.position.y.toFixed(1);
        const vs = state.velocity.y.toFixed(1);
        const speed = Math.sqrt(
            state.velocity.x ** 2 + state.velocity.z ** 2
        ).toFixed(1);
        const throttle = (state.throttles.reduce((a, b) => a + b, 0) / 4 * 100).toFixed(0);
        const pitch = (state.rotation.x * (180 / Math.PI)).toFixed(1);
        const roll = (state.rotation.z * (180 / Math.PI)).toFixed(1);
        const yaw = (state.rotation.y * (180 / Math.PI) % 360).toFixed(1);

        const x = w - 200;
        const y = 20;

        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1;
        roundRect(ctx, x, y, 185, 210, 10);
        ctx.fill();
        ctx.stroke();

        const lines = [
            { label: 'ALT', value: `${alt} m`, color: '#ffffff' },
            { label: 'V/S', value: `${vs} m/s`, color: vs > 0.5 ? '#4f8' : vs < -0.5 ? '#f44' : '#fff' },
            { label: 'SPD', value: `${speed} m/s`, color: '#ffffff' },
            { label: 'THR', value: `${throttle}%`, color: '#ffcc00' },
            { label: 'PIT', value: `${pitch}°`, color: '#ffffff' },
            { label: 'ROL', value: `${roll}°`, color: '#ffffff' },
            { label: 'YAW', value: `${yaw}°`, color: '#ffffff' },
        ];

        ctx.textAlign = 'right';
        lines.forEach((line, i) => {
            const ly = y + 25 + i * 26;
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.font = '11px monospace';
            ctx.fillText(line.label, x + 50, ly);
            ctx.fillStyle = line.color;
            ctx.font = 'bold 15px monospace';
            ctx.fillText(line.value, x + 170, ly);
        });

        ctx.restore();
    }

    // ── Controls hint (bottom-left) ──────────────────────────

    _drawControlsHint(ctx, w, h) {
        const x = 15;
        const y = h - 170;

        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        roundRect(ctx, x, y, 170, 120, 8);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '10px monospace';
        ctx.textAlign = 'left';
        const hints = [
            'W/S    Throttle',
            '\u2191\u2193     Pitch',
            '\u2190\u2192     Roll',
            'A/D    Yaw',
            'V      FPV/3rd',
            'C      Calibrate',
            'R      Reset',
        ];
        hints.forEach((hint, i) => {
            ctx.fillText(hint, x + 10, y + 18 + i * 18);
        });

        ctx.restore();
    }

    // ── Controller status (top-left) ─────────────────────────

    _drawControllerStatus(ctx, w, h) {
        const x = 15;
        let y = 15;

        ctx.save();
        ctx.font = 'bold 11px monospace';

        // Hint message
        if (this.hintMsg) {
            ctx.fillStyle = '#ffcc00';
            ctx.fillText(this.hintMsg, x, y + 12);
            y += 20;
        }

        if (this.calibrating) {
            const blink = Math.floor(performance.now() / 400) % 2 === 0;
            ctx.fillStyle = blink ? '#ffcc00' : '#ff8800';
            ctx.fillText('⚙ CALIBRATING — ' + this.calibrationMsg, x, y + 12);
        } else if (this.calibrationMsg) {
            ctx.fillStyle = '#4f8';
            ctx.fillText(this.calibrationMsg, x, y + 12);
        } else if (this.controllerConnected) {
            ctx.fillStyle = '#4f8';
            const shortName = this.controllerName.length > 40
                ? this.controllerName.slice(0, 37) + '...'
                : this.controllerName;
            ctx.fillText('🎮 ' + shortName, x, y + 12);
        } else if (this.hidDevices.length > 0) {
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            const names = this.hidDevices.slice(0, 3).map(d => d.name).join(', ');
            const more = this.hidDevices.length > 3 ? ` +${this.hidDevices.length - 3} more` : '';
            ctx.fillText(`🔍 HID: ${names}${more}`, x, y + 12);
        }

        ctx.restore();
    }

    // ── Camera mode badge (top-center) ───────────────────────

    _drawCameraBadge(ctx, state, w, h) {
        const mode = state.cameraMode === 'fpv' ? '● FPV' : '◉ 3RD PERSON';
        ctx.save();
        ctx.font = 'bold 13px monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fillText(mode, w / 2, 18);
        ctx.restore();
    }
}

/** Helper: rounded rectangle path */
function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}
