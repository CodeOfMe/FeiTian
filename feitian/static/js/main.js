// main.js — FeiTian 飞天: FPV Drone Simulator entry point & game loop

import * as THREE from 'three';
import { initScene, getScene, getCamera, getRenderer } from './scene.js';
import { createDrone } from './drone.js';
import { createTerrain } from './terrain.js';
import { stepPhysics } from './physics.js';
import { InputState } from './input.js';
import { HUD } from './hud.js';

// ── State ──────────────────────────────────────────────────────
const state = {
    // Drone physics state (will be driven by physics.js)
    position: new THREE.Vector3(0, 2.5, 0),
    velocity: new THREE.Vector3(0, 0, 0),
    rotation: new THREE.Euler(0, 0, 0, 'YXZ'), // Yaw(X) Pitch(X) Roll(Z)
    angularVelocity: new THREE.Vector3(0, 0, 0),

    // Motor throttle [0, 1] — 4 motors
    throttles: [0, 0, 0, 0],

    // Control inputs (normalized [-1, 1])
    input: {
        throttle: 0,
        pitch: 0,
        roll: 0,
        yaw: 0,
    },

    // Camera
    cameraMode: 'third', // 'third' | 'fpv'
    lastTime: performance.now(),
    dt: 0,
};

// ── Camera follow ──────────────────────────────────────────────
const cameraOffset = new THREE.Vector3(0, 3, -10);  // behind & above
const cameraLookAhead = new THREE.Vector3(0, 0, 5); // look ahead of drone

/** Smooth camera follow (third person) */
function updateThirdPersonCamera(droneGroup) {
    const cam = getCamera();

    // Compute desired position in world space
    const dronePos = droneGroup.position.clone();
    const droneQuat = new THREE.Quaternion().setFromEuler(state.rotation);

    const offset = cameraOffset.clone().applyQuaternion(droneQuat);
    const desiredPos = dronePos.clone().add(offset);
    desiredPos.y = Math.max(desiredPos.y, dronePos.y + 1.5); // don't go below drone

    // Look-at point: ahead of drone
    const lookTarget = dronePos.clone().add(
        new THREE.Vector3(0, 0.5, 2).applyQuaternion(droneQuat)
    );

    // Smooth interpolation
    const lerpFactor = 1 - Math.exp(-6 * state.dt);
    cam.position.lerp(desiredPos, lerpFactor);

    // Smooth look-at
    const currentLook = new THREE.Vector3();
    cam.getWorldDirection(currentLook);
    const desiredLook = lookTarget.clone().sub(cam.position).normalize();
    const smoothedLook = new THREE.Vector3().copy(currentLook).lerp(desiredLook, lerpFactor);
    const finalTarget = cam.position.clone().add(smoothedLook);
    cam.lookAt(finalTarget);
}

/** FPV camera — place at drone center, look forward */
function updateFPVCamera(droneGroup) {
    const cam = getCamera();
    const dronePos = droneGroup.position.clone();
    const droneQuat = new THREE.Quaternion().setFromEuler(state.rotation);
    const forward = new THREE.Vector3(0, 0.15, 0.5).applyQuaternion(droneQuat);

    cam.position.copy(dronePos.clone().add(new THREE.Vector3(0, 0.2, 0)));
    const lookAt = dronePos.clone().add(forward);
    cam.lookAt(lookAt);
}

// ── Initialization ─────────────────────────────────────────────
async function init() {
    const { scene } = initScene();

    // Hide loading text
    document.getElementById('app').style.display = 'none';

    // Terrain
    createTerrain(scene);

    // Drone
    const { group: droneGroup, rotors } = createDrone();
    droneGroup.position.copy(state.position);
    scene.add(droneGroup);

    // Store refs for game loop
    state.droneGroup = droneGroup;
    state.rotors = rotors;

    // Input handler
    const inputState = new InputState();

    // HUD
    const hud = new HUD();

    // ── Keyboard extras ──────────────────────────────────────
    window.addEventListener('keydown', (e) => {
        switch (e.code) {
            case 'KeyV':
                state.cameraMode = state.cameraMode === 'fpv' ? 'third' : 'fpv';
                break;
            case 'KeyR':
                // Reset drone
                state.position.set(0, 2.5, 0);
                state.velocity.set(0, 0, 0);
                state.rotation.set(0, 0, 0);
                state.angularVelocity.set(0, 0, 0);
                break;
        }
    });

    // ── Game loop ──────────────────────────────────────────────
    function animate(now) {
        requestAnimationFrame(animate);

        state.dt = Math.min((now - state.lastTime) / 1000, 0.05); // cap at 50ms
        state.lastTime = now;

        if (state.dt <= 0) return;

        // Read inputs
        inputState.update(state.dt);
        inputState.applyTo(state.input);

        stepPhysics(state, state.dt);

        // Update drone transform
        droneGroup.position.copy(state.position);
        droneGroup.rotation.copy(state.rotation);

        // Spin rotors — speed proportional to individual motor throttle
        rotors.forEach((rotor, i) => {
            rotor.rotation.y += (state.throttles[i] * 60 + 8) * state.dt;
        });

        // Camera
        if (state.cameraMode === 'fpv') {
            updateFPVCamera(droneGroup);
        } else {
            updateThirdPersonCamera(droneGroup);
        }

        // HUD
        hud.controllerConnected = inputState.gamepadConnected;
        hud.controllerName = inputState.gamepadName;
        hud.calibrating = inputState.calibrating;
        hud.draw(state);

        // Render
        getRenderer().render(scene, getCamera());
    }

    requestAnimationFrame(animate);
}

// ── Boot ───────────────────────────────────────────────────────
init().catch(console.error);
