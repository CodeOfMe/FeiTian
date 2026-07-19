"""FeiTian — Panda3D FPV drone simulator (DirectGUI setup)."""
import json,math,os,random,sys,threading,time
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

_hid_thread=None
def hid_connect(vid,pid):
  global _hid_thread
  stop_reader()
  if start_reader(vid,pid):
    def loop():
      while True:
        r = get_reader()
        if r is None or not r.connected:
          break
        hid.poll()
        time.sleep(.01)
    if _hid_thread and _hid_thread.is_alive():
      pass # old thread will die because stop_reader() already killed the reader
    _hid_thread=threading.Thread(target=loop,daemon=True)
    _hid_thread.start()

# ═══════════ PANDA3D SETUP + FLIGHT ═══════════
from panda3d.core import (load_prc_file_data,Vec3,Vec4,Point3,AmbientLight,
  DirectionalLight,TextNode,TransparencyAttrib,CardMaker,NodePath,PandaNode,
  LVector3,Texture,GeomVertexFormat,GeomVertexData,Geom,GeomTriangles,
  GeomVertexWriter,GeomNode,Mat4,PGTop)
from direct.showbase.ShowBase import ShowBase
from direct.gui.DirectGui import (DirectFrame,DirectButton,DirectLabel,
  DirectScrolledList,DirectSlider,DirectCheckButton,DirectEntry)
load_prc_file_data("","window-title FeiTian — FPV");load_prc_file_data("","win-size 1280 720");load_prc_file_data("","sync-video 0")

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
    self.setBackgroundColor(.1,.1,.18,1);self.disableMouse()
    self.devlist=scan_controllers();self.setup_done=False
    self._build_setup()
    self.learn=False;self.ld=None;self.ls=0
    self.taskMgr.add(self._setup_tick,'setup_tick')

  def _build_setup(self):
    bg=(.08,.08,.18,1);fg=(1,1,1,1);ac=(.97,.52,.12,1);dk=(.12,.12,.24,1);tx=(.6,.6,.7,1)
    # Title
    DirectLabel(text="FeiTian",scale=.12,pos=(0,0,.85),text_fg=ac,frameColor=(0,0,0,0))
    DirectLabel(text="FPV Drone Simulator",scale=.05,pos=(0,0,.76),text_fg=tx,frameColor=(0,0,0,0))

    # Device list
    DirectLabel(text="Controllers",scale=.06,pos=(-.65,0,.66),text_fg=fg,text_align=TextNode.A_left,frameColor=(0,0,0,0))
    items=[f"{d['name']} [{d['vid']}:{d['pid']}]" for d in self.devlist]
    self.dlist=DirectScrolledList(
      parent=self.aspect2d,pos=(-.65,0,.3),frameSize=(-.05,.55,-.05,.35),
      numItemsVisible=5,items=items,itemFrame_frameSize=(-.02,.48,-.02,.05),
      itemFrame_frameColor=dk,forceHeight=.07,incButton_pos=(.5,0,-.33),
      decButton_pos=(.5,0,.33))
    self.dlist.addItem("Keyboard")
    self.dev_status=DirectLabel(text=f"Found {len(self.devlist)} devices",scale=.04,pos=(-.65,0,-.15),text_fg=(.3,.8,.3,1),text_align=TextNode.A_left,frameColor=(0,0,0,0))
    DirectButton(text="Rescan",scale=.045,pos=(-.15,0,-.15),command=self._rescan,frameColor=dk,text_fg=fg,borderWidth=(1,1))

    # Channel mapping
    DirectLabel(text="Channel Map",scale=.06,pos=(.1,0,.66),text_fg=fg,text_align=TextNode.A_left,frameColor=(0,0,0,0))
    self.raw_label=DirectLabel(text="RAW: -- "*8,scale=.04,pos=(.1,0,.6),text_fg=ac,text_align=TextNode.A_left,frameColor=(0,0,0,0))
    self.centries={};self.cinverts={};self.csubs={}
    ch_labels=[("throttle","Throttle"),("yaw","Yaw"),("pitch","Pitch"),("roll","Roll")]
    for i,(key,lb) in enumerate(ch_labels):
      y=.52-i*.09
      DirectLabel(text=lb,scale=.045,pos=(.1,0,y),text_fg=fg,text_align=TextNode.A_left,frameColor=(0,0,0,0))
      e=DirectEntry(scale=.04,pos=(.28,0,y-.005),width=3,numLines=1,initialText=str(S["ch"].get(key,0)),
             frameColor=dk,text_fg=fg,focus=0,command=lambda txt,k=key:self._ch_changed(k,txt))
      self.centries[key]=e
      cb=DirectCheckButton(text="Inv",scale=.04,pos=(.42,0,y),indicatorValue=S["inv"].get(key,False),
                 frameColor=(0,0,0,0),text_fg=tx,
                 command=lambda val,k=key:self._inv_changed(k,val))
      self.cinverts[key]=cb
      DirectLabel(text="Sub",scale=.035,pos=(.49,0,y),text_fg=tx,frameColor=(0,0,0,0))
      se=DirectEntry(scale=.035,pos=(.55,0,y-.005),width=4,numLines=1,initialText=str(S["sub"].get(key,0)),
              frameColor=dk,text_fg=fg,focus=0,command=lambda txt,k=key:self._sub_changed(k,txt))
      self.csubs[key]=se
    DirectButton(text="Auto-Detect",scale=.045,pos=(.5,0,.52-.36),command=self._learn_start,frameColor=dk,text_fg=ac,borderWidth=(1,1))
    self.learn_label=DirectLabel(text="",scale=.035,pos=(.5,0,.52-.42),text_fg=(.5,.5,.5,1),text_align=TextNode.A_left,frameColor=(0,0,0,0))

    # Settings
    DirectLabel(text="Settings",scale=.06,pos=(-.65,0,-.3),text_fg=fg,text_align=TextNode.A_left,frameColor=(0,0,0,0))
    DirectLabel(text="Deadzone",scale=.045,pos=(-.65,0,-.37),text_fg=tx,text_align=TextNode.A_left,frameColor=(0,0,0,0))
    self.dz_slider=DirectSlider(range=(0,30),value=int(S["deadzone"]*100),pos=(-.45,0,-.38),scale=.25,
                   frameColor=dk,thumb_frameColor=ac,command=lambda:self._slider('deadzone'))
    self.dz_label=DirectLabel(text=str(int(S["deadzone"]*100)),scale=.04,pos=(-.2,0,-.38),text_fg=fg,frameColor=(0,0,0,0))
    DirectLabel(text="Smooth",scale=.045,pos=(-.65,0,-.46),text_fg=tx,text_align=TextNode.A_left,frameColor=(0,0,0,0))
    self.sm_slider=DirectSlider(range=(5,50),value=int(S["smooth"]*100),pos=(-.45,0,-.47),scale=.25,
                   frameColor=dk,thumb_frameColor=ac,command=lambda:self._slider('smooth'))
    self.sm_label=DirectLabel(text=str(int(S["smooth"]*100)),scale=.04,pos=(-.2,0,-.47),text_fg=fg,frameColor=(0,0,0,0))
    self.rc_cb=DirectCheckButton(text="RCThrottle",scale=.045,pos=(-.65,0,-.56),indicatorValue=S["rcThr"],
                   text_fg=tx,frameColor=(0,0,0,0),
                   command=lambda val:S.update({"rcThr":val}))

    # Launch
    DirectButton(text="Start Flight",scale=.07,pos=(0,0,-.8),command=self._launch,frameColor=ac,text_fg=(1,1,1,1),
           borderWidth=(1,1),frameSize=(-2.5,2.5,-.5,.5))
    DirectLabel(text="W/SThrottle ^vPitch <>Roll A/DYaw VView RReset EscExit",scale=.035,pos=(0,0,-.93),
          text_fg=(.3,.3,.3,1),frameColor=(0,0,0,0))

  def _ch_changed(self,k,txt):
    try:S["ch"][k]=int(txt);_save(S)
    except:pass
  def _inv_changed(self,k,val):
    S["inv"][k]=bool(val);_save(S)
  def _sub_changed(self,k,txt):
    try:S["sub"][k]=int(txt);_save(S)
    except:pass
  def _slider(self,k):
    if k=='deadzone':v=self.dz_slider['value'];S['deadzone']=v/100;self.dz_label['text']=str(int(v))
    else:v=self.sm_slider['value'];S['smooth']=v/100;self.sm_label['text']=str(int(v))
  def _rescan(self):
    self.devlist=scan_controllers()
    items=[f"{d['name']} [{d['vid']}:{d['pid']}]" for d in self.devlist]
    self.dlist['items']=items+["Keyboard"]
    self.dev_status['text']=f"Found {len(self.devlist)} devices"
  def _learn_start(self):
    if self.learn:self.learn=False;self._finish_learn();return
    self.learn=True;self.ld={i:{"min":255,"max":0}for i in range(16)};self.ls=time.time();self._learn_poll()
  def _learn_poll(self):
    if not self.learn:self.learn_label['text']="";return
    t=time.time()-self.ls;self.learn_label['text']=f"学习Sub... {max(0,5-t):.1f}s move sticks!！"
    if t>5:self._learn_start();return
    hid.poll()
    for i,b in enumerate(hid.raw):
      if b<self.ld[i]["min"]:self.ld[i]["min"]=b
      if b>self.ld[i]["max"]:self.ld[i]["max"]=b
  def _finish_learn(self):
    r=sorted([(i,self.ld[i]["max"]-self.ld[i]["min"])for i in range(len(self.ld))],key=lambda x:-x[1])
    t4=[x[0]for x in r[:4]]
    for i,k in enumerate(["throttle","yaw","pitch","roll"]):
      S["ch"][k]=t4[i]if i<len(t4)else i*2;self.centries[k].set(str(S["ch"][k]))
    _save(S);self.learn_label['text']=f"Done! Map: {t4}"
  def _setup_tick(self,task):
    if self.setup_done:return task.done
    if not self.learn:
      hid.poll()
      if hid.ok:self.raw_label['text']="RAW: "+" ".join(f"{b:02X}"for b in hid.raw)
    # Check device selection
    sel=self.dlist.getSelectedIndex()
    if sel is not None and sel<len(self.devlist):
      d=self.devlist[sel];hid_connect(int(d["vid"],16),int(d["pid"],16))
      self.dev_status['text']=f"Connected: {d['name']}"
    return task.cont
  def _launch(self):
    self.setup_done=True
    # Clear setup GUI
    for child in self.aspect2d.getChildren():child.removeNode()
    self._build_flight()

  def _build_flight(self):
    self.setBackgroundColor(.53,.81,.94,1)
    al=AmbientLight('al');al.setColor(Vec4(.45,.5,.55,1))
    dl=DirectionalLight('dl');dl.setColor(Vec4(1,.95,.8,1))
    dln=self.render.attachNewNode(dl);dln.setHpr(45,-40,0)
    self.render.setLight(self.render.attachNewNode(al));self.render.setLight(dln)

    for c,h in[(Vec4(.53,.81,.94,1),.1),(Vec4(.7,.9,1,1),.45),(Vec4(.4,.6,.8,1),1)]:
      cm=CardMaker('sky');cm.setFrame(-600,600,-600,600)
      n=self.render.attachNewNode(cm.generate());n.setPos(0,0,h*400);n.setColor(c)
      n.setBin('background',0);n.setDepthWrite(False)

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
        a=y*RES+x;b=a+1;c=a+RES;d=c+1;tris.addVertices(a,b,c);tris.addVertices(b,d,c)
    geom=Geom(vdata);geom.addPrimitive(tris)
    tnode=GeomNode('terrain');tnode.addGeom(geom)
    terrain=self.render.attachNewNode(tnode);terrain.setPos(-SIZE/2,-SIZE/2,0)

    for r in range(6):
      cm=CardMaker('pad');cm.setFrame(-3,3,-3,3)
      p=self.render.attachNewNode(cm.generate());p.setPos(0,0,.005+r*.002);p.setColor(.4+.1*r,.4+.1*r,.4+.1*r)
    rcm=CardMaker('ring');rcm.setFrame(-2.8,2.8,-2.8,2.8)
    ring=self.render.attachNewNode(rcm.generate());ring.setPos(0,0,.02);ring.setColor(.9,.9,.9)

    for _ in range(150):
      tx=(random.random()-.5)*450;ty=(random.random()-.5)*450
      if math.sqrt(tx*tx+ty*ty)<20:continue
      idx=int((ty/SIZE+.5)*RES);idy=int((tx/SIZE+.5)*RES)
      hz=heights[min(idx,RES-1),min(idy,RES-1)]if 0<=idx<RES and 0<=idy<RES else 0
      h=1.5+random.random()*4;sh=.2+.2*random.random()
      t=self.loader.loadModel("models/smiley");t.setScale(.12,.12,h*.4);t.setPos(tx,ty,hz+h*.2);t.reparentTo(self.render)
      c=self.loader.loadModel("models/smiley");c.setScale(.5+.6*random.random());c.setPos(tx,ty,hz+h*.7);c.reparentTo(self.render)
      c.setColor(sh,.35+sh,.05+sh*.3)

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
    self.hin.setText("V:View R:Reset Esc:Exit")
    self.aspect2d.attachNewNode(self.hin).setScale(.04);self.aspect2d.attachNewNode(self.hin).setPos(0,0,-.9)

    self.pos=Vec3(0,0,hz0+3);self.vel=Vec3(0,0,0);self.rot=LVector3(0,0,0);self.avel=LVector3(0,0,0)
    self.thr=[0,0,0,0];self.inp={k:0 for k in['throttle','pitch','roll','yaw']};self.keys={}
    self.accept('escape',lambda:self._toggle_setup())
    self.accept('v',lambda:setattr(self,'camMode','fpv'if self.camMode=='third'else'third'))
    self.accept('r',self._rst)
    for k in['w','s','a','d','arrow_up','arrow_down','arrow_left','arrow_right']:
      self.accept(k,self._k,[k,True]);self.accept(k+'-up',self._k,[k,False])
    self.taskMgr.remove('setup_tick')
    self.taskMgr.add(self._flight_tick,'flight_tick')

  def _toggle_setup(self):
    self.setup_done=False;self._clear_all()
    self.setBackgroundColor(.1,.1,.18,1)
    self._build_setup()
    self.taskMgr.remove('flight_tick')
    self.taskMgr.add(self._setup_tick,'setup_tick')

  def _clear_all(self):
    self.render.getChildren().clear()
    for child in self.aspect2d.getChildren():child.removeNode()
    for task in list(self.taskMgr.getAllTasks()):
      if task.name not in('dataLoop',):self.taskMgr.remove(task.name)

  def _k(self,k,d):self.keys[k]=d
  def _rst(self):
    self.pos=Vec3(0,0,heights[RES//2,RES//2]+3);self.vel=Vec3(0,0,0);self.rot=LVector3(0,0,0);self.avel=LVector3(0,0,0)

  def _flight_tick(self,task):
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
    self.htn.setText(f"ALT {self.pos.z:.1f}m  SPD {spd:.1f}m/s  THR {int(sum(self.thr)/4*100)}%  {self.camMode.upper()}")
    return task.cont

def main():
  try:
    app=App();app.run()
  except Exception as e:
    import traceback;traceback.print_exc()
    try:
      import tkinter.messagebox as mb;mb.showerror("FeiTian Error",f"Start failed:\n{e}")
    except:pass
    sys.exit(1)
