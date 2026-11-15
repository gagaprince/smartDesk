"""基于 OpenCV YuNet 的人脸检测封装."""

from __future__ import annotations

import os
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

MODEL_FILENAME = "face_detection_yunet_2023mar.onnx"

_MODEL_URLS = (
    "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/"
    "face_detection_yunet_2023mar.onnx",
    "https://gh-proxy.com/https://github.com/opencv/opencv_zoo/raw/main/"
    "models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
    "https://ghproxy.net/https://github.com/opencv/opencv_zoo/raw/main/"
    "models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
)


@dataclass
class Face:
    """单张人脸的检测结果."""

    x: float
    y: float
    w: float
    h: float
    score: float
    landmarks: np.ndarray

    @property
    def center(self) -> tuple[float, float]:
        return self.x + self.w / 2.0, self.y + self.h / 2.0

    @property
    def area(self) -> float:
        return self.w * self.h


def default_model_path() -> Path:
    return Path(__file__).resolve().parent / "models" / MODEL_FILENAME


def ensure_model(path: str | os.PathLike[str] | None = None) -> Path:
    """返回可用的模型文件路径, 缺失时自动从镜像下载."""
    env_path = os.environ.get("HEADCUT_MODEL")
    if path:
        model_path = Path(path)
    elif env_path:
        model_path = Path(env_path)
    else:
        model_path = default_model_path()

    if model_path.is_file() and model_path.stat().st_size > 10_000:
        return model_path

    model_path.parent.mkdir(parents=True, exist_ok=True)
    last_error: Exception | None = None
    for url in _MODEL_URLS:
        try:
            urllib.request.urlretrieve(url, model_path)
            if model_path.is_file() and model_path.stat().st_size > 10_000:
                return model_path
        except OSError as exc:  # 逐个镜像重试
            last_error = exc
    raise FileNotFoundError(
        f"未找到 YuNet 模型: {model_path}, 且自动下载失败。"
        f"可手动下载 {_MODEL_URLS[0]} 放到该路径, 或设置环境变量 HEADCUT_MODEL。"
    ) from last_error


class FaceDetector:
    """YuNet 人脸检测器, 输出人脸框、关键点与置信度."""

    def __init__(
        self,
        model_path: str | os.PathLike[str] | None = None,
        confidence: float = 0.6,
        nms_threshold: float = 0.3,
        top_k: int = 50,
    ) -> None:
        self.model_path = ensure_model(model_path)
        self.confidence = confidence
        # 屏蔽新版 DNN 引擎 "Targets are not supported" 之类的无害告警
        cv2.utils.logging.setLogLevel(cv2.utils.logging.LOG_LEVEL_ERROR)
        self._detector = cv2.FaceDetectorYN_create(
            str(self.model_path),
            "",
            (320, 320),
            confidence,
            nms_threshold,
            top_k,
        )

    def detect(self, image: np.ndarray) -> list[Face]:
        height, width = image.shape[:2]
        self._detector.setInputSize((width, height))
        _, rows = self._detector.detect(image)
        if rows is None:
            return []
        faces: list[Face] = []
        for row in rows:
            x, y, face_w, face_h = row[:4]
            landmarks = np.asarray(row[4:14], dtype=np.float32).reshape(5, 2)
            faces.append(
                Face(
                    x=float(x),
                    y=float(y),
                    w=float(face_w),
                    h=float(face_h),
                    score=float(row[14]),
                    landmarks=landmarks,
                )
            )
        return faces
