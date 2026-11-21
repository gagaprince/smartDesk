"""识别区域可视化: 把人体框、关键点骨架、人脸框与各部位裁切框画到原图副本上.

仅在命令行传入 --save-debug 时由 smartcut_cli 调用, 结果写到输出目录的
_debug 子文件夹, 不参与正常裁切流程, 也不会出现在界面结果列表中。
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .body_planner import PART_LABELS, BodyCrop
from .detector import Face
from .pose_detector import Person

# COCO 17 关键点的骨架连接关系
_SKELETON_EDGES = (
    (0, 1), (0, 2), (1, 3), (2, 4),
    (5, 6), (5, 7), (7, 9), (6, 8), (8, 10),
    (5, 11), (6, 12),
    (11, 12), (11, 13), (13, 15), (12, 14), (14, 16),
)

# 部位裁切框配色 (RGB, PIL 文字直接使用, cv2 画框时翻转成 BGR)
_PART_COLORS_RGB: dict[str, tuple[int, int, int]] = {
    "head": (255, 99, 132),
    "chest": (255, 159, 64),
    "legs": (76, 175, 80),
    "hand": (33, 150, 243),
    "foot": (156, 39, 176),
}
_DEFAULT_PART_COLOR_RGB = (255, 235, 59)

_PERSON_BOX_RGB = (255, 255, 255)
_SKELETON_RGB = (255, 200, 60)
_VISIBLE_KP_RGB = (76, 255, 120)
_HIDDEN_KP_RGB = (150, 150, 150)
_FACE_RGB = (0, 229, 255)
_FALLBACK_FACE_RGB = (255, 0, 255)
_NOTE_RGB = (255, 90, 90)

_FONT_CANDIDATES = (
    "C:/Windows/Fonts/msyh.ttc",
    "C:/Windows/Fonts/simhei.ttf",
    "/System/Library/Fonts/PingFang.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
)
_font_cache: dict[int, ImageFont.ImageFont] = {}


def _load_font(size: int) -> ImageFont.ImageFont:
    cached = _font_cache.get(size)
    if cached is not None:
        return cached
    for candidate in _FONT_CANDIDATES:
        if Path(candidate).is_file():
            try:
                font = ImageFont.truetype(candidate, size)
                _font_cache[size] = font
                return font
            except OSError:
                continue
    font = ImageFont.load_default()
    _font_cache[size] = font
    return font


def _bgr(rgb: tuple[int, int, int]) -> tuple[int, int, int]:
    return rgb[2], rgb[1], rgb[0]


def render_debug_overlay(
    image: np.ndarray,
    persons: list[Person],
    crop_items: list[BodyCrop],
    kpt_conf: float,
    faces: list[Face] | None = None,
    fallback_face: Face | None = None,
    note: str | None = None,
) -> np.ndarray:
    """在原图副本上绘制检测与裁切区域, 返回标注后的 BGR 图像.

    绘制内容: 人体包围框、17 关键点骨架 (绿色=可见, 灰色=低于可见度阈值)、
    YuNet 人脸框/姿态估算人脸框, 以及头/胸/腿/手/脚各部位裁切正方形与边长。
    """
    canvas = image.copy()
    height, width = canvas.shape[:2]
    scale = max(1.0, min(width, height) / 1000.0)
    line_thick = max(1, round(2 * scale))
    thin_thick = max(1, round(1.2 * scale))
    kp_radius = max(3, round(4 * scale))
    font_size = max(15, round(22 * scale))
    font = _load_font(font_size)
    # (文字, 左上角坐标, 颜色), 文字统一在最后用 PIL 渲染以支持中文
    labels: list[tuple[str, tuple[int, int], tuple[int, int, int]]] = []

    for person in persons:
        x1, y1, x2, y2 = (int(round(value)) for value in person.box)
        cv2.rectangle(
            canvas, (x1, y1), (x2, y2), _bgr(_PERSON_BOX_RGB), thin_thick,
        )
        labels.append((
            f"人体 {person.score:.2f}",
            (x1, max(0, y1 - font_size - 6)),
            _PERSON_BOX_RGB,
        ))

        keypoints = person.keypoints
        for start, end in _SKELETON_EDGES:
            if (
                float(keypoints[start][2]) >= kpt_conf
                and float(keypoints[end][2]) >= kpt_conf
            ):
                point1 = (
                    int(round(keypoints[start][0])),
                    int(round(keypoints[start][1])),
                )
                point2 = (
                    int(round(keypoints[end][0])),
                    int(round(keypoints[end][1])),
                )
                cv2.line(
                    canvas, point1, point2, _bgr(_SKELETON_RGB),
                    thin_thick, cv2.LINE_AA,
                )
        for point in keypoints:
            visible = float(point[2]) >= kpt_conf
            color = _VISIBLE_KP_RGB if visible else _HIDDEN_KP_RGB
            center = (int(round(point[0])), int(round(point[1])))
            cv2.circle(
                canvas,
                center,
                kp_radius if visible else max(2, kp_radius - 1),
                _bgr(color),
                -1 if visible else thin_thick,
                cv2.LINE_AA,
            )

    for face in faces or []:
        x, y = int(round(face.x)), int(round(face.y))
        right = int(round(face.x + face.w))
        bottom = int(round(face.y + face.h))
        cv2.rectangle(
            canvas, (x, y), (right, bottom), _bgr(_FACE_RGB), line_thick,
        )
        labels.append((
            f"人脸 {face.score:.2f}",
            (x, max(0, y - font_size - 6)),
            _FACE_RGB,
        ))

    if fallback_face is not None:
        x, y = int(round(fallback_face.x)), int(round(fallback_face.y))
        right = int(round(fallback_face.x + fallback_face.w))
        bottom = int(round(fallback_face.y + fallback_face.h))
        cv2.rectangle(
            canvas, (x, y), (right, bottom),
            _bgr(_FALLBACK_FACE_RGB), line_thick,
        )
        labels.append((
            "头部(姿态估算)",
            (x, max(0, y - font_size - 6)),
            _FALLBACK_FACE_RGB,
        ))

    for item in crop_items:
        plan = item.plan
        left, top = int(round(plan.left)), int(round(plan.top))
        right = int(round(plan.left + plan.side))
        bottom = int(round(plan.top + plan.side))
        color = _PART_COLORS_RGB.get(item.part, _DEFAULT_PART_COLOR_RGB)
        if getattr(item, "mask", None) is not None:
            # AI 分割 mask: 半透明填色 + 轮廓, 直观看出模型识别的部位区域
            overlay = canvas.copy()
            overlay[item.mask] = _bgr(color)
            canvas = cv2.addWeighted(overlay, 0.35, canvas, 0.65, 0)
            contours, _ = cv2.findContours(
                item.mask.astype(np.uint8),
                cv2.RETR_EXTERNAL,
                cv2.CHAIN_APPROX_SIMPLE,
            )
            cv2.drawContours(
                canvas, contours, -1, _bgr(color), thin_thick, cv2.LINE_AA,
            )
        cv2.rectangle(
            canvas, (left, top), (right, bottom),
            _bgr(color), line_thick + 1,
        )
        clamped_text = " 已缩小" if plan.clamped else ""
        ai_text = "AI识别 " if getattr(item, "ai", False) else ""
        label = f"{ai_text}{item.label} {plan.side:.0f}px{clamped_text}"
        label_y = top - font_size - 6
        if label_y < 0:
            label_y = top + 4
        labels.append((label, (left, label_y), color))

    if note:
        labels.append((note, (8, 8), _NOTE_RGB))

    # cv2 自带 Hershey 字体不含中文字形, 文字统一交给 PIL 渲染
    pil_image = Image.fromarray(cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB))
    draw = ImageDraw.Draw(pil_image)
    for text, (x, y), color in labels:
        bbox = draw.textbbox((x, y), text, font=font)
        draw.rectangle(
            (bbox[0] - 3, bbox[1] - 1, bbox[2] + 3, bbox[3] + 1),
            fill=(0, 0, 0),
        )
        draw.text((x, y), text, font=font, fill=color)
    return cv2.cvtColor(np.asarray(pil_image), cv2.COLOR_RGB2BGR)
