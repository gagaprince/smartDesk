"""根据姿态关键点规划头/胸/腿/手/脚的正方形裁切区域, 以及提示词解析."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from . import part_segmenter as seg
from .cropper import CropPlan
from .pose_detector import (
    KP_LEFT_ANKLE,
    KP_LEFT_EAR,
    KP_LEFT_ELBOW,
    KP_LEFT_HIP,
    KP_LEFT_KNEE,
    KP_LEFT_SHOULDER,
    KP_LEFT_WRIST,
    KP_NOSE,
    KP_RIGHT_ANKLE,
    KP_RIGHT_EAR,
    KP_RIGHT_ELBOW,
    KP_RIGHT_HIP,
    KP_RIGHT_KNEE,
    KP_RIGHT_SHOULDER,
    KP_RIGHT_WRIST,
    Person,
)

PART_HEAD = "head"
PART_CHEST = "chest"
PART_LEGS = "legs"
PART_HAND = "hand"
PART_FOOT = "foot"

# 界面/日志使用的中文部位名
PART_LABELS = {
    PART_HEAD: "头部",
    PART_CHEST: "胸部",
    PART_LEGS: "腿部",
    PART_HAND: "手部",
    PART_FOOT: "脚部",
}

ALL_PARTS = (PART_HEAD, PART_CHEST, PART_LEGS, PART_HAND, PART_FOOT)

# 裁切比例默认值, 与界面/命令行的 --scale 默认保持一致;
# 身体各部位的几何参数按该基准调校, 实际边长再乘以 scale / DEFAULT_SCALE
DEFAULT_SCALE = 2.6

# 提示词关键词 -> 部位, 命中任一关键词即裁切对应部位
PART_KEYWORDS: dict[str, tuple[str, ...]] = {
    PART_HEAD: (
        "头像", "头部", "人脸", "脸部", "脸蛋", "面部", "五官", "头", "脸",
        "head", "face", "portrait", "avatar",
    ),
    PART_CHEST: (
        "胸部", "胸口", "胸", "上半身", "半身", "躯干",
        "chest", "bust", "torso", "upper body",
    ),
    PART_LEGS: (
        "腿部", "大腿", "小腿", "腿", "下半身",
        "leg", "legs", "thigh",
    ),
    PART_HAND: (
        "手部", "手指", "手掌", "手腕", "手",
        "hand", "hands", "wrist", "finger",
    ),
    PART_FOOT: (
        "脚部", "足部", "脚", "足", "鞋子",
        "foot", "feet", "ankle", "shoe",
    ),
}


@dataclass
class BodyCrop:
    """单个部位的裁切方案, name 含左右手/脚序号 (如 hand1).

    ai=True 表示中心定位来自 SegFormer 分割 mask; mask 为对应的布尔区域,
    仅供调试图叠加, 不参与落盘裁切。
    """

    name: str
    part: str
    label: str
    plan: CropPlan
    ai: bool = False
    mask: np.ndarray | None = field(default=None, compare=False)


def parse_prompt_parts(prompt: str | None) -> list[str]:
    """从中文/英文提示词中提取需要裁切的部位, 未命中任何关键词返回空列表."""
    if not prompt:
        return []
    text = prompt.lower()
    matched: list[str] = []
    for part in ALL_PARTS:
        if any(keyword.lower() in text for keyword in PART_KEYWORDS[part]):
            matched.append(part)
    return matched


def resolve_parts(
    prompt: str | None,
    selected: list[str] | None,
) -> list[str]:
    """优先用提示词决定部位, 提示词无命中时回退到勾选部位, 再回退到头部."""
    prompt_parts = parse_prompt_parts(prompt)
    if prompt_parts:
        return prompt_parts
    valid = [part for part in (selected or []) if part in ALL_PARTS]
    return valid if valid else [PART_HEAD]


def _distance(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.hypot(a[0] - b[0], a[1] - b[1]))


def _clamp_square(
    center_x: float,
    center_y: float,
    side: float,
    img_width: int,
    img_height: int,
) -> CropPlan:
    """以给定点为中心生成完整落在画面内的正方形裁切框, 放不下时缩小边长."""
    fit_side = min(float(img_width), float(img_height))
    requested_side = float(side)
    side = min(requested_side, fit_side)
    left = center_x - side / 2.0
    top = center_y - side / 2.0
    left = min(max(left, 0.0), img_width - side)
    top = min(max(top, 0.0), img_height - side)
    return CropPlan(
        left=left,
        top=top,
        side=side,
        clamped=side < requested_side - 1e-6,
    )


def _visible(point: np.ndarray, threshold: float) -> bool:
    return float(point[2]) >= threshold


def plan_head_from_pose(
    person: Person,
    img_width: int,
    img_height: int,
    kpt_conf: float,
    scale: float = DEFAULT_SCALE,
) -> CropPlan | None:
    """无人脸检测结果时的头部兜底方案: 依据耳朵/鼻子/肩宽估计头框."""
    kp = person.keypoints
    nose = kp[KP_NOSE]
    left_ear = kp[KP_LEFT_EAR]
    right_ear = kp[KP_RIGHT_EAR]
    left_shoulder = kp[KP_LEFT_SHOULDER]
    right_shoulder = kp[KP_RIGHT_SHOULDER]

    shoulder_width = _distance(left_shoulder, right_shoulder)
    person_width = float(person.box[2] - person.box[0])
    if _visible(left_ear, kpt_conf) and _visible(right_ear, kpt_conf):
        # 近景/侧面时耳朵距离可能偏小, 用人物框宽度做下限
        head_width = max(
            _distance(left_ear, right_ear) * 1.9,
            person_width * 0.42,
        )
    elif shoulder_width > 0:
        head_width = max(shoulder_width * 0.55, person_width * 0.42)
    elif person_width > 0:
        head_width = person_width * 0.42
    else:
        return None

    if _visible(nose, kpt_conf):
        center_x, center_y = float(nose[0]), float(nose[1])
    else:
        ear_points = [
            point for point in (left_ear, right_ear)
            if _visible(point, kpt_conf)
        ]
        if not ear_points:
            return None
        center = np.mean(np.array(ear_points), axis=0)
        # 鼻子不可见 (如背影) 时中心略向上移, 给头顶发髻留空间
        center_x, center_y = float(center[0]), float(center[1]) - head_width * 0.08
    return _clamp_square(
        center_x,
        center_y,
        head_width * 1.7 * (scale / DEFAULT_SCALE),
        img_width,
        img_height,
    )


def _chest_region(
    seg_map: np.ndarray,
    img_width: int,
    img_height: int,
) -> seg.MaskRegion | None:
    """从分割标签图取胸部/躯干区域, 连衣裙等全身服装只取上部 60%。"""
    region = seg.region_from_labels(
        seg_map, seg.CHEST_LABELS, img_width, img_height,
    )
    if region is not None:
        return region
    region = seg.region_from_labels(
        seg_map, seg.CHEST_FALLBACK_LABELS, img_width, img_height,
    )
    if region is None:
        return None
    x1, y1, x2, y2 = region.bbox
    cutoff = y1 + int(0.6 * (y2 - y1))
    upper_mask = region.mask.copy()
    upper_mask[cutoff:, :] = False
    return seg.region_from_mask(upper_mask, img_width, img_height)


def plan_body_crops(
    person: Person,
    img_width: int,
    img_height: int,
    parts: list[str],
    kpt_conf: float = 0.5,
    scale: float = DEFAULT_SCALE,
    seg_map: np.ndarray | None = None,
) -> list[BodyCrop]:
    """按部位列表生成裁切方案, 关键点被遮挡的手/脚会自动跳过.

    scale: 裁切比例, 各部位以 DEFAULT_SCALE 下的基准边长按比例整体缩放,
    与人脸头部裁切的 --scale 语义保持一致。
    seg_map: SegFormer 服装解析的标签图 (见 part_segmenter), 提供时胸/腿/手/
    脚优先用像素级 mask 定位中心; mask 缺失或过弱时自动回退关键点几何方案,
    边长公式保持不变, 因此 --scale 的语义在两种方案下完全一致。
    """
    kp = person.keypoints
    crops: list[BodyCrop] = []
    scale_ratio = scale / DEFAULT_SCALE

    left_shoulder = kp[KP_LEFT_SHOULDER]
    right_shoulder = kp[KP_RIGHT_SHOULDER]
    left_hip = kp[KP_LEFT_HIP]
    right_hip = kp[KP_RIGHT_HIP]
    shoulder_width = _distance(left_shoulder, right_shoulder)
    hip_width = _distance(left_hip, right_hip)
    shoulder_mid = (left_shoulder + right_shoulder) / 2
    person_width = float(person.box[2] - person.box[0])
    person_height = float(person.box[3] - person.box[1])

    def add_crop(
        name: str,
        part: str,
        plan: CropPlan | None,
        ai: bool = False,
        mask: np.ndarray | None = None,
    ) -> None:
        if plan is not None:
            crops.append(
                BodyCrop(
                    name=name,
                    part=part,
                    label=PART_LABELS[part],
                    plan=plan,
                    ai=ai,
                    mask=mask,
                )
            )

    if PART_HEAD in parts:
        add_crop(PART_HEAD, PART_HEAD, plan_head_from_pose(
            person, img_width, img_height, kpt_conf, scale=scale,
        ))

    if PART_CHEST in parts:
        plan: CropPlan | None = None
        ai_mask: np.ndarray | None = None
        used_ai = False
        if seg_map is not None:
            region = _chest_region(seg_map, img_width, img_height)
            if region is not None:
                side = max(
                    shoulder_width * 2.4,
                    person_width * 1.15,
                    person_height * 0.32,
                ) * scale_ratio
                center_x, center_y = region.center
                plan = _clamp_square(
                    center_x, center_y, side, img_width, img_height,
                )
                ai_mask, used_ai = region.mask, True
        if plan is None and shoulder_width > 0:
            side = max(
                shoulder_width * 2.4,
                person_width * 1.15,
                person_height * 0.32,
            ) * scale_ratio
            plan = _clamp_square(
                float(shoulder_mid[0]),
                float(shoulder_mid[1]) + side * 0.15,
                side,
                img_width,
                img_height,
            )
        add_crop(PART_CHEST, PART_CHEST, plan, used_ai, ai_mask)

    if PART_LEGS in parts:
        plan = None
        ai_mask = None
        used_ai = False
        if seg_map is not None:
            region = seg.region_from_labels(
                seg_map, seg.LEG_LABELS, img_width, img_height,
            )
            if region is None:
                # 长裤/裙子遮挡腿部皮肤时, 用下装区域兜底
                region = seg.region_from_labels(
                    seg_map, seg.LEG_FALLBACK_LABELS, img_width, img_height,
                )
            if region is not None:
                rx1, ry1, rx2, ry2 = region.bbox
                seg_span = max(rx2 - rx1, ry2 - ry1)
                side = max(
                    seg_span * 1.15,
                    person_width * 1.1,
                    person_height * 0.4,
                ) * scale_ratio
                center_x, center_y = region.center
                plan = _clamp_square(
                    center_x, center_y, side, img_width, img_height,
                )
                ai_mask, used_ai = region.mask, True
        if plan is None:
            leg_indices = (
                KP_LEFT_HIP, KP_RIGHT_HIP,
                KP_LEFT_KNEE, KP_RIGHT_KNEE,
                KP_LEFT_ANKLE, KP_RIGHT_ANKLE,
            )
            leg_points = [
                kp[index] for index in leg_indices if _visible(kp[index], kpt_conf)
            ]
            if leg_points:
                coords = np.array([(point[0], point[1]) for point in leg_points])
                x1, y1 = coords.min(axis=0)
                x2, y2 = coords.max(axis=0)
                center_x = float((x1 + x2) / 2)
                center_y = float((y1 + y2) / 2)
                # 近景画面里腿部关键点可能挤在一起, 用人物框尺寸做下限,
                # 避免裁出放大后发虚的局部面料
                side = max(
                    max(float(x2 - x1), float(y2 - y1)) * 1.15,
                    person_width * 1.1,
                    person_height * 0.4,
                ) * scale_ratio
                plan = _clamp_square(
                    center_x, center_y, side, img_width, img_height,
                )
        add_crop(PART_LEGS, PART_LEGS, plan, used_ai, ai_mask)

    if PART_HAND in parts:
        side = max(
            shoulder_width * 1.25,
            person_width * 0.55,
        ) * scale_ratio
        hand_specs = (
            ("hand1", seg.LEFT_ARM_LABELS, KP_LEFT_WRIST, KP_LEFT_ELBOW),
            ("hand2", seg.RIGHT_ARM_LABELS, KP_RIGHT_WRIST, KP_RIGHT_ELBOW),
        )
        for name, arm_labels, wrist_index, elbow_index in hand_specs:
            plan = None
            ai_mask = None
            used_ai = False
            if seg_map is not None:
                region = seg.region_from_labels(
                    seg_map, arm_labels, img_width, img_height,
                )
                if region is not None:
                    # 模型没有独立的手掌类, 取手臂 mask 上离肩中心最远的点
                    # (即手臂末端) 作为手掌中心
                    anchor = (float(shoulder_mid[0]), float(shoulder_mid[1]))
                    hand_x, hand_y = seg.farthest_point(region.mask, anchor)
                    plan = _clamp_square(
                        float(hand_x), float(hand_y), side,
                        img_width, img_height,
                    )
                    ai_mask, used_ai = region.mask, True
            if plan is None:
                wrist = kp[wrist_index]
                if _visible(wrist, kpt_conf):
                    center_x, center_y = float(wrist[0]), float(wrist[1])
                    elbow = kp[elbow_index]
                    if _visible(elbow, kpt_conf):
                        # 沿小臂方向越过手腕再偏移, 让手掌位于画面中央而非边缘
                        direction = wrist - elbow
                        norm = float(np.hypot(direction[0], direction[1]))
                        if norm > 1:
                            center_x += float(direction[0]) / norm * side * 0.25
                            center_y += float(direction[1]) / norm * side * 0.25
                    plan = _clamp_square(
                        center_x, center_y, side, img_width, img_height,
                    )
            add_crop(name, PART_HAND, plan, used_ai, ai_mask)

    if PART_FOOT in parts:
        base_side = max(
            shoulder_width * 0.95,
            hip_width * 1.3,
            person_width * 0.5,
        )
        if base_side > 0:
            side = base_side * scale_ratio
            foot_specs = (
                ("foot1", seg.LEFT_SHOE_LABELS, KP_LEFT_ANKLE),
                ("foot2", seg.RIGHT_SHOE_LABELS, KP_RIGHT_ANKLE),
            )
            for name, shoe_labels, ankle_index in foot_specs:
                plan = None
                ai_mask = None
                used_ai = False
                if seg_map is not None:
                    region = seg.region_from_labels(
                        seg_map, shoe_labels, img_width, img_height,
                    )
                    if region is not None:
                        center_x, center_y = region.center
                        plan = _clamp_square(
                            center_x, center_y, side,
                            img_width, img_height,
                        )
                        ai_mask, used_ai = region.mask, True
                if plan is None:
                    ankle = kp[ankle_index]
                    if _visible(ankle, kpt_conf):
                        # 脚踝下方才是鞋/脚主体, 中心向下偏移
                        plan = _clamp_square(
                            float(ankle[0]),
                            float(ankle[1]) + side * 0.22,
                            side,
                            img_width,
                            img_height,
                        )
                add_crop(name, PART_FOOT, plan, used_ai, ai_mask)

    return crops
