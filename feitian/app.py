"""FeiTian 飞天 — Panda3D native desktop flight simulator."""
import json, os, sys, threading, time, tkinter as tk
from pathlib import Path

from feitian.controller_scanner import scan_controllers
from feitian.hid_reader import start_reader, stop_reader, get_reader

CFG = Path(__file__).parent.parent / "feitian_settings.json"

def _load(): 
    try: return json.loads(CFG.read_text()) if CFG.exists() else {}
    except: return {}
def _save(s): CFG.write_text(json.dumps(s))

S = _load()
for k,v in {"mode":2,"deadzone":.08,"smooth":.18,"rcThr":False,
            "ch":{"throttle":0,"yaw":2,"pitch":3,"roll":4},
            "inv":{"throttle":False,"yaw":False,"pitch":False,"roll":False},
            "sub":{"throttle":0,"yaw":0,"pitch":0,"roll":0}}.items():
    S.setdefault(k,v)

# ── HID state ──
class HID:
    def __init__(self):
        self.raw=[0]*8; self.axes=[0.]*4; self.ok=False
    def poll(self):
        r=get_reader()
        if r and r.connected:
            with r._lock: self.raw=list(r.raw_bytes); self.axes=list(r.axes)
            self.ok=True
        else: self.ok=False
hid=HID()

def hid_connect(vid,pid):
    stop_reader()
    if start_reader(vid,pid):
        def loop():
            while get_reader() and get_reader().connected: hid.poll(); time.sleep(.01)
        threading.Thread(target=loop,daemon=True).start()

# ═══════════════════════════════════════════════════════════
# SETUP (tkinter)
# ═══════════════════════════════════════════════════════════
class Setup:
    def __init__(self):
        self.r=tk.Tk(); self.r.title("FeiTian 飞天"); self.r.resizable(False,False)
        self.r.configure(bg="#1a1a2e"); self.devices=scan_controllers(); self.sd=None
        self._build()
        tk.Button(self.r,text="开始飞行",command=self._go,bg="#f8851f",fg="#fff",
                  font=("",12,"bold"),padx=30,pady=8,border=0,cursor="hand2").pack(pady=12)
        tk.Label(self.r,text="键盘: W/S油门 ↑↓俯仰 ←→横滚 A/D偏航 V视角 R重置 Esc退出",
                 bg="#1a1a2e",fg="#666",font=("",8)).pack(pady=(0,10))
        self.r.protocol("WM_DELETE_WINDOW",sys.exit)
        self.learn=False; self.ld=None; self.ls=0
        self.r.after(100,self._live)
        self.r.mainloop()
    def _build(self):
        f,b="#ccc","#1a1a2e"; e="#2a2a4a"
        fr=tk.LabelFrame(self.r,text="控制器",fg=f,bg=b,font=("",10,"bold"),padx=8,pady=4); fr.pack(fill="x",padx=10,pady=(10,4))
        self.lb=tk.Listbox(fr,height=6,bg=e,fg=f,selectbackground="#f8851f",font=("Consolas",9),border=0); self.lb.pack(fill="x")
        for d in self.devices: self.lb.insert("end",f"{d['name']}  [{d['vid']}:{d['pid']}]")
        self.lb.bind("<<ListboxSelect>>",self._sel)
        self.st=tk.Label(fr,text=f"检测到 {len(self.devices)} 个设备",bg=b,fg="#4c8",font=("",8)); self.st.pack(anchor="w")
        tk.Button(fr,text="重新扫描",command=self._scan,bg=e,fg=f,border=0,padx=8).pack(anchor="e",pady=2)

        cf=tk.LabelFrame(self.r,text="通道映射",fg=f,bg=b,font=("",10,"bold"),padx=8,pady=4); cf.pack(fill="x",padx=10,pady=4)
        self.rl=tk.Label(cf,text="RAW: -- "*8,bg=b,fg="#f8851f",font=("Consolas",9)); self.rl.pack(anchor="w")
        self.cv={}
        for key,lb in [("throttle","油门"),("yaw","偏航"),("pitch","俯仰"),("roll","横滚")]:
            rw=tk.Frame(cf,bg=b); rw.pack(fill="x",pady=1)
            tk.Label(rw,text=lb,bg=b,fg=f,width=5,font=("",9)).pack(side="left")
            v=tk.StringVar(value=str(S["ch"][key])); tk.OptionMenu(rw,v,*[str(i)for i in range(8)])
            rw.winfo_children()[-1].configure(bg=e,fg=f,font=("Consolas",8),border=0,width=3)
            v.trace_add("write",lambda *a,k=key,var=v: self._cc(k,var)); self.cv[key]=v
        tk.Button(cf,text="自动检测通道",command=self._learn,bg=e,fg="#f8851f",border=0,padx=8,font=("",9)).pack(pady=3)
        self.ll=tk.Label(cf,text="",bg=b,fg="#888",font=("",8)); self.ll.pack()

        sf=tk.LabelFrame(self.r,text="参数",fg=f,bg=b,font=("",10,"bold"),padx=8,pady=4); sf.pack(fill="x",padx=10,pady=4)
        for lb,key in [("死区","deadzone"),("平滑","smooth")]:
            rw=tk.Frame(sf,bg=b); rw.pack(fill="x")
            tk.Label(rw,text=lb,bg=b,fg=f,font=("",9)).pack(side="left")
            v=tk.IntVar(value=int(S[key]*100)); mn,mx=(0,30) if key=="deadzone" else (5,50)
            tk.Scale(rw,from_=mn,to=mx,orient="horizontal",variable=v,bg=b,fg=f,highlightbackground=b,
                     command=lambda val,k=key: S.update({k:int(val)/100})).pack(side="left",fill="x",expand=True)
        self.rcv=tk.BooleanVar(value=S["rcThr"])
        tk.Checkbutton(sf,text="RC油门（不自回中）",variable=self.rcv,bg=b,fg=f,selectcolor=b,
                       command=lambda: S.update({"rcThr":self.rcv.get()})).pack(anchor="w")

    def _sel(self,evt):
        s=self.lb.curselection(); 
        if not s: return
        d=self.devices[s[0]]; self.sd=d
        hid_connect(int(d["vid"],16),int(d["pid"],16))
        self.st.config(text=f"已连接: {d['name']}",fg="#4c8")
    def _cc(self,k,v):
        try: S["ch"][k]=int(v.get()); _save(S)
        except: pass
    def _scan(self):
        self.devices=scan_controllers(); self.lb.delete(0,"end")
        for d in self.devices: self.lb.insert("end",f"{d['name']}  [{d['vid']}:{d['pid']}]")
        self.st.config(text=f"检测到 {len(self.devices)} 个设备")
    def _learn(self):
        if self.learn: self.learn=False; self._finish_learn(); return
        self.learn=True; self.ld={i:{"min":255,"max":0}for i in range(8)}; self.ls=time.time(); self._lp()
    def _lp(self):
        if not self.learn: self.ll.config(text=""); return
        t=time.time()-self.ls; self.ll.config(text=f"学习中... {max(0,5-t):.1f}s 摇杆画圈！")
        if t>5: self._learn(); return
        hid.poll()
        for i,b in enumerate(hid.raw):
            if b<self.ld[i]["min"]: self.ld[i]["min"]=b
            if b>self.ld[i]["max"]: self.ld[i]["max"]=b
        self.r.after(80,self._lp)
    def _finish_learn(self):
        r=sorted([(i,self.ld[i]["max"]-self.ld[i]["min"])for i in range(8)],key=lambda x:-x[1])
        t4=[x[0]for x in r[:4]]
        for i,k in enumerate(["throttle","yaw","pitch","roll"]):
            S["ch"][k]=t4[i] if i<len(t4) else i*2; self.cv[k].set(str(S["ch"][k]))
        _save(S); self.ll.config(text=f"完成！映射: {t4}")
    def _live(self):
        if not self.learn:
            hid.poll()
            if hid.ok: self.rl.config(text="RAW: "+" ".join(f"{b:02X}"for b in hid.raw))
        self.r.after(50,self._live)
    def _go(self):
        _save(S); self.r.destroy(); flight()

# ═══════════════════════════════════════════════════════════
# FLIGHT (Panda3D — Z-up)
# ═══════════════════════════════════════════════════════════
def flight():
    from panda3d.core import (load_prc_file_data, Vec3, Vec4, Point3, AmbientLight,
        DirectionalLight, TextNode, TransparencyAttrib, CardMaker, NodePath, PandaNode,
        LVector3, Texture, Filename, GeomVertexFormat, GeomVertexData, Geom, GeomTriangles,
        GeomVertexWriter, GeomNode)
    from direct.showbase.ShowBase import ShowBase

    load_prc_file_data("","window-title FeiTian 飞天 — FPV")
    load_prc_file_data("","win-size 1280 720")
    load_prc_file_data("","sync-video 0")

    class App(ShowBase):
        def __init__(self):
            ShowBase.__init__(self)
            self.setBackgroundColor(.53,.81,.94,1)
            self.disableMouse()

            al=AmbientLight('al'); al.setColor(Vec4(.5,.5,.5,1)); self.render.attachNewNode(al)
            dl=DirectionalLight('dl'); dl.setColor(Vec4(1,.95,.8,1))
            dln=self.render.attachNewNode(dl); dln.setHpr(45,-45,0)
            self.render.setLight(self.render.attachNewNode(al)); self.render.setLight(dln)

            # Ground (Panda3D Z-up: ground is XY plane at Z=0)
            cm=CardMaker('gnd'); cm.setFrame(-250,250,-250,250)
            gnd=self.render.attachNewNode(cm.generate()); gnd.setPos(0,0,0)
            tex=Texture(); import numpy as np
            arr=np.zeros((512,512,3),dtype=np.uint8); arr[:,:,1]=140; arr[:,:,0]=90
            arr[::16,:,:]=60; arr[:,::16,:]=60
            tex.setup2dTexture(512,512,Texture.T_unsigned_byte,Texture.F_rgb); tex.setRamImage(arr.tobytes())
            gnd.setTexture(tex)

            # Trees (Z-up: cylinders along Z)
            for i in range(80):
                x,y=(np.random.random()*2-1)*240,(np.random.random()*2-1)*240
                if np.sqrt(x*x+y*y)<20: continue
                h=1.5+np.random.random()*3
                cm2=CardMaker('t'); cm2.setFrame(-.1,.1,-.1*h,.1*h)
                t=self.render.attachNewNode(cm2.generate()); t.setPos(x,y,.1); t.setBillboardAxis()
                t.setColor(.3+.2*np.random.random(),.5+.3*np.random.random(),.1+.1*np.random.random())

            # Launch pad (Z-up: cylinder on XY plane)
            cm3=CardMaker('pad'); cm3.setFrame(-1.5,1.5,-1.5,1.5)
            pad=self.render.attachNewNode(cm3.generate()); pad.setPos(0,0,.01)
            pad.setColor(.5,.5,.5)

            # Drone (Z-up)
            self.drone=self.render.attachNewNode(PandaNode("drone")); self.drone.setPos(0,0,2.5)
            # Body
            cm4=CardMaker('hub'); cm4.setFrame(-.25,.25,-.25,.25)
            hub=self.drone.attachNewNode(cm4.generate()); hub.setPos(0,0,.1); hub.setColor(.15,.15,.25)
            # Arms + rotors
            self.rotors=[]; colors=[(1,.2,.2,1),(.2,1,.2,1),(1,1,.2,1),(.2,1,1,1)]
            for i in range(4):
                a=i*np.pi/2; cx,cy=np.cos(a),np.sin(a)
                cm5=CardMaker('arm'); cm5.setFrame(-.04,.04,-.45,.45)
                arm=self.drone.attachNewNode(cm5.generate())
                arm.setPos(cx*.5,cy*.5,.12); arm.setH(i*90); arm.setColor(.2,.2,.3)
                cm6=CardMaker('disc'); cm6.setFrame(-.9,.9,-.9,.9)
                disc=self.drone.attachNewNode(cm6.generate())
                disc.setPos(cx*.9,cy*.9,.16); disc.setColor(*colors[i])
                disc.setTransparency(TransparencyAttrib.MAlpha); self.rotors.append(disc)

            # Camera (Z-up: camera above and behind drone in XY plane)
            self.camera.setPos(0,-10,5); self.camera.lookAt(0,0,2)
            self.camMode='third'

            # HUD
            self.htn=TextNode('hud'); self.htn.setAlign(TextNode.A_center)
            self.htn.setTextColor(1,1,1,.85); self.htn.setShadow(.05,.05)
            hn=self.aspect2d.attachNewNode(self.htn); hn.setScale(.06); hn.setPos(0,0,-.85)
            self.hin=TextNode('hint'); self.hin.setAlign(TextNode.A_center)
            self.hin.setTextColor(1,1,1,.35); self.hin.setText("V:视角 R:重置 Esc:退出")
            self.aspect2d.attachNewNode(self.hin).setScale(.04); self.aspect2d.attachNewNode(self.hin).setPos(0,0,-.93)

            # State (Z-up: pos.xy=horizontal, pos.z=altitude)
            self.pos=Vec3(0,0,2.5); self.vel=Vec3(0,0,0)
            self.rot=LVector3(0,0,0); self.avel=LVector3(0,0,0)
            self.thr=[0,0,0,0]; self.inp={k:0 for k in['throttle','pitch','roll','yaw']}
            self.keys={}
            self.accept('escape',sys.exit)
            self.accept('v',lambda:setattr(self,'camMode','fpv'if self.camMode=='third'else'third'))
            self.accept('r',self._rst)
            for k in['w','s','a','d','arrow_up','arrow_down','arrow_left','arrow_right']:
                self.accept(k,self._k,[k,True]); self.accept(k+'-up',self._k,[k,False])
            self.taskMgr.add(self._upd,'upd')
        def _k(self,k,d): self.keys[k]=d
        def _rst(self): self.pos=Vec3(0,0,2.5); self.vel=Vec3(0,0,0); self.rot=LVector3(0,0,0); self.avel=LVector3(0,0,0)
        def _upd(self,task):
            dt=min(globalClock.getDt(),.05)
            if hid.ok:
                for n in['throttle','yaw','pitch','roll']:
                    bi=S['ch'].get(n,{'throttle':0,'yaw':2,'pitch':3,'roll':4}[n])
                    v=((hid.raw[bi]if bi<len(hid.raw)else 127)-127)/127
                    v+=S['sub'].get(n,0)/127
                    if S['inv'].get(n,False): v=-v
                    self.inp[n]=max(-1,min(1,v))
                if S['rcThr']: self.inp['throttle']=(self.inp['throttle']+1)/2
            else:
                self.inp['throttle']=(1 if self.keys.get('w')else 0)+(-1 if self.keys.get('s')else 0)
                self.inp['pitch']=(-1 if self.keys.get('arrow_up')else 0)+(1 if self.keys.get('arrow_down')else 0)
                self.inp['roll']=(-1 if self.keys.get('arrow_left')else 0)+(1 if self.keys.get('arrow_right')else 0)
                self.inp['yaw']=(-1 if self.keys.get('a')else 0)+(1 if self.keys.get('d')else 0)
            # Physics (Z-up: gravity along -Z)
            t=max(0,min(1,self.inp['throttle']))*.85
            m0=t-self.inp['pitch']+self.inp['yaw']; m1=t+self.inp['roll']-self.inp['yaw']
            m2=t+self.inp['pitch']+self.inp['yaw']; m3=t-self.inp['roll']-self.inp['yaw']
            self.thr=[max(0,min(1,v))for v in[m0,m1,m2,m3]]
            thrust=sum(self.thr)*4.5
            f=Vec3(0,0,thrust-9.81*.7)  # Z-up: thrust along +Z, gravity along -Z
            f.x-=.3*self.vel.x; f.y-=.3*self.vel.y; f.z-=.06*self.vel.z
            self.vel+=f*dt/.7; self.pos+=self.vel*dt
            if self.pos.z<.06: self.pos.z=.06
            if self.pos.z<.1 and self.vel.z<0: self.vel.z*=-.25; self.vel.x*=.9; self.vel.y*=.9
            # Angular (Z-up: pitch around X, roll around Y, yaw around Z)
            arm=.18; I=.005
            tx=(self.thr[2]-self.thr[0])*arm; ty=(self.thr[1]-self.thr[3])*arm
            tz=((self.thr[0]+self.thr[2])-(self.thr[1]+self.thr[3]))*.015
            aa=Vec3(tx,ty,tz)/I
            aa.x-=2.0*self.avel.x; aa.y-=2.0*self.avel.y; aa.z-=2.0*self.avel.z
            self.avel+=aa*dt; self.rot+=self.avel*dt
            self.rot.x=max(-1.4,min(1.4,self.rot.x)); self.rot.y=max(-1.4,min(1.4,self.rot.y))
            # Apply to drone (Z-up: pitch=rot.x, roll=rot.y, yaw=rot.z)
            self.drone.setPos(self.pos)
            self.drone.setHpr(self.rot.z*57.3,self.rot.x*57.3,self.rot.y*57.3)
            for i,r in enumerate(self.rotors): r.setR(r.getR()+(self.thr[i]*200+20)*dt)
            # Camera
            if self.camMode=='fpv':
                self.camera.setPos(self.pos.x,self.pos.y,self.pos.z+.15)
                h,p,r=self.rot.z*57.3,self.rot.x*57.3,self.rot.y*57.3
                from panda3d.core import Mat4; m=Mat4.rotateMat(h,p,r)
                fwd=m.xformVec(Vec3(0,1,0))
                self.camera.lookAt(self.pos+fwd*10)
            else:
                target=Vec3(self.pos.x,self.pos.y-8,self.pos.z+4)
                self.camera.setPos(self.camera.getPos()*.92+target*.08)
                self.camera.lookAt(self.pos+Vec3(0,2,0))
            # HUD
            spd=pow(self.vel.x**2+self.vel.y**2,.5)
            self.htn.setText(f"{self.pos.z:.1f}m   {spd:.1f}m/s   {int(sum(self.thr)/4*100)}%")
            return task.cont
    App().run()

def main():
    Setup()
