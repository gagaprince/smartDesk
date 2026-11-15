"""以人脸为中心的正方形裁切区域计算与图像提取."""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from .detector import Face


@dataclass
class CropPlan:
    """裁切方案, 坐标与边长 (clamp 策略下保证完整落在图像边界内)."""

    left: float
    top: float
    side: float
    clamped: bool = False

    @property
    def right(self) -> float:
        return self.left + self.side

    @property
    def bottom(self) -> float:
        return self.top + self.side


def plan_square_crop(
    face: Face,
    img_width: int,
    img_height: int,
    scale: float = 2.6,
    x_offset: float = 0.0,
    y_offset: float = 0.0,
    edge_strategy: str = "clamp",
) -> CropPlan:
    """根据人脸框计算正方形裁切区域.

    scale: 正方形边长相对人脸框长边的倍数, 越大包含越多身体/背景。
    x_offset / y_offset: 裁切中心相对人脸中心的偏移, 以人脸宽/高为单位,
    y_offset 正值向下移动。
    edge_strategy: 人脸靠近边角、裁切框放不下时的处理方式。
        clamp(默认): 裁切框始终限制在画面内, 必要时缩小边长, 允许人脸偏离中心, 不产生补边;
        pad: 保持人脸居中与目标边长, 越界部分交给 extract_square 补边。
    """
    desired_side = max(face.w, face.h) * scale
    center_x, center_y = face.center
    center_x += face.w * x_offset
    center_y += face.h * y_offset

    if edge_strategy == "pad":
        side = desired_side
        left = center_x - side / 2.0
        top = center_y - side / 2.0
        # 能放进画面的方向仍然贴边内缩, 放不下的方向留给补边
        if side <= img_width:
            left = min(max(left, 0.0), img_width - side)
        if side <= img_height:
            top = min(max(top, 0.0), img_height - side)
        return CropPlan(left=left, top=top, side=side)

    # clamp: 正方形完整落在画面内。画面容纳不下目标边长时, 缩小到最大可容纳正方形,
    # 此时人脸可能偏离画面中心, 但不会出现任何像素延展/补边
    fit_side = min(float(img_width), float(img_height))
    side = min(desired_side, fit_side)
    clamped = side < desired_side
    left = center_x - side / 2.0
    top = center_y - side / 2.0
    left = min(max(left, 0.0), img_width - side)
    top = min(max(top, 0.0), img_height - side)
    return CropPlan(left=left, top=top, side=side, clamped=clamped)


def extract_square(
    image: np.ndarray,
    plan: CropPlan,
    padding: str = "edge",
    padding_color: tuple[int, int, int] = (0, 0, 0),
) -> np.ndarray:
    """按裁切方案取出正方形图像, 越界时按指定策略补边."""
    img_height, img_width = image.shape[:2]
    x0 = int(round(plan.left))
    y0 = int(round(plan.top))
    side = int(round(plan.side))
    x1, y1 = x0 + side, y0 + side

    if x0 >= 0 and y0 >= 0 and x1 <= img_width and y1 <= img_height:
        return image[y0:y1, x0:x1].copy()

    border_top = max(0, -y0)
    border_left = max(0, -x0)
    border_bottom = max(0, y1 - img_height)
    border_right = max(0, x1 - img_width)

    if padding == "constant":
        border_type = cv2.BORDER_CONSTANT
        kwargs: dict[str, object] = {"value": padding_color}
    elif padding == "reflect":
        # 反射宽度不能超过原图尺寸, 超出时退化为边缘复制
        if (
            max(border_top, border_bottom) >= img_height
            or max(border_left, border_right) >= img_width
        ):
            border_type = cv2.BORDER_REPLICATE
        else:
            border_type = cv2.BORDER_REFLECT_101
        kwargs = {}
    else:
        border_type = cv2.BORDER_REPLICATE
        kwargs = {}

    padded = cv2.copyMakeBorder(
        image,
        border_top,
        border_bottom,
        border_left,
        border_right,
        border_type,
        **kwargs,
    )
    src_x = x0 + border_left
    src_y = y0 + border_top
    return padded[src_y : src_y + side, src_x : src_x + side].copy()


def resize_square(image: np.ndarray, size: int) -> np.ndarray:
    """缩放到目标正方形尺寸, 缩小用 AREA, 放大用 CUBIC."""
    if image.shape[0] == size and image.shape[1] == size:
        return image
    interpolation = cv2.INTER_AREA if size < image.shape[0] else cv2.INTER_CUBIC
    return cv2.resize(image, (size, size), interpolation=interpolation)
