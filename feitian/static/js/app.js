// app.js — FeiTian 飞天
const $ = s => document.querySelector(s);
const SET = 'feitian_settings';
let S = { mode:2, deadzone:.08, smooth:.18, rcThr:false,
         ch:{throttle:0,yaw:2,pitch:3,roll:4},
         inv:{throttle:false,yaw:false,pitch:false,roll:false},
         sub:{throttle:0,yaw:0,pitch:0,roll:0},
         epl:{throttle:100,yaw:100,pitch:100,roll:100},
         epr:{throttle:100,yaw:100,pitch:100,roll:100} };
try { const r=localStorage.getItem(SET); if(r) Object.assign(S,JSON.parse(r)); } catch(e){}
function save(){ try{localStorage.setItem(SET,JSON.stringify(S))}catch(e){} }

// ── HID ──
let ws=null, pt=null, rawBytes=null, extAxes=null;

function hidOpen(vid,pid){
  if(ws){try{ws.send(JSON.stringify({action:'close'}));ws.close()}catch(e){}}
  clearInterval(pt);
  ws=new WebSocket(`ws://${location.host}/ws/controller`);
  ws.onopen=()=>{ ws.send(JSON.stringify({action:'open',vid,pid}));
    pt=setInterval(()=>{if(ws.readyState===1)ws.send(JSON.stringify({action:'poll'}))},20); };
  ws.onmessage=e=>{ try{const m=JSON.parse(e.data);if(m.raw)rawBytes=m.raw;if(m.axes)extAxes=m.axes} catch(err){} };
  ws.onclose=()=>{rawBytes=null;extAxes=null};
}

// ── Setup UI ──
const NAMES=['throttle','yaw','pitch','roll'], LABELS=['油门','偏航','俯仰','横滚'];

function buildChans(){
  let h='';
  NAMES.forEach((n,i)=>{ h+=`<div class="crow">
    <span class="cl">${LABELS[i]}</span><div class="cb"><div class="cf" id="cf-${n}"></div></div>
    <span class="cv" id="cv-${n}">0.00</span>
    <select id="cs-${n}">${[0,1,2,3,4,5,6,7].map(b=>`<option value="${b}">B${b}</option>`).join('')}</select>
    <input type="checkbox" id="ci-${n}" title="反向">
    <input type="number" id="ce-${n}" value="0" min="-127" max="127" style="width:42px" title="Subtrim">
  </div>`; });
  $('#chans').innerHTML=h;
  NAMES.forEach(n=>{
    $('#cs-'+n).value=S.ch[n]; $('#ci-'+n).checked=S.inv[n]; $('#ce-'+n).value=S.sub[n];
    $('#cs-'+n).onchange=e=>{S.ch[n]=+e.target.value;save()};
    $('#ci-'+n).onchange=e=>{S.inv[n]=e.target.checked;save()};
    $('#ce-'+n).onchange=e=>{S.sub[n]=+e.target.value||0;save()};
  });
}

function applyDom(){
  $('#mode').value=S.mode; $('#dz').value=Math.round(S.deadzone*100); $('#dz-val').textContent=Math.round(S.deadzone*100)+'%';
  $('#sm').value=Math.round(S.smooth*100); $('#sm-val').textContent=S.smooth.toFixed(2); $('#rc-thr').checked=S.rcThr;
}

buildChans(); applyDom();

// Device list
$('#devices').addEventListener('click',e=>{
  const el=e.target.closest('.dev'); if(!el) return;
  $('#devices').querySelectorAll('.dev').forEach(x=>x.classList.remove('sel'));
  el.classList.add('sel');
  const vid=el.dataset.vid, pid=el.dataset.pid;
  if(vid&&pid) hidOpen(vid,pid);
  localStorage.setItem('feitian_dev',JSON.stringify({vid,pid,idx:+el.dataset.idx}));
});

// Restore saved device
try{ const d=JSON.parse(localStorage.getItem('feitian_dev'));
  if(d){ const els=$('#devices').querySelectorAll('.dev'); if(els[d.idx]){els[d.idx].classList.add('sel');hidOpen(d.vid,d.pid);} }
}catch(e){}

// Settings
$('#mode').onchange=e=>{S.mode=+e.target.value;save()};
$('#dz').oninput=e=>{S.deadzone=+e.target.value/100;$('#dz-val').textContent=e.target.value+'%';save()};
$('#sm').oninput=e=>{S.smooth=+e.target.value/100;$('#sm-val').textContent=S.smooth.toFixed(2);save()};
$('#rc-thr').onchange=e=>{S.rcThr=e.target.checked;save()};
$('#btn-rescan').onclick=()=>{ fetch('/api/controllers').then(r=>r.json()).then(d=>{
  if(d.controllers){window.__DEVICES__=d.controllers; location.reload();} }) };

// Auto-learn
let learn=null;
$('#btn-learn').onclick=()=>{
  if(learn){clearTimeout(learn.timer);finishLearn();return}
  learn={data:Array.from({length:8},()=>({min:255,max:0})),start:Date.now()};
  $('#learn-status').textContent='学习中...摇杆画圈！';$('#btn-learn').textContent='完成';
  function poll(){ if(!learn)return;
    const t=(Date.now()-learn.start)/1000;
    $('#learn-status').textContent=`学习中... ${Math.max(0,(5-t)).toFixed(1)}s`;
    if(t>5){finishLearn();return}
    if(rawBytes) rawBytes.forEach((b,i)=>{if(b<learn.data[i].min)learn.data[i].min=b;if(b>learn.data[i].max)learn.data[i].max=b});
    learn.timer=setTimeout(poll,80); }
  poll();
};
function finishLearn(){
  const r=learn.data.map((d,i)=>({i,r:d.max-d.min})).sort((a,b)=>b.r-a.r);
  const top4=r.slice(0,4).map(x=>x.i);
  NAMES.forEach((n,i)=>{S.ch[n]=top4[i]??i*2}); save(); buildChans();
  $('#learn-status').textContent='完成！映射: '+top4.join(',');
  $('#btn-learn').textContent='自动检测通道'; learn=null;
}

// Enter to fly
window.addEventListener('keydown',e=>{ if(e.code==='Enter'&&!$('#flight').classList.contains('hidden')){} else if(e.code==='Enter')fly(); });

$('#btn-fly').onclick=fly;

// ── Launch flight ──
function fly(){
  save();
  $('#setup').classList.add('hidden'); $('#flight').classList.remove('hidden');
  initBabylon();
  history.pushState({v:'flight'},'','#flight');
}
window.addEventListener('popstate',e=>{
  if(e.state&&e.state.v==='flight'){ $('#setup').classList.add('hidden');$('#flight').classList.remove('hidden');if(!B)initBabylon(); }
  else { $('#flight').classList.add('hidden');$('#setup').classList.remove('hidden');$('#btn-rescan').click(); }
});
window.addEventListener('keydown',e=>{
  if(e.code==='Escape'&&!$('#flight').classList.contains('hidden')) history.back();
  if(e.code==='KeyV'&&!$('#flight').classList.contains('hidden')) camMode=camMode==='fpv'?'third':'fpv';
  if(e.code==='KeyR'&&!$('#flight').classList.contains('hidden')){ pos.set(0,2.5,0);vel.set(0,0,0);rot.set(0,0,0);aVel.set(0,0,0); }
});

// ── Babylon scene ──
let B=null,engine,scene,camera,drone,rotors=[],camMode='third',camTarget=new BABYLON.Vector3(0,3,-10);
let pos=new BABYLON.Vector3(0,2.5,0),vel=new BABYLON.Vector3(0,0,0);
let rot=new BABYLON.Vector3(0,0,0),aVel=new BABYLON.Vector3(0,0,0);
let throttles=[0,0,0,0],input={throttle:0,pitch:0,roll:0,yaw:0};

function initBabylon(){
  B=BABYLON; const cvs=$('#cvs');
  engine=new B.Engine(cvs,true);
  scene=new B.Scene(engine); scene.clearColor=new B.Color4(.53,.81,.94,1);
  scene.fogMode=B.Scene.FOGMODE_LINEAR; scene.fogStart=150; scene.fogEnd=600; scene.fogColor=new B.Color3(.53,.81,.94);

  // Light
  const light=new B.DirectionalLight('sun',new B.Vector3(.3,-.6,.5),scene); light.intensity=1.5;
  const hemi=new B.HemisphericLight('hemi',new B.Vector3(0,1,0),scene); hemi.intensity=.5;

  // Camera
  camera=new B.ArcRotateCamera('cam',0,.8,25,new B.Vector3(0,2,0),scene);
  camera.lowerRadiusLimit=2; camera.upperRadiusLimit=50; camera.attachControl(cvs,false);

  // Ground
  const ground=B.MeshBuilder.CreateGround('gnd',{width:400,height:400,subdivisions:80},scene);
  const gmat=new B.StandardMaterial('gmat',scene); gmat.diffuseColor=new B.Color3(.3,.5,.25); ground.material=gmat;
  ground.receiveShadows=true;

  // Tree scatter
  for(let i=0;i<100;i++){
    const tx=(Math.random()-.5)*350,tz=(Math.random()-.5)*350;
    if(Math.sqrt(tx*tx+tz*tz)<20)continue;
    const trunk=B.MeshBuilder.CreateCylinder('t',{height:1.5+Math.random()*2,diameter:.25},scene);
    trunk.position.set(tx,.75,tz);
    const crown=B.MeshBuilder.CreateSphere('c',{diameter:1+Math.random()*1.5,segments:5},scene);
    crown.position.set(tx,2+Math.random()*1.5,tz);
    const cmat=new B.StandardMaterial('cmat'+i,scene); cmat.diffuseColor=new B.Color3(.15+.1*Math.random(),.35+.15*Math.random(),.1+.05*Math.random()); crown.material=cmat;
  }

  // Drone
  drone=new B.TransformNode('drone',scene); drone.position=pos;
  const bmat=new B.StandardMaterial('bmat',scene); bmat.diffuseColor=new B.Color3(.15,.15,.22);
  const hub=B.MeshBuilder.CreateCylinder('hub',{height:.2,diameter:.5},scene); hub.parent=drone; hub.position.y=.1;
  const amat=new B.StandardMaterial('amat',scene); amat.diffuseColor=new B.Color3(.2,.2,.28);
  const colors=['#f44','#4f4','#ff4','#4ff'];
  for(let i=0;i<4;i++){
    const angle=i*Math.PI/2;
    const arm=B.MeshBuilder.CreateBox('arm'+i,{width:.08,height:.06,depth:1.1},scene); arm.parent=drone;
    arm.position.set(Math.sin(angle)*.55,.1,Math.cos(angle)*.55); arm.rotation.y=angle;
    const motor=B.MeshBuilder.CreateCylinder('m'+i,{height:.1,diameter:.28},scene); motor.parent=drone;
    motor.position.set(Math.sin(angle)*1.1,.15,Math.cos(angle)*1.1);
    const disc=B.MeshBuilder.CreateCylinder('d'+i,{height:.02,diameter:1.8},scene); disc.parent=drone;
    disc.position.set(Math.sin(angle)*1.1,.22,Math.cos(angle)*1.1);
    const dmat=new B.StandardMaterial('dmat'+i,scene); dmat.diffuseColor=B.Color3.FromHexString(colors[i]); dmat.alpha=.7; disc.material=dmat;
    rotors.push(disc);
  }

  // Landing legs
  [[.25,0,.25],[-.25,0,.25],[.25,0,-.25],[-.25,0,-.25]].forEach(([x,y,z])=>{
    const leg=B.MeshBuilder.CreateCylinder('leg',{height:.25,diameter:.12},scene); leg.parent=drone; leg.position.set(x,y-.18,z);
  });

  // Skybox-like ground fog
  scene.fogMode=B.Scene.FOGMODE_EXP; scene.fogDensity=.0007;

  engine.runRenderLoop(()=>{
    const now=performance.now(); if(!lastTime)lastTime=now;
    let dt=Math.min((now-lastTime)/1000,.05); lastTime=now; if(dt<=0)return;

    // Input
    if(extAxes){ input.throttle=extAxes[0]; input.yaw=extAxes[1]; input.pitch=-extAxes[2]; input.roll=extAxes[3]; }
    else {
      // Keyboard fallback
      input.throttle=0;input.pitch=0;input.roll=0;input.yaw=0;
    }

    // Physics (inline for simplicity)
    const base=Math.max(0,Math.min(1,input.throttle))*.85;
    let m0=base-input.pitch+input.yaw, m1=base+input.roll-input.yaw, m2=base+input.pitch+input.yaw, m3=base-input.roll-input.yaw;
    throttles=[m0,m1,m2,m3].map(v=>Math.max(0,Math.min(1,v)));
    const totalThrust=throttles.reduce((a,b)=>a+b)*4.5;
    const force=new B.Vector3(0,totalThrust-9.81*.7,0);
    const drag=.3; force.x-=drag*vel.x; force.y-=drag*vel.y*.2; force.z-=drag*vel.z;
    vel.addInPlace(force.scale(dt/.7)); pos.addInPlace(vel.scale(dt));
    if(pos.y<.15){pos.y=.15;if(vel.y<0)vel.y*=-.3;vel.x*=.92;vel.z*=.92}

    // Angular
    const a=.18, I=.005;
    const tX=(throttles[2]-throttles[0])*a, tZ=(throttles[1]-throttles[3])*a, tY=((throttles[0]+throttles[2])-(throttles[1]+throttles[3]))*.015;
    const aAcc=new B.Vector3(tX,tY,tZ).scale(1/I);
    aAcc.x-=1.8*aVel.x; aAcc.y-=1.8*aVel.y; aAcc.z-=1.8*aVel.z;
    aVel.addInPlace(aAcc.scale(dt)); rot.addInPlace(aVel.scale(dt));
    rot.x=Math.max(-1.4,Math.min(1.4,rot.x)); rot.z=Math.max(-1.4,Math.min(1.4,rot.z));

    drone.position=pos; drone.rotation=new B.Vector3(rot.x,rot.y,rot.z);
    rotors.forEach((r,i)=>{ r.rotation.y+=(throttles[i]*50+5)*dt; });

    // Camera
    if(camMode==='fpv'){ camera.target=pos; camera.radius=0; camera.beta=Math.PI/2-rot.x; camera.alpha=-rot.y; }
    else {
      const off=new B.Vector3(0,3,-10); const q=B.Quaternion.RotationYawPitchRoll(rot.y,rot.x,rot.z);
      const target=pos.add(off.applyRotationQuaternion(q));
      camera.target=pos; camera.alpha=-rot.y+.2; camera.beta=.8; camera.radius=10;
    }

    // HUD
    $('#hud-alt').textContent=pos.y.toFixed(1)+'m';
    $('#hud-spd').textContent=Math.sqrt(vel.x*vel.x+vel.z*vel.z).toFixed(1)+'m/s';
    $('#hud-thr').textContent=Math.round(throttles.reduce((a,b)=>a+b)/4*100)+'%';
    engine.resize(); scene.render();
  });
}
let lastTime=0;

// Keyboard input
const keys={};
window.addEventListener('keydown',e=>{keys[e.code]=true});
window.addEventListener('keyup',e=>{keys[e.code]=false});
setInterval(()=>{
  if($('#flight').classList.contains('hidden'))return;
  input.throttle=(keys['KeyW']?1:0)+(keys['ShiftLeft']?-1:0);
  input.pitch=(keys['ArrowDown']?1:0)+(keys['ArrowUp']?-1:0);
  input.roll=(keys['ArrowRight']?1:0)+(keys['ArrowLeft']?-1:0);
  input.yaw=(keys['KeyD']?1:0)+(keys['KeyA']?-1:0);
},16);

// Live update for setup page
setInterval(()=>{
  if($('#setup').classList.contains('hidden'))return;
  if(rawBytes){
    $('#raw-disp').textContent='RAW: '+rawBytes.map(b=>b.toString(16).padStart(2,'0').toUpperCase()).join(' ');
    NAMES.forEach(n=>{
      const bi=S.ch[n]; let v=((rawBytes[bi]||0)-127)/127;
      v+=(S.sub[n]||0)/127; if(S.inv[n])v=-v;
      if(v<0)v*=(S.epl[n]||100)/100; else v*=(S.epr[n]||100)/100;
      v=Math.max(-1,Math.min(1,v));
      const bar=$('#cf-'+n), val=$('#cv-'+n);
      if(bar){ bar.style.left=v>=0?'50%':(50+v*50)+'%'; bar.style.width=(Math.abs(v)*50)+'%'; }
      if(val)val.textContent=v.toFixed(2);
    });
    if(extAxes){ input.throttle=extAxes[0];input.yaw=extAxes[1];input.pitch=-extAxes[2];input.roll=extAxes[3]; }
  }
},50);

history.replaceState({v:'setup'},'','#setup');
