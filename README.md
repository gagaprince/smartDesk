# smartDesk

SmartDesk 智能工作台桌面应用，基于 Vue 3 + Electron + Element Plus，功能架构参考 live-download-app，当前包含两个功能分类：

- **短视频下载**：支持抖音 / TikTok / 快手 / 小红书分享链接批量下载（视频、图文、实况照片），下载目录在功能页内配置。
- **一键裁切头像**：调用内置 Python 子项目 headcut（YuNet 人脸检测 + 可选 rembg 去背景），批量裁切 LoRA 训练用正方形头像。
- **工作流调用配置**：可视化导入并绑定 ComfyUI API 工作流、在线试跑、保存即生成接口文档（由内置 FastAPI 子服务 comfyui-ctrl 驱动）。
- **生图工作流**：选择已注册工作流填参生图，轮询任务并查看结果与最近任务。

侧边栏「素材工具箱」与「生产工具」两个分类展开后进入对应功能标签，主区域采用浏览器式多标签页，切换标签保留页面状态。

## 技术栈

- Vue 3 + Vue Router 4（hash 模式）+ Element Plus
- Electron 13 + vue-cli-plugin-electron-builder
- Vue CLI 5 + Sass + ESLint（airbnb-base + vue3-recommended）
- Python 子项目 headcut：opencv-python-headless、numpy、pillow、rembg、onnxruntime
- Python 子服务 comfyui-ctrl：FastAPI + Uvicorn + pydantic-settings + httpx，编排本地 ComfyUI（8188）

## 快速开始

```bash
# 1. 安装 Node 依赖（.npmrc 已配置 npmmirror 国内镜像）
npm install

# 2. 准备 headcut 子项目虚拟环境（详见 docs/技术文档.md 第 11 节）
cd subprojects/headcut
<python3.11> -m venv .venv
.venv/Scripts/python.exe -m pip install -e ".[bg]" -i https://mirrors.cloud.tencent.com/pypi/simple
cd ../..

# 3. 准备 comfyui-ctrl 子服务虚拟环境
cd subprojects/comfyui-ctrl
<python> -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt -i https://mirrors.cloud.tencent.com/pypi/simple
cd ../..

# 4. 启动开发（Electron 启动时自动拉起 comfyui-ctrl 服务）
npm run electron:serve
```

## 常用命令

```bash
npm run electron:serve   # Electron 开发模式（热更新）
npm run serve            # 纯 Web 模式调试
npm run lint             # ESLint 检查并自动修复
npm run electron:build   # 打包安装包（含 headcut、comfyui-ctrl 子项目资源）
```

## 目录结构

```
docs/技术文档.md          # 完整技术文档（架构、IPC、子项目、打包说明）
subprojects/
├── headcut/              # Python 头像裁切子项目（自带 .venv，不入库）
└── comfyui-ctrl/         # FastAPI 工作流服务子项目（自带 .venv，不入库）
src/
├── background.js         # Electron 主进程入口
├── preload.js            # 预加载脚本，注入受控 ipcRenderer
├── main.js               # 渲染层入口
├── common/eventConst.js  # IPC 事件常量
├── render/               # 渲染层：布局、标签页、页面、工作流组件
└── server/               # 主进程：解析库、下载器、headcut/comfyui-ctrl 调用、配置
```

更多细节见 [docs/技术文档.md](docs/技术文档.md)。
