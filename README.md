# FeiTian 飞天 🚁

[![PyPI version](https://img.shields.io/pypi/v/feitian.svg)](https://pypi.org/project/feitian/)
[![License: GPLv3](https://img.shields.io/badge/license-GPLv3-blue.svg)](LICENSE)
[![Python 3.9+](https://img.shields.io/badge/python-3.9%2B-blue)](https://www.python.org/)

**飞天** — 多旋翼 FPV 无人机飞行模拟器。

一个基于 WebGL (Three.js) 的无人机飞行模拟器，通过 pywebview 打包为原生桌面应用。支持键盘和游戏手柄操控，提供第三人称和 FPV 视角。

---

## ✨ 特性

- 🚁 **真实飞行动力学** — 四轴飞行器物理模型：推力混控、力矩计算、空气阻力、地面碰撞
- 🎮 **多种操控方式** — 键盘映射 + 游戏手柄 (Gamepad API, Mode 2)
- 👁️ **双视角** — 第三人称平滑跟随 + FPV 第一人称
- 📊 **完整 HUD** — 人工地平线、高度计、垂直速度、油门、姿态角
- 🌳 **3D 场景** — 程序化地形、树木、发射台
- 🖥️ **原生桌面** — pywebview 窗口，跨平台 (Windows/macOS/Linux)

---

## 📦 安装

```bash
pip install feitian
```

## 🚀 运行

```bash
feitian
```

或：

```bash
python -m feitian
```

---

## 🎮 操控

| 操作     | 键盘          | 手柄 (Mode 2)    |
| -------- | ------------- | ---------------- |
| 油门     | W / S         | 左摇杆 Y         |
| 俯仰     | ↑ / ↓         | 右摇杆 Y         |
| 横滚     | ← / →         | 右摇杆 X         |
| 偏航     | A / D         | 左摇杆 X         |
| 切换视角 | V             | —                |
| 重置     | R             | —                |

---

## 🛠️ 技术栈

| 层级     | 技术                              |
| -------- | --------------------------------- |
| 3D 引擎  | Three.js (WebGL 2.0)              |
| 物理     | 自研多旋翼动力学引擎              |
| 前端     | 原生 HTML5 Canvas + ES Modules    |
| 后端     | FastAPI + uvicorn                 |
| 桌面包装 | pywebview (系统原生 WebView)      |
| 构建     | Hatchling                         |

---

## 🏗️ 开发

```bash
# 克隆仓库
git clone https://github.com/CodeOfMe/FeiTian.git
cd FeiTian

# 可编辑安装
pip install -e .

# 运行
feitian
```

前端代码位于 `feitian/static/`，修改后无需重新安装即可生效。

### 项目结构

```
FeiTian/
├── feitian/
│   ├── __init__.py          # 包元数据
│   ├── __main__.py          # python -m 入口
│   ├── server.py            # FastAPI + pywebview 启动
│   └── static/
│       ├── index.html       # 主页面
│       ├── css/main.css     # 样式
│       └── js/
│           ├── main.js      # 入口 + 游戏循环
│           ├── scene.js     # Three.js 场景/相机/光照
│           ├── drone.js     # 四轴飞行器 3D 模型
│           ├── terrain.js   # 程序化地形
│           ├── physics.js   # 飞行动力学引擎
│           ├── input.js     # 键盘 + 手柄输入
│           └── hud.js       # HUD 叠加层
├── pyproject.toml           # 构建配置
└── README.md
```

---

## 📄 许可

GNU General Public License v3.0 © CodeOfMe

---

*FeiTian 飞天 — Let your drone dreams take flight.* 🚁✨
