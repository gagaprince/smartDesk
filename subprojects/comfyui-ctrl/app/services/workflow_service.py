"""Workflow template registry, parameter injection and async generation jobs.

Design reference: doc/工作流调用方案设计.md (section 4 and the validated
section 7). Templates are pre-flattened ComfyUI API graphs stored under
workflows/templates; parameter mapping lives in workflows/definitions.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import copy
import json
import logging
import re
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx

from app.core.config import Settings, get_settings
from app.schemas.workflow import JobInfo, ParamDef, WorkflowDef

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFINITIONS_DIR = PROJECT_ROOT / "workflows" / "definitions"
TEMPLATES_DIR = PROJECT_ROOT / "workflows" / "templates"
OUTPUTS_DIR = PROJECT_ROOT / "workflows" / "outputs"

MAX_JOBS = 50
JOB_POLL_SECONDS = 2.0
JOB_TIMEOUT_SECONDS = 600.0
LORA_CACHE_SECONDS = 300.0
# 调用方上传的图片统一放到 ComfyUI input 下的该子目录, 便于与手工素材区分
UPLOAD_IMAGE_SUBFOLDER = "smartdesk"
DATA_URL_PATTERN = re.compile(
    r"^data:(?P<mime>[\w.+-]+/[\w.+-]+);base64,(?P<data>.+)$", re.DOTALL
)
BASE64_PATTERN = re.compile(r"^[A-Za-z0-9+/]+={0,2}$")
IMAGE_SIGNATURES = (b"\x89PNG", b"\xff\xd8\xff", b"GIF8", b"BM", b"RIFF")
# 短于该长度的纯字母字符串按文件名处理, 避免与无扩展名文件名冲突
MIN_BASE64_IMAGE_LENGTH = 64
MIME_SUFFIXES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/bmp": ".bmp",
}
# 多图参数允许承载的图片加载节点类型
IMAGE_LOADER_CLASSES = {"LoadImage", "LoadImageMask"}


class WorkflowInvokeError(Exception):
    """ComfyUI rejected the prompt (validation/node errors)."""

    def __init__(self, payload: dict[str, Any]) -> None:
        super().__init__("ComfyUI rejected the prompt")
        self.payload = payload


class WorkflowService:
    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
        self._workflows: dict[str, WorkflowDef] = {}
        self._template_graphs: dict[str, dict[str, Any]] = {}
        self._jobs: dict[str, dict[str, Any]] = {}
        self._lora_cache: tuple[float, list[str]] | None = None
        self._load_errors: dict[str, str] = {}
        self._template_mtimes: dict[str, datetime] = {}
        self._load_registry()

    # ------------------------------------------------------------------
    # Registry
    # ------------------------------------------------------------------
    def _load_registry(self) -> None:
        self._workflows.clear()
        self._template_graphs.clear()
        self._load_errors.clear()
        self._template_mtimes.clear()
        if not DEFINITIONS_DIR.exists():
            logger.warning("workflow definitions dir missing: %s", DEFINITIONS_DIR)
            return
        for definition_path in sorted(DEFINITIONS_DIR.glob("*.json")):
            try:
                definition = WorkflowDef.model_validate(
                    json.loads(definition_path.read_text(encoding="utf-8"))
                )
                template_path = TEMPLATES_DIR / definition.template
                if not template_path.is_file():
                    raise RuntimeError(f"模板文件不存在: {template_path.name}")
                graph = json.loads(template_path.read_text(encoding="utf-8"))
                self.self_check(definition, graph)
            except Exception as exc:
                logger.exception(
                    "failed to load workflow definition: %s", definition_path.name
                )
                self._load_errors[definition_path.stem] = str(exc)
                continue
            self._workflows[definition.workflow_id] = definition
            self._template_graphs[definition.workflow_id] = graph
            self._template_mtimes[definition.workflow_id] = datetime.fromtimestamp(
                template_path.stat().st_mtime
            )
            logger.info(
                "registered workflow %s (%d nodes, %d params)",
                definition.workflow_id,
                len(graph),
                len(definition.params),
            )

    @staticmethod
    def self_check(definition: WorkflowDef, graph: dict[str, Any]) -> None:
        """Fail fast on node/input drift between definition and template."""
        for param in definition.params:
            if param.type == "image_list":
                WorkflowService._check_image_list(definition, param, graph)
                continue
            paths = param.paths or ([param.path] if param.path else [])
            if not paths:
                raise RuntimeError(
                    f"工作流 {definition.workflow_id} 参数 {param.key} 未配置注入路径"
                )
            for path in paths:
                node_id = str(path[0])
                node = graph.get(node_id)
                if node is None:
                    raise RuntimeError(
                        f"工作流 {definition.workflow_id} 参数 {param.key} "
                        f"引用了不存在的节点 {node_id}"
                    )
                cursor: Any = node
                for part in path[1:]:
                    key = str(part)
                    if not isinstance(cursor, dict) or key not in cursor:
                        raise RuntimeError(
                            f"工作流 {definition.workflow_id} 参数 {param.key} "
                            f"的注入路径 {path} 在模板中不存在"
                        )
                    cursor = cursor[key]

    @staticmethod
    def _check_image_list(
        definition: WorkflowDef, param: ParamDef, graph: dict[str, Any]
    ) -> None:
        """image_list 参数不使用注入路径, 改为校验有序图片加载节点列表。"""
        node_ids = param.image_nodes or []
        if not node_ids:
            raise RuntimeError(
                f"工作流 {definition.workflow_id} 参数 {param.key} 未配置 image_nodes"
            )
        seen: set[str] = set()
        for raw_node_id in node_ids:
            node_id = str(raw_node_id)
            if node_id in seen:
                raise RuntimeError(
                    f"工作流 {definition.workflow_id} 参数 {param.key} "
                    f"的 image_nodes 存在重复节点 {node_id}"
                )
            seen.add(node_id)
            node = graph.get(node_id)
            if node is None:
                raise RuntimeError(
                    f"工作流 {definition.workflow_id} 参数 {param.key} "
                    f"引用了不存在的节点 {node_id}"
                )
            if node.get("class_type") not in IMAGE_LOADER_CLASSES:
                raise RuntimeError(
                    f"工作流 {definition.workflow_id} 参数 {param.key} "
                    f"的节点 {node_id} 不是图片加载节点（LoadImage/LoadImageMask）"
                )
            if not isinstance(node.get("inputs"), dict) or "image" not in node["inputs"]:
                raise RuntimeError(
                    f"工作流 {definition.workflow_id} 参数 {param.key} "
                    f"的节点 {node_id} 缺少 image 文件名控件"
                )

    def reload(self) -> dict[str, Any]:
        """Re-scan definitions/templates without restarting the service."""
        self._load_registry()
        return {
            "loaded": [wf.workflow_id for wf in self.list_workflows()],
            "failed": dict(self._load_errors),
        }

    def registry_status(self) -> list[dict[str, Any]]:
        """Per-workflow health for the admin console, including broken entries."""
        entries: list[dict[str, Any]] = []
        for definition in self._workflows.values():
            entries.append(
                {
                    "workflow_id": definition.workflow_id,
                    "name": definition.name,
                    "description": definition.description,
                    "template": definition.template,
                    "output_node": definition.output_node,
                    "ok": True,
                    "error": None,
                    "param_count": len(definition.params),
                    "node_count": len(self._template_graphs[definition.workflow_id]),
                    "updated_at": self._template_mtimes.get(definition.workflow_id),
                }
            )
        for broken_id, error in self._load_errors.items():
            entries.append(
                {
                    "workflow_id": broken_id,
                    "name": broken_id,
                    "description": "",
                    "template": "",
                    "output_node": "",
                    "ok": False,
                    "error": error,
                    "param_count": 0,
                    "node_count": 0,
                    "updated_at": None,
                }
            )
        return sorted(entries, key=lambda item: (not item["ok"], item["workflow_id"]))

    def get_workflow_detail(self, workflow_id: str) -> dict[str, Any]:
        definition = self._require_workflow(workflow_id)
        return {
            "definition": definition,
            "template": self._template_graphs[workflow_id],
        }

    def list_workflows(self) -> list[WorkflowDef]:
        return list(self._workflows.values())

    def get_workflow(self, workflow_id: str) -> WorkflowDef:
        return self._require_workflow(workflow_id)

    def _require_workflow(self, workflow_id: str) -> WorkflowDef:
        definition = self._workflows.get(workflow_id)
        if definition is None:
            raise KeyError(workflow_id)
        return definition

    async def list_loras(self, force_refresh: bool = False) -> list[str]:
        now = time.time()
        if (
            not force_refresh
            and self._lora_cache
            and now - self._lora_cache[0] < LORA_CACHE_SECONDS
        ):
            return self._lora_cache[1]
        async with self._client() as client:
            resp = await client.get("/object_info/LoraLoader")
            resp.raise_for_status()
            loras = resp.json()["LoraLoader"]["input"]["required"]["lora_name"][0]
        self._lora_cache = (now, loras)
        return loras

    # ------------------------------------------------------------------
    # Invocation
    # ------------------------------------------------------------------
    async def invoke(
        self, workflow_id: str, raw_params: dict[str, Any]
    ) -> JobInfo:
        definition = self._require_workflow(workflow_id)
        graph = copy.deepcopy(self._template_graphs[workflow_id])
        return await self._submit(definition, graph, raw_params)

    async def invoke_graph(
        self,
        definition: WorkflowDef,
        template_graph: dict[str, Any],
        raw_params: dict[str, Any],
    ) -> JobInfo:
        """Submit an ad-hoc graph (admin trial run); nothing is persisted."""
        return await self._submit(definition, copy.deepcopy(template_graph), raw_params)

    async def _submit(
        self,
        definition: WorkflowDef,
        graph: dict[str, Any],
        raw_params: dict[str, Any],
    ) -> JobInfo:
        submitted: dict[str, Any] = {}
        available_loras: list[str] | None = None
        client_id = str(uuid.uuid4())
        uploaded_refs: list[dict[str, str]] = []
        async with self._client() as client:
            for param in definition.params:
                if param.key in raw_params:
                    raw_value = raw_params[param.key]
                elif param.default is not None:
                    raw_value = param.default
                elif param.required:
                    raise ValueError(f"缺少必填参数：{param.label}")
                else:
                    continue

                if param.type == "image_list":
                    await self._apply_image_list(
                        graph, client, param, raw_value, uploaded_refs, submitted
                    )
                    continue
                if param.type == "image":
                    value = await self._materialize_image(
                        client, raw_value, param.label, uploaded_refs
                    )
                else:
                    value = self._coerce(param, raw_value)
                    if param.type == "enum":
                        choices = param.choices
                        if param.enum_source == "comfyui_loras":
                            if available_loras is None:
                                available_loras = await self.list_loras()
                            choices = available_loras
                        if choices is not None and value not in choices:
                            raise ValueError(f"参数 {param.label} 的取值不合法：{value}")

                submitted[param.key] = value
                paths = param.paths or ([param.path] if param.path else [])
                for path in paths:
                    self._inject(graph, path, value)

            resp = await client.post(
                "/prompt", json={"prompt": graph, "client_id": client_id}
            )
            if resp.status_code != 200:
                self._cleanup_refs(uploaded_refs)
                raise WorkflowInvokeError(resp.json())
            submit_payload = resp.json()
            prompt_id = submit_payload["prompt_id"]
            submit_node_errors = submit_payload.get("node_errors") or None

        job = {
            "job_id": prompt_id,
            "workflow_id": definition.workflow_id,
            "workflow_name": definition.name,
            "status": "queued",
            "submitted_params": submitted,
            "image_url": f"/api/v1/jobs/{prompt_id}/image",
            "image_path": None,
            "error": None,
            "node_errors": submit_node_errors,
            "created_at": datetime.now(),
            "finished_at": None,
            "uploaded_images": uploaded_refs,
        }
        self._jobs[prompt_id] = job
        self._prune_jobs()
        asyncio.create_task(self._watch_job(definition, prompt_id))
        return self._to_info(job)

    @staticmethod
    def _coerce(param: ParamDef, raw: Any) -> Any:
        if param.type == "string":
            value: Any = str(raw)
        elif param.type == "int":
            try:
                value = int(raw)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"参数 {param.label} 需要整数") from exc
        elif param.type == "float":
            try:
                value = float(raw)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"参数 {param.label} 需要数字") from exc
        elif param.type == "bool":
            if isinstance(raw, bool):
                value = raw
            else:
                value = str(raw).lower() in ("true", "1", "on", "yes")
        else:  # enum
            value = str(raw)

        if param.type in ("int", "float"):
            if param.min is not None and value < param.min:
                raise ValueError(f"参数 {param.label} 不能小于 {param.min}")
            if param.max is not None and value > param.max:
                raise ValueError(f"参数 {param.label} 不能大于 {param.max}")
        return value

    @staticmethod
    def _inject(graph: dict[str, Any], path: list[str | int], value: Any) -> None:
        cursor: Any = graph[str(path[0])]
        for part in path[1:-1]:
            cursor = cursor[str(part)]
        cursor[str(path[-1])] = value

    # ------------------------------------------------------------------
    # image_list params: ordered multi-image injection with runtime pruning
    # ------------------------------------------------------------------
    async def _apply_image_list(
        self,
        graph: dict[str, Any],
        client: httpx.AsyncClient,
        param: ParamDef,
        raw_value: Any,
        uploaded_refs: list[dict[str, str]],
        submitted: dict[str, Any],
    ) -> None:
        """注入有序参考图数组, 并剪除未使用的图片加载节点。

        第 N 张图填入 image_nodes 的第 N 个 LoadImage, 其余节点连同指向
        它们的连线一起从图中删除, 效果等同于界面上的 Fast Bypasser 开关。
        """
        if not isinstance(raw_value, list):
            raise ValueError(f"参数 {param.label} 需要图片数组")
        images = [
            item for item in raw_value
            if item is not None and str(item).strip()
        ]
        if not images:
            raise ValueError(f"参数 {param.label} 至少需要一张图片")
        max_images = len(param.image_nodes or [])
        if len(images) > max_images:
            raise ValueError(
                f"参数 {param.label} 最多支持 {max_images} 张图片，"
                f"实际传入 {len(images)} 张"
            )
        filenames = [
            await self._materialize_image(
                client, item, param.label, uploaded_refs
            )
            for item in images
        ]
        for node_id, filename in zip(param.image_nodes, filenames):
            graph[str(node_id)]["inputs"]["image"] = filename
        unused_node_ids = [
            str(node_id) for node_id in param.image_nodes[len(filenames):]
        ]
        self._prune_image_nodes(graph, unused_node_ids)
        submitted[param.key] = filenames

    @staticmethod
    def _prune_image_nodes(
        graph: dict[str, Any], node_ids: list[str]
    ) -> None:
        """删除节点本身, 并清理全图中指向它们的连线（[源节点 id, 槽位]）。"""
        removed = set(node_ids)
        if not removed:
            return
        for node_id in removed:
            graph.pop(node_id, None)
        for node in graph.values():
            inputs = node.get("inputs")
            if not isinstance(inputs, dict):
                continue
            for input_name in list(inputs):
                value = inputs[input_name]
                if (
                    isinstance(value, list)
                    and len(value) == 2
                    and isinstance(value[0], str)
                    and isinstance(value[1], int)
                    and value[0] in removed
                ):
                    del inputs[input_name]

    # ------------------------------------------------------------------
    # Image params: data URL / base64 -> ComfyUI upload -> widget filename
    # ------------------------------------------------------------------
    async def _materialize_image(
        self,
        client: httpx.AsyncClient,
        raw: Any,
        label: str,
        uploaded_refs: list[dict[str, str]],
    ) -> str:
        """Turn an image param value into a LoadImage-ready filename.

        Data URLs and raw base64 are uploaded to ComfyUI first; plain
        filenames pass through unchanged for backward compatibility.
        """
        if not isinstance(raw, str) or not raw.strip():
            raise ValueError(f"参数 {label} 需要图片值（data URL、base64 或文件名）")
        value = raw.strip()
        decoded, mime = self._decode_image_value(value, label)
        if decoded is None:
            return value
        ref = await self._upload_image(client, decoded, mime)
        uploaded_refs.append(ref)
        return f"{ref['subfolder']}/{ref['name']}" if ref.get("subfolder") else ref["name"]

    @staticmethod
    def _decode_image_value(value: str, label: str) -> tuple[bytes | None, str]:
        if value.startswith("data:"):
            match = DATA_URL_PATTERN.match(value)
            if not match:
                raise ValueError(
                    f"参数 {label} 的 Data URL 格式不正确，应为 data:image/png;base64,..."
                )
            try:
                raw = base64.b64decode(match.group("data"), validate=True)
            except (binascii.Error, ValueError) as exc:
                raise ValueError(f"参数 {label} 的图片 base64 解码失败") from exc
            return raw, match.group("mime")
        compact = "".join(value.split())
        # 文件名一般含扩展名、路径分隔符等 base64 字母表之外的字符;
        # 注意 base64 自身也可能含 "/", 不能用路径符判断
        is_base64_like = (
            len(compact) >= MIN_BASE64_IMAGE_LENGTH
            and not compact.endswith(("[input]", "[output]", "[temp]"))
            and BASE64_PATTERN.fullmatch(compact) is not None
        )
        if not is_base64_like:
            return None, ""
        try:
            raw = base64.b64decode(compact, validate=True)
        except (binascii.Error, ValueError):
            return None, ""
        if not raw.startswith(IMAGE_SIGNATURES):
            raise ValueError(
                f"参数 {label} 既不是合法图片 base64，也不是已存在的文件名；"
                "推荐使用 data:image/png;base64,... 形式传参"
            )
        return raw, "image/png"

    async def _upload_image(
        self, client: httpx.AsyncClient, raw: bytes, mime: str
    ) -> dict[str, str]:
        suffix = MIME_SUFFIXES.get(mime, ".png")
        filename = f"{uuid.uuid4().hex}{suffix}"
        files = {"image": (filename, raw, mime or "application/octet-stream")}
        data = {
            "subfolder": UPLOAD_IMAGE_SUBFOLDER,
            "type": "input",
            "overwrite": "false",
        }
        try:
            resp = await client.post("/upload/image", data=data, files=files)
            resp.raise_for_status()
            payload = resp.json()
        except httpx.HTTPError as exc:
            raise ValueError(f"图片上传到 ComfyUI 失败：{exc}") from exc
        return {
            "name": str(payload["name"]),
            "subfolder": str(payload.get("subfolder") or ""),
            "type": str(payload.get("type") or "input"),
        }

    def _cleanup_uploaded(self, job_id: str) -> None:
        """Best-effort removal of caller uploads once the job reached a terminal state."""
        job = self._jobs.get(job_id)
        refs = job.get("uploaded_images") if job else None
        if refs:
            self._cleanup_refs(refs)

    def _cleanup_refs(self, refs: list[dict[str, str]]) -> None:
        """Delete uploaded files from the configured input dir (no-op when unconfigured)."""
        if not refs or not self._settings.comfyui_input_dir:
            return
        input_dir = Path(self._settings.comfyui_input_dir)
        if not input_dir.is_dir():
            return
        input_root = input_dir.resolve()
        for ref in refs:
            target = (input_dir / ref.get("subfolder", "") / ref["name"]).resolve()
            if input_root not in target.parents or not target.is_file():
                continue
            try:
                target.unlink()
            except OSError:
                logger.warning("上传图片清理失败: %s", target)

    # ------------------------------------------------------------------
    # Job tracking
    # ------------------------------------------------------------------
    async def _watch_job(self, definition: WorkflowDef, job_id: str) -> None:
        try:
            await self._watch_job_until_done(definition, job_id)
        finally:
            self._cleanup_uploaded(job_id)

    async def _watch_job_until_done(
        self, definition: WorkflowDef, job_id: str
    ) -> None:
        deadline = time.time() + JOB_TIMEOUT_SECONDS
        async with self._client() as client:
            while time.time() < deadline:
                history = (await client.get(f"/history/{job_id}")).json()
                entry = history.get(job_id)
                if entry is not None:
                    status = entry.get("status", {})
                    if status.get("status_str") == "error":
                        self._mark_error(job_id, "ComfyUI 执行失败", status)
                        return
                    images = self._collect_images(entry, definition.output_node)
                    if images:
                        await self._download_image(client, job_id, images[0])
                        return
                    if status.get("completed") or status.get("status_str") == "success":
                        self._mark_error(
                            job_id,
                            (
                                f"ComfyUI 执行已完成，但输出节点 {definition.output_node} "
                                "未产生图片，通常是节点参数校验失败导致该输出被忽略，"
                                "请查看 ComfyUI 日志确认具体节点"
                            ),
                            status,
                        )
                        return
                else:
                    queue = (await client.get("/queue")).json()
                    target = "running" if queue.get("queue_running") else "queued"
                    if self._jobs[job_id]["status"] != target:
                        self._jobs[job_id]["status"] = target
                await asyncio.sleep(JOB_POLL_SECONDS)
        self._mark_error(job_id, "任务超时，未在限定时间内完成", None)

    @staticmethod
    def _collect_images(entry: dict[str, Any], output_node: str) -> list[dict[str, Any]]:
        outputs = entry.get("outputs", {})
        if output_node in outputs and outputs[output_node].get("images"):
            return outputs[output_node]["images"]
        for node_output in outputs.values():
            if node_output.get("images"):
                return node_output["images"]
        return []

    async def _download_image(
        self, client: httpx.AsyncClient, job_id: str, image: dict[str, Any]
    ) -> None:
        params = {"filename": image["filename"], "type": image.get("type", "output")}
        if image.get("subfolder"):
            params["subfolder"] = image["subfolder"]
        resp = await client.get("/view", params=params)
        resp.raise_for_status()
        suffix = Path(image["filename"]).suffix or ".png"
        image_path = OUTPUTS_DIR / f"{job_id}{suffix}"
        image_path.write_bytes(resp.content)
        job = self._jobs[job_id]
        job["image_path"] = str(image_path)
        job["status"] = "success"
        job["finished_at"] = datetime.now()
        logger.info("job %s succeeded, image saved to %s", job_id, image_path)

    def _mark_error(
        self, job_id: str, message: str, node_errors: dict[str, Any] | None
    ) -> None:
        job = self._jobs[job_id]
        job["status"] = "error"
        job["error"] = message
        job["node_errors"] = node_errors
        job["finished_at"] = datetime.now()
        logger.warning("job %s failed: %s", job_id, message)

    def list_jobs(self) -> list[JobInfo]:
        jobs = sorted(
            self._jobs.values(), key=lambda item: item["created_at"], reverse=True
        )
        return [self._to_info(job) for job in jobs]

    def get_job(self, job_id: str) -> JobInfo:
        job = self._jobs.get(job_id)
        if job is None:
            raise KeyError(job_id)
        return self._to_info(job)

    def get_job_image_path(self, job_id: str) -> Path:
        job = self._jobs.get(job_id)
        if job is None or not job.get("image_path"):
            raise KeyError(job_id)
        return Path(job["image_path"])

    def _prune_jobs(self) -> None:
        while len(self._jobs) > MAX_JOBS:
            oldest_id = min(
                self._jobs, key=lambda item: self._jobs[item]["created_at"]
            )
            self._jobs.pop(oldest_id)

    @staticmethod
    def _to_info(job: dict[str, Any]) -> JobInfo:
        return JobInfo(
            job_id=job["job_id"],
            workflow_id=job["workflow_id"],
            workflow_name=job["workflow_name"],
            status=job["status"],
            submitted_params=job["submitted_params"],
            image_url=job["image_url"],
            error=job["error"],
            node_errors=job["node_errors"],
            created_at=job["created_at"],
            finished_at=job["finished_at"],
        )

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=self._settings.comfyui_base_url,
            timeout=30.0,
            trust_env=False,
        )


workflow_service = WorkflowService()


def get_workflow_service() -> WorkflowService:
    return workflow_service
