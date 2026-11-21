"""AIComicBuilder 兼容层: task_type 路由、参考图落盘、同步排队出图。

框架阶段只打通协议链路: task_type -> workflow_id 的映射维护在
workflows/task_routing.json, 留空的任务类型返回 501; 工作流模板后续
按 task_type 逐个在 ComfyUI 中搭建并补 definitions 后, 只需填写路由表。
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
import logging
import math
import uuid
from pathlib import Path
from typing import Any

import httpx

from app.core.config import get_settings
from app.schemas.compat import GenRequest, RefImage
from app.services.workflow_service import (
    WorkflowInvokeError,
    get_workflow_service,
)

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[2]

TASK_TYPES: tuple[str, ...] = (
    "character_turnaround",
    "first_frame",
    "last_frame",
    "scene_frame",
    "reference",
    "generic",
)

DEFAULT_SIZES: dict[str, tuple[int, int]] = {
    "16:9": (2560, 1440),
    "9:16": (1440, 2560),
    "1:1": (2048, 2048),
}

# 像素宽高比 -> 工作流 ResolutionSelector 枚举文案(千问 turbo 工作流节点 38)
ASPECT_RATIO_LABELS: dict[tuple[int, int], str] = {
    (16, 9): "16:9 (Widescreen)",
    (9, 16): "9:16 (Portrait Widescreen)",
    (1, 1): "1:1 (Square)",
}

# 16G 显存: 同一时刻只允许一个出图任务, 并发请求在信号量上排队等待
gpu_semaphore = asyncio.Semaphore(1)
POLL_INTERVAL_SECONDS = 1.0


class CompatError(Exception):
    """业务异常, 由路由层转换为协议约定的 {error: {type, message}} 包络。"""

    def __init__(self, status_code: int, error_type: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.error_type = error_type
        self.message = message


class CompatService:
    def __init__(self) -> None:
        self._settings = get_settings()
        self._workflow_service = get_workflow_service()

    # ------------------------------------------------------------------
    # 路由表与尺寸
    # ------------------------------------------------------------------
    def _routing_file(self) -> Path:
        configured = Path(self._settings.task_routing_file)
        return configured if configured.is_absolute() else PROJECT_ROOT / configured

    def load_routing(self) -> dict[str, dict[str, Any]]:
        """每次请求读取, 编辑路由表后无需重启服务; 文件缺失时全部留空。

        路由项支持两种写法:
        - ``"task_type": "workflow_id"``
        - ``"task_type": {"workflow_id": "...", "param_overrides": {...}}``
        - 条件路由（按是否携带参考图分流）::

              "task_type": {
                  "without_images": {"workflow_id": "...", "param_overrides": {}},
                  "with_images": {"workflow_id": "...", "param_overrides": {}}
              }
        """
        routing = {
            task_type: {"workflow_id": "", "param_overrides": {}}
            for task_type in TASK_TYPES
        }
        routing_file = self._routing_file()
        if not routing_file.is_file():
            return routing
        try:
            raw = json.loads(routing_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise CompatError(
                500, "routing_config_error", f"路由表解析失败: {exc}"
            ) from exc
        for task_type in TASK_TYPES:
            entry = raw.get(task_type)
            if isinstance(entry, str):
                if entry.strip():
                    routing[task_type] = {
                        "workflow_id": entry.strip(),
                        "param_overrides": {},
                    }
            elif isinstance(entry, dict):
                if "without_images" in entry or "with_images" in entry:
                    routing[task_type] = {
                        "workflow_id": "",
                        "param_overrides": {},
                        "conditional": {
                            False: self._parse_route_branch(
                                entry.get("without_images"), task_type, "without_images"
                            ),
                            True: self._parse_route_branch(
                                entry.get("with_images"), task_type, "with_images"
                            ),
                        },
                    }
                    continue
                workflow_id = entry.get("workflow_id")
                overrides = entry.get("param_overrides", {})
                if isinstance(workflow_id, str) and workflow_id.strip():
                    if not isinstance(overrides, dict):
                        raise CompatError(
                            500,
                            "routing_config_error",
                            f"路由项 {task_type} 的 param_overrides 必须是对象",
                        )
                    routing[task_type] = {
                        "workflow_id": workflow_id.strip(),
                        "param_overrides": overrides,
                    }
        return routing

    @staticmethod
    def _parse_route_branch(
        branch: Any, task_type: str, branch_name: str
    ) -> dict[str, Any]:
        """解析条件路由的单个分支, 缺省/空值表示该条件暂未对接。"""
        if branch is None:
            return {"workflow_id": "", "param_overrides": {}}
        if not isinstance(branch, dict):
            raise CompatError(
                500,
                "routing_config_error",
                f"路由项 {task_type} 的 {branch_name} 分支必须是对象",
            )
        workflow_id = branch.get("workflow_id")
        overrides = branch.get("param_overrides", {})
        if not isinstance(overrides, dict):
            raise CompatError(
                500,
                "routing_config_error",
                f"路由项 {task_type} 的 {branch_name} 分支 param_overrides 必须是对象",
            )
        return {
            "workflow_id": workflow_id.strip()
            if isinstance(workflow_id, str) else "",
            "param_overrides": overrides,
        }

    @staticmethod
    def _select_route(entry: dict[str, Any], has_images: bool) -> dict[str, Any]:
        """条件路由按参考图有无选分支, 普通路由直接返回自身。"""
        conditional = entry.get("conditional")
        return conditional[has_images] if conditional else entry

    @staticmethod
    def resolve_size(body: GenRequest) -> tuple[int, int]:
        """size 优先, 其次 aspect_ratio, 再缺省按 16:9 兜底。"""
        if body.size and "x" in body.size.lower():
            width_text, height_text = body.size.lower().split("x", 1)
            if width_text.isdigit() and height_text.isdigit():
                return int(width_text), int(height_text)
        return DEFAULT_SIZES.get(
            body.aspect_ratio or "16:9", DEFAULT_SIZES["16:9"]
        )

    @staticmethod
    def aspect_ratio_label(width: int, height: int) -> str | None:
        """把像素尺寸换算为工作流宽高比枚举文案, 无法匹配时返回 None。"""
        factor = math.gcd(width, height)
        return ASPECT_RATIO_LABELS.get((width // factor, height // factor))

    # ------------------------------------------------------------------
    # 参考图
    # ------------------------------------------------------------------
    def _input_dir(self) -> Path:
        configured = self._settings.comfyui_input_dir
        if not configured:
            raise CompatError(
                501,
                "input_dir_not_configured",
                "该任务携带参考图, 但未配置 ComfyUI input 目录, "
                "请在 .env 中设置 COMFYUI_INPUT_DIR",
            )
        input_dir = Path(configured)
        if not input_dir.is_dir():
            raise CompatError(
                501,
                "input_dir_not_found",
                f"配置的 ComfyUI input 目录不存在: {input_dir}",
            )
        return input_dir

    def _save_reference_images(self, images: list[RefImage]) -> list[str]:
        """base64 解码后写入 ComfyUI input 目录, 返回 LoadImage 可用的文件名。"""
        if not images:
            return []
        input_dir = self._input_dir()
        filenames: list[str] = []
        for image in images:
            try:
                raw = base64.b64decode(image.data, validate=True)
            except (binascii.Error, ValueError) as exc:
                self._cleanup(filenames, input_dir)
                raise CompatError(
                    400, "invalid_reference_image", f"参考图 base64 解码失败: {exc}"
                ) from exc
            suffix = ".jpg" if image.mime_type == "image/jpeg" else ".png"
            filename = f"aicompat-{uuid.uuid4().hex}{suffix}"
            try:
                (input_dir / filename).write_bytes(raw)
            except OSError as exc:
                self._cleanup(filenames, input_dir)
                raise CompatError(
                    500, "reference_write_failed", f"参考图落盘失败: {exc}"
                ) from exc
            filenames.append(filename)
        return filenames

    @staticmethod
    def _cleanup(filenames: list[str], input_dir: Path) -> None:
        for filename in filenames:
            try:
                (input_dir / filename).unlink(missing_ok=True)
            except OSError:
                logger.warning("临时参考图删除失败: %s", filename)

    # ------------------------------------------------------------------
    # 模型列表与同步生图
    # ------------------------------------------------------------------
    def list_models(self) -> list[str]:
        return [item.workflow_id for item in self._workflow_service.list_workflows()]

    async def list_loras(self) -> list[str]:
        try:
            return await self._workflow_service.list_loras()
        except httpx.HTTPError as exc:
            raise CompatError(
                503, "comfyui_unreachable", f"ComfyUI 不可达: {exc}"
            ) from exc

    async def generate(self, body: GenRequest) -> str:
        if body.task_type not in TASK_TYPES:
            raise CompatError(
                400,
                "unknown_task_type",
                f"不支持的 task_type: {body.task_type}, 合法值: {', '.join(TASK_TYPES)}",
            )

        routing = self.load_routing()
        width, height = self.resolve_size(body)
        input_dir = Path(self._settings.comfyui_input_dir) if (
            self._settings.comfyui_input_dir
        ) else None
        ref_filenames = self._save_reference_images(body.reference_images)
        # 条件路由: 按本次请求是否实际携带参考图选择工作流分支
        has_images = bool(ref_filenames)
        route = self._select_route(routing[body.task_type], has_images)
        workflow_id = route["workflow_id"]
        if not workflow_id:
            condition = "带参考图（with_images）" if has_images else "无参考图（without_images）"
            raise CompatError(
                501,
                "workflow_not_mapped",
                f"task_type '{body.task_type}' 在{condition}条件下尚未配置工作流, "
                f"请在 {self._routing_file()} 中填写对应分支的 workflow_id",
            )
        try:
            self._workflow_service.get_workflow(workflow_id)
        except KeyError as exc:
            raise CompatError(
                501,
                "workflow_not_registered",
                f"路由表指向的工作流 '{workflow_id}' 未在 definitions 中注册",
            ) from exc

        # 约定参数键: 后续工作流 definition 声明同名参数即可自动注入,
        # 未声明的键会被 WorkflowService 忽略, 不影响当前框架链路。
        params = {
            "prompt": body.prompt,
            "width": width,
            "height": height,
            "task_type": body.task_type,
            "ref_image": ref_filenames[0] if ref_filenames else "",
            "ref_images": ref_filenames,
            "ref_labels": [image.label or "" for image in body.reference_images],
        }
        ratio_label = self.aspect_ratio_label(width, height)
        if ratio_label:
            params["aspect_ratio"] = ratio_label
        # 路由表 param_overrides 先合并, 请求级 LoRA 选择再覆盖, 显式传参优先
        params.update(route["param_overrides"])
        if body.lora and body.lora.strip():
            params["lora_enabled"] = True
            params["lora_name"] = body.lora.strip()
            params["lora_strength"] = (
                body.strength if body.strength is not None else 1.0
            )
        else:
            params["lora_enabled"] = False

        try:
            async with gpu_semaphore:
                job = await self._invoke(workflow_id, params)
                job = await self._wait_until_finished(job.job_id)
            image_path = self._workflow_service.get_job_image_path(job.job_id)
            return base64.b64encode(image_path.read_bytes()).decode("ascii")
        finally:
            if input_dir is not None:
                self._cleanup(ref_filenames, input_dir)

    async def _invoke(self, workflow_id: str, params: dict):
        try:
            return await self._workflow_service.invoke(workflow_id, params)
        except WorkflowInvokeError as exc:
            raise CompatError(
                502, "comfyui_rejected", f"ComfyUI 拒绝了工作流: {exc.payload}"
            ) from exc
        except ValueError as exc:
            raise CompatError(400, "invalid_workflow_param", str(exc)) from exc
        except httpx.HTTPError as exc:
            raise CompatError(503, "comfyui_unreachable", f"ComfyUI 不可达: {exc}") from exc

    async def _wait_until_finished(self, job_id: str):
        deadline = asyncio.get_running_loop().time() + self._settings.compat_job_timeout
        while True:
            try:
                job = self._workflow_service.get_job(job_id)
            except KeyError as exc:
                raise CompatError(500, "job_missing", "任务提交后丢失") from exc
            if job.status == "success":
                return job
            if job.status == "error":
                raise CompatError(
                    502,
                    "generation_failed",
                    job.error or "ComfyUI 执行失败",
                )
            if asyncio.get_running_loop().time() >= deadline:
                raise CompatError(
                    504,
                    "generation_timeout",
                    f"任务在 {self._settings.compat_job_timeout} 秒内未完成",
                )
            await asyncio.sleep(POLL_INTERVAL_SECONDS)


compat_service = CompatService()
