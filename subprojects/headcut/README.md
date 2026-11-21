# headcut

批量人脸主体正方形头像裁切工具：自动检测图片中的主体人脸，以人脸为中心向外延伸，
截取包含**人脸、发型、头部、上半身**的正方形区域，并统一缩放到指定尺寸（默认 1024×1024）。

典型用途：批量制作 LoRA / 微调训练的头像素材。

## 特性

- 命令行工具，支持单文件、多文件、目录（可递归）批量处理，方便被其他服务/脚本调用
- 基于 OpenCV 内置的 [YuNet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) 人脸检测，CPU 即可运行，模型仅约 230KB，离线可用
- 自动选择面积最大的主体人脸；也可 `--all-faces` 裁切图中每一张脸
- 自动过滤远处路人等过小的人脸（`--min-face-ratio`）
- 正方形裁切比例、中心偏移、输出尺寸均可调
- 人脸靠近边角时默认把裁切框限制在画面内（允许人脸偏离中心，不做像素延展），也可切换为补边模式
- 自动校正手机照片的 EXIF 旋转，支持中文路径
- 支持 jpg / jpeg / png / webp / bmp / tif / tiff 输入
- 无人脸图片可选择跳过、原样复制或报错
- 可选一键去除背景（`--remove-bg`），支持透明底 PNG 或自定义纯色底，内置人像分割模型
- 可选输出人脸框 + 裁切框标注图，便于核对检测效果

## 项目结构

```
headcut/
├── headcut/
│   ├── __init__.py
│   ├── __main__.py        # python -m headcut 入口
│   ├── cli.py             # 命令行参数与批处理流程
│   ├── detector.py        # YuNet 人脸检测封装（含模型自动下载）
│   ├── cropper.py         # 正方形裁切区域计算、补边与缩放
│   ├── smartcut_cli.py    # 智能裁切入口: 视频抽帧 + 多部位裁切
│   ├── pose_detector.py   # YOLO11-pose 人体关键点检测（含模型自动下载）
│   ├── part_segmenter.py  # SegFormer-B2 服装语义分割, AI 部位识别（含模型自动下载）
│   ├── body_planner.py    # 头/胸/腿/手/脚裁切规划与提示词解析（分割优先, 关键点兜底）
│   ├── video_utils.py     # 视频发现与按时间均分抽帧
│   ├── bgremove.py        # 可选：rembg 人像分割去背景（含模型自动下载）
│   ├── io_utils.py        # 图像读写（EXIF 校正、中文路径）
│   └── models/
│       ├── face_detection_yunet_2023mar.onnx
│       ├── yolo11n-pose.onnx
│       ├── segformer_b2_clothes.onnx  # AI 部位分割模型（首次使用自动下载, 约 110MB）
│       └── rembg/         # 去背景模型（首次使用自动下载, 已 gitignore）
├── requirements.txt
├── requirements-bg.txt    # 去背景可选依赖 (rembg + onnxruntime)
├── pyproject.toml
├── LICENSE
└── README.md
```

## 环境要求

- Python 3.9+（在 Windows + Python 3.11 上测试通过）
- 依赖：`opencv-python-headless`、`numpy`、`pillow`
- 去背景为可选功能，额外依赖 `rembg`、`onnxruntime`（见下文安装步骤）

## 安装

### 1. 创建并激活虚拟环境（推荐）

Windows (PowerShell)：

```powershell
cd headcut
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

Linux / macOS：

```bash
cd headcut
python3 -m venv .venv
source .venv/bin/activate
```

### 2. 安装依赖（国内镜像源）

```powershell
# 腾讯云镜像（实测速度快）
pip install -r requirements.txt -i https://mirrors.cloud.tencent.com/pypi/simple --trusted-host mirrors.cloud.tencent.com

# 或清华镜像
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
```

也可以直接安装为命令行工具（安装后可直接使用 `headcut` 命令）：

```powershell
pip install -e . -i https://mirrors.cloud.tencent.com/pypi/simple --trusted-host mirrors.cloud.tencent.com
```

### 3. 人脸模型

仓库已自带 `headcut/models/face_detection_yunet_2023mar.onnx`，无需额外下载。
若模型文件缺失，首次运行时会自动从 GitHub 及镜像地址下载；也可以手动指定模型：

```powershell
# 命令行参数
headcut photo.jpg --model D:\models\face_detection_yunet_2023mar.onnx

# 或环境变量
$env:HEADCUT_MODEL = "D:\models\face_detection_yunet_2023mar.onnx"
```

### 4. 去背景可选依赖（不需要可跳过）

只有使用 `--remove-bg` 时才需要安装，不装不影响普通裁切：

```powershell
pip install -r requirements-bg.txt -i https://mirrors.cloud.tencent.com/pypi/simple --trusted-host mirrors.cloud.tencent.com

# 或在安装/升级 headcut 时通过可选依赖分组一并安装
pip install -e ".[bg]" -i https://mirrors.cloud.tencent.com/pypi/simple --trusted-host mirrors.cloud.tencent.com
```

首次执行去背景时会自动下载分割模型到 `headcut/models/rembg/`（默认人像模型
`u2net_human_seg` 约 176MB），下载地址依次尝试 ModelScope 国内源、HuggingFace 镜像、
GitHub 官方源，无需代理。

## 快速开始

```powershell
# 处理单张图片，输出到 output 目录，默认 1024x1024
python -m headcut "E:\photos\a.jpg"

# 处理整个目录
python -m headcut "E:\photos" -o "E:\dataset\avatars"

# 递归处理目录及所有子目录
python -m headcut "E:\photos" -r -o "E:\dataset\avatars"

# 指定输出尺寸为 512x512
python -m headcut "E:\photos" -s 512

# 一次传入多个文件/目录
python -m headcut img1.jpg img2.png "E:\more_photos" -o dataset

# 裁切并去除背景, 输出透明底 PNG
python -m headcut "E:\photos" -r -o "E:\dataset\nobg" --remove-bg

# 去背景并合成白色纯色底 (仍是 jpg)
python -m headcut "E:\photos" -r -o "E:\dataset\white" --remove-bg --bg-color 255,255,255

# 安装为命令后可直接调用
headcut "E:\photos" -r -o dataset -s 1024
```

## 参数说明

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `inputs` | 必填 | 图片文件或目录，可传多个 |
| `-o, --output-dir` | `output` | 输出目录 |
| `-s, --size` | `1024` | 输出正方形边长（像素） |
| `-r, --recursive` | 关 | 递归处理子目录 |
| `--scale` | `2.6` | 裁切边长 = 人脸框长边 × 该倍数；调大包含更多身体/背景，调小更贴近脸部 |
| `--x-offset` | `0.0` | 裁切中心水平偏移，以人脸宽度为单位，正值向右 |
| `--y-offset` | `0.0` | 裁切中心垂直偏移，以人脸高度为单位，正值向下（如 `0.1` 多留身体） |
| `--confidence` | `0.6` | 人脸检测置信度阈值，漏检时可调低（如 `0.4`） |
| `--min-face-ratio` | `0.05` | 过滤宽度小于图像宽度该比例的人脸（忽略远处路人），`0` 表示不过滤 |
| `--all-faces` | 关 | 裁切图中每一张脸，文件名带 `_face1`、`_face2` 后缀 |
| `--face-suffix` | `_face` | 多人脸输出的文件名后缀前缀 |
| `--on-no-face` | `skip` | 无人脸时：`skip` 跳过并警告 / `copy` 原样复制 / `error` 记为失败 |
| `--edge-strategy` | `clamp` | 边角人脸处理：`clamp` 裁切框限制在画面内、允许人脸不居中（无补边） / `pad` 保持居中并补边 |
| `--padding` | `edge` | 仅 `--edge-strategy pad` 时生效：`edge` 边缘延展 / `reflect` 镜像 / `constant` 纯色 |
| `--padding-color` | `0,0,0` | 纯色补边的 RGB 颜色，如 `255,255,255` |
| `--remove-bg` | 关 | 裁切后去除背景，需先安装 `requirements-bg.txt` |
| `--bg-model` | `u2net_human_seg` | 去背景模型：`u2net_human_seg` 人像专用 / `silueta` 轻量快速 / `isnet-general-use` 通用高精度 / `u2net` 通用 / `isnet-anime` 动漫插画 |
| `--bg-color` | 无 | 去背景后合成的纯色背景 RGB，如 `255,255,255`；不填则输出透明底，且自动转为 PNG |
| `--format` | `keep` | 输出格式：`keep` 与原图一致 / `jpg` / `png` / `webp` |
| `--jpeg-quality` | `95` | JPEG/WebP 输出质量（1-100） |
| `--model` | 无 | 自定义 YuNet 模型路径（也可用 `HEADCUT_MODEL` 环境变量） |
| `--annotate-dir` | 无 | 输出带人脸框（绿）与裁切框（红）的标注图，便于核对 |
| `--dry-run` | 关 | 只打印检测与裁切计划，不写文件 |

## 裁切策略

1. YuNet 检测出图中所有人脸（含关键点与置信度）；
2. 过滤宽度小于 `--min-face-ratio` 比例的小人脸；
3. 默认取面积最大的人脸作为主体（`--all-faces` 时取全部）；
4. 以人脸中心为正方形中心，边长 = 人脸框长边 × `--scale`，默认 2.6 倍可完整包住
   发型头部并覆盖肩部/上半身；
5. 默认 `clamp` 策略：裁切框始终完整落在画面内——能放下就贴边内缩（人脸随之偏离中心），
   画面本身容纳不下目标边长时自动缩小到最大可容纳正方形，全程不产生补边像素；
   如需保持人脸绝对居中，可加 `--edge-strategy pad`，越界部分按 `--padding` 补边；
6. 统一高质量缩放到 `--size` × `--size`（缩小用 AREA，放大用 CUBIC）。

### 常用调节

```powershell
# 想要更紧凑的脸部特写
python -m headcut photos --scale 2.0

# 想要更多上半身/服装信息（LoRA 服装训练常用）
python -m headcut photos --scale 3.2 --y-offset 0.1

# 输出带标注的调试图，确认框选位置后再批量跑
python -m headcut photos --annotate-dir debug

# 无人脸的照片原样保留，方便人工复查
python -m headcut photos --on-no-face copy

# 统一转成高质量 JPG 数据集
python -m headcut photos -r --format jpg --jpeg-quality 98 -o dataset
```

## 背景去除（可选）

基于 [rembg](https://github.com/danielgatis/rembg) + ONNX Runtime 的人像分割，
在正方形裁切、缩放之后执行，CPU 即可运行。

- **透明底（默认）**：加 `--remove-bg` 即可，输出带 alpha 通道的 PNG；若原图是 jpg 等
  不支持透明的格式，输出文件会自动改成 `.png` 后缀，文件名主体不变。
- **纯色底**：加 `--bg-color R,G,B`，按 alpha 把人像合成到纯色背景上，保持原输出格式
  （如 jpg 仍输出 jpg），LoRA 训练常用白底 `255,255,255`。
- **模型选择**：默认 `u2net_human_seg`（人像专用，约 176MB，效果最好）；追求速度可换
  `silueta`（约 43MB，效果接近）；动漫/插画素材用 `isnet-anime`。
- 模型首次使用时自动下载到 `headcut/models/rembg/`，已被 gitignore，不会提交进仓库；
  下载源按 ModelScope → HuggingFace 镜像 → GitHub 的顺序自动回退。
- 同一次批处理中模型只加载一次，批量处理时第一张稍慢、后续很快。

## 一键智能裁切（图片/视频 · 多部位）

除头像裁切外，包内还提供 `headcut.smartcut_cli` 模块（与原 `headcut` 完全独立，
互不影响），面向 LoRA 多部位素材制作：

- **视频抽帧**：视频按时间均分成 N 段，取每段中点的画面（`--frames N`，默认 5），
  抽帧结果再逐张执行裁切；图片则直接处理
- **多部位裁切**：支持头部 / 胸部 / 腿部 / 手部 / 脚部（`--parts head,chest,legs,hand,foot`），
  被遮挡的手/脚自动跳过
- **AI 部位识别（默认开启）**：胸/腿/手/脚优先用 HuggingFace `mattmdjaga/segformer_b2_clothes`
  （SegFormer-B2，18 类服装/人体像素级语义分割，纯 ONNX 推理）定位，比关键点几何推算更精准；
  模型缺失、推理失败或 mask 过弱时自动回退 YOLO-pose 关键点方案，裁切边长公式与 `--scale`
  语义在两种方案下完全一致；头部始终走 YuNet 人脸检测，不参与分割。加 `--no-seg` 可关闭，
  模型路径可用环境变量 `SMARTCUT_SEG_MODEL` 指定；调试图（`--save-debug`）会用半透明色块
  叠加 AI 识别到的部位区域并标注「AI识别」
- **提示词驱动**：`--prompt "需要头像和手部特写"` 自动识别中/英文部位关键词，
  命中后优先于 `--parts`；都未指定时默认裁切头部
- **统一裁切比例**：`--scale`（默认 2.6）对头/胸/腿/手/脚统一生效，各部位基准框按该倍数整体缩放，调大画面更宽松、调小更贴近主体，2.6 为默认调校基准
- **头部双保险**：优先复用 YuNet 人脸检测，无人脸时用姿态关键点兜底
- **识别区域调试图**：加 `--save-debug` 后，每个处理单元在输出目录的 `_debug` 子文件夹保存一张标注图，画出人体框、关键点骨架（绿色=可见、灰色=低于阈值）、人脸框与各部位裁切框及边长，便于核对识别位置与排查漏检，调试图不会出现在正常结果列表中
- 输出文件名带部位后缀，如 `video_f000135_head.jpg`、`video_f000135_hand1.jpg`
- 同样支持递归目录、去背景、自定义输出尺寸、中文与 emoji 路径

```powershell
# 目录内图片与视频一起处理, 每个视频抽 5 帧, 裁切全部五个部位
python -m headcut.smartcut_cli D:\素材 -o D:\out --parts head,chest,legs,hand,foot --frames 5

# 用提示词决定裁切部位
python -m headcut.smartcut_cli D:\素材 -o D:\out --prompt "裁切模特的胸部、腿部和脚部"

# 先空跑检查计划, 不写文件
python -m headcut.smartcut_cli D:\素材 -o D:\out --parts head,hand --dry-run
```

依赖说明：智能裁切需要 `onnxruntime`（去背景可选依赖已包含，即
`pip install -e ".[bg]"`），无需安装 torch/transformers；姿态模型
`yolo11n-pose.onnx`（约 12MB）随包分发，缺失时按 GitHub → 镜像顺序自动下载，
也可用环境变量 `SMARTCUT_POSE_MODEL` 指定。AI 分割模型
`segformer_b2_clothes.onnx`（约 110MB）首次用到胸/腿/手/脚时自动从
HuggingFace 镜像下载到 `headcut/models/`，也可预先手动放置或用
`SMARTCUT_SEG_MODEL` 指定。

## 被其他服务调用

- 模块方式：`python -m headcut <参数...>`
- 命令方式：`pip install -e .` 后直接使用 `headcut <参数...>`
- 退出码：全部成功返回 `0`；存在处理失败（或 `--on-no-face error` 触发）时返回非 0，
  便于在流水线中判断结果
- 运行结束会打印汇总：`共 N 张, 裁切输出 X 张, 无人脸 Y 张, 失败 Z 张`

## LoRA 素材制作建议

- 头像/人脸 LoRA：默认 `--scale 2.6` 即可，保证发型、头部完整
- 服装 LoRA：建议 `--scale 3.0~3.5` 并配合 `--y-offset 0.1` 多保留身体
- 素材尺寸：训练尺寸多大就输出多大（如 1024 训练就用 `-s 1024`），避免二次缩放
- 批量前先用 `--dry-run` 和 `--annotate-dir` 抽查检测与框选效果
- 对检测失败的图片，可调低 `--confidence` 到 0.4 重试

## 常见问题

**Q: 中文路径或文件名会出错吗？**
不会。图像读写统一走 Pillow，原生支持中文路径，并自动处理 EXIF 旋转。

**Q: 控制台中文日志乱码？**
程序已自动将输出流切换为 UTF-8；如仍异常，可先执行
`$env:PYTHONUTF8 = "1"` 再运行。

**Q: 模型自动下载失败？**
手动从 [opencv_zoo](https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx)
下载模型，放到 `headcut/models/` 目录，或通过 `--model` / `HEADCUT_MODEL` 指定路径。

**Q: 提示需要安装 rembg？**
去背景是可选功能，执行 `pip install -r requirements-bg.txt` 即可（国内加腾讯云镜像参数，
见安装章节）。普通裁切不依赖它，不安装也能正常使用。

**Q: 一张图里有多个人怎么办？**
默认只裁切面积最大的主体人脸；加 `--all-faces` 会裁切所有人脸并以
`_face1`、`_face2` 后缀区分，远处小人脸默认被 `--min-face-ratio` 过滤。

**Q: 人脸在画面边角时为什么不居中了？**
这是默认的 `clamp` 策略：为避免边缘像素延展造成的假画面，裁切框会被限制在画面内，
人脸允许偏离中心；画面太小放不下目标边长时会自动缩小裁切框（日志会提示
"靠近边角已缩小裁切框"），输出仍会缩放到指定尺寸。若更看重人脸居中，
可加 `--edge-strategy pad` 恢复补边模式。

## 许可证

- 本项目代码：MIT License
- 内置 YuNet 模型来自 [opencv_zoo](https://github.com/opencv/opencv_zoo)，遵循 Apache-2.0 License
