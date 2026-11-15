"""可选的背景去除功能, 基于 rembg + onnxruntime 人像分割模型.

rembg 属于可选依赖, 仅在启用 --remove-bg 时才导入, 未安装时给出明确提示。
模型文件统一存放在包内 models/rembg 目录, 首次使用自动下载 (支持镜像回退)。
"""

from __future__ import annotations

import os
import urllib.request
from pathlib import Path

import cv2
import numpy as np

DEFAULT_MODEL = "u2net_human_seg"

# 文件名与 rembg release v0.0.0 资产名一致的模型, 便于镜像直连下载
MODEL_CHOICES = (
    "u2net_human_seg",  # 人像专用, 人物头像首选 (约 176MB)
    "isnet-general-use",  # 通用高精度分割 (约 176MB)
    "u2net",  # 通用分割 (约 176MB)
    "silueta",  # 轻量快速, 效果接近 u2net (约 43MB)
    "isnet-anime",  # 动漫/插画风格
)


def rembg_home() -> Path:
    return Path(__file__).resolve().parent / "models" / "rembg"


def _model_file(model_name: str) -> Path:
    return rembg_home() / f"{model_name}.onnx"


def _download_urls(model_name: str) -> tuple[str, ...]:
    github_url = (
        "https://github.com/danielgatis/rembg/releases/download/"
        f"v0.0.0/{model_name}.onnx"
    )
    return (
        # ModelScope 国内源 (阿里 CDN, 速度最快), 文件与 rembg 官方 release 一致
        "https://modelscope.cn/api/v1/models/shiertier/rembg/repo?"
        f"Revision=master&FilePath={model_name}.onnx",
        # HuggingFace 国内镜像, 模型文件与 rembg 官方 release 一致, 国内访问最稳
        f"https://hf-mirror.com/tomjackson2023/rembg/resolve/main/{model_name}.onnx",
        github_url,
        f"https://gh-proxy.com/{github_url}",
        f"https://ghproxy.net/{github_url}",
    )


def ensure_rembg_model(model_name: str) -> Path:
    """模型缺失时从 GitHub 及镜像下载, 返回本地模型路径."""
    target = _model_file(model_name)
    if target.is_file() and target.stat().st_size > 1_000_000:
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    last_error: Exception | None = None
    for url in _download_urls(model_name):
        try:
            print(f"首次使用背景去除, 正在下载模型 {model_name} ...\n  {url}")
            urllib.request.urlretrieve(url, target)
            if target.is_file() and target.stat().st_size > 1_000_000:
                print(f"模型下载完成: {target}")
                return target
        except OSError as exc:  # 逐个镜像重试
            last_error = exc
            print(f"下载失败, 尝试下一镜像: {exc}")
    raise FileNotFoundError(
        f"背景去除模型下载失败: {model_name}。可手动下载 {_download_urls(model_name)[0]} "
        f"并保存为 {target}",
    ) from last_error


_sessions: dict[str, object] = {}


def get_session(model_name: str = DEFAULT_MODEL) -> object:
    # 必须在 import rembg 前指定模型目录, 让 rembg 复用我们下载好的模型
    os.environ["U2NET_HOME"] = str(rembg_home())
    ensure_rembg_model(model_name)
    try:
        from rembg import new_session
    except ImportError as exc:
        raise ImportError(
            "启用背景去除需要安装可选依赖, 请执行: "
            "pip install rembg onnxruntime "
            "(国内可加 -i https://mirrors.cloud.tencent.com/pypi/simple)",
        ) from exc
    if model_name not in _sessions:
        _sessions[model_name] = new_session(
            model_name,
            providers=["CPUExecutionProvider"],
        )
    return _sessions[model_name]


def remove_background(
    image_bgr: np.ndarray,
    model_name: str = DEFAULT_MODEL,
    bg_color: tuple[int, int, int] | None = None,
) -> np.ndarray:
    """对 BGR 图像做背景去除.

    bg_color 为 None 时返回 BGRA 透明底图; 传入 RGB 三元组时返回合成纯色背景的 BGR 图。
    """
    from PIL import Image
    from rembg import remove

    session = get_session(model_name)
    rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    pil_rgba = remove(
        Image.fromarray(rgb),
        session=session,
        post_process_mask=True,
    ).convert("RGBA")
    rgba = np.asarray(pil_rgba, dtype=np.uint8)

    if bg_color is None:
        return cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA)

    # 按 alpha 把前景合成到纯色背景上
    alpha = rgba[..., 3:4].astype(np.float32) / 255.0
    foreground = rgba[..., :3].astype(np.float32)
    background = np.empty_like(foreground)
    background[:] = bg_color  # RGB
    composite = foreground * alpha + background * (1.0 - alpha)
    return cv2.cvtColor(composite.astype(np.uint8), cv2.COLOR_RGB2BGR)
