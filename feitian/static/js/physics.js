// physics.js — Multi-rotor flight dynamics engine

import * as THREE from 'three';

/**
 * Physics constants for a typical 5-inch FPV quadcopter.
 * All values in SI units (meters, kg, seconds).
 */
export const CONFIG = {
    mass: 0.7,             // kg — typical 5" quad
    armLength: 0.18,       // m — motor distance from center
    maxThrust: 4.5,        // N per motor at full throttle (~460g thrust per motor)
    gravity: 9.81,         // m/s²

    // Aerodynamic drag coefficients
    dragLinear: 0.3,       // linear drag (low speed)
    dragAngular: 1.8,      // angular drag

    // Flight controller stabilization (simulated PD gains)
    stabP: 12.0,           // proportional gain on angular rate
    stabD: 2.5,            // derivative damping

    // Yaw authority
    yawTorquePerThrust: 0.015,  // Nm per N thrust difference (torque from prop rotation)

    // Ground
    groundLevel: 0.0,
    groundSpring: 120,     // spring constant when hitting ground
    groundDamping: 15,     // damping when hitting ground
};

/**
 * Mix pilot inputs into per-motor throttles [0, 1].
 *
 * + configuration motor layout:
 *     M0 = front (+Z), M1 = right (+X), M2 = rear (-Z), M3 = left (-X)
 *
 * Inputs (all normalized [-1, 1]):
 *   throttle: base thrust
 *   pitch:    nose up/down (M0 vs M2)
 *   roll:     tilt right/left (M1 vs M3)
 *   yaw:      rotate CW/CCW (M0+M2 vs M1+M3)
 */
export function mixThrottles(input) {
    const t = Math.max(0, Math.min(1, input.throttle));
    const p = Math.max(-1, Math.min(1, input.pitch));
    const r = Math.max(-1, Math.min(1, input.roll));
    const y = Math.max(-1, Math.min(1, input.yaw));

    // + config mix. Scale t down so we have headroom for control.
    const base = t * 0.85;

    let m0 = base - p + y;           // front: pitch down (nose up via lower front), yaw CW
    let m1 = base + r - y;           // right: roll right, yaw CCW
    let m2 = base + p + y;           // rear:  pitch up, yaw CW
    let m3 = base - r - y;           // left:  roll left, yaw CCW

    // Clamp to [0, 1]
    return [m0, m1, m2, m3].map(v => Math.max(0, Math.min(1, v)));
}

/**
 * Compute forces and torques from motor throttles and current angular velocity.
 *
 * Returns { force: THREE.Vector3, torque: THREE.Vector3 }
 */
export function computeForces(throttles, angularVelocity, droneQuat) {
    const cfg = CONFIG;

    // Compute thrust per motor
    const thrusts = throttles.map(t => t * cfg.maxThrust);

    // Total thrust in body frame (up = +Y)
    const totalThrust = thrusts.reduce((a, b) => a + b, 0);
    const forceBody = new THREE.Vector3(0, totalThrust, 0);

    // Convert to world frame
    const forceWorld = forceBody.clone().applyQuaternion(droneQuat);

    // Gravity
    forceWorld.y -= cfg.mass * cfg.gravity;

    // Linear drag (opposite velocity direction, computed in update step)
    // (We don't have velocity here — drag is applied in the step function)

    // Torques in body frame
    const a = cfg.armLength;

    // + config:
    // Pitch torque (around X axis): M0(-) vs M2(+) → M2 pushes nose up, M0 pushes nose down
    const pitchTorque = (thrusts[2] - thrusts[0]) * a;

    // Roll torque (around Z axis): M1(+) vs M3(-) → M1 pushes right side up
    const rollTorque = (thrusts[1] - thrusts[3]) * a;

    // Yaw torque (around Y axis): net reaction torque from prop rotation
    // Assume M0,M2 are CW (positive Y torque on body), M1,M3 are CCW (negative)
    const yawTorque = ((thrusts[0] + thrusts[2]) - (thrusts[1] + thrusts[3])) * cfg.yawTorquePerThrust;

    const torque = new THREE.Vector3(pitchTorque, yawTorque, rollTorque);

    // Angular damping (flight controller stabilisation)
    // This simulates the PID loop fighting to keep angular rates at desired setpoint
    torque.x -= cfg.stabD * angularVelocity.x;
    torque.y -= cfg.stabD * angularVelocity.y;
    torque.z -= cfg.stabD * angularVelocity.z;

    return { force: forceWorld, torque };
}

/**
 * Advance the physics state by dt seconds.
 * Modifies state in place.
 */
export function stepPhysics(state, dt) {
    const cfg = CONFIG;

    // Clamp dt to prevent explosions
    const clampedDt = Math.min(dt, 0.033); // ~30 FPS minimum
    if (clampedDt <= 0) return;

    // Mix inputs → throttles
    const throttles = mixThrottles(state.input);
    state.throttles = throttles;

    const droneQuat = new THREE.Quaternion().setFromEuler(state.rotation);

    // Compute forces
    const { force, torque } = computeForces(throttles, state.angularVelocity, droneQuat);

    // Linear acceleration
    const accel = force.clone().divideScalar(cfg.mass);
    // Add drag
    accel.x -= cfg.dragLinear * state.velocity.x;
    accel.y -= cfg.dragLinear * state.velocity.y * 0.2; // less vertical drag
    accel.z -= cfg.dragLinear * state.velocity.z;

    // Semi-implicit Euler integration (velocity first, then position)
    state.velocity.add(accel.clone().multiplyScalar(clampedDt));
    state.position.add(state.velocity.clone().multiplyScalar(clampedDt));

    // ── Ground collision ──────────────────────────────────────
    if (state.position.y < cfg.groundLevel + 0.15) {
        state.position.y = cfg.groundLevel + 0.15;
        if (state.velocity.y < 0) {
            state.velocity.y *= -0.3; // bounce with energy loss
        }
        // Friction on ground
        state.velocity.x *= 0.92;
        state.velocity.z *= 0.92;
    }

    // ── Angular ───────────────────────────────────────────────
    // Angular acceleration
    const I = 0.005; // approximate moment of inertia
    const angularAccel = torque.clone().divideScalar(I);

    // Angular drag
    angularAccel.x -= cfg.dragAngular * state.angularVelocity.x;
    angularAccel.y -= cfg.dragAngular * state.angularVelocity.y;
    angularAccel.z -= cfg.dragAngular * state.angularVelocity.z;

    state.angularVelocity.add(angularAccel.clone().multiplyScalar(clampedDt));

    // Update rotation
    state.rotation.x += state.angularVelocity.x * clampedDt;
    state.rotation.y += state.angularVelocity.y * clampedDt;
    state.rotation.z += state.angularVelocity.z * clampedDt;

    // Keep yaw in [-PI, PI]
    while (state.rotation.y > Math.PI) state.rotation.y -= Math.PI * 2;
    while (state.rotation.y < -Math.PI) state.rotation.y += Math.PI * 2;

    // Clamp pitch and roll to ±80°
    const maxTilt = 1.4; // ~80 degrees
    state.rotation.x = Math.max(-maxTilt, Math.min(maxTilt, state.rotation.x));
    state.rotation.z = Math.max(-maxTilt, Math.min(maxTilt, state.rotation.z));
}
