// terrain.js — Procedural ground plane

import * as THREE from 'three';

/**
 * Create a flat ground plane with a grass-like texture.
 */
export function createTerrain(scene) {
    // Large flat ground
    const size = 400;
    const segments = 80;

    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);

    // Give it a subtle vertex displacement for a natural look
    const positions = geo.attributes.position;
    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const y = positions.getY(i);
        const dist = Math.sqrt(x * x + y * y);
        // Slight wobble, flatten near center (launch pad area)
        const wobble = (Math.sin(x * 0.3) * Math.cos(y * 0.3) * 0.4
                      + Math.sin(x * 0.7 + 1.5) * Math.cos(y * 0.5) * 0.25)
                      * Math.min(1, dist / 15);
        positions.setZ(i, wobble);
    }
    geo.computeVertexNormals();

    // Canvas-generated texture for ground
    const texCanvas = document.createElement('canvas');
    texCanvas.width = 512;
    texCanvas.height = 512;
    const ctx = texCanvas.getContext('2d');

    // Base green
    ctx.fillStyle = '#4a7c3f';
    ctx.fillRect(0, 0, 512, 512);

    // Grid pattern
    ctx.strokeStyle = '#3d6834';
    ctx.lineWidth = 1;
    for (let i = 0; i < 512; i += 32) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, 512);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(512, i);
        ctx.stroke();
    }

    // Some noise
    for (let i = 0; i < 2000; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        const shade = 60 + Math.random() * 60;
        ctx.fillStyle = `rgb(${shade},${shade + 30},${shade - 20})`;
        ctx.fillRect(x, y, 2, 2);
    }

    const texture = new THREE.CanvasTexture(texCanvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(20, 20);

    const mat = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.9,
        metalness: 0.0,
    });

    const ground = new THREE.Mesh(geo, mat);
    ground.receiveShadow = true;
    ground.name = 'terrain';
    scene.add(ground);

    // Launch pad marker (a circle on the ground at origin)
    const padGeo = new THREE.CylinderGeometry(1.2, 1.2, 0.02, 32);
    const padMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.6, metalness: 0.3 });
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.position.y = 0.01;
    pad.receiveShadow = true;
    scene.add(pad);

    // Ring around launch pad
    const ringGeo = new THREE.TorusGeometry(1.2, 0.05, 8, 48);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, emissive: 0x222222 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    ring.receiveShadow = true;
    scene.add(ring);

    // Some scattered trees (simple cones on cylinders)
    for (let i = 0; i < 80; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 20 + Math.random() * 180;
        // Skip launch pad area
        if (dist < 15) continue;
        const tx = Math.cos(angle) * dist;
        const tz = Math.sin(angle) * dist;
        createTree(scene, tx, getGroundHeight(tx, tz), tz);
    }

    return ground;
}

/** Approximate ground height at (x, z) from the vertex wobble formula */
function getGroundHeight(x, z) {
    const dist = Math.sqrt(x * x + z * z);
    const wobble = (Math.sin(x * 0.3) * Math.cos(z * 0.3) * 0.4
                  + Math.sin(x * 0.7 + 1.5) * Math.cos(z * 0.5) * 0.25)
                  * Math.min(1, dist / 15);
    return wobble;
}

function createTree(scene, x, y, z) {
    const group = new THREE.Group();

    const trunkH = 1.2 + Math.random() * 2.5;
    const trunkGeo = new THREE.CylinderGeometry(0.15, 0.25, trunkH, 6);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8b5e3c, roughness: 0.9 });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    group.add(trunk);

    const crownR = 0.8 + Math.random() * 1.5;
    const crownGeo = new THREE.SphereGeometry(crownR, 8, 6);
    const greenShade = 0x2d5a1e + Math.floor(Math.random() * 0x334400);
    const crownMat = new THREE.MeshStandardMaterial({ color: greenShade, roughness: 0.8 });
    const crown = new THREE.Mesh(crownGeo, crownMat);
    crown.position.y = trunkH + crownR * 0.5;
    crown.castShadow = true;
    crown.receiveShadow = true;
    group.add(crown);

    group.position.set(x, y, z);
    scene.add(group);
}
