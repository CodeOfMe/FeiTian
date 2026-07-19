"""FeiTian — PySide6 setup + Panda3D flight."""
import json, math, os, random, sys, threading, time
from pathlib import Path
import numpy as np
from feitian.controller_scanner import scan_controllers
from feitian.hid_reader import start_reader, stop_reader, get_reader

CFG = Path(__file__).parent.parent / "feitian_settings.json"
def _load():
    try: return json.loads(CFG.read_text()) if CFG.exists() else {}
    except: return {}
def _save(s): CFG.write_text(json.dumps(s))

S = _load()
for k, v in {"mode": 2, "deadzone": .08, "smooth": .18, "rcThr": False,
             "ch": {"throttle": 0, "yaw": 2, "pitch": 3, "roll": 4},
             "inv": {"throttle": False, "yaw": False, "pitch": False, "roll": False},
             "sub": {"throttle": 0, "yaw": 0, "pitch": 0, "roll": 0}}.items():
    S.setdefault(k, v)

class HID:
    def __init__(self): self.raw = [0] * 8; self.axes = [0.] * 4; self.ok = False
    def poll(self):
        r = get_reader()
        if r and r.connected:
            with r._lock: self.raw = list(r.raw_bytes); self.axes = list(r.axes)
            self.ok = True
        else: self.ok = False

hid = HID()
_hid_thread = None

def hid_connect(vid, pid):
    global _hid_thread
    stop_reader()
    if start_reader(vid, pid):
        def loop():
            while True:
                r = get_reader()
                if r is None or not r.connected: break
                hid.poll(); time.sleep(.01)
        _hid_thread = threading.Thread(target=loop, daemon=True)
        _hid_thread.start()

# ═══════════ PYSIDE6 SETUP ═══════════
from PySide6.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout,
    QHBoxLayout, QLabel, QPushButton, QListWidget, QSpinBox, QCheckBox,
    QSlider, QGroupBox, QLineEdit, QListWidgetItem)
from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QFont, QColor, QPalette

class SetupWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("FeiTian — Setup")
        self.setFixedSize(560, 620)
        self.devices = scan_controllers()
        self.learning = False
        self.learn_data = None
        self.learn_start = 0
        self._build()
        self._timer = QTimer()
        self._timer.timeout.connect(self._live)
        self._timer.start(50)

    def _dark(self, w):
        p = w.palette()
        p.setColor(QPalette.Window, QColor(21, 21, 42))
        p.setColor(QPalette.Base, QColor(28, 28, 50))
        p.setColor(QPalette.Text, QColor(200, 200, 220))
        p.setColor(QPalette.Button, QColor(40, 40, 70))
        p.setColor(QPalette.ButtonText, QColor(200, 200, 220))
        p.setColor(QPalette.Highlight, QColor(248, 133, 31))
        p.setColor(QPalette.HighlightedText, QColor(255, 255, 255))
        w.setPalette(p)

    def _build(self):
        self._dark(self)
        cw = QWidget(); self.setCentralWidget(cw)
        lay = QVBoxLayout(cw); lay.setSpacing(8); lay.setContentsMargins(12, 12, 12, 12)

        # Title
        title = QLabel("FeiTian FPV Drone Simulator")
        title.setAlignment(Qt.AlignCenter)
        title.setStyleSheet("font-size:18px;font-weight:bold;color:#f8851f;padding:4px;")
        lay.addWidget(title)

        # ── Device list ──
        gb = QGroupBox("Controllers"); self._dark(gb); gb.setStyleSheet("QGroupBox{color:#ccc;font-weight:bold;padding-top:14px;}")
        gl = QVBoxLayout(gb)
        self.dlist = QListWidget()
        self.dlist.setStyleSheet("QListWidget{background:#1c1c32;color:#ccc;border:1px solid #333;font-family:Consolas;font-size:12px;}")
        self.dlist.setMaximumHeight(120)
        for d in self.devices:
            self.dlist.addItem(f"{d['name']}   [{d['vid']}:{d['pid']}]")
        self.dlist.addItem("Keyboard (no controller)")
        self.dlist.currentRowChanged.connect(self._sel)
        gl.addWidget(self.dlist)
        hl = QHBoxLayout()
        self.dst = QLabel(f"Found {len(self.devices)} devices"); self.dst.setStyleSheet("color:#4c8;font-size:11px;")
        hl.addWidget(self.dst); hl.addStretch()
        btn = QPushButton("Rescan"); btn.setStyleSheet("background:#2a2a4a;color:#ccc;padding:3px 12px;border:1px solid #444;border-radius:3px;"); btn.clicked.connect(self._rescan)
        hl.addWidget(btn)
        gl.addLayout(hl)
        lay.addWidget(gb)

        # ── Channel map ──
        gb2 = QGroupBox("Channel Map"); self._dark(gb2); gb2.setStyleSheet("QGroupBox{color:#ccc;font-weight:bold;padding-top:14px;}")
        g2l = QVBoxLayout(gb2)
        self.raw_label = QLabel("RAW: -- -- -- -- -- -- -- --")
        self.raw_label.setStyleSheet("color:#f8851f;font-family:Consolas;font-size:11px;")
        g2l.addWidget(self.raw_label)
        self.cspin = {}; self.cinv = {}; self.csub = {}
        for key, lb in [("throttle", "Throttle"), ("yaw", "Yaw"), ("pitch", "Pitch"), ("roll", "Roll")]:
            rw = QHBoxLayout()
            rw.addWidget(QLabel(lb)); lbw = rw.itemAt(0).widget(); lbw.setFixedWidth(55); lbw.setStyleSheet("color:#ccc;")
            sp = QSpinBox(); sp.setRange(0, 15); sp.setValue(S["ch"].get(key, 0)); sp.setStyleSheet("background:#1c1c32;color:#ccc;border:1px solid #444;"); sp.setFixedWidth(50); sp.valueChanged.connect(lambda v, k=key: self._cc(k, v))
            rw.addWidget(sp); self.cspin[key] = sp
            cb = QCheckBox("Rev"); cb.setChecked(S["inv"].get(key, False)); cb.setStyleSheet("color:#888;"); cb.toggled.connect(lambda v, k=key: self._ci(k, v))
            rw.addWidget(cb); self.cinv[key] = cb
            rw.addWidget(QLabel("Sub")); rw.itemAt(rw.count()-1).widget().setStyleSheet("color:#888;")
            le = QLineEdit(str(S["sub"].get(key, 0))); le.setFixedWidth(40); le.setStyleSheet("background:#1c1c32;color:#ccc;border:1px solid #444;"); le.editingFinished.connect(lambda k=key, e=le: self._cs(k, e))
            rw.addWidget(le); self.csub[key] = le
            rw.addStretch()
            g2l.addLayout(rw)
        bh = QHBoxLayout()
        btn_learn = QPushButton("Auto Detect"); btn_learn.setStyleSheet("background:#2a2a4a;color:#f8851f;padding:4px 12px;border:1px solid #444;border-radius:3px;"); btn_learn.clicked.connect(self._learn)
        bh.addWidget(btn_learn)
        self.learn_label = QLabel(""); self.learn_label.setStyleSheet("color:#888;font-size:11px;"); bh.addWidget(self.learn_label); bh.addStretch()
        g2l.addLayout(bh)
        lay.addWidget(gb2)

        # ── Settings ──
        gb3 = QGroupBox("Settings"); self._dark(gb3); gb3.setStyleSheet("QGroupBox{color:#ccc;font-weight:bold;padding-top:14px;}")
        g3l = QVBoxLayout(gb3)
        for lb, key, mn, mx in [("Deadzone", "deadzone", 0, 30), ("Smooth", "smooth", 5, 50)]:
            rw = QHBoxLayout()
            rw.addWidget(QLabel(lb)); rw.itemAt(0).widget().setFixedWidth(70); rw.itemAt(0).widget().setStyleSheet("color:#ccc;")
            sl = QSlider(Qt.Horizontal); sl.setRange(mn, mx); sl.setValue(int(S[key] * 100))
            sl.valueChanged.connect(lambda v, k=key: S.update({k: v / 100}))
            rw.addWidget(sl)
            val = QLabel(str(int(S[key] * 100))); val.setFixedWidth(30); val.setStyleSheet("color:#ccc;"); sl.valueChanged.connect(lambda v, lbl=val: lbl.setText(str(v)))
            rw.addWidget(val)
            g3l.addLayout(rw)
        self.rc_cb = QCheckBox("RC Throttle (non-self-centering)"); self.rc_cb.setChecked(S["rcThr"]); self.rc_cb.setStyleSheet("color:#ccc;"); self.rc_cb.toggled.connect(lambda v: S.update({"rcThr": v}))
        g3l.addWidget(self.rc_cb)
        lay.addWidget(gb3)

        # ── Launch ──
        btn_fly = QPushButton("Start Flight"); btn_fly.setStyleSheet("background:#f8851f;color:#fff;font-size:16px;font-weight:bold;padding:10px;border:none;border-radius:6px;"); btn_fly.clicked.connect(self._go)
        lay.addWidget(btn_fly)
        hint = QLabel("W/S Throttle | Arrows Pitch/Roll | A/D Yaw | V View | R Reset | Esc Exit")
        hint.setAlignment(Qt.AlignCenter); hint.setStyleSheet("color:#555;font-size:10px;")
        lay.addWidget(hint)

    def _sel(self, idx):
        if idx < 0 or idx >= len(self.devices): return
        d = self.devices[idx]; hid_connect(int(d["vid"], 16), int(d["pid"], 16))
        self.dst.setText(f"Connected: {d['name']}"); self.dst.setStyleSheet("color:#4c8;font-size:11px;")
    def _cc(self, k, v): S["ch"][k] = v; _save(S)
    def _ci(self, k, v): S["inv"][k] = v; _save(S)
    def _cs(self, k, e):
        try: S["sub"][k] = int(e.text()); _save(S)
        except: pass
    def _rescan(self):
        self.devices = scan_controllers(); self.dlist.clear()
        for d in self.devices: self.dlist.addItem(f"{d['name']}   [{d['vid']}:{d['pid']}]")
        self.dlist.addItem("Keyboard (no controller)")
        self.dst.setText(f"Found {len(self.devices)} devices")
    def _learn(self):
        if self.learning: self.learning = False; self._finish_learn(); return
        self.learning = True
        self.learn_data = {i: {"min": 255, "max": 0} for i in range(16)}
        self.learn_start = time.time(); self._learn_poll()
    def _learn_poll(self):
        if not self.learning: self.learn_label.setText(""); return
        t = time.time() - self.learn_start
        self.learn_label.setText(f"Learning... {max(0, 5 - t):.1f}s  move sticks!")
        QTimer.singleShot(80, self._learn_poll)
        if t > 5: self._learn(); return
        hid.poll()
        for i, b in enumerate(hid.raw):
            if b < self.learn_data[i]["min"]: self.learn_data[i]["min"] = b
            if b > self.learn_data[i]["max"]: self.learn_data[i]["max"] = b
    def _finish_learn(self):
        r = sorted([(i, self.learn_data[i]["max"] - self.learn_data[i]["min"]) for i in range(len(self.learn_data))], key=lambda x: -x[1])
        t4 = [x[0] for x in r[:4]]
        for i, k in enumerate(["throttle", "yaw", "pitch", "roll"]):
            S["ch"][k] = t4[i] if i < len(t4) else i * 2
            self.cspin[k].setValue(S["ch"][k])
        _save(S); self.learn_label.setText(f"Done! Map: {t4}")
    def _live(self):
        if not self.learning:
            hid.poll()
            if hid.ok: self.raw_label.setText("RAW: " + " ".join(f"{b:02X}" for b in hid.raw))
    def _go(self):
        for k in ["throttle", "yaw", "pitch", "roll"]:
            S["ch"][k] = self.cspin[k].value()
            try: S["sub"][k] = int(self.csub[k].text())
            except: pass
        _save(S); self._timer.stop(); self.close()

# ═══════════ PANDA3D FLIGHT ═══════════
def flight():
    from panda3d.core import (load_prc_file_data, Vec3, Vec4, AmbientLight,
        DirectionalLight, TextNode, TransparencyAttrib, CardMaker, NodePath, PandaNode,
        LVector3, GeomVertexFormat, GeomVertexData, Geom, GeomTriangles,
        GeomVertexWriter, GeomNode, Mat4)
    from direct.showbase.ShowBase import ShowBase
    load_prc_file_data("", "window-title FeiTian FPV")
    load_prc_file_data("", "win-size 1280 720"); load_prc_file_data("", "sync-video 0")

    SIZE, RES = 500, 128
    heights = np.zeros((RES, RES), dtype=np.float32)
    for _ in range(4):
        amp = 8 / (2 ** _); freq = 2 ** _ * .8
        for y in range(RES):
            for x in range(RES):
                heights[y, x] += amp * math.sin(x * freq * .1) * math.cos(y * freq * .1) + amp * .5 * math.sin(x * freq * .05 + y * freq * .03)

    class App(ShowBase):
        def __init__(self):
            ShowBase.__init__(self)
            self.setBackgroundColor(.53, .81, .94, 1); self.disableMouse()
            al = AmbientLight('al'); al.setColor(Vec4(.45, .5, .55, 1))
            dl = DirectionalLight('dl'); dl.setColor(Vec4(1, .95, .8, 1))
            dln = self.render.attachNewNode(dl); dln.setHpr(45, -40, 0)
            self.render.setLight(self.render.attachNewNode(al)); self.render.setLight(dln)

            for c, h in [(Vec4(.53, .81, .94, 1), .1), (Vec4(.7, .9, 1, 1), .45), (Vec4(.4, .6, .8, 1), 1)]:
                cm = CardMaker('sky'); cm.setFrame(-600, 600, -600, 600)
                n = self.render.attachNewNode(cm.generate()); n.setPos(0, 0, h * 400); n.setColor(c)
                n.setBin('background', 0); n.setDepthWrite(False)

            fmt = GeomVertexFormat.getV3n3cpt2()
            vdata = GeomVertexData('terrain', fmt, Geom.UHStatic); vdata.setNumRows(RES * RES)
            vtx = GeomVertexWriter(vdata, 'vertex'); nrm = GeomVertexWriter(vdata, 'normal')
            clr = GeomVertexWriter(vdata, 'color'); txc = GeomVertexWriter(vdata, 'texcoord')
            for y in range(RES):
                for x in range(RES):
                    px = (x / (RES - 1) - .5) * SIZE; py = (y / (RES - 1) - .5) * SIZE; pz = heights[y, x]
                    vtx.addData3f(px, py, pz); txc.addData2f(x / (RES - 1) * 30, y / (RES - 1) * 30)
                    clr.addData4f(.2 + pz * .02, .5 + pz * .03, .15 + pz * .01, 1)
            for _ in range(RES * RES): nrm.addData3f(0, 0, 1)
            tris = GeomTriangles(Geom.UHStatic)
            for y in range(RES - 1):
                for x in range(RES - 1):
                    a = y * RES + x; b = a + 1; c = a + RES; d = c + 1
                    tris.addVertices(a, b, c); tris.addVertices(b, d, c)
            geom = Geom(vdata); geom.addPrimitive(tris)
            tnode = GeomNode('terrain'); tnode.addGeom(geom)
            self.render.attachNewNode(tnode).setPos(-SIZE / 2, -SIZE / 2, 0)

            for r in range(6):
                cm = CardMaker('pad'); cm.setFrame(-3, 3, -3, 3)
                p = self.render.attachNewNode(cm.generate()); p.setPos(0, 0, .005 + r * .002); p.setColor(.4 + .1 * r, .4 + .1 * r, .4 + .1 * r)
            rcm = CardMaker('ring'); rcm.setFrame(-2.8, 2.8, -2.8, 2.8)
            ring = self.render.attachNewNode(rcm.generate()); ring.setPos(0, 0, .02); ring.setColor(.9, .9, .9)

            for _ in range(120):
                tx = (random.random() - .5) * 450; ty = (random.random() - .5) * 450
                if math.sqrt(tx * tx + ty * ty) < 20: continue
                idx = int((ty / SIZE + .5) * RES); idy = int((tx / SIZE + .5) * RES)
                hz = heights[min(idx, RES - 1), min(idy, RES - 1)] if 0 <= idx < RES and 0 <= idy < RES else 0
                h = 1.5 + random.random() * 4; sh = .2 + .2 * random.random()
                t = self.loader.loadModel("models/smiley"); t.setScale(.12, .12, h * .4); t.setPos(tx, ty, hz + h * .2); t.reparentTo(self.render)
                c = self.loader.loadModel("models/smiley"); c.setScale(.5 + .6 * random.random()); c.setPos(tx, ty, hz + h * .7); c.reparentTo(self.render)
                c.setColor(sh, .35 + sh, .05 + sh * .3)

            self.drone = self.render.attachNewNode(PandaNode("drone"))
            hz0 = heights[RES // 2, RES // 2]; self.drone.setPos(0, 0, hz0 + 3)
            hub = self.loader.loadModel("models/smiley"); hub.setScale(.3, .3, .12); hub.setPos(0, 0, .1); hub.setColor(.05, .05, .15); hub.reparentTo(self.drone)
            self.rotors = []; rc_colors = [(1, .15, .15), (.15, 1, .15), (1, 1, .15), (.15, 1, 1)]
            for i in range(4):
                a = i * math.pi / 2; cx, cy = math.cos(a), math.sin(a)
                arm = self.loader.loadModel("models/smiley"); arm.setScale(.05, .05, .45); arm.setPos(cx * .5, cy * .5, .13); arm.setH(i * 90); arm.setColor(.1, .1, .2); arm.reparentTo(self.drone)
                motor = self.loader.loadModel("models/smiley"); motor.setScale(.14, .14, .06); motor.setPos(cx * .95, cy * .95, .15); motor.setColor(.3, .3, .35); motor.reparentTo(self.drone)
                disc = self.loader.loadModel("models/smiley"); disc.setScale(.9, .9, .015); disc.setPos(cx * .95, cy * .95, .2)
                disc.setColor(*rc_colors[i]); disc.setTransparency(TransparencyAttrib.MAlpha); disc.reparentTo(self.drone); self.rotors.append(disc)
            for a in [.4, 2.3, 3.9, 5.5]:
                cx, cy = math.cos(a), math.sin(a)
                leg = self.loader.loadModel("models/smiley"); leg.setScale(.05, .05, .12); leg.setPos(cx * .22, cy * .22, -.05); leg.setColor(.1, .1, .1); leg.reparentTo(self.drone)
            cam = self.loader.loadModel("models/smiley"); cam.setScale(.04, .04, .04); cam.setPos(.35, 0, .12); cam.setColor(0, 0, 0); cam.reparentTo(self.drone)

            self.camera.setPos(0, -12, 6); self.camera.lookAt(0, 0, hz0 + 3); self.camMode = 'third'

            self.htn = TextNode('hud'); self.htn.setAlign(TextNode.A_center); self.htn.setTextColor(1, 1, 1, .88); self.htn.setShadow(.04, .04)
            self.aspect2d.attachNewNode(self.htn).setScale(.06); self.aspect2d.attachNewNode(self.htn).setPos(0, 0, -.82)
            self.hin = TextNode('hint'); self.hin.setAlign(TextNode.A_center); self.hin.setTextColor(1, 1, 1, .3)
            self.hin.setText("V:View R:Reset Esc:Exit")
            self.aspect2d.attachNewNode(self.hin).setScale(.04); self.aspect2d.attachNewNode(self.hin).setPos(0, 0, -.9)

            self.pos = Vec3(0, 0, hz0 + 3); self.vel = Vec3(0, 0, 0); self.rot = LVector3(0, 0, 0); self.avel = LVector3(0, 0, 0)
            self.thr = [0, 0, 0, 0]; self.inp = {k: 0 for k in ['throttle', 'pitch', 'roll', 'yaw']}; self.keys = {}
            self.accept('escape', sys.exit)
            self.accept('v', lambda: setattr(self, 'camMode', 'fpv' if self.camMode == 'third' else 'third'))
            self.accept('r', self._rst)
            for k in ['w', 's', 'a', 'd', 'arrow_up', 'arrow_down', 'arrow_left', 'arrow_right']:
                self.accept(k, self._k, [k, True]); self.accept(k + '-up', self._k, [k, False])
            self.taskMgr.add(self._upd, 'upd')

        def _k(self, k, d): self.keys[k] = d
        def _rst(self): self.pos = Vec3(0, 0, heights[RES // 2, RES // 2] + 3); self.vel = Vec3(0, 0, 0); self.rot = LVector3(0, 0, 0); self.avel = LVector3(0, 0, 0)

        def _upd(self, task):
            dt = min(globalClock.getDt(), .05)
            if hid.ok:
                for n in ['throttle', 'yaw', 'pitch', 'roll']:
                    bi = S['ch'].get(n, {'throttle': 0, 'yaw': 2, 'pitch': 3, 'roll': 4}[n])
                    v = ((hid.raw[bi] if bi < len(hid.raw) else 127) - 127) / 127
                    v += S['sub'].get(n, 0) / 127
                    if S['inv'].get(n, False): v = -v
                    self.inp[n] = max(-1, min(1, v))
                if S['rcThr']: self.inp['throttle'] = (self.inp['throttle'] + 1) / 2
            else:
                self.inp['throttle'] = (1 if self.keys.get('w') else 0) + (-1 if self.keys.get('s') else 0)
                self.inp['pitch'] = (-1 if self.keys.get('arrow_up') else 0) + (1 if self.keys.get('arrow_down') else 0)
                self.inp['roll'] = (-1 if self.keys.get('arrow_left') else 0) + (1 if self.keys.get('arrow_right') else 0)
                self.inp['yaw'] = (-1 if self.keys.get('a') else 0) + (1 if self.keys.get('d') else 0)

            t = max(0, min(1, self.inp['throttle'])) * .85
            m0 = t - self.inp['pitch'] + self.inp['yaw']; m1 = t + self.inp['roll'] - self.inp['yaw']
            m2 = t + self.inp['pitch'] + self.inp['yaw']; m3 = t - self.inp['roll'] - self.inp['yaw']
            self.thr = [max(0, min(1, v)) for v in [m0, m1, m2, m3]]
            thrust = sum(self.thr) * 4.5; f = Vec3(0, 0, thrust - 9.81 * .7)
            f.x -= .3 * self.vel.x; f.y -= .3 * self.vel.y; f.z -= .06 * self.vel.z
            self.vel += f * dt / .7; self.pos += self.vel * dt
            try:
                idx = int((self.pos.y / SIZE + .5) * RES); idy = int((self.pos.x / SIZE + .5) * RES)
                gz = heights[min(idx, RES - 1), min(idy, RES - 1)] if 0 <= idx < RES and 0 <= idy < RES else 0
            except: gz = 0
            if self.pos.z < gz + .15: self.pos.z = gz + .15
            if self.pos.z < gz + .2 and self.vel.z < 0: self.vel.z *= -.25; self.vel.x *= .9; self.vel.y *= .9

            arm = .18; I = .005
            tx = (self.thr[2] - self.thr[0]) * arm; ty = (self.thr[1] - self.thr[3]) * arm
            tz = ((self.thr[0] + self.thr[2]) - (self.thr[1] + self.thr[3])) * .015
            aa = Vec3(tx, ty, tz) / I; aa.x -= 2.0 * self.avel.x; aa.y -= 2.0 * self.avel.y; aa.z -= 2.0 * self.avel.z
            self.avel += aa * dt; self.rot += self.avel * dt
            self.rot.x = max(-1.4, min(1.4, self.rot.x)); self.rot.y = max(-1.4, min(1.4, self.rot.y))
            self.drone.setPos(self.pos)
            self.drone.setHpr(self.rot.z * 57.3, self.rot.x * 57.3, self.rot.y * 57.3)
            for i, r in enumerate(self.rotors): r.setR(r.getR() + (self.thr[i] * 200 + 20) * dt)
            if self.camMode == 'fpv':
                self.camera.setPos(self.pos.x, self.pos.y - 1, self.pos.z + .2)
                h, p, r = self.rot.z * 57.3, self.rot.x * 57.3, self.rot.y * 57.3
                m = Mat4.rotateMat(h, p, r); fwd = m.xformVec(Vec3(0, 1, 0)); self.camera.lookAt(self.pos + fwd * 15)
            else:
                target = Vec3(self.pos.x, self.pos.y - 10, self.pos.z + 5)
                self.camera.setPos(self.camera.getPos() * .9 + target * .1)
                self.camera.lookAt(self.pos.x, self.pos.y + 3, self.pos.z + .5)
            spd = (self.vel.x ** 2 + self.vel.y ** 2) ** .5
            self.htn.setText(f"ALT {self.pos.z:.1f}m  SPD {spd:.1f}m/s  THR {int(sum(self.thr)/4*100)}%  {self.camMode.upper()}")
            return task.cont
    App().run()

def main():
    app = QApplication(sys.argv)
    w = SetupWindow(); w.show()
    app.exec()
    if w.devices: flight()

if __name__ == "__main__":
    main()
