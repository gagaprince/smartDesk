"""一键智能裁切命令行入口.

在 headcut 人脸裁切能力之上新增:
1. 视频输入: 按时间均分抽取 N 帧 (N 可配置, 默认 5) 后逐帧裁切;
2. 部位裁切: 头/胸/腿/手/脚, 可由提示词关键词或显式 --parts 决定;
3. 复用 YuNet 人脸检测 (头部) 与 YOLO11-pose 姿态检测 (其余部位)。

与 cli.py 完全独立, 不会影响原有 "一键裁切头像" 功能。
"""

from __future__ import annotations

import argparse
import shutil
import sys
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

from . import __version__
from .bgremove import DEFAULT_MODEL, MODEL_CHOICES, remove_background
from .body_planner import (
    ALL_PARTS,
    PART_HEAD,
    PART_LABELS,
    BodyCrop,
    plan_body_crops,
    resolve_parts,
)
from .cropper import CropPlan, extract_square, plan_square_crop, resize_square
from .debug_viz import render_debug_overlay
from .detector import Face, FaceDetector
from .io_utils import load_image_bgr, save_image_bgr
from .part_segmenter import PartSegmenter
from .pose_detector import PoseDetector
from .video_utils import extract_even_frames, iter_media_files, probe_video


def _setup_console_encoding() -> None:
    """Windows 控制台默认 GBK, 统一切到 UTF-8 避免中文日志乱码."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
        except (AttributeError, ValueError):
            pass


@dataclass
class SmartStats:
    images: int = 0
    videos: int = 0
    frames: int = 0
    total: int = 0
    cropped: int = 0
    no_target: int = 0
    failed: int = 0
    errors: list[str] = field(default_factory=list)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="headcut.smartcut",
        description="图片/视频智能部位裁切: 视频按时间均分抽帧后, 按提示词或 "
        "指定部位 (头/胸/腿/手/脚) 输出正方形素材, 适合批量制作 LoRA 训练图。",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "inputs",
        nargs="+",
        help="图片/视频文件或包含素材的目录, 可同时传入多个",
    )
    parser.add_argument(
        "-o", "--output-dir",
        default="output",
        help="裁切结果输出目录",
    )
    parser.add_argument(
        "-s", "--size",
        type=int,
        default=1024,
        help="输出正方形图片的边长 (像素)",
    )
    parser.add_argument(
        "-r", "--recursive",
        action="store_true",
        help="递归处理子目录中的素材",
    )
    parser.add_argument(
        "--parts",
        default=PART_HEAD,
        help="裁切部位, 逗号分隔, 可选: " + ",".join(ALL_PARTS)
        + " (提示词有命中时以提示词为准)",
    )
    parser.add_argument(
        "--prompt",
        default="",
        help="提示词/需求描述, 自动识别其中的部位关键词 "
        "(如 头像/胸部/腿部/手部/脚部, 中英文均可)",
    )
    parser.add_argument(
        "--frames",
        type=int,
        default=5,
        help="每个视频按时间均分抽取的帧数 N",
    )
    parser.add_argument(
        "--scale",
        type=float,
        default=2.6,
        help="裁切比例: 裁切边长相对主体检测框的倍数, 头/胸/腿/手/脚各部位统一生效, 数值越大画面越宽松",
    )
    parser.add_argument(
        "--confidence",
        type=float,
        default=0.6,
        help="人脸检测置信度阈值, 漏检时可调低",
    )
    parser.add_argument(
        "--pose-confidence",
        type=float,
        default=0.4,
        help="人体姿态检测置信度阈值",
    )
    parser.add_argument(
        "--kpt-conf",
        type=float,
        default=0.5,
        help="关键点可见度阈值, 低于该值的手/脚视为遮挡而跳过",
    )
    parser.add_argument(
        "--on-no-target",
        choices=("skip", "copy", "error"),
        default="skip",
        help="未检测到人体/人脸时: skip=跳过并警告, copy=原样复制 (仅图片), "
        "error=记为失败",
    )
    parser.add_argument(
        "--remove-bg",
        action="store_true",
        help="裁切后去除背景 (需安装可选依赖 rembg)",
    )
    parser.add_argument(
        "--bg-model",
        choices=MODEL_CHOICES,
        default=DEFAULT_MODEL,
        help="背景去除模型, 默认人像专用 u2net_human_seg",
    )
    parser.add_argument(
        "--bg-color",
        default=None,
        help="去背景后填充的纯色背景, RGB 格式, 如 255,255,255; 不填输出透明底 PNG",
    )
    parser.add_argument(
        "--format",
        choices=("keep", "jpg", "png", "webp"),
        default="jpg",
        help="输出图片格式, keep=图片沿用原图格式 (视频帧仍用 jpg)",
    )
    parser.add_argument(
        "--jpeg-quality",
        type=int,
        default=95,
        help="JPEG/WebP 输出质量 (1-100)",
    )
    parser.add_argument(
        "--model",
        default=None,
        help="自定义 YuNet 人脸模型路径 (也可用环境变量 HEADCUT_MODEL)",
    )
    parser.add_argument(
        "--model-pose",
        default=None,
        help="自定义 YOLO-pose 模型路径 (也可用环境变量 SMARTCUT_POSE_MODEL)",
    )
    parser.add_argument(
        "--seg-model",
        default=None,
        help="自定义 SegFormer 部位分割模型路径 "
        "(也可用环境变量 SMARTCUT_SEG_MODEL)",
    )
    parser.add_argument(
        "--no-seg",
        dest="ai_seg",
        action="store_false",
        help="关闭 AI 部位分割, 胸/腿/手/脚完全改用姿态关键点几何方案",
    )
    parser.set_defaults(ai_seg=True)
    parser.add_argument(
        "--save-debug",
        action="store_true",
        help="保存识别区域调试图: 在输出目录 _debug 子文件夹画出人体框、"
        "关键点骨架与各部位裁切框, 便于核对识别位置",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="只打印检测与裁切计划, 不写出任何文件",
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"headcut smartcut {__version__}",
    )
    return parser


def _parse_color(text: str | None) -> tuple[int, int, int] | None:
    if not text:
        return None
    parts = [part.strip() for part in text.split(",")]
    if len(parts) != 3:
        raise argparse.ArgumentTypeError(f"颜色应为 R,G,B 格式, 收到: {text}")
    try:
        color = tuple(int(part) for part in parts)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"颜色必须是整数: {text}") from exc
    if any(not 0 <= channel <= 255 for channel in color):
        raise argparse.ArgumentTypeError(f"颜色取值范围 0-255: {text}")
    return color  # type: ignore[return-value]


def _parse_parts(text: str) -> list[str]:
    parts = [item.strip().lower() for item in text.split(",") if item.strip()]
    invalid = [item for item in parts if item not in ALL_PARTS]
    if invalid:
        raise argparse.ArgumentTypeError(f"未知裁切部位: {','.join(invalid)}")
    return parts


def _unique_path(path: Path) -> Path:
    """文件名冲突时追加 _1 / _2 序号."""
    if not path.exists():
        return path
    stem, suffix, parent = path.stem, path.suffix, path.parent
    index = 1
    while True:
        candidate = parent / f"{stem}_{index}{suffix}"
        if not candidate.exists():
            return candidate
        index += 1


def _output_extension(source_suffix: str, fmt: str) -> str:
    if fmt != "keep":
        return f".{fmt}"
    suffix = source_suffix.lower()
    if suffix in (".jpg", ".jpeg"):
        return ".jpg"
    return suffix if suffix else ".jpg"


def _fallback_face(person, width: int, height: int) -> Face | None:
    """把姿态检测的头部关键点包装成 Face, 复用人脸裁切几何."""
    kp = person.keypoints
    nose = kp[0]
    left_ear = kp[3]
    right_ear = kp[4]
    if float(left_ear[2]) < 0.3 or float(right_ear[2]) < 0.3:
        return None
    ear_width = float(np.hypot(
        left_ear[0] - right_ear[0],
        left_ear[1] - right_ear[1],
    ))
    face_w = ear_width * 1.35
    face_h = ear_width * 1.6
    center_x = float(nose[0]) if nose[2] >= 0.3 else float(
        (left_ear[0] + right_ear[0]) / 2,
    )
    center_y = float(nose[1]) if nose[2] >= 0.3 else float(
        (left_ear[1] + right_ear[1]) / 2,
    )
    return Face(
        x=center_x - face_w / 2,
        y=center_y - face_h / 2,
        w=face_w,
        h=face_h,
        score=float(person.score),
        landmarks=np.zeros((5, 2), dtype=np.float32),
    )


def _save_debug_visual(
    base_name: str,
    image: np.ndarray,
    persons: list,
    faces: list[Face],
    fallback_face: Face | None,
    crop_items: list[BodyCrop],
    args: argparse.Namespace,
    note: str | None = None,
) -> None:
    """把检测/裁切区域标注图写到输出目录的 _debug 子文件夹."""
    if not args.save_debug or args.dry_run:
        return
    annotated = render_debug_overlay(
        image,
        persons,
        crop_items,
        args.kpt_conf,
        faces=faces,
        fallback_face=fallback_face,
        note=note,
    )
    target = Path(args.output_dir) / "_debug" / f"{base_name}_debug.jpg"
    save_image_bgr(target, annotated, jpeg_quality=90)
    print(f"[识别区域] {base_name} -> {target.parent.name}/{target.name}")


def process_unit(
    base_name: str,
    image: np.ndarray,
    source_suffix: str,
    parts: list[str],
    args: argparse.Namespace,
    face_detector: FaceDetector | None,
    pose_detector: PoseDetector | None,
    bg_color: tuple[int, int, int] | None,
    stats: SmartStats,
    copy_source: Path | None,
    segmenter: PartSegmenter | None = None,
) -> None:
    """对一张图片/一帧执行多部位裁切, 结果直接落盘."""
    height, width = image.shape[:2]
    persons = pose_detector.detect(image) if pose_detector else []
    main_person = persons[0] if persons else None
    crop_items: list[BodyCrop] = []
    faces: list[Face] = []
    fallback_face: Face | None = None

    if PART_HEAD in parts:
        head_plan: CropPlan | None = None
        faces = face_detector.detect(image) if face_detector else []
        if faces:
            main_face = max(faces, key=lambda face: face.area)
            head_plan = plan_square_crop(
                main_face,
                width,
                height,
                scale=args.scale,
            )
        elif main_person is not None:
            fallback_face = _fallback_face(main_person, width, height)
            if fallback_face is not None:
                head_plan = plan_square_crop(
                    fallback_face,
                    width,
                    height,
                    scale=args.scale,
                )
        if head_plan is not None:
            crop_items.append(
                BodyCrop(
                    name=PART_HEAD,
                    part=PART_HEAD,
                    label=PART_LABELS[PART_HEAD],
                    plan=head_plan,
                )
            )

    body_parts = [part for part in parts if part != PART_HEAD]
    seg_map = None
    if body_parts and segmenter is not None:
        try:
            seg_map = segmenter.segment(image)
        except (OSError, ValueError, RuntimeError) as exc:
            print(f"[警告] AI 分割推理失败, 本单元回退关键点方案: {exc}")
            seg_map = None
    if body_parts and main_person is not None:
        crop_items.extend(
            plan_body_crops(
                main_person,
                width,
                height,
                body_parts,
                kpt_conf=args.kpt_conf,
                scale=args.scale,
                seg_map=seg_map,
            )
        )

    if not crop_items:
        stats.no_target += 1
        reason = "未检测到人体" if body_parts else "未检测到人脸"
        print(f"[{reason}] {base_name}")
        _save_debug_visual(
            base_name,
            image,
            persons,
            faces,
            fallback_face,
            crop_items,
            args,
            note=reason,
        )
        if args.on_no_target == "copy" and copy_source is not None:
            if not args.dry_run:
                target = _unique_path(
                    Path(args.output_dir) / copy_source.name,
                )
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(copy_source, target)
            print("  -> 已原样复制")
        elif args.on_no_target == "error":
            stats.failed += 1
            stats.errors.append(f"{base_name}: {reason}")
        return

    _save_debug_visual(
        base_name,
        image,
        persons,
        faces,
        fallback_face,
        crop_items,
        args,
    )

    extension = _output_extension(source_suffix, args.format)
    transparent = args.remove_bg and bg_color is None
    for item in crop_items:
        output_name = f"{base_name}_{item.name}{extension}"
        if transparent and extension.lower() not in (".png", ".webp", ".tif", ".tiff"):
            output_name = f"{base_name}_{item.name}.png"
        target = Path(args.output_dir) / output_name
        ai_text = ", AI识别" if getattr(item, "ai", False) else ""
        print(
            f"[裁切] {base_name} -> {output_name} "
            f"({item.label}{ai_text}, 裁切边长 {item.plan.side:.0f}px"
            f"{', 靠近边角已缩小裁切框' if item.plan.clamped else ''})"
        )
        if args.dry_run:
            stats.cropped += 1
            continue
        square = extract_square(image, item.plan)
        if args.remove_bg:
            square = remove_background(
                square,
                model_name=args.bg_model,
                bg_color=bg_color,
            )
        result = resize_square(square, args.size)
        save_image_bgr(
            _unique_path(target),
            result,
            jpeg_quality=args.jpeg_quality,
        )
        stats.cropped += 1


def main(argv: list[str] | None = None) -> int:
    _setup_console_encoding()
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.size <= 0:
        parser.error("--size 必须是正整数")
    if args.frames <= 0:
        parser.error("--frames 必须是正整数")
    if args.scale <= 0:
        parser.error("--scale 必须大于 0")
    try:
        selected_parts = _parse_parts(args.parts)
        bg_color = _parse_color(args.bg_color)
    except argparse.ArgumentTypeError as exc:
        parser.error(str(exc))
        return 2
    parts = resolve_parts(args.prompt, selected_parts)
    print(f"裁切部位: {', '.join(PART_LABELS[part] for part in parts)}")

    try:
        images, videos = iter_media_files(args.inputs, recursive=args.recursive)
    except FileNotFoundError as exc:
        print(f"错误: {exc}", file=sys.stderr)
        return 1
    if not images and not videos:
        print(
            "错误: 没有找到可处理的图片或视频 "
            "(支持 jpg/jpeg/png/webp/bmp/tif/tiff 与 mp4/mov/avi/mkv/webm 等)",
            file=sys.stderr,
        )
        return 1

    # 先探测视频元数据, 得到准确的处理单元总数用于进度展示
    video_infos = []
    for video in videos:
        try:
            info = probe_video(video)
            frame_total = min(args.frames, max(1, info.frame_count))
            video_infos.append((video, info, frame_total))
        except OSError as exc:
            print(f"[视频探测失败] {video}: {exc}", file=sys.stderr)
    stats = SmartStats(
        images=len(images),
        videos=len(video_infos),
        frames=sum(frame_total for _, _, frame_total in video_infos),
    )
    stats.total = stats.images + stats.frames
    print(
        f"共发现 {stats.total} 个处理单元 "
        f"(图片 {stats.images} 个, 视频 {stats.videos} 个, 抽帧 {stats.frames} 张), "
        "初始化检测器..."
    )

    face_detector: FaceDetector | None = None
    pose_detector: PoseDetector | None = None
    try:
        if PART_HEAD in parts:
            face_detector = FaceDetector(
                model_path=args.model,
                confidence=args.confidence,
            )
        pose_detector = PoseDetector(
            model_path=args.model_pose,
            confidence=args.pose_confidence,
        )
    except (FileNotFoundError, ImportError, cv2.error) as exc:
        print(f"错误: 检测器初始化失败: {exc}", file=sys.stderr)
        return 1

    segmenter: PartSegmenter | None = None
    if args.ai_seg and any(part != PART_HEAD for part in parts):
        try:
            segmenter = PartSegmenter(model_path=args.seg_model)
            print(
                "AI 部位识别已启用: SegFormer-B2 服装解析模型 "
                "(mask 缺失或推理失败时自动回退关键点方案)"
            )
        except (FileNotFoundError, ImportError, OSError, RuntimeError) as exc:
            print(f"[警告] AI 分割模型不可用, 本次改用关键点方案: {exc}")
            segmenter = None

    Path(args.output_dir).mkdir(parents=True, exist_ok=True)

    for image_path in images:
        try:
            image = load_image_bgr(image_path)
            process_unit(
                image_path.stem,
                image,
                image_path.suffix,
                parts,
                args,
                face_detector,
                pose_detector,
                bg_color,
                stats,
                copy_source=image_path,
                segmenter=segmenter,
            )
        except (OSError, cv2.error, ValueError, ImportError) as exc:
            stats.failed += 1
            stats.errors.append(f"{image_path}: {exc}")
            print(f"[处理失败] {image_path}: {exc}", file=sys.stderr)

    for video_path, info, frame_total in video_infos:
        print(
            f"[抽帧] {video_path.name}: 时长 {info.duration:.1f}s, "
            f"共 {info.frame_count} 帧, 抽取 {frame_total} 帧"
        )
        try:
            frames = extract_even_frames(video_path, args.frames)
        except OSError as exc:
            stats.failed += 1
            stats.errors.append(f"{video_path}: {exc}")
            print(f"[处理失败] {video_path}: {exc}", file=sys.stderr)
            continue
        for frame_index, frame in frames:
            base_name = f"{video_path.stem}_f{frame_index:06d}"
            try:
                process_unit(
                    base_name,
                    frame,
                    video_path.suffix,
                    parts,
                    args,
                    face_detector,
                    pose_detector,
                    bg_color,
                    stats,
                    copy_source=None,
                    segmenter=segmenter,
                )
            except (OSError, cv2.error, ValueError, ImportError) as exc:
                stats.failed += 1
                stats.errors.append(f"{base_name}: {exc}")
                print(f"[处理失败] {base_name}: {exc}", file=sys.stderr)

    print("-" * 60)
    print(
        f"完成: 共 {stats.total} 个单元, 裁切输出 {stats.cropped} 张, "
        f"无目标 {stats.no_target} 个, 失败 {stats.failed} 个 "
        f"(图片 {stats.images}, 视频 {stats.videos}, 抽帧 {stats.frames})"
    )
    if args.dry_run:
        print("(dry-run 模式, 未写出文件)")
    for error in stats.errors:
        print(f"  失败详情: {error}", file=sys.stderr)
    return 1 if stats.failed else 0


if __name__ == "__main__":
    sys.exit(main())
