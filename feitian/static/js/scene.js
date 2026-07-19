// scene.js — Three.js scene, renderer, camera, lights, sky

import * as THREE from 'three';

/** @type {THREE.WebGLRenderer} */
let renderer;

/** @type {THREE.PerspectiveCamera} */
let camera;

/** @type {THREE.Scene} */
let scene;

/** @type {HTMLCanvasElement} */
let canvas;

export function initScene() {
    const container = document.getElementById('app');
    container.innerHTML = '';

    // ── Renderer ──────────────────────────────────────────────
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    canvas = renderer.domElement;
    container.appendChild(canvas);

    // ── Scene ─────────────────────────────────────────────────
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb); // sky blue
    scene.fog = new THREE.Fog(0x87ceeb, 200, 800);

    // ── Camera (third person) ─────────────────────────────────
    camera = new THREE.PerspectiveCamera(
        70,
        window.innerWidth / window.innerHeight,
        0.5,
        1500
    );
    camera.position.set(0, 6, 15);
    camera.lookAt(0, 2, 0);

    // ── Lights ────────────────────────────────────────────────
    // Ambient
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);

    // Directional (sun)
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(100, 150, 80);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 600;
    sun.shadow.camera.left = -80;
    sun.shadow.camera.right = 80;
    sun.shadow.camera.top = 80;
    sun.shadow.camera.bottom = -80;
    sun.shadow.bias = -0.0001;
    scene.add(sun);

    // Hemisphere (ground/sky blend)
    const hemi = new THREE.HemisphereLight(0x87ceeb, 0x3a6b35, 0.4);
    scene.add(hemi);

    // ── Resize handler ────────────────────────────────────────
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    return { scene, camera, renderer };
}

export function getCanvas() { return canvas; }
export function getScene() { return scene; }
export function getCamera() { return camera; }
export function getRenderer() { return renderer; }
