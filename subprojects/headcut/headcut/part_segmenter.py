"""基于 SegFormer-B2 服装语义分割的人体部位像素级识别.

使用 HuggingFace mattmdjaga/segformer_b2_clothes 的官方 ONNX 导出 (18 类人体/服装
解析, 标签以 onnx/config.json 的 id2label 为准, 与模型卡的 20 类 ATR 映射不同),
纯 onnxruntime 推理, 不依赖 torch/transformers: 预处理 (BGR->RGB、resize 到 512、
ImageNet 均值方差归一化) 与 argmax 后处理均手写实现。

输出与原图同分辨率的部位标签图, 供 body_planner 做胸/腿/手/脚定位; 模型缺失时按
pose_detector 相同策略自动从 HuggingFace 镜像下载, 也可用环境变量 SMARTCUT_SEG_MODEL
指定本地模型路径。
"""

from __future__ import annotations

import http.client
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

MODEL_FILENAME = "segformer_b2_clothes.onnx"

_MODEL_URLS = (
    "https://hf-mirror.com/mattmdjaga/segformer_b2_clothes/resolve/main/onnx/model.onnx",
    "https://huggingface.co/mattmdjaga/segformer_b2_clothes/resolve/main/onnx/model.onnx",
)

# 模型输入/类别规格 (预处理与 onnx/preprocessor_config.json 一致,
# 类别 id 与 onnx/config.json 的 18 类 id2label 一致)
INPUT_SIZE = 512
CLASS_COUNT = 18
_IMAGE_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
_IMAGE_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

# ONNX 导出的 18 个标签 id (onnx/config.json id2label)
LABEL_BACKGROUND = 0
LABEL_HAT = 1
LABEL_HAIR = 2
LABEL_SUNGLASSES = 3
LABEL_UPPER_CLOTHES = 4
LABEL_SKIRT = 5
LABEL_PANTS = 6
LABEL_DRESS = 7
LABEL_BELT = 8
LABEL_LEFT_SHOE = 9
LABEL_RIGHT_SHOE = 10
LABEL_FACE = 11
LABEL_LEFT_LEG = 12
LABEL_RIGHT_LEG = 13
LABEL_LEFT_ARM = 14
LABEL_RIGHT_ARM = 15
LABEL_BAG = 16
LABEL_SCARF = 17

# 智能裁切各部位对应的模型标签组
CHEST_LABELS = (LABEL_UPPER_CLOTHES,)
CHEST_FALLBACK_LABELS = (LABEL_DRESS,)
LEG_LABELS = (LABEL_LEFT_LEG, LABEL_RIGHT_LEG)
LEG_FALLBACK_LABELS = (LABEL_PANTS, LABEL_SKIRT)
LEFT_ARM_LABELS = (LABEL_LEFT_ARM,)
RIGHT_ARM_LABELS = (LABEL_RIGHT_ARM,)
LEFT_SHOE_LABELS = (LABEL_LEFT_SHOE,)
RIGHT_SHOE_LABELS = (LABEL_RIGHT_SHOE,)

# mask 像素少于画面的该比例时视为无效识别, 自动回退关键点几何方案
MIN_AREA_RATIO = 0.0005

# 完整模型约 110MB, 低于该大小视为未下完的残文件, 触发断点续传
MIN_MODEL_BYTES = 100_000_000


@dataclass
class MaskRegion:
    """单个部位 mask 的统计结果, 坐标均为原图像素坐标."""

    mask: np.ndarray  # bool, shape (H, W)
    bbox: tuple[int, int, int, int]  # x1, y1, x2, y2
    center: tuple[float, float]
    area: int


def default_model_path() -> Path:
    return Path(__file__).resolve().parent / "models" / MODEL_FILENAME


def _stream_download(
    url: str,
    target: Path,
    max_retries: int = 8,
    chunk_size: int = 1 << 20,
) -> int:
    """带断点续传的流式下载, 返回最终字节数; 断连时按已下载大小自动续传。"""
    for attempt in range(1, max_retries + 1):
        existing = target.stat().st_size if target.is_file() else 0
        headers = {"Range": f"bytes={existing}-"} if existing else {}
        try:
            request = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(request, timeout=60) as response:
                status = getattr(response, "status", None) or response.getcode()
                # 206 表示服务器接受续传; 200 表示忽略 Range 从头返回
                resuming = existing > 0 and status == 206
                mode = "ab" if resuming else "wb"
                downloaded = existing if resuming else 0
                total: int | None = None
                content_range = response.headers.get("Content-Range")
                if content_range and "/" in content_range:
                    try:
                        total = int(content_range.rsplit("/", 1)[1])
                    except ValueError:
                        total = None
                if total is None:
                    content_length = response.headers.get("Content-Length")
                    if content_length:
                        total = downloaded + int(content_length)
                last_percent = -10
                with open(target, mode) as handle:
                    while True:
                        chunk = response.read(chunk_size)
                        if not chunk:
                            break
                        handle.write(chunk)
                        downloaded += len(chunk)
                        if total:
                            percent = min(100, int(downloaded * 100 / total))
                            if percent >= last_percent + 10:
                                print(
                                    f"[模型下载] 进度 {percent}% "
                                    f"({downloaded // 1_048_576}MB/"
                                    f"{total // 1_048_576}MB)"
                                )
                                last_percent = percent
            final_size = target.stat().st_size
            if total is None or final_size >= total:
                return final_size
            print(
                f"[模型下载] 连接中断, 已下载 {final_size // 1_048_576}MB, "
                f"断点续传重试 ({attempt}/{max_retries})"
            )
        except (OSError, urllib.error.URLError, http.client.HTTPException) as exc:
            print(
                f"[模型下载] 网络异常: {exc}, "
                f"断点续传重试 ({attempt}/{max_retries})"
            )
        time.sleep(1.5)
    return target.stat().st_size if target.is_file() else 0


def ensure_model(path: str | os.PathLike[str] | None = None) -> Path:
    """返回可用的分割模型路径, 缺失时逐个镜像断点续传下载."""
    env_path = os.environ.get("SMARTCUT_SEG_MODEL")
    if path:
        model_path = Path(path)
    elif env_path:
        model_path = Path(env_path)
    else:
        model_path = default_model_path()

    if model_path.is_file() and model_path.stat().st_size > MIN_MODEL_BYTES:
        return model_path

    model_path.parent.mkdir(parents=True, exist_ok=True)
    for url in _MODEL_URLS:
        print(
            "[模型下载] 首次使用 AI 部位识别, 下载 SegFormer 分割模型 "
            f"(约 110MB, 支持断点续传): {url}"
        )
        final_size = _stream_download(url, model_path)
        if final_size > MIN_MODEL_BYTES:
            print("[模型下载] 完成")
            return model_path
    raise FileNotFoundError(
        f"未找到 AI 分割模型: {model_path}, 且自动下载失败。"
        f"可手动下载 {_MODEL_URLS[0]} 放到该路径, "
        "或设置环境变量 SMARTCUT_SEG_MODEL。"
    )


def region_from_mask(
    mask: np.ndarray,
    img_width: int,
    img_height: int,
    min_area_ratio: float = MIN_AREA_RATIO,
) -> MaskRegion | None:
    """从 bool mask 统计 bbox/中心/面积, 面积过小返回 None."""
    if mask is None or mask.ndim != 2 or not mask.any():
        return None
    area = int(mask.sum())
    if area < img_width * img_height * min_area_ratio:
        return None
    ys, xs = np.where(mask)
    x1, x2 = int(xs.min()), int(xs.max())
    y1, y2 = int(ys.min()), int(ys.max())
    if x2 - x1 < 2 or y2 - y1 < 2:
        return None
    return MaskRegion(
        mask=mask,
        bbox=(x1, y1, x2, y2),
        center=((x1 + x2) / 2.0, (y1 + y2) / 2.0),
        area=area,
    )


def region_from_labels(
    label_map: np.ndarray,
    labels: tuple[int, ...],
    img_width: int,
    img_height: int,
    min_area_ratio: float = MIN_AREA_RATIO,
) -> MaskRegion | None:
    """抽取指定标签 id 的并集 mask 并统计区域."""
    mask = np.isin(label_map, labels)
    return region_from_mask(mask, img_width, img_height, min_area_ratio)


def farthest_point(mask: np.ndarray, anchor: tuple[float, float]) -> tuple[int, int]:
    """返回 mask 中距离锚点最远的像素坐标, 用于取手臂末端 (手掌)。"""
    ys, xs = np.where(mask)
    distances = (xs - anchor[0]) ** 2 + (ys - anchor[1]) ** 2
    index = int(np.argmax(distances))
    return int(xs[index]), int(ys[index])


class PartSegmenter:
    """SegFormer-B2 服装解析分割器, 输出原图分辨率的 18 类标签图."""

    def __init__(
        self,
        model_path: str | os.PathLike[str] | None = None,
        input_size: int = INPUT_SIZE,
    ) -> None:
        self.input_size = input_size
        try:
            import onnxruntime as ort
        except ImportError as exc:
            raise ImportError(
                "AI 部位识别需要 onnxruntime, 请在 headcut 虚拟环境中执行 "
                "pip install onnxruntime (或 pip install -e .[bg])"
            ) from exc
        resolved = ensure_model(model_path)
        self.session = ort.InferenceSession(
            str(resolved),
            providers=["CPUExecutionProvider"],
        )
        self.input_name = self.session.get_inputs()[0].name

    def segment(self, image: np.ndarray) -> np.ndarray:
        """对 BGR 图像推理, 返回 shape (H, W) 的 uint8 标签图 (标签 id 见模块常量)."""
        height, width = image.shape[:2]
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        resized = cv2.resize(
            rgb, (self.input_size, self.input_size), interpolation=cv2.INTER_LINEAR,
        )
        blob = resized.astype(np.float32) / 255.0
        blob = (blob - _IMAGE_MEAN) / _IMAGE_STD
        blob = np.transpose(blob, (2, 0, 1))[np.newaxis, ...]

        output = self.session.run(None, {self.input_name: blob})[0]
        # 官方 optimum 导出为 [1, 18, H/4, W/4]; 注意 output[0] 去掉批次维后
        # 标签轴变为 0, 同时兼容通道在最后 [1, H/4, W/4, 18] 的布局
        if output.ndim == 4 and output.shape[-1] == CLASS_COUNT:
            label_small = np.argmax(output[0], axis=-1).astype(np.uint8)
        else:
            label_small = np.argmax(output[0], axis=0).astype(np.uint8)

        # 最近邻缩回原图, 保留离散标签边界, 不做插值混合
        return cv2.resize(
            label_small, (width, height), interpolation=cv2.INTER_NEAREST,
        )
