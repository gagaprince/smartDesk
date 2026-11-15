"""图像读写工具, 走 Pillow 以支持中文路径与 EXIF 方向自动校正."""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps

SUPPORTED_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}


def load_image_bgr(path: str | Path) -> np.ndarray:
    """读取图像并校正 EXIF 旋转, 返回 OpenCV 使用的 BGR 数组."""
    with Image.open(path) as image:
        image = ImageOps.exif_transpose(image)
        rgb = np.asarray(image.convert("RGB"), dtype=np.uint8)
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)


def save_image_bgr(
    path: str | Path,
    image: np.ndarray,
    jpeg_quality: int = 95,
) -> None:
    """保存 BGR 数组, 扩展名决定输出格式."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    has_alpha = image.ndim == 3 and image.shape[2] == 4
    suffix = path.suffix.lower()
    if has_alpha and suffix in (".jpg", ".jpeg"):
        # JPEG 不支持透明通道, 兜底合成白底
        bgr = image[..., :3]
        alpha = image[..., 3:4].astype(np.float32) / 255.0
        white = np.full_like(bgr, 255, dtype=np.float32)
        image = (bgr.astype(np.float32) * alpha + white * (1.0 - alpha)).astype(np.uint8)
        has_alpha = False
    if has_alpha:
        data = cv2.cvtColor(image, cv2.COLOR_BGRA2RGBA)
        mode = "RGBA"
    else:
        data = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        mode = "RGB"
    with Image.fromarray(data, mode) as out:
        if suffix in (".jpg", ".jpeg"):
            out.save(path, quality=jpeg_quality, subsampling=1, optimize=True)
        elif suffix == ".webp":
            out.save(path, quality=jpeg_quality, method=6)
        else:
            out.save(path)


def iter_image_files(
    inputs: list[str | Path],
    recursive: bool = False,
) -> list[Path]:
    """把文件/目录参数展开成去重后的图片文件列表."""
    files: list[Path] = []
    seen: set[Path] = set()
    for item in inputs:
        path = Path(item)
        if path.is_file():
            candidates = [path]
        elif path.is_dir():
            pattern = "**/*" if recursive else "*"
            candidates = (
                p for p in path.glob(pattern)
                if p.is_file() and p.suffix.lower() in SUPPORTED_SUFFIXES
            )
        else:
            raise FileNotFoundError(f"输入路径不存在: {path}")
        for candidate in candidates:
            resolved = candidate.resolve()
            if resolved not in seen:
                seen.add(resolved)
                files.append(candidate)
    return sorted(files)
