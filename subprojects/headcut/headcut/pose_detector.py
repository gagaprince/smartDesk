"""基于 YOLO11-pose ONNX 的人体姿态检测封装.

只依赖 onnxruntime (rembg 可选依赖已自带) 与 OpenCV, 输出画面中置信度
最高的主体人物包围框与 17 个 COCO 关键点, 供智能裁切按部位规划裁切框。
模型缺失时按 YuNet 相同策略自动从镜像下载。
"""

from __future__ import annotations

import os
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

MODEL_FILENAME = "yolo11n-pose.onnx"

_MODEL_URLS = (
    "https://github.com/ultralytics/assets/releases/download/v8.3.0/"
    "yolo11n-pose.onnx",
    "https://gh-proxy.com/https://github.com/ultralytics/assets/releases/"
    "download/v8.3.0/yolo11n-pose.onnx",
    "https://ghproxy.net/https://github.com/ultralytics/assets/releases/"
    "download/v8.3.0/yolo11n-pose.onnx",
)

# COCO 17 关键点顺序, 与 YOLO-pose 输出一致
KP_NOSE = 0
KP_LEFT_EYE = 1
KP_RIGHT_EYE = 2
KP_LEFT_EAR = 3
KP_RIGHT_EAR = 4
KP_LEFT_SHOULDER = 5
KP_RIGHT_SHOULDER = 6
KP_LEFT_ELBOW = 7
KP_RIGHT_ELBOW = 8
KP_LEFT_WRIST = 9
KP_RIGHT_WRIST = 10
KP_LEFT_HIP = 11
KP_RIGHT_HIP = 12
KP_LEFT_KNEE = 13
KP_RIGHT_KNEE = 14
KP_LEFT_ANKLE = 15
KP_RIGHT_ANKLE = 16


@dataclass
class Person:
    """单个人体的检测结果, 坐标均为原图像素坐标."""

    box: np.ndarray  # [x1, y1, x2, y2]
    score: float
    keypoints: np.ndarray  # shape (17, 3), 每行 x / y / visibility

    @property
    def area(self) -> float:
        width = max(0.0, self.box[2] - self.box[0])
        height = max(0.0, self.box[3] - self.box[1])
        return float(width * height)


def default_model_path() -> Path:
    return Path(__file__).resolve().parent / "models" / MODEL_FILENAME


def ensure_model(path: str | os.PathLike[str] | None = None) -> Path:
    """返回可用的姿态模型路径, 缺失时逐个镜像重试下载."""
    env_path = os.environ.get("SMARTCUT_POSE_MODEL")
    if path:
        model_path = Path(path)
    elif env_path:
        model_path = Path(env_path)
    else:
        model_path = default_model_path()

    if model_path.is_file() and model_path.stat().st_size > 100_000:
        return model_path

    model_path.parent.mkdir(parents=True, exist_ok=True)
    last_error: Exception | None = None
    for url in _MODEL_URLS:
        try:
            urllib.request.urlretrieve(url, model_path)
            if model_path.is_file() and model_path.stat().st_size > 100_000:
                return model_path
        except OSError as exc:
            last_error = exc
    raise FileNotFoundError(
        f"未找到姿态模型: {model_path}, 且自动下载失败。"
        f"可手动下载 {_MODEL_URLS[0]} 放到该路径, "
        "或设置环境变量 SMARTCUT_POSE_MODEL。"
    ) from last_error


def _letterbox(image: np.ndarray, size: int) -> tuple[np.ndarray, float, int, int]:
    """等比缩放并填充到 size x size, 返回 (画布, 缩放比, 左填充, 上填充)."""
    height, width = image.shape[:2]
    scale = min(size / width, size / height)
    new_width = max(1, int(round(width * scale)))
    new_height = max(1, int(round(height * scale)))
    resized = cv2.resize(image, (new_width, new_height), interpolation=cv2.INTER_AREA)
    canvas = np.full((size, size, 3), 114, dtype=np.uint8)
    left = (size - new_width) // 2
    top = (size - new_height) // 2
    canvas[top:top + new_height, left:left + new_width] = resized
    return canvas, scale, left, top


class PoseDetector:
    """YOLO11-pose 检测器, 输出主体人物框与关键点."""

    def __init__(
        self,
        model_path: str | os.PathLike[str] | None = None,
        confidence: float = 0.4,
        nms_threshold: float = 0.45,
        input_size: int = 640,
    ) -> None:
        self.confidence = confidence
        self.nms_threshold = nms_threshold
        self.input_size = input_size
        # onnxruntime 属于可选依赖, 仅在使用智能裁切时导入, 报错信息更明确
        try:
            import onnxruntime as ort
        except ImportError as exc:
            raise ImportError(
                "智能裁切需要 onnxruntime, 请在 headcut 虚拟环境中执行 "
                "pip install onnxruntime (或 pip install -e .[bg])"
            ) from exc
        resolved = ensure_model(model_path)
        self.session = ort.InferenceSession(
            str(resolved),
            providers=["CPUExecutionProvider"],
        )
        self.input_name = self.session.get_inputs()[0].name

    def detect(self, image: np.ndarray) -> list[Person]:
        height, width = image.shape[:2]
        canvas, scale, pad_left, pad_top = _letterbox(image, self.input_size)
        blob = cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        blob = np.transpose(blob, (2, 0, 1))[np.newaxis, ...]

        output = self.session.run(None, {self.input_name: blob})[0]
        # [1, 56, 8400] -> [8400, 56]: 4 包围框 + 1 置信度 + 17*3 关键点
        predictions = np.transpose(output[0], (1, 0))

        boxes: list[list[float]] = []
        scores: list[float] = []
        keypoints: list[np.ndarray] = []
        for row in predictions:
            score = float(row[4])
            if score < self.confidence:
                continue
            cx, cy, bw, bh = row[:4]
            boxes.append([cx - bw / 2, cy - bh / 2, bw, bh])
            scores.append(score)
            keypoints.append(row[5:].reshape(17, 3))
        if not boxes:
            return []

        keep_indices = cv2.dnn.NMSBoxes(
            boxes,
            scores,
            self.confidence,
            self.nms_threshold,
        )
        if keep_indices is None or len(keep_indices) == 0:
            return []
        keep_indices = np.array(keep_indices).flatten()

        persons: list[Person] = []
        for index in keep_indices:
            x, y, bw, bh = boxes[index]
            box = np.array(
                [
                    (x - pad_left) / scale,
                    (y - pad_top) / scale,
                    (x + bw - pad_left) / scale,
                    (y + bh - pad_top) / scale,
                ],
                dtype=np.float32,
            )
            box[[0, 2]] = np.clip(box[[0, 2]], 0.0, float(width))
            box[[1, 3]] = np.clip(box[[1, 3]], 0.0, float(height))
            kp = keypoints[index].copy()
            kp[:, 0] = (kp[:, 0] - pad_left) / scale
            kp[:, 1] = (kp[:, 1] - pad_top) / scale
            kp[:, 0] = np.clip(kp[:, 0], 0.0, float(width))
            kp[:, 1] = np.clip(kp[:, 1], 0.0, float(height))
            persons.append(Person(box=box, score=scores[index], keypoints=kp))

        persons.sort(key=lambda person: person.area, reverse=True)
        return persons
