// drone.js — Quadcopter 3D model

import * as THREE from 'three';

/**
 * Build a quadcopter model.
 *
 * Layout (top-down X-Z plane):
 *     front (0°)
 *        [M0]
 *     \   |   /
 *   [M3]-[HUB]-[M1]
 *     /   |   \
 *        [M2]
 *     rear (180°)
 *
 * M0/M2 arms along X axis, M1/M3 arms along Z axis.
 *
 * Returns an object with:
 *   - group: THREE.Group (the whole drone, origin at center of mass)
 *   - rotors: [THREE.Group, ...] (4 rotor discs, spin around local Y)
 *   - body: THREE.Mesh
 */

const BODY_COLOR = 0x2a2a3a;
const ARM_COLOR = 0x3a3a4a;
const ROTOR_COLOR = 0xcccccc;
const HUB_RADIUS = 0.25;
const HUB_HEIGHT = 0.2;
const ARM_LENGTH = 1.2;
const ARM_WIDTH = 0.1;
const ARM_HEIGHT = 0.08;
const MOTOR_RADIUS = 0.16;
const MOTOR_HEIGHT = 0.12;
const ROTOR_RADIUS = 1.0;

export function createDrone() {
    const group = new THREE.Group();
    const rotors = [];

    // ── Central hub ──────────────────────────────────────────
    const hubGeo = new THREE.CylinderGeometry(HUB_RADIUS, HUB_RADIUS, HUB_HEIGHT, 16);
    const hubMat = new THREE.MeshStandardMaterial({ color: BODY_COLOR, roughness: 0.4, metalness: 0.6 });
    const hub = new THREE.Mesh(hubGeo, hubMat);
    hub.position.y = HUB_HEIGHT / 2;
    hub.castShadow = true;
    hub.receiveShadow = true;
    group.add(hub);

    // ── Arms + motors ────────────────────────────────────────
    const armGeo = new THREE.BoxGeometry(ARM_LENGTH, ARM_HEIGHT, ARM_WIDTH);

    // Rotor frame (thin ring)
    const rotorFrameGeo = new THREE.TorusGeometry(ROTOR_RADIUS, 0.04, 8, 24);
    const rotorFrameMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.3, metalness: 0.5 });

    const armConfigs = [
        { rx: 0, rz: 0, color: 0xff4444 },          // M0 front (red)  — along +Z
        { rx: 0, rz: Math.PI / 2, color: 0x44ff44 }, // M1 right (green) — along +X
        { rx: 0, rz: Math.PI, color: 0xffff44 },     // M2 rear  (yellow)
        { rx: 0, rz: -Math.PI / 2, color: 0x44ffff },// M3 left  (cyan) — along -X
    ];

    armConfigs.forEach((cfg, i) => {
        // Arm
        const armMat = new THREE.MeshStandardMaterial({ color: ARM_COLOR, roughness: 0.5, metalness: 0.4 });
        const arm = new THREE.Mesh(armGeo, armMat);
        arm.position.y = HUB_HEIGHT;
        arm.position.z = ARM_LENGTH / 2 - HUB_RADIUS / 2; // offset from center
        arm.rotation.set(cfg.rx, 0, cfg.rz);
        arm.castShadow = true;
        arm.receiveShadow = true;
        group.add(arm);

        // Motor housing
        const motorGeo = new THREE.CylinderGeometry(MOTOR_RADIUS, MOTOR_RADIUS * 1.1, MOTOR_HEIGHT, 12);
        const motorMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.3, metalness: 0.7 });
        const motor = new THREE.Mesh(motorGeo, motorMat);

        // Position at end of arm
        const armEndDist = ARM_LENGTH - HUB_RADIUS / 2;
        const angle = (i * Math.PI) / 2; // 0, PI/2, PI, 3PI/2
        motor.position.set(
            Math.sin(angle) * armEndDist,
            HUB_HEIGHT + MOTOR_HEIGHT / 2,
            Math.cos(angle) * armEndDist
        );
        motor.castShadow = true;
        group.add(motor);

        // Rotor disc group (spins around local Y)
        const rotorGroup = new THREE.Group();
        rotorGroup.position.copy(motor.position);
        rotorGroup.position.y += MOTOR_HEIGHT / 2 + 0.05;

        // Rotor disc
        const rotorGeo = new THREE.CylinderGeometry(ROTOR_RADIUS, ROTOR_RADIUS, 0.02, 32);
        const rotorMat = new THREE.MeshStandardMaterial({
            color: cfg.color,
            roughness: 0.5,
            transparent: true,
            opacity: 0.7,
            side: THREE.DoubleSide,
        });
        const rotorDisc = new THREE.Mesh(rotorGeo, rotorMat);
        rotorGroup.add(rotorDisc);

        // Rotor frame ring
        const frameRing = new THREE.Mesh(rotorFrameGeo, rotorFrameMat);
        rotorGroup.add(frameRing);

        group.add(rotorGroup);
        rotors.push(rotorGroup);
    });

    // ── Camera mount (small indicator on front) ──────────────
    const camGeo = new THREE.SphereGeometry(0.06, 8, 8);
    const camMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2, metalness: 0.8 });
    const fpvCam = new THREE.Mesh(camGeo, camMat);
    fpvCam.position.set(0, HUB_HEIGHT + 0.05, 0.35);
    group.add(fpvCam);

    // ── Landing gear nubs ────────────────────────────────────
    const footGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.3, 8);
    const footMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
    [[0.25, 0, 0.25], [-0.25, 0, 0.25], [0.25, 0, -0.25], [-0.25, 0, -0.25]].forEach(([x, y, z]) => {
        const foot = new THREE.Mesh(footGeo, footMat);
        foot.position.set(x, y - 0.15, z);
        foot.castShadow = true;
        group.add(foot);
    });

    return { group, rotors };
}
