// FeiTian 飞天 — app.js
const $ = s => document.querySelector(s);
const SET = 'feitian_settings';

let S = {
  mode: 2, deadzone: .08, smooth: .18, rcThr: false,
  ch: { throttle: 0, yaw: 2, pitch: 3, roll: 4 },
  inv: { throttle: false, yaw: false, pitch: false, roll: false },
  sub: { throttle: 0, yaw: 0, pitch: 0, roll: 0 },
  epl: { throttle: 100, yaw: 100, pitch: 100, roll: 100 },
  epr: { throttle: 100, yaw: 100, pitch: 100, roll: 100 }
};
try { const r = localStorage.getItem(SET); if (r) Object.assign(S, JSON.parse(r)); } catch (e) {}
function save() { try { localStorage.setItem(SET, JSON.stringify(S)); } catch (e) {} }

// ── HID WebSocket ──
let ws = null, pt = null, rawBytes = null, extAxes = null;

function hidOpen(vid, pid) {
  if (ws) { try { ws.send(JSON.stringify({ action: 'close' })); ws.close(); } catch (e) {} }
  clearInterval(pt);
  ws = new WebSocket(`ws://${location.host}/ws/controller`);
  ws.onopen = () => {
    ws.send(JSON.stringify({ action: 'open', vid, pid }));
    pt = setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ action: 'poll' })); }, 20);
  };
  ws.onmessage = e => {
    try {
      const m = JSON.parse(e.data);
      if (m.raw) rawBytes = m.raw;
      if (m.axes) extAxes = m.axes;
    } catch (err) {}
  };
  ws.onclose = () => { rawBytes = null; extAxes = null; };
}

// ── Setup UI ──
const NAMES = ['throttle', 'yaw', 'pitch', 'roll'];
const LABELS = ['油门', '偏航', '俯仰', '横滚'];

function buildChans() {
  let h = '';
  NAMES.forEach((n, i) => {
    h += `<div class="crow"><span class="cl">${LABELS[i]}</span><div class="cb"><div class="cf" id="cf-${n}"></div></div><span class="cv" id="cv-${n}">0.00</span><select id="cs-${n}">${[0,1,2,3,4,5,6,7].map(b => `<option value="${b}">B${b}</option>`).join('')}</select><input type="checkbox" id="ci-${n}" title="反向"><input type="number" id="ce-${n}" value="0" min="-127" max="127" style="width:42px" title="Subtrim"></div>`;
  });
  $('#chans').innerHTML = h;
  NAMES.forEach(n => {
    $('#cs-' + n).value = S.ch[n]; $('#ci-' + n).checked = S.inv[n]; $('#ce-' + n).value = S.sub[n];
    $('#cs-' + n).onchange = e => { S.ch[n] = +e.target.value; save(); };
    $('#ci-' + n).onchange = e => { S.inv[n] = e.target.checked; save(); };
    $('#ce-' + n).onchange = e => { S.sub[n] = +e.target.value || 0; save(); };
  });
}
buildChans();

function applyDom() {
  $('#mode').value = S.mode; $('#dz').value = Math.round(S.deadzone * 100); $('#dz-val').textContent = Math.round(S.deadzone * 100) + '%';
  $('#sm').value = Math.round(S.smooth * 100); $('#sm-val').textContent = S.smooth.toFixed(2); $('#rc-thr').checked = S.rcThr;
}
applyDom();

// Device selection
$('#devices').addEventListener('click', e => {
  const el = e.target.closest('.dev'); if (!el) return;
  $('#devices').querySelectorAll('.dev').forEach(x => x.classList.remove('sel'));
  el.classList.add('sel');
  hidOpen(el.dataset.vid, el.dataset.pid);
  localStorage.setItem('feitian_dev', JSON.stringify({ vid: el.dataset.vid, pid: el.dataset.pid, idx: +el.dataset.idx }));
});
try {
  const d = JSON.parse(localStorage.getItem('feitian_dev'));
  if (d) { const els = $('#devices').querySelectorAll('.dev'); if (els[d.idx]) { els[d.idx].classList.add('sel'); hidOpen(d.vid, d.pid); } }
} catch (e) {}

// Settings
$('#mode').onchange = e => { S.mode = +e.target.value; save(); };
$('#dz').oninput = e => { S.deadzone = +e.target.value / 100; $('#dz-val').textContent = e.target.value + '%'; save(); };
$('#sm').oninput = e => { S.smooth = +e.target.value / 100; $('#sm-val').textContent = S.smooth.toFixed(2); save(); };
$('#rc-thr').onchange = e => { S.rcThr = e.target.checked; save(); };
$('#btn-rescan').onclick = () => { fetch('/api/controllers').then(r => r.json()).then(d => { if (d.controllers) { window.__DEVICES__ = d.controllers; location.reload(); } }); };

// Auto-learn
let learn = null;
$('#btn-learn').onclick = () => {
  if (learn) { clearTimeout(learn.timer); finishLearn(); return; }
  learn = { data: Array.from({ length: 8 }, () => ({ min: 255, max: 0 })), start: Date.now() };
  $('#learn-status').textContent = '学习中... 摇杆画圈！'; $('#btn-learn').textContent = '完成';
  function poll() {
    if (!learn) return;
    const t = (Date.now() - learn.start) / 1000;
    $('#learn-status').textContent = `学习中... ${Math.max(0, (5 - t)).toFixed(1)}s`;
    if (t > 5) { finishLearn(); return; }
    if (rawBytes) rawBytes.forEach((b, i) => { if (b < learn.data[i].min) learn.data[i].min = b; if (b > learn.data[i].max) learn.data[i].max = b; });
    learn.timer = setTimeout(poll, 80);
  }
  poll();
};
function finishLearn() {
  const r = learn.data.map((d, i) => ({ i, r: d.max - d.min })).sort((a, b) => b.r - a.r);
  const top4 = r.slice(0, 4).map(x => x.i);
  NAMES.forEach((n, i) => { S.ch[n] = top4[i] ?? i * 2; }); save(); buildChans();
  $('#learn-status').textContent = '完成！映射: ' + top4.join(',');
  $('#btn-learn').textContent = '自动检测通道'; learn = null;
}

// Navigation
$('#btn-fly').onclick = fly;
window.addEventListener('keydown', e => { if (e.code === 'Enter' && $('#setup').classList.contains('hidden')) {} else if (e.code === 'Enter') fly(); });
function fly() { save(); $('#setup').classList.add('hidden'); $('#flight').classList.remove('hidden'); initBabylon(); history.pushState({ v: 'flight' }, '', '#flight'); }
window.addEventListener('popstate', e => {
  if (e.state && e.state.v === 'flight') { $('#setup').classList.add('hidden'); $('#flight').classList.remove('hidden'); if (!B) initBabylon(); }
  else { $('#flight').classList.add('hidden'); $('#setup').classList.remove('hidden'); $('#btn-rescan').click(); }
});
window.addEventListener('keydown', e => {
  if (e.code === 'Escape' && !$('#flight').classList.contains('hidden')) history.back();
  if (e.code === 'KeyV' && !$('#flight').classList.contains('hidden')) { camMode = camMode === 'fpv' ? 'third' : 'fpv'; }
  if (e.code === 'KeyR' && !$('#flight').classList.contains('hidden')) { pos.set(0, 2.5, 0); vel.set(0, 0, 0); rot.set(0, 0, 0); aVel.set(0, 0, 0); }
});

// ═══════════════════════════════════════════════════════════
// FLIGHT SCENE
// ═══════════════════════════════════════════════════════════
let B = null, engine, scene, camera, drone, rotors = [], camMode = 'third';
let pos = new BABYLON.Vector3(0, 2.5, 0), vel = new BABYLON.Vector3(0, 0, 0);
let rot = new BABYLON.Vector3(0, 0, 0), aVel = new BABYLON.Vector3(0, 0, 0);
let throttles = [0, 0, 0, 0], inp = { throttle: 0, pitch: 0, roll: 0, yaw: 0 };

function initBabylon() {
  B = BABYLON; const cvs = $('#cvs');
  engine = new B.Engine(cvs, true, { preserveDrawingBuffer: true, stencil: true });
  scene = new B.Scene(engine);

  // Sky
  const sky = new B.SkyMaterial('sky', scene); sky.backFaceCulling = false; sky.turbidity = 3; sky.luminance = .45; sky.inclination = .45;
  B.MeshBuilder.CreateBox('skybox', { size: 1000 }, scene).material = sky;

  // Lights
  const sun = new B.DirectionalLight('sun', new B.Vector3(.4, -.5, .3), scene); sun.intensity = 2.5;
  sun.shadowEnabled = true; sun.shadowMinZ = 1; sun.shadowMaxZ = 200;
  const sg = new B.ShadowGenerator(2048, sun); sg.useBlurExponentialShadowMap = true; sg.blurKernel = 32;
  new B.HemisphericLight('hemi', new B.Vector3(0, 1, 0), scene).intensity = .4;

  // Ground
  const ground = B.MeshBuilder.CreateGround('gnd', { width: 500, height: 500, subdivisions: 100 }, scene);
  const tc = document.createElement('canvas'); tc.width = 512; tc.height = 512; const ctx = tc.getContext('2d');
  ctx.fillStyle = '#5a8a3c'; ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 3000; i++) { const x = Math.random() * 512, y = Math.random() * 512; ctx.fillStyle = `rgb(${70 + Math.random() * 40},${100 + Math.random() * 50},${30 + Math.random() * 30})`; ctx.fillRect(x, y, 3, 3); }
  ctx.strokeStyle = '#4a7a2c'; ctx.lineWidth = 1;
  for (let i = 0; i < 512; i += 48) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 512); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(512, i); ctx.stroke(); }
  const gmat = new B.StandardMaterial('gmat', scene); gmat.diffuseTexture = new B.Texture(tc.toDataURL(), scene); gmat.diffuseTexture.uScale = 25; gmat.diffuseTexture.vScale = 25;
  ground.material = gmat; ground.receiveShadows = true; sg.addShadowCaster(ground);

  // Trees
  for (let i = 0; i < 120; i++) {
    const tx = (Math.random() - .5) * 460, tz = (Math.random() - .5) * 460;
    if (Math.sqrt(tx * tx + tz * tz) < 25) continue;
    const h = 1.2 + Math.random() * 3;
    const t = B.MeshBuilder.CreateCylinder('tr' + i, { height: h, diameterTop: .12, diameterBottom: .22, tessellation: 5 }, scene);
    t.position.set(tx, h / 2, tz); t.receiveShadows = true; sg.addShadowCaster(t);
    const cr = B.MeshBuilder.CreateSphere('cr' + i, { diameter: .8 + Math.random() * 1.8, segments: 4 }, scene);
    cr.position.set(tx, h + .3, tz); cr.receiveShadows = true;
    const cm = new B.StandardMaterial('cm' + i, scene); cm.diffuseColor = new B.Color3(.1 + .15 * Math.random(), .3 + .2 * Math.random(), .05 + .1 * Math.random()); cr.material = cm;
  }

  // Launch pad
  const pad = B.MeshBuilder.CreateCylinder('pad', { height: .03, diameter: 2.5, tessellation: 32 }, scene); pad.position.y = .015;
  pad.material = new B.StandardMaterial('pmat', scene); pad.material.diffuseColor = new B.Color3(.5, .5, .5); pad.receiveShadows = true;
  const ring = B.MeshBuilder.CreateTorus('ring', { diameter: 2.5, thickness: .06, tessellation: 48 }, scene); ring.position.y = .05;
  const rmat = new B.StandardMaterial('rmat', scene); rmat.diffuseColor = new B.Color3(.9, .9, .9); rmat.emissiveColor = new B.Color3(.15, .15, .15); ring.material = rmat;
  for (let i = 0; i < 40; i++) {
    const a = i * Math.PI * 2 / 40;
    const m = B.MeshBuilder.CreateBox('m'+i,{width:.15,height:.04,depth:.04},scene); m.position.set(Math.cos(a)*1.25,.03,Math.sin(a)*1.25); m.position.y=.04;
    m.material = new B.StandardMaterial('mm'+i,scene); m.material.diffuseColor=new B.Color3(.85,.85,.85);
  } // pad markers

  // Camera
  camera = new B.UniversalCamera('cam', new B.Vector3(0, 5, -12), scene); camera.setTarget(new B.Vector3(0, 2, 0));
  camera.fov = 1.1; camera.minZ = .3; camera.maxZ = 800;

  // Drone model
  drone = new B.TransformNode('drone', scene); drone.position = pos;
  const bmat = new B.StandardMaterial('bmat', scene); bmat.diffuseColor = new B.Color3(.12, .12, .2); bmat.specularColor = new B.Color3(.3, .3, .4);
  const hub = B.MeshBuilder.CreateCylinder('hub', { height: .18, diameterTop: .4, diameterBottom: .45, tessellation: 16 }, scene); hub.parent = drone; hub.position.y = .09; hub.material = bmat; sg.addShadowCaster(hub);
  const colors = ['#ff3333', '#33ff33', '#ffff33', '#33ffff'];
  for (let i = 0; i < 4; i++) {
    const ang = i * Math.PI / 2;
    const arm = B.MeshBuilder.CreateBox('arm' + i, { width: .07, height: .05, depth: 1.0 }, scene); arm.parent = drone;
    arm.position.set(Math.sin(ang) * .5, .09, Math.cos(ang) * .5); arm.rotation.y = ang; sg.addShadowCaster(arm);
    const motor = B.MeshBuilder.CreateCylinder('m' + i, { height: .09, diameterTop: .22, diameterBottom: .26, tessellation: 12 }, scene); motor.parent = drone;
    motor.position.set(Math.sin(ang) * 1.0, .13, Math.cos(ang) * 1.0); sg.addShadowCaster(motor);
    const disc = B.MeshBuilder.CreateCylinder('d' + i, { height: .015, diameter: 1.6, tessellation: 24 }, scene); disc.parent = drone;
    disc.position.set(Math.sin(ang) * 1.0, .18, Math.cos(ang) * 1.0);
    const dm = new B.StandardMaterial('dm' + i, scene); dm.diffuseColor = B.Color3.FromHexString(colors[i]); dm.alpha = .65; dm.emissiveColor = B.Color3.FromHexString(colors[i]).scale(.2); disc.material = dm;
    rotors.push(disc);
  }
  [[.22, 0, .22], [-.22, 0, .22], [.22, 0, -.22], [-.22, 0, -.22]].forEach(([x, y, z]) => {
    const l = B.MeshBuilder.CreateCylinder('lg', { height: .22, diameter: .1, tessellation: 6 }, scene); l.parent = drone; l.position.set(x, y - .16, z); sg.addShadowCaster(l);
  });
  B.MeshBuilder.CreateSphere('fcam', { diameter: .1, segments: 6 }, scene).parent = drone;

  // Game loop
  engine.runRenderLoop(() => {
    const now = performance.now(); if (!LT) LT = now;
    let dt = Math.min((now - LT) / 1000, .05); LT = now; if (dt <= 0) return;

    // Input: rawBytes + chanMap first (user config), extAxes fallback
    if (rawBytes) {
      NAMES.forEach(n => {
        const bi = S.ch[n] ?? { throttle: 0, yaw: 2, pitch: 3, roll: 4 }[n];
        let v = ((rawBytes[bi] || 0) - 127) / 127;
        v += (S.sub[n] || 0) / 127; if (S.inv[n]) v = -v;
        if (v < 0) v *= (S.epl[n] || 100) / 100; else v *= (S.epr[n] || 100) / 100;
        inp[n] = Math.max(-1, Math.min(1, v));
      });
    } else if (extAxes) {
      inp.throttle = extAxes[0]; inp.yaw = extAxes[1]; inp.pitch = -extAxes[2]; inp.roll = extAxes[3];
    }

    // Physics
    const t = Math.max(0, Math.min(1, inp.throttle)) * .85;
    let m0 = t - inp.pitch + inp.yaw, m1 = t + inp.roll - inp.yaw, m2 = t + inp.pitch + inp.yaw, m3 = t - inp.roll - inp.yaw;
    throttles = [m0, m1, m2, m3].map(v => Math.max(0, Math.min(1, v)));
    const thrust = throttles.reduce((a, b) => a + b) * 4.5;
    const f = new B.Vector3(0, thrust - 9.81 * .7, 0);
    f.x -= .3 * vel.x; f.y -= .06 * vel.y; f.z -= .3 * vel.z;
    vel.addInPlace(f.scale(dt / .7)); pos.addInPlace(vel.scale(dt));
    if (pos.y < .15) { pos.y = .15; if (vel.y < 0) vel.y *= -.25; vel.x *= .9; vel.z *= .9; }

    const arm = .18, I = .005;
    const tX = (throttles[2] - throttles[0]) * arm, tZ = (throttles[1] - throttles[3]) * arm;
    const tY = ((throttles[0] + throttles[2]) - (throttles[1] + throttles[3])) * .015;
    const aA = new B.Vector3(tX, tY, tZ).scale(1 / I);
    aA.x -= 2.0 * aVel.x; aA.y -= 2.0 * aVel.y; aA.z -= 2.0 * aVel.z;
    aVel.addInPlace(aA.scale(dt)); rot.addInPlace(aVel.scale(dt));
    rot.x = Math.max(-1.4, Math.min(1.4, rot.x)); rot.z = Math.max(-1.4, Math.min(1.4, rot.z));

    drone.position = pos; drone.rotation = new B.Vector3(rot.x, rot.y, rot.z);
    rotors.forEach((r, i) => { r.rotation.y += (throttles[i] * 60 + 6) * dt; });

    // Camera
    if (camMode === 'fpv') {
      camera.position = pos.clone(); camera.position.y += .15;
      const q = B.Quaternion.RotationYawPitchRoll(rot.y, rot.x, rot.z);
      camera.setTarget(pos.add(new B.Vector3(0, 0, 1).applyRotationQuaternion(q).scale(10)));
    } else {
      const q = B.Quaternion.RotationYawPitchRoll(rot.y, rot.x, rot.z);
      const off = new B.Vector3(0, 2.5, -8).applyRotationQuaternion(q);
      const target = pos.add(off); target.y = Math.max(target.y, pos.y + 1);
      camera.position = B.Vector3.Lerp(camera.position, target, .08);
      camera.setTarget(B.Vector3.Lerp(camera.getTarget(), pos.add(new B.Vector3(0, .5, 2).applyRotationQuaternion(q)), .08));
    }

    // HUD
    $('#hud-alt').textContent = pos.y.toFixed(1) + 'm';
    $('#hud-spd').textContent = Math.sqrt(vel.x * vel.x + vel.z * vel.z).toFixed(1) + 'm/s';
    $('#hud-thr').textContent = Math.round(throttles.reduce((a, b) => a + b) / 4 * 100) + '%';
    scene.render();
  });
}
let LT = 0;

// Keyboard fallback
const keys = {};
window.addEventListener('keydown', e => { keys[e.code] = true; });
window.addEventListener('keyup', e => { keys[e.code] = false; });
setInterval(() => {
  if ($('#flight').classList.contains('hidden')) return;
  if (!rawBytes) {
    inp.throttle = (keys['KeyW'] ? 1 : 0) + (keys['ShiftLeft'] ? -1 : 0);
    inp.pitch = (keys['ArrowDown'] ? 1 : 0) + (keys['ArrowUp'] ? -1 : 0);
    inp.roll = (keys['ArrowRight'] ? 1 : 0) + (keys['ArrowLeft'] ? -1 : 0);
    inp.yaw = (keys['KeyD'] ? 1 : 0) + (keys['KeyA'] ? -1 : 0);
  }
}, 16);

// Setup live update
setInterval(() => {
  if ($('#setup').classList.contains('hidden')) return;
  if (rawBytes) {
    $('#raw-disp').textContent = 'RAW: ' + rawBytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    NAMES.forEach(n => {
      const bi = S.ch[n]; let v = ((rawBytes[bi] || 0) - 127) / 127;
      v += (S.sub[n] || 0) / 127; if (S.inv[n]) v = -v;
      if (v < 0) v *= (S.epl[n] || 100) / 100; else v *= (S.epr[n] || 100) / 100;
      v = Math.max(-1, Math.min(1, v));
      const bar = $('#cf-' + n), val = $('#cv-' + n);
      if (bar) { bar.style.left = v >= 0 ? '50%' : (50 + v * 50) + '%'; bar.style.width = (Math.abs(v) * 50) + '%'; }
      if (val) val.textContent = v.toFixed(2);
    });
  }
}, 50);

history.replaceState({ v: 'setup' }, '', '#setup');
