"""headcut 命令行入口."""

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
from .cropper import CropPlan, extract_square, plan_square_crop, resize_square
from .detector import Face, FaceDetector
from .io_utils import iter_image_files, load_image_bgr, save_image_bgr


def _setup_console_encoding() -> None:
    """Windows 控制台默认 GBK, 统一切到 UTF-8 避免中文日志乱码."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
        except (AttributeError, ValueError):
            pass


@dataclass
class Stats:
    total: int = 0
    cropped: int = 0
    no_face: int = 0
    failed: int = 0
    errors: list[str] = field(default_factory=list)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="headcut",
        description="检测图片中的主体人脸, 向外延伸截取包含头部/上半身的正方形头像, "
        "并缩放到指定尺寸 (默认 1024x1024), 适合批量制作 LoRA 训练素材。",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "inputs",
        nargs="+",
        help="图片文件或包含图片的目录, 可同时传入多个",
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
        help="递归处理子目录中的图片",
    )
    parser.add_argument(
        "--scale",
        type=float,
        default=2.6,
        help="裁切边长相对人脸框长边的倍数, 调大包含更多身体与背景, 调小更贴近脸部",
    )
    parser.add_argument(
        "--x-offset",
        type=float,
        default=0.0,
        help="裁切中心水平偏移, 以人脸宽度为单位, 正值向右",
    )
    parser.add_argument(
        "--y-offset",
        type=float,
        default=0.0,
        help="裁切中心垂直偏移, 以人脸高度为单位, 正值向下 (如 0.1 可多留出身体)",
    )
    parser.add_argument(
        "--confidence",
        type=float,
        default=0.6,
        help="人脸检测置信度阈值, 漏检时可调低",
    )
    parser.add_argument(
        "--all-faces",
        action="store_true",
        help="裁切图中每一张脸 (默认只取面积最大的主体人脸), 输出文件名带 _face1 等后缀",
    )
    parser.add_argument(
        "--min-face-ratio",
        type=float,
        default=0.05,
        help="过滤掉宽度小于图像宽度该比例的人脸 (用于忽略远处路人), 设为 0 表示不过滤",
    )
    parser.add_argument(
        "--face-suffix",
        default="_face",
        help="多人脸输出时的文件名后缀前缀",
    )
    parser.add_argument(
        "--on-no-face",
        choices=("skip", "copy", "error"),
        default="skip",
        help="未检测到人脸时: skip=跳过并警告, copy=原样复制, error=记为失败",
    )
    parser.add_argument(
        "--edge-strategy",
        choices=("clamp", "pad"),
        default="clamp",
        help="人脸靠近边角、裁切框放不下时: clamp=裁切框限制在画面内并允许人脸偏离中心(默认, "
        "无补边); pad=保持人脸居中, 越界部分按 --padding 补边",
    )
    parser.add_argument(
        "--padding",
        choices=("edge", "reflect", "constant"),
        default="edge",
        help="仅 --edge-strategy pad 时生效: edge=边缘像素延展, reflect=镜像, constant=纯色",
    )
    parser.add_argument(
        "--padding-color",
        default="0,0,0",
        help="padding=constant 时的填充色, RGB 格式, 如 255,255,255",
    )
    parser.add_argument(
        "--remove-bg",
        action="store_true",
        help="裁切后去除背景 (需安装可选依赖 rembg, 首次使用自动下载分割模型)",
    )
    parser.add_argument(
        "--bg-model",
        choices=MODEL_CHOICES,
        default=DEFAULT_MODEL,
        help="背景去除模型, 默认人像专用 u2net_human_seg; silueta 体积小速度快",
    )
    parser.add_argument(
        "--bg-color",
        default=None,
        help="去背景后填充的纯色背景, RGB 格式, 如 255,255,255; 不填则输出透明底 PNG",
    )
    parser.add_argument(
        "--format",
        choices=("keep", "jpg", "png", "webp"),
        default="keep",
        help="输出图片格式, keep 表示与原图一致",
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
        help="自定义 YuNet onnx 模型路径 (也可用环境变量 HEADCUT_MODEL)",
    )
    parser.add_argument(
        "--annotate-dir",
        default=None,
        help="可选: 把人脸框与裁切框画到原图上输出到该目录, 便于核对检测效果",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="只打印检测与裁切计划, 不写出任何文件",
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"headcut {__version__}",
    )
    return parser


def _parse_color(text: str) -> tuple[int, int, int]:
    parts = [p.strip() for p in text.split(",")]
    if len(parts) != 3:
        raise argparse.ArgumentTypeError(f"padding-color 应为 R,G,B 格式, 收到: {text}")
    try:
        color = tuple(int(p) for p in parts)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"padding-color 必须是整数: {text}") from exc
    if any(not 0 <= channel <= 255 for channel in color):
        raise argparse.ArgumentTypeError(f"padding-color 取值范围 0-255: {text}")
    return color  # type: ignore[return-value]


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


def _output_name(source: Path, face_index: int | None, suffix: str, fmt: str) -> str:
    extension = source.suffix if fmt == "keep" else f".{fmt.replace('jpg', 'jpg')}"
    if fmt == "keep" and extension.lower() == ".jpeg":
        extension = ".jpg"
    if face_index is None:
        return f"{source.stem}{extension}"
    return f"{source.stem}{suffix}{face_index}{extension}"


def _select_faces(faces: list[Face], all_faces: bool) -> list[tuple[int, Face]]:
    if not faces:
        return []
    ordered = sorted(enumerate(faces, start=1), key=lambda item: item[1].area, reverse=True)
    if all_faces:
        return ordered
    return [ordered[0]]


def _draw_annotation(
    image: np.ndarray,
    faces: list[Face],
    plans: list[CropPlan],
    selected_indices: set[int],
) -> np.ndarray:
    annotated = image.copy()
    for index, face in enumerate(faces, start=1):
        color = (0, 200, 0) if index in selected_indices else (128, 128, 128)
        top_left = (int(face.x), int(face.y))
        bottom_right = (int(face.x + face.w), int(face.y + face.h))
        cv2.rectangle(annotated, top_left, bottom_right, color, 2)
        for point in face.landmarks.astype(int):
            cv2.circle(annotated, tuple(point), 2, (0, 165, 255), -1)
        cv2.putText(
            annotated,
            f"#{index} {face.score:.2f}",
            (int(face.x), max(15, int(face.y) - 6)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            color,
            2,
        )
    for plan in plans:
        cv2.rectangle(
            annotated,
            (int(round(plan.left)), int(round(plan.top))),
            (int(round(plan.right)), int(round(plan.bottom))),
            (0, 0, 255),
            2,
        )
    return annotated


def process_file(
    source: Path,
    args: argparse.Namespace,
    detector: FaceDetector,
    padding_color: tuple[int, int, int],
    bg_color: tuple[int, int, int] | None,
    stats: Stats,
) -> None:
    image = load_image_bgr(source)
    height, width = image.shape[:2]
    faces = detector.detect(image)

    if args.min_face_ratio > 0:
        min_width = width * args.min_face_ratio
        kept = [face for face in faces if face.w >= min_width]
        if len(kept) < len(faces):
            print(f"  {source.name}: 过滤 {len(faces) - len(kept)} 张小于 "
                  f"{args.min_face_ratio:.0%} 图像宽度的人脸")
        faces = kept

    if not faces:
        stats.no_face += 1
        print(f"[未检测到人脸] {source}")
        if args.on_no_face == "copy":
            if not args.dry_run:
                target = _unique_path(Path(args.output_dir) / source.name)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
            print(f"  -> 已原样复制")
        elif args.on_no_face == "error":
            stats.failed += 1
            stats.errors.append(f"{source}: 未检测到人脸")
        return

    selected = _select_faces(faces, args.all_faces)
    multi = len(selected) > 1
    plans: list[CropPlan] = []
    selected_indices: set[int] = set()
    for face_index, face in selected:
        selected_indices.add(face_index)
        plan = plan_square_crop(
            face,
            width,
            height,
            scale=args.scale,
            x_offset=args.x_offset,
            y_offset=args.y_offset,
            edge_strategy=args.edge_strategy,
        )
        plans.append(plan)
        name_index = face_index if multi else None
        output_name = _output_name(source, name_index, args.face_suffix, args.format)
        transparent = args.remove_bg and bg_color is None
        if transparent and Path(output_name).suffix.lower() not in (
            ".png", ".webp", ".tif", ".tiff",
        ):
            output_name = str(Path(output_name).with_suffix(".png"))
        target = Path(args.output_dir) / output_name
        clamp_note = ", 靠近边角已缩小裁切框" if plan.clamped else ""
        bg_note = ", 已去除背景(透明底)" if transparent else (
            ", 已去除背景(纯色底)" if args.remove_bg else ""
        )
        print(
            f"[裁切] {source.name} -> {output_name} "
            f"(人脸 {face.w:.0f}x{face.h:.0f}px, 置信度 {face.score:.2f}, "
            f"裁切边长 {plan.side:.0f}px{clamp_note}{bg_note})"
        )
        if args.dry_run:
            continue
        # CLI 接收的是 RGB, OpenCV 按 BGR 处理, 需要反转
        square = extract_square(
            image,
            plan,
            padding=args.padding,
            padding_color=padding_color[::-1],
        )
        if args.remove_bg:
            square = remove_background(
                square,
                model_name=args.bg_model,
                bg_color=bg_color,
            )
        result = resize_square(square, args.size)
        save_image_bgr(_unique_path(target), result, jpeg_quality=args.jpeg_quality)
        stats.cropped += 1

    if args.annotate_dir and not args.dry_run:
        annotated = _draw_annotation(image, faces, plans, selected_indices)
        annotate_target = Path(args.annotate_dir) / source.name
        save_image_bgr(_unique_path(annotate_target), annotated, jpeg_quality=args.jpeg_quality)


def main(argv: list[str] | None = None) -> int:
    _setup_console_encoding()
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.size <= 0:
        parser.error("--size 必须是正整数")
    if args.scale <= 0:
        parser.error("--scale 必须大于 0")
    padding_color = _parse_color(args.padding_color)
    bg_color = _parse_color(args.bg_color) if args.bg_color else None

    try:
        files = iter_image_files(args.inputs, recursive=args.recursive)
    except FileNotFoundError as exc:
        print(f"错误: {exc}", file=sys.stderr)
        return 1
    if not files:
        print("错误: 没有找到可处理的图片 (支持 jpg/jpeg/png/webp/bmp/tif/tiff)", file=sys.stderr)
        return 1

    print(f"共发现 {len(files)} 张图片, 初始化人脸检测器...")
    try:
        detector = FaceDetector(model_path=args.model, confidence=args.confidence)
    except (FileNotFoundError, cv2.error) as exc:
        print(f"错误: 人脸模型初始化失败: {exc}", file=sys.stderr)
        return 1

    stats = Stats(total=len(files))
    for source in files:
        try:
            process_file(source, args, detector, padding_color, bg_color, stats)
        except (OSError, cv2.error, ValueError, ImportError) as exc:
            stats.failed += 1
            stats.errors.append(f"{source}: {exc}")
            print(f"[处理失败] {source}: {exc}", file=sys.stderr)

    print("-" * 60)
    print(
        f"完成: 共 {stats.total} 张, 裁切输出 {stats.cropped} 张, "
        f"无人脸 {stats.no_face} 张, 失败 {stats.failed} 张"
    )
    if args.dry_run:
        print("(dry-run 模式, 未写出文件)")
    for error in stats.errors:
        print(f"  失败详情: {error}", file=sys.stderr)
    return 1 if stats.failed else 0
