"""FeiTian 飞天 — Panda3D FPV drone simulator."""
import json,math,os,random,sys,threading,time,tkinter as tk
from pathlib import Path
import numpy as np
from feitian.controller_scanner import scan_controllers
from feitian.hid_reader import start_reader,stop_reader,get_reader

CFG=Path(__file__).parent.parent/"feitian_settings.json"
def _load():
    try:return json.loads(CFG.read_text())if CFG.exists()else{}
    except:return{}
def _save(s):CFG.write_text(json.dumps(s))
S=_load()
for k,v in{"mode":2,"deadzone":.08,"smooth":.18,"rcThr":False,
           "ch":{"throttle":0,"yaw":2,"pitch":3,"roll":4},
           "inv":{"throttle":False,"yaw":False,"pitch":False,"roll":False},
           "sub":{"throttle":0,"yaw":0,"pitch":0,"roll":0}}.items():
    S.setdefault(k,v)

class HID:
    def __init__(self):self.raw=[0]*8;self.axes=[0.]*4;self.ok=False
    def poll(self):
        r=get_reader()
        if r and r.connected:
            with r._lock:self.raw=list(r.raw_bytes);self.axes=list(r.axes)
            self.ok=True
        else:self.ok=False
hid=HID()

def hid_connect(vid,pid):
    stop_reader()
    if start_reader(vid,pid):
        def loop():
            while get_reader()and get_reader().connected:hid.poll();time.sleep(.01)
        threading.Thread(target=loop,daemon=True).start()

# ═══════════ SETUP ═══════════
class Setup:
    def __init__(self):
        self.r=tk.Tk();self.r.title("FeiTian 飞天");self.r.resizable(True,False)
        self.r.configure(bg="#15152a");self.devices=scan_controllers();self.sd=None
        f,b,e="#ccc","#15152a","#222240"
        hdr=tk.Frame(self.r,bg="#0d0d1a",padx=15,pady=12);hdr.pack(fill="x")
        tk.Label(hdr,text="FeiTian 飞天",bg="#0d0d1a",fg="#f8851f",font=("",18,"bold")).pack()
        tk.Label(hdr,text="FPV Drone Flight Simulator",bg="#0d0d1a",fg="#666",font=("",9)).pack()

        fr=tk.LabelFrame(self.r,text=" 控制器 ",fg=f,bg=b,font=("",10,"bold"),padx=10,pady=6)
        fr.pack(fill="x",padx=12,pady=(10,5))
        self.lb=tk.Listbox(fr,height=5,bg=e,fg=f,selectbackground="#f8851f",font=("Consolas",10),border=0,highlightthickness=0)
        self.lb.pack(fill="x")
        for d in self.devices:self.lb.insert("end",f"  {d['name']}    [{d['vid']}:{d['pid']}]")
        self.lb.bind("<<ListboxSelect>>",self._sel)
        bf=tk.Frame(fr,bg=b);bf.pack(fill="x",pady=(4,0))
        self.st=tk.Label(bf,text=f"检测到 {len(self.devices)} 个设备",bg=b,fg="#4c8",font=("",9));self.st.pack(side="left")
        tk.Button(bf,text="重新扫描",command=self._scan,bg=e,fg=f,border=0,padx=12,font=("",9)).pack(side="right")

        cf=tk.LabelFrame(self.r,text=" 通道映射与微调 ",fg=f,bg=b,font=("",10,"bold"),padx=10,pady=6)
        cf.pack(fill="x",padx=12,pady=5)
        self.rl=tk.Label(cf,text="RAW: -- "*8,bg=b,fg="#f8851f",font=("Consolas",10));self.rl.pack(anchor="w",pady=(0,4))
        self.cv={};self.iv={};self.sv={}
        for key,lb in[("throttle","油门"),("yaw","偏航"),("pitch","俯仰"),("roll","横滚")]:
            rw=tk.Frame(cf,bg=b);rw.pack(fill="x",pady=2)
            tk.Label(rw,text=lb,bg=b,fg=f,width=5,font=("",10)).pack(side="left")
            sv=tk.Spinbox(rw,from_=0,to=15,width=3,font=("Consolas",10),bg=e,fg=f,buttonbackground=e,state="readonly",command=lambda k=key:self._cc(k))
            sv.pack(side="left",padx=(4,2));sv.delete(0,"end");sv.insert(0,str(S["ch"].get(key,0)));self.cv[key]=sv
            tv=tk.BooleanVar(value=S["inv"].get(key,False))
            tk.Checkbutton(rw,text="反",variable=tv,bg=b,fg=f,selectcolor=e,font=("",8),command=lambda k=key,v=tv:self._ci(k,v)).pack(side="left",padx=2);self.iv[key]=tv
            tk.Label(rw,text="中",bg=b,fg=f,font=("",8)).pack(side="left")
            ev=tk.Entry(rw,width=4,font=("Consolas",9),bg=e,fg=f,insertbackground=f);ev.pack(side="left")
            ev.insert(0,str(S["sub"].get(key,0)));ev.bind("<FocusOut>",lambda e,k=key,entry=ev:self._cs(k,entry));self.sv[key]=ev
        bb=tk.Frame(cf,bg=b);bb.pack(fill="x",pady=(6,0))
        tk.Button(bb,text="自动检测通道",command=self._learn,bg=e,fg="#f8851f",border=0,padx=10,font=("",10)).pack(side="left")
        tk.Button(bb,text="保存设置",command=lambda:_save(S),bg=e,fg=f,border=0,padx=10,font=("",9)).pack(side="right")
        self.ll=tk.Label(cf,text="",bg=b,fg="#888",font=("",9));self.ll.pack(anchor="w",pady=(4,0))

        sf=tk.LabelFrame(self.r,text=" 参数 ",fg=f,bg=b,font=("",10,"bold"),padx=10,pady=6)
        sf.pack(fill="x",padx=12,pady=5)
        for lb,key,mn,mx in[("死区","deadzone",0,30),("平滑度","smooth",5,50)]:
            rw=tk.Frame(sf,bg=b);rw.pack(fill="x",pady=2)
            tk.Label(rw,text=lb,bg=b,fg=f,width=6,font=("",10)).pack(side="left")
            v=tk.IntVar(value=int(S[key]*100))
            tk.Scale(rw,from_=mn,to=mx,orient="horizontal",variable=v,bg=b,fg=f,highlightbackground=b,length=200,command=lambda val,k=key:S.update({k:int(val)/100})).pack(side="left",padx=8)
            tk.Label(rw,textvariable=v,bg=b,fg=f,width=3,font=("",9)).pack(side="left")
        self.rcv=tk.BooleanVar(value=S["rcThr"])
        tk.Checkbutton(sf,text="RC油门模式（油门杆不自回中）",variable=self.rcv,bg=b,fg=f,selectcolor=b,font=("",9),command=lambda:S.update({"rcThr":self.rcv.get()})).pack(anchor="w",pady=(4,0))

        tk.Button(self.r,text="开始飞行",command=self._go,bg="#f8851f",fg="#fff",font=("",13,"bold"),padx=40,pady=10,border=0,cursor="hand2").pack(pady=14)
        tk.Label(self.r,text="W/S油门 ↑↓俯仰 ←→横滚 A/D偏航  V:视角  R:重置  Esc:退出",bg=b,fg="#555",font=("",8)).pack(pady=(0,10))
        self.r.protocol("WM_DELETE_WINDOW",sys.exit)
        self.learn=False;self.ld=None;self.ls=0
        self.r.after(100,self._live);self.r.mainloop()

    def _sel(self,evt):
        s=self.lb.curselection()
        if not s:return
        d=self.devices[s[0]];self.sd=d
        hid_connect(int(d["vid"],16),int(d["pid"],16))
        self.st.config(text=f"已连接: {d['name']}",fg="#4c8")
    def _cc(self,k):
        try:v=int(self.cv[k].get());S["ch"][k]=v;_save(S)
        except:pass
    def _ci(self,k,v):S["inv"][k]=v.get();_save(S)
    def _cs(self,k,entry):
        try:S["sub"][k]=int(entry.get());_save(S)
        except:pass
    def _scan(self):
        self.devices=scan_controllers();self.lb.delete(0,"end")
        for d in self.devices:self.lb.insert("end",f"  {d['name']}    [{d['vid']}:{d['pid']}]")
        self.st.config(text=f"检测到 {len(self.devices)} 个设备")
    def _learn(self):
        if self.learn:self.learn=False;self._finish_learn();return
        self.learn=True;self.ld={i:{"min":255,"max":0}for i in range(16)};self.ls=time.time();self._lp()
    def _lp(self):
        if not self.learn:self.ll.config(text="");return
        t=time.time()-self.ls;self.ll.config(text=f"学习中... {max(0,5-t):.1f}s  请将两个摇杆画圈推到极限！")
        if t>5:self._learn();return
        hid.poll()
        for i,b in enumerate(hid.raw):
            if b<self.ld[i]["min"]:self.ld[i]["min"]=b
            if b>self.ld[i]["max"]:self.ld[i]["max"]=b
        self.r.after(80,self._lp)
    def _finish_learn(self):
        r=sorted([(i,self.ld[i]["max"]-self.ld[i]["min"])for i in range(len(self.ld))],key=lambda x:-x[1])
        t4=[x[0]for x in r[:4]]
        for i,k in enumerate(["throttle","yaw","pitch","roll"]):
            S["ch"][k]=t4[i]if i<len(t4)else i*2
            self.cv[k].delete(0,"end");self.cv[k].insert(0,str(S["ch"][k]))
        _save(S);self.ll.config(text=f"完成！映射: {t4}")
    def _live(self):
        if not self.learn:
            hid.poll()
            if hid.ok:self.rl.config(text="RAW: "+" ".join(f"{b:02X}"for b in hid.raw))
        self.r.after(50,self._live)
    def _go(self):
        for k in["throttle","yaw","pitch","roll"]:
            try:S["ch"][k]=int(self.cv[k].get())
            except:pass
            try:S["sub"][k]=int(self.sv[k].get())
            except:pass
        _save(S);self.r.destroy();_flight()

# ═══════════ FLIGHT ═══════════
def flight():
    try:_flight()
    except Exception as e:
        import traceback;traceback.print_exc()
        tk.messagebox.showerror("FeiTian 错误",f"飞行启动失败:\n{e}");sys.exit(1)

def _flight():
    from panda3d.core import (load_prc_file_data,Vec3,Vec4,Point3,AmbientLight,
        DirectionalLight,TextNode,TransparencyAttrib,CardMaker,NodePath,PandaNode,
        LVector3,Texture,GeomVertexFormat,GeomVertexData,Geom,GeomTriangles,
        GeomVertexWriter,GeomNode,Mat4)
    from direct.showbase.ShowBase import ShowBase
    load_prc_file_data("","window-title FeiTian 飞天 — FPV")
    load_prc_file_data("","win-size 1280 720");load_prc_file_data("","sync-video 0")

    SIZE,RES=500,128
    heights=np.zeros((RES,RES),dtype=np.float32)
    for _ in range(4):
        amp=8/(2**_);freq=2**_*.8
        for y in range(RES):
            for x in range(RES):
                heights[y,x]+=amp*math.sin(x*freq*.1)*math.cos(y*freq*.1)+amp*.5*math.sin(x*freq*.05+y*freq*.03)

    class App(ShowBase):
        def __init__(self):
            ShowBase.__init__(self)
            self.setBackgroundColor(.53,.81,.94,1);self.disableMouse()
            al=AmbientLight('al');al.setColor(Vec4(.45,.5,.55,1))
            dl=DirectionalLight('dl');dl.setColor(Vec4(1,.95,.8,1))
            dln=self.render.attachNewNode(dl);dln.setHpr(45,-40,0)
            self.render.setLight(self.render.attachNewNode(al));self.render.setLight(dln)

            # Sky gradient
            for c,h in[(Vec4(.53,.81,.94,1),.1),(Vec4(.7,.9,1,1),.45),(Vec4(.4,.6,.8,1),1)]:
                cm=CardMaker('sky');cm.setFrame(-600,600,-600,600)
                n=self.render.attachNewNode(cm.generate());n.setPos(0,0,h*400);n.setColor(c)
                n.setBin('background',0);n.setDepthWrite(False)

            # Terrain
            fmt=GeomVertexFormat.getV3n3cpt2()
            vdata=GeomVertexData('terrain',fmt,Geom.UHStatic);vdata.setNumRows(RES*RES)
            vtx=GeomVertexWriter(vdata,'vertex');nrm=GeomVertexWriter(vdata,'normal')
            clr=GeomVertexWriter(vdata,'color');txc=GeomVertexWriter(vdata,'texcoord')
            for y in range(RES):
                for x in range(RES):
                    px=(x/(RES-1)-.5)*SIZE;py=(y/(RES-1)-.5)*SIZE;pz=heights[y,x]
                    vtx.addData3f(px,py,pz);txc.addData2f(x/(RES-1)*30,y/(RES-1)*30)
                    clr.addData4f(.2+pz*.02,.5+pz*.03,.15+pz*.01,1)
            for _ in range(RES*RES):nrm.addData3f(0,0,1)
            tris=GeomTriangles(Geom.UHStatic)
            for y in range(RES-1):
                for x in range(RES-1):
                    a=y*RES+x;b=a+1;c=a+RES;d=c+1
                    tris.addVertices(a,b,c);tris.addVertices(b,d,c)
            geom=Geom(vdata);geom.addPrimitive(tris)
            tnode=GeomNode('terrain');tnode.addGeom(geom)
            terrain=self.render.attachNewNode(tnode);terrain.setPos(-SIZE/2,-SIZE/2,0)

            # Launch pad
            for r in range(6):
                cm=CardMaker('pad');cm.setFrame(-3,3,-3,3)
                p=self.render.attachNewNode(cm.generate());p.setPos(0,0,.005+r*.002);p.setColor(.4+.1*r,.4+.1*r,.4+.1*r)
            rcm=CardMaker('ring');rcm.setFrame(-2.8,2.8,-2.8,2.8)
            ring=self.render.attachNewNode(rcm.generate());ring.setPos(0,0,.02);ring.setColor(.9,.9,.9)

            # Trees
            for _ in range(150):
                tx=(random.random()-.5)*450;ty=(random.random()-.5)*450
                if math.sqrt(tx*tx+ty*ty)<20:continue
                idx=int((ty/SIZE+.5)*RES);idy=int((tx/SIZE+.5)*RES)
                hz=heights[min(idx,RES-1),min(idy,RES-1)]if 0<=idx<RES and 0<=idy<RES else 0
                h=1.5+random.random()*4;sh=.2+.2*random.random()
                t=self.loader.loadModel("models/smiley");t.setScale(.12,.12,h*.4);t.setPos(tx,ty,hz+h*.2);t.reparentTo(self.render)
                c=self.loader.loadModel("models/smiley");c.setScale(.5+.6*random.random());c.setPos(tx,ty,hz+h*.7);c.reparentTo(self.render)
                c.setColor(sh,.35+sh,.05+sh*.3)

            # Drone
            self.drone=self.render.attachNewNode(PandaNode("drone"))
            hz0=heights[RES//2,RES//2];self.drone.setPos(0,0,hz0+3)
            hub=self.loader.loadModel("models/smiley");hub.setScale(.3,.3,.12);hub.setPos(0,0,.1);hub.setColor(.05,.05,.15);hub.reparentTo(self.drone)
            self.rotors=[];rc_colors=[(1,.15,.15),(.15,1,.15),(1,1,.15),(.15,1,1)]
            for i in range(4):
                a=i*math.pi/2;cx,cy=math.cos(a),math.sin(a)
                arm=self.loader.loadModel("models/smiley");arm.setScale(.05,.05,.45);arm.setPos(cx*.5,cy*.5,.13);arm.setH(i*90);arm.setColor(.1,.1,.2);arm.reparentTo(self.drone)
                motor=self.loader.loadModel("models/smiley");motor.setScale(.14,.14,.06);motor.setPos(cx*.95,cy*.95,.15);motor.setColor(.3,.3,.35);motor.reparentTo(self.drone)
                disc=self.loader.loadModel("models/smiley");disc.setScale(.9,.9,.015);disc.setPos(cx*.95,cy*.95,.2)
                disc.setColor(*rc_colors[i]);disc.setTransparency(TransparencyAttrib.MAlpha);disc.reparentTo(self.drone);self.rotors.append(disc)
            for a in[.4,2.3,3.9,5.5]:
                cx,cy=math.cos(a),math.sin(a)
                leg=self.loader.loadModel("models/smiley");leg.setScale(.05,.05,.12);leg.setPos(cx*.22,cy*.22,-.05);leg.setColor(.1,.1,.1);leg.reparentTo(self.drone)
            cam=self.loader.loadModel("models/smiley");cam.setScale(.04,.04,.04);cam.setPos(.35,0,.12);cam.setColor(0,0,0);cam.reparentTo(self.drone)

            self.camera.setPos(0,-12,6);self.camera.lookAt(0,0,hz0+3);self.camMode='third'

            self.htn=TextNode('hud');self.htn.setAlign(TextNode.A_center);self.htn.setTextColor(1,1,1,.88);self.htn.setShadow(.04,.04)
            self.aspect2d.attachNewNode(self.htn).setScale(.06);self.aspect2d.attachNewNode(self.htn).setPos(0,0,-.82)
            self.hin=TextNode('hint');self.hin.setAlign(TextNode.A_center);self.hin.setTextColor(1,1,1,.3)
            self.hin.setText("V:视角 R:重置 Esc:退出")
            self.aspect2d.attachNewNode(self.hin).setScale(.04);self.aspect2d.attachNewNode(self.hin).setPos(0,0,-.9)

            self.pos=Vec3(0,0,hz0+3);self.vel=Vec3(0,0,0);self.rot=LVector3(0,0,0);self.avel=LVector3(0,0,0)
            self.thr=[0,0,0,0];self.inp={k:0 for k in['throttle','pitch','roll','yaw']};self.keys={}
            self.accept('escape',sys.exit)
            self.accept('v',lambda:setattr(self,'camMode','fpv'if self.camMode=='third'else'third'))
            self.accept('r',self._rst)
            for k in['w','s','a','d','arrow_up','arrow_down','arrow_left','arrow_right']:
                self.accept(k,self._k,[k,True]);self.accept(k+'-up',self._k,[k,False])
            self.taskMgr.add(self._upd,'upd')

        def _k(self,k,d):self.keys[k]=d
        def _rst(self):
            self.pos=Vec3(0,0,heights[RES//2,RES//2]+3);self.vel=Vec3(0,0,0);self.rot=LVector3(0,0,0);self.avel=LVector3(0,0,0)

        def _upd(self,task):
            dt=min(globalClock.getDt(),.05)
            if hid.ok:
                for n in['throttle','yaw','pitch','roll']:
                    bi=S['ch'].get(n,{'throttle':0,'yaw':2,'pitch':3,'roll':4}[n])
                    v=((hid.raw[bi]if bi<len(hid.raw)else 127)-127)/127
                    v+=S['sub'].get(n,0)/127
                    if S['inv'].get(n,False):v=-v
                    self.inp[n]=max(-1,min(1,v))
                if S['rcThr']:self.inp['throttle']=(self.inp['throttle']+1)/2
            else:
                self.inp['throttle']=(1 if self.keys.get('w')else 0)+(-1 if self.keys.get('s')else 0)
                self.inp['pitch']=(-1 if self.keys.get('arrow_up')else 0)+(1 if self.keys.get('arrow_down')else 0)
                self.inp['roll']=(-1 if self.keys.get('arrow_left')else 0)+(1 if self.keys.get('arrow_right')else 0)
                self.inp['yaw']=(-1 if self.keys.get('a')else 0)+(1 if self.keys.get('d')else 0)

            t=max(0,min(1,self.inp['throttle']))*.85
            m0=t-self.inp['pitch']+self.inp['yaw'];m1=t+self.inp['roll']-self.inp['yaw']
            m2=t+self.inp['pitch']+self.inp['yaw'];m3=t-self.inp['roll']-self.inp['yaw']
            self.thr=[max(0,min(1,v))for v in[m0,m1,m2,m3]]
            thrust=sum(self.thr)*4.5;f=Vec3(0,0,thrust-9.81*.7)
            f.x-=.3*self.vel.x;f.y-=.3*self.vel.y;f.z-=.06*self.vel.z
            self.vel+=f*dt/.7;self.pos+=self.vel*dt

            try:
                idx=int((self.pos.y/SIZE+.5)*RES);idy=int((self.pos.x/SIZE+.5)*RES)
                gz=heights[min(idx,RES-1),min(idy,RES-1)]if 0<=idx<RES and 0<=idy<RES else 0
            except:gz=0
            if self.pos.z<gz+.15:self.pos.z=gz+.15
            if self.pos.z<gz+.2 and self.vel.z<0:self.vel.z*=-.25;self.vel.x*=.9;self.vel.y*=.9

            arm=.18;I=.005
            tx=(self.thr[2]-self.thr[0])*arm;ty=(self.thr[1]-self.thr[3])*arm
            tz=((self.thr[0]+self.thr[2])-(self.thr[1]+self.thr[3]))*.015
            aa=Vec3(tx,ty,tz)/I;aa.x-=2.0*self.avel.x;aa.y-=2.0*self.avel.y;aa.z-=2.0*self.avel.z
            self.avel+=aa*dt;self.rot+=self.avel*dt
            self.rot.x=max(-1.4,min(1.4,self.rot.x));self.rot.y=max(-1.4,min(1.4,self.rot.y))
            self.drone.setPos(self.pos)
            self.drone.setHpr(self.rot.z*57.3,self.rot.x*57.3,self.rot.y*57.3)
            for i,r in enumerate(self.rotors):r.setR(r.getR()+(self.thr[i]*200+20)*dt)

            if self.camMode=='fpv':
                self.camera.setPos(self.pos.x,self.pos.y-1,self.pos.z+.2)
                h,p,r=self.rot.z*57.3,self.rot.x*57.3,self.rot.y*57.3
                m=Mat4.rotateMat(h,p,r);fwd=m.xformVec(Vec3(0,1,0));self.camera.lookAt(self.pos+fwd*15)
            else:
                target=Vec3(self.pos.x,self.pos.y-10,self.pos.z+5)
                self.camera.setPos(self.camera.getPos()*.9+target*.1)
                self.camera.lookAt(self.pos.x,self.pos.y+3,self.pos.z+.5)

            spd=(self.vel.x**2+self.vel.y**2)**.5
            self.htn.setText(f"ALT {self.pos.z:.1f}m    SPD {spd:.1f}m/s    THR {int(sum(self.thr)/4*100)}%    {self.camMode.upper()}")
            return task.cont
    App().run()

def main():
    try:Setup()
    except Exception as e:
        import traceback;traceback.print_exc()
        tk.messagebox.showerror("FeiTian 错误",f"启动失败:\n{e}");sys.exit(1)
