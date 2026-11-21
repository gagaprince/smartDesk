"""视频文件发现与按时间均分抽帧, 全部走 OpenCV VideoIO."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from .io_utils import SUPPORTED_SUFFIXES

VIDEO_SUFFIXES = {
    ".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv",
    ".ts", ".m4v", ".wmv", ".mpg", ".mpeg",
}


@dataclass
class VideoInfo:
    frame_count: int
    fps: float
    duration: float


def iter_media_files(
    inputs: list[str | Path],
    recursive: bool = False,
) -> tuple[list[Path], list[Path]]:
    """展开输入为 (图片列表, 视频列表), 均按路径排序且去重."""
    images: list[Path] = []
    videos: list[Path] = []
    seen: set[Path] = set()
    for item in inputs:
        path = Path(item)
        if path.is_file():
            candidates = [path]
        elif path.is_dir():
            pattern = "**/*" if recursive else "*"
            candidates = (
                candidate for candidate in path.glob(pattern)
                if candidate.is_file()
            )
        else:
            raise FileNotFoundError(f"输入路径不存在: {path}")
        for candidate in candidates:
            suffix = candidate.suffix.lower()
            if suffix not in SUPPORTED_SUFFIXES and suffix not in VIDEO_SUFFIXES:
                continue
            resolved = candidate.resolve()
            if resolved in seen:
                continue
            seen.add(resolved)
            if suffix in VIDEO_SUFFIXES:
                videos.append(candidate)
            else:
                images.append(candidate)
    return sorted(images), sorted(videos)


def probe_video(path: str | Path) -> VideoInfo:
    """读取视频元数据, 帧数/帧率缺失时给出兜底值."""
    cap = cv2.VideoCapture(str(path))
    try:
        if not cap.isOpened():
            raise OSError(f"无法打开视频: {path}")
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        if frame_count <= 0:
            # 个别封装 (如 ts 流) 不提供总帧数, 顺序读取统计
            counted = 0
            while True:
                ok, _ = cap.read()
                if not ok:
                    break
                counted += 1
            frame_count = counted
        if fps <= 0:
            fps = 25.0
        duration = frame_count / fps if fps else 0.0
        return VideoInfo(frame_count=frame_count, fps=fps, duration=duration)
    finally:
        cap.release()


def extract_even_frames(
    path: str | Path,
    count: int,
) -> list[tuple[int, np.ndarray]]:
    """把视频时间均分成 count 段, 取每段中点的帧.

    返回 (帧序号, BGR 图像) 列表; 优先按时间戳跳转, 跳转失败的片段
    退化为顺序抓帧, 保证短视频也能取满数量 (不足时返回实际可读帧数)。
    """
    info = probe_video(path)
    target_count = max(1, int(count))
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise OSError(f"无法打开视频: {path}")
    frames: list[tuple[int, np.ndarray]] = []
    try:
        total = max(1, info.frame_count)
        actual_count = min(target_count, total)
        for index in range(actual_count):
            # 第 index 段的中点帧
            target_frame = int(round((index + 0.5) * total / actual_count))
            target_frame = min(max(target_frame, 0), total - 1)
            target_msec = (
                target_frame / info.fps * 1000.0 if info.fps else 0.0
            )
            cap.set(cv2.CAP_PROP_POS_MSEC, target_msec)
            ok, frame = cap.read()
            current_frame = int(cap.get(cv2.CAP_PROP_POS_FRAMES))
            if not ok or frame is None:
                # 时间戳跳转失败时, 从当前位置顺序抓到目标帧
                cap.set(cv2.CAP_PROP_POS_FRAMES, target_frame)
                ok, frame = cap.read()
                current_frame = target_frame
            if ok and frame is not None:
                frames.append((current_frame if current_frame >= 0 else target_frame, frame))
    finally:
        cap.release()
    return frames
