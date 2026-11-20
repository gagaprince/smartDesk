"""Visual configuration platform: graph parsing, persistence and doc generation.

Design reference: doc/工作流调用方案设计.md chapter 8. Only ComfyUI API-format
graphs are accepted (node-id -> {class_type, inputs} dictionaries); UI-format
graphs are rejected with export guidance.
"""

from __future__ import annotations

import json
import logging
import re
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx

from app.core.config import Settings, get_settings
from app.schemas.admin import (
    EnumOptions,
    ParsedInput,
    ParsedNode,
    ParseResult,
    RegistryEntry,
    SaveResult,
    WorkflowSaveRequest,
)
from app.schemas.workflow import WorkflowDef
from app.services.workflow_service import (
    DEFINITIONS_DIR,
    PROJECT_ROOT,
    TEMPLATES_DIR,
    WorkflowService,
)

logger = logging.getLogger(__name__)

BACKUPS_DIR = PROJECT_ROOT / "workflows" / "backups"
DOCS_DIR = PROJECT_ROOT / "doc"
WORKFLOW_DOC_DIR = DOCS_DIR / "workflow_api"
MAIN_API_DOC = DOCS_DIR / "接口文档.md"

OBJECT_INFO_CACHE_SECONDS = 120.0
WORKFLOW_ID_PATTERN = re.compile(r"^[a-z0-9_]+$")

TEXT_NODES = {"CLIPTextEncode", "TextGenerate", "easy positive", "easy negative"}
LORA_LOADER_CLASSES = {"LoraLoader", "LoraLoaderModelOnly"}
SAMPLER_CLASSES = {"KSampler", "KSamplerAdvanced"}
SWITCH_NODE_CLASS = "ComfySwitchNode"
# ComfyUI 图片加载节点: widget 值是 input 目录文件名, 平台改造成 image 类型,
# 调用方上传图片后由服务端换成实际文件名再注入
IMAGE_LOADER_CLASSES = {"LoadImage", "LoadImageMask"}

ENUM_SOURCE_SPECS: dict[str, tuple[str, str]] = {
    "checkpoints": ("CheckpointLoaderSimple", "ckpt_name"),
    "samplers": ("KSampler", "sampler_name"),
    "schedulers": ("KSampler", "scheduler"),
    "vaes": ("VAELoader", "vae_name"),
}


class WorkflowAdminService:
    def __init__(
        self,
        workflow_service: WorkflowService,
        settings: Settings | None = None,
    ) -> None:
        self._workflows = workflow_service
        self._settings = settings or get_settings()
        self._object_info_cache: tuple[float, dict[str, Any]] | None = None

    # ------------------------------------------------------------------
    # ComfyUI metadata
    # ------------------------------------------------------------------
    async def _object_info(self, force_refresh: bool = False) -> dict[str, Any]:
        now = time.time()
        if (
            not force_refresh
            and self._object_info_cache
            and now - self._object_info_cache[0] < OBJECT_INFO_CACHE_SECONDS
        ):
            return self._object_info_cache[1]
        try:
            async with self._client() as client:
                resp = await client.get("/object_info")
                resp.raise_for_status()
                info = resp.json()
        except httpx.HTTPError as exc:
            logger.warning("object_info unavailable, degraded parsing: %s", exc)
            info = {}
        self._object_info_cache = (now, info)
        return info

    async def enum_options(
        self, source: str, force_refresh: bool = False
    ) -> EnumOptions:
        if source == "comfyui_loras":
            return EnumOptions(
                source=source,
                options=await self._workflows.list_loras(force_refresh=force_refresh),
            )
        spec = ENUM_SOURCE_SPECS.get(source)
        if spec is None:
            raise ValueError(f"不支持的枚举来源：{source}")
        info = await self._object_info(force_refresh=force_refresh)
        class_type, input_name = spec
        node_meta = info.get(class_type, {}).get("input", {})
        raw = node_meta.get("required", {}).get(input_name) or node_meta.get("optional", {}).get(input_name)
        options = raw[0] if raw and isinstance(raw[0], list) else []
        return EnumOptions(source=source, options=[str(item) for item in options])

    # ------------------------------------------------------------------
    # Graph parsing
    # ------------------------------------------------------------------
    async def parse_graph(self, graph: dict[str, Any]) -> ParseResult:
        self._ensure_api_format(graph)
        object_info = await self._object_info()
        warnings: list[str] = []
        nodes: list[ParsedNode] = []
        output_candidates: list[str] = []
        used_keys: set[str] = set()

        for node_id in sorted(graph.keys(), key=self._node_sort_key):
            node = graph[node_id]
            if not isinstance(node, dict) or "class_type" not in node:
                warnings.append(f"节点 {node_id} 结构异常，已跳过")
                continue
            class_type = str(node["class_type"])
            title = (node.get("_meta") or {}).get("title")
            if object_info and class_type not in object_info:
                warnings.append(f"节点 {node_id}（{class_type}）未在 /object_info 注册，可能是自定义节点")
            meta_inputs = self._meta_inputs(object_info.get(class_type, {}))
            is_output = class_type.startswith(("Save", "Preview"))
            if is_output:
                output_candidates.append(node_id)

            parsed_inputs: list[ParsedInput] = []
            for input_name, value in (node.get("inputs") or {}).items():
                parsed_inputs.extend(
                    self._parse_input(
                        node_id, title, class_type, input_name, value,
                        meta_inputs.get(input_name), used_keys,
                    )
                )
            nodes.append(
                ParsedNode(
                    node_id=node_id,
                    class_type=class_type,
                    title=title,
                    is_output_candidate=is_output,
                    inputs=parsed_inputs,
                )
            )
        return ParseResult(
            node_count=len(graph),
            output_candidates=self._rank_output_candidates(graph, output_candidates),
            nodes=nodes,
            warnings=warnings,
        )

    @staticmethod
    def _rank_output_candidates(
        graph: dict[str, Any], candidates: list[str]
    ) -> list[str]:
        """Prefer real savers over image previews, with generic PreviewAny last."""

        def rank(node_id: str) -> int:
            class_type = graph[node_id]["class_type"]
            if class_type.startswith("Save"):
                return 0
            if class_type == "PreviewAny":
                return 2
            return 1

        return sorted(candidates, key=lambda node_id: (rank(node_id), node_id))

    @staticmethod
    def _ensure_api_format(graph: dict[str, Any]) -> None:
        if isinstance(graph.get("nodes"), list) and "links" in graph:
            raise ValueError(
                "检测到 UI 图格式（nodes/links 数组），平台仅接受 API 格式。"
                "请在 ComfyUI 设置中打开 Enable Dev mode options，"
                "然后用工作流菜单的 Save (API Format) 导出后重新导入。"
            )
        if not graph or not all(
            isinstance(node, dict) and "class_type" in node
            for node in graph.values()
        ):
            raise ValueError("无法识别的 JSON 结构：API 格式应以节点 ID 为键、每个节点含 class_type")

    @staticmethod
    def _node_sort_key(node_id: str) -> tuple[int, ...]:
        parts = []
        for segment in str(node_id).split(":"):
            try:
                parts.append(int(segment))
            except ValueError:
                parts.append(10**9)
        return tuple(parts)

    @staticmethod
    def _meta_inputs(class_meta: dict[str, Any]) -> dict[str, list[Any]]:
        input_block = class_meta.get("input", {})
        merged: dict[str, list[Any]] = {}
        for group in ("required", "optional"):
            for name, spec in input_block.get(group, {}).items():
                merged[name] = spec
        return merged

    def _parse_input(
        self,
        node_id: str,
        node_title: str | None,
        class_type: str,
        input_name: str,
        value: Any,
        spec: list[Any] | None,
        used_keys: set[str],
    ) -> list[ParsedInput]:
        base_path = [node_id, "inputs"]
        if self._is_link(value):
            return [
                ParsedInput(
                    node_id=node_id, node_title=node_title, class_type=class_type,
                    input_name=input_name, path=base_path + [input_name],
                    current_value=value, kind="link", inferred_type="unknown",
                )
            ]
        if isinstance(value, dict):
            if "__value__" in value or "__type__" in value:
                return [
                    ParsedInput(
                        node_id=node_id, node_title=node_title, class_type=class_type,
                        input_name=input_name, path=base_path + [input_name],
                        current_value=value, kind="wrapper", inferred_type="unknown",
                    )
                ]
            if {"on", "lora", "strength"}.issubset(value.keys()):
                return self._parse_rgthree_slot(
                    node_id, node_title, class_type, input_name, value, used_keys
                )
            return [
                ParsedInput(
                    node_id=node_id, node_title=node_title, class_type=class_type,
                    input_name=input_name, path=base_path + [input_name],
                    current_value=value, kind="wrapper", inferred_type="unknown",
                )
            ]
        if self._is_image_input(class_type, input_name, value, spec):
            inferred = {
                "inferred_type": "image", "choices": None, "enum_source": None,
                "multiline": False, "min": None, "max": None,
            }
        else:
            inferred = self._infer_scalar(value, spec)
        item = ParsedInput(
            node_id=node_id, node_title=node_title, class_type=class_type,
            input_name=input_name, path=base_path + [input_name],
            current_value=value, kind="widget", **inferred,
        )
        self._apply_suggestion(item, used_keys)
        return [item]

    @staticmethod
    def _is_image_input(
        class_type: str, input_name: str, value: Any, spec: list[Any] | None
    ) -> bool:
        """LoadImage 一类节点的文件名控件, object_info 中带 image_upload 标记。"""
        if not isinstance(value, str):
            return False
        if spec and isinstance(spec[0], list):
            opts = spec[1] if len(spec) > 1 and isinstance(spec[1], dict) else {}
            if opts.get("image_upload"):
                return True
        return class_type in IMAGE_LOADER_CLASSES and input_name == "image"

    def _parse_rgthree_slot(
        self,
        node_id: str,
        node_title: str | None,
        class_type: str,
        slot_name: str,
        value: dict[str, Any],
        used_keys: set[str],
    ) -> list[ParsedInput]:
        leaf_types = {
            "on": ("bool", None, None, None),
            "lora": ("enum", "comfyui_loras", None, None),
            "strength": ("float", None, 0.0, 10.0),
            "strengthTwo": ("float", None, 0.0, 10.0),
        }
        items: list[ParsedInput] = []
        for leaf, leaf_value in value.items():
            inferred_type, enum_source, min_value, max_value = leaf_types.get(
                leaf, ("unknown", None, None, None)
            )
            item = ParsedInput(
                node_id=node_id, node_title=node_title, class_type=class_type,
                input_name=f"{slot_name}.{leaf}",
                path=[node_id, "inputs", slot_name, leaf],
                current_value=leaf_value, kind="widget",
                inferred_type=inferred_type, enum_source=enum_source,
                min=min_value, max=max_value,
                suggest_export=leaf in {"on", "lora", "strength"},
            )
            item.suggest_key = self._unique_key(f"{slot_name}_{leaf}", used_keys)
            item.suggest_label = f"{slot_name} {self._leaf_label(leaf)}"
            items.append(item)
        return items

    @staticmethod
    def _leaf_label(leaf: str) -> str:
        return {"on": "开关", "lora": "模型", "strength": "强度", "strengthTwo": "强度二"}.get(leaf, leaf)

    @staticmethod
    def _is_link(value: Any) -> bool:
        return (
            isinstance(value, list)
            and len(value) == 2
            and isinstance(value[0], str)
            and isinstance(value[1], int)
        )

    def _infer_scalar(
        self, value: Any, spec: list[Any] | None
    ) -> dict[str, Any]:
        result: dict[str, Any] = {
            "inferred_type": "unknown", "choices": None, "enum_source": None,
            "multiline": False, "min": None, "max": None,
        }
        if spec:
            head = spec[0]
            opts = spec[1] if len(spec) > 1 and isinstance(spec[1], dict) else {}
            if isinstance(head, list):
                result["inferred_type"] = "enum"
                result["choices"] = [str(item) for item in head]
                return result
            if head == "STRING":
                result["inferred_type"] = "string"
                result["multiline"] = bool(opts.get("multiline"))
                return result
            if head == "BOOLEAN":
                result["inferred_type"] = "bool"
                return result
            if head == "INT":
                result["inferred_type"] = "int"
                result["min"], result["max"] = opts.get("min"), opts.get("max")
                return result
            if head == "FLOAT":
                result["inferred_type"] = "float"
                result["min"], result["max"] = opts.get("min"), opts.get("max")
                return result
        if isinstance(value, bool):
            result["inferred_type"] = "bool"
        elif isinstance(value, int):
            result["inferred_type"] = "int"
        elif isinstance(value, float):
            result["inferred_type"] = "float"
        elif isinstance(value, str):
            result["inferred_type"] = "string"
        return result

    def _apply_suggestion(self, item: ParsedInput, used_keys: set[str]) -> None:
        name = item.input_name.lower()
        if item.class_type == SWITCH_NODE_CLASS and name in {"on_true", "on_false"}:
            if isinstance(item.current_value, str):
                item.suggest_export = True
                item.suggest_key = self._unique_key(f"switch_{name}", used_keys)
                item.suggest_label = f"切换节点输入（{name}）"
                item.inferred_type = "string"
                item.multiline = True
            return
        if item.class_type in TEXT_NODES and name in {"text", "prompt"}:
            item.suggest_export = True
            item.suggest_key = self._unique_key("prompt", used_keys)
            item.suggest_label = "提示词"
            item.multiline = True
        elif name == "seed":
            item.suggest_export = True
            item.suggest_key = self._unique_key("seed", used_keys)
            item.inferred_type = "int"
            if item.class_type in SAMPLER_CLASSES:
                # Standard KSampler rejects seed < 0; only rgthree Seed accepts -1.
                item.suggest_label = "种子"
                if item.min is None:
                    item.min = 0
            else:
                item.suggest_label = "种子（-1 随机）"
        elif item.class_type in LORA_LOADER_CLASSES and name == "lora_name":
            item.suggest_export = True
            item.suggest_key = self._unique_key("lora_name", used_keys)
            item.suggest_label = "LoRA 模型"
            item.inferred_type = "enum"
            item.enum_source = "comfyui_loras"
            item.choices = None
        elif item.class_type in LORA_LOADER_CLASSES and name.startswith("strength"):
            item.suggest_export = False
            item.inferred_type = "float"
        elif item.inferred_type == "image":
            item.suggest_export = True
            item.suggest_key = self._unique_key(f"image_{item.node_id}", used_keys)
            item.suggest_label = f"图片（{item.node_title or item.node_id}）"
            item.choices = None
            item.enum_source = None

    @staticmethod
    def _unique_key(candidate: str, used_keys: set[str]) -> str:
        key = re.sub(r"[^a-z0-9_]", "_", candidate.lower()).strip("_")
        base, index = key, 2
        while key in used_keys:
            key = f"{base}_{index}"
            index += 1
        used_keys.add(key)
        return key

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------
    def save_workflow(self, payload: WorkflowSaveRequest) -> SaveResult:
        workflow_id = payload.workflow_id.strip()
        if not WORKFLOW_ID_PATTERN.match(workflow_id):
            raise ValueError("workflow_id 只能包含小写字母、数字和下划线")
        if not payload.name.strip():
            raise ValueError("工作流名称不能为空")
        if not payload.template:
            raise ValueError("模板图不能为空")
        if payload.output_node not in payload.template:
            raise ValueError(f"输出节点 {payload.output_node} 不在模板中")

        template_filename = f"{workflow_id}.api.json"
        definition = WorkflowDef(
            workflow_id=workflow_id,
            name=payload.name.strip(),
            description=payload.description.strip(),
            template=template_filename,
            output_node=payload.output_node,
            params=payload.params,
        )
        WorkflowService.self_check(definition, payload.template)

        DEFINITIONS_DIR.mkdir(parents=True, exist_ok=True)
        TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)
        definition_path = DEFINITIONS_DIR / f"{workflow_id}.json"
        template_path = TEMPLATES_DIR / template_filename
        backed_up = self._backup_existing(definition_path, template_path)

        self._write_json(definition_path, definition.model_dump())
        self._write_json(template_path, payload.template)

        reload_result = self._workflows.reload()
        if workflow_id in reload_result["failed"]:
            raise RuntimeError(
                f"保存后自检失败：{reload_result['failed'][workflow_id]}"
            )
        doc_path = self._write_workflow_doc(definition)
        self._update_doc_index()
        entry = RegistryEntry.model_validate(
            next(
                item
                for item in self._workflows.registry_status()
                if item["workflow_id"] == workflow_id
            )
        )
        logger.info("workflow %s saved (params=%d)", workflow_id, len(definition.params))
        return SaveResult(
            entry=entry,
            doc_path=str(doc_path),
            template_path=str(template_path),
            definition_path=str(definition_path),
            backed_up=backed_up,
        )

    def delete_workflow(self, workflow_id: str) -> None:
        definition_path = DEFINITIONS_DIR / f"{workflow_id}.json"
        template_path = TEMPLATES_DIR / f"{workflow_id}.api.json"
        doc_path = WORKFLOW_DOC_DIR / f"{workflow_id}.md"
        for path in (definition_path, template_path, doc_path):
            if path.is_file():
                path.unlink()
        self._workflows.reload()
        self._update_doc_index()

    def sync_workflow_docs(self) -> None:
        """Regenerate per-workflow docs + index for every registered workflow."""
        for definition in self._workflows.list_workflows():
            self._write_workflow_doc(definition)
        self._update_doc_index()

    def _backup_existing(self, *paths: Path) -> list[str]:
        backed_up: list[str] = []
        existing = [path for path in paths if path.is_file()]
        if not existing:
            return backed_up
        BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        for path in existing:
            target = BACKUPS_DIR / f"{path.stem}.{timestamp}{path.suffix}"
            target.write_bytes(path.read_bytes())
            backed_up.append(str(target))
        return backed_up

    # ------------------------------------------------------------------
    # Documentation
    # ------------------------------------------------------------------
    def _write_workflow_doc(self, definition: WorkflowDef) -> Path:
        WORKFLOW_DOC_DIR.mkdir(parents=True, exist_ok=True)
        lines: list[str] = [
            f"# 工作流接口文档：{definition.name}",
            "",
            f"- 工作流 ID：`{definition.workflow_id}`",
            f"- 更新时间：{datetime.now().strftime('%Y-%m-%d %H:%M')}",
            f"- 模板文件：`workflows/templates/{definition.template}`",
            f"- 输出节点：`{definition.output_node}`",
            ("- 说明：" + definition.description) if definition.description else "- 说明：无",
            "",
            "## 1. 提交生图",
            "",
            "- 方法：`POST`",
            f"- 路径：`/api/v1/workflows/{definition.workflow_id}/invoke`",
            "- 请求体：`{\"params\": { ... }}`，仅传需要覆盖的参数，其余取默认值",
            "- 响应：异步任务，立即返回 `job_id`，用第 2 节接口轮询结果",
            "",
            "### 参数说明",
            "",
            "| 参数 key | 名称 | 类型 | 必填 | 默认值 | 取值 / 范围 |",
            "| --- | --- | --- | --- | --- | --- |",
        ]
        for param in definition.params:
            value_domain = self._param_value_domain(param)
            lines.append(
                f"| `{param.key}` | {param.label} | {param.type} | "
                f"{'是' if param.required else '否'} | "
                f"{self._format_default(param.default)} | {value_domain} |"
            )
        image_params = [param for param in definition.params if param.type == "image"]
        if image_params:
            lines.extend(
                [
                    "",
                    "### 图片参数说明",
                    "",
                    "图片类型参数支持以下三种传值方式：",
                    "",
                    "1. Data URL：`data:image/png;base64,...`（推荐，可直接放在 JSON 中提交）",
                    "2. 纯 base64 字符串（不带 `data:` 前缀，服务端按 PNG 解码）",
                    "3. ComfyUI input 目录中已存在的文件名（兼容旧调用方式）",
                    "",
                    "服务端收到前两种值后会自动上传到 ComfyUI 并替换为文件名注入工作流，",
                    "调用方不需要知道 ComfyUI 的本地目录结构。",
                ]
            )
        lines.extend(
            [
                "",
                "### curl 示例",
                "",
                "```bash",
                "curl -X POST http://127.0.0.1:8888/api/v1/workflows/"
                f"{definition.workflow_id}/invoke \\",
                "  -H 'Content-Type: application/json' \\",
                "  -d '" + json.dumps(
                    {"params": self._example_params(definition)},
                    ensure_ascii=False,
                ) + "'",
                "```",
                "",
                "## 2. 任务查询与产物",
                "",
                f"- 查询状态：`GET /api/v1/jobs/{{job_id}}`",
                f"- 下载图片：`GET /api/v1/jobs/{{job_id}}/image`",
                "- 最近任务：`GET /api/v1/jobs`",
                "",
            ]
        )
        doc_path = WORKFLOW_DOC_DIR / f"{definition.workflow_id}.md"
        doc_path.write_text("\n".join(lines), encoding="utf-8")
        return doc_path

    @staticmethod
    def _param_value_domain(param: Any) -> str:
        if param.type == "image":
            return "图片：data URL / base64 / 已上传文件名"
        if param.enum_source:
            return f"动态枚举：{param.enum_source}"
        if param.choices:
            return " / ".join(str(item) for item in param.choices)
        if param.min is not None or param.max is not None:
            return f"{param.min if param.min is not None else '-∞'} ~ {param.max if param.max is not None else '+∞'}"
        return "-"

    @staticmethod
    def _format_default(value: Any) -> str:
        if value is None:
            return "无"
        if isinstance(value, str):
            return f"`{value}`" if len(value) <= 40 else f"`{value[:37]}...`"
        return f"`{json.dumps(value, ensure_ascii=False)}`"

    @staticmethod
    def _example_params(definition: WorkflowDef) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for param in definition.params:
            if param.type == "image":
                result[param.key] = "data:image/png;base64,<BASE64编码的图片内容>"
            elif param.default is not None:
                result[param.key] = param.default
        return result

    def _update_doc_index(self) -> None:
        entries = sorted(DEFINITIONS_DIR.glob("*.json"))
        rows = ["", "<!-- WORKFLOW_DOC_INDEX:START -->",
                "## 工作流接口文档索引（自动生成，请勿手工编辑）", ""]
        if entries:
            rows.append("| 工作流 ID | 名称 | 接口文档 |")
            rows.append("| --- | --- | --- |")
            for path in entries:
                data = json.loads(path.read_text(encoding="utf-8"))
                workflow_id = data.get("workflow_id", path.stem)
                rows.append(
                    f"| `{workflow_id}` | {data.get('name', '')} | "
                    f"[workflow_api/{workflow_id}.md](workflow_api/{workflow_id}.md) |"
                )
        else:
            rows.append("（暂无已注册工作流）")
        rows.extend(["<!-- WORKFLOW_DOC_INDEX:END -->", ""])
        block = "\n".join(rows)

        content = MAIN_API_DOC.read_text(encoding="utf-8") if MAIN_API_DOC.is_file() else ""
        start = "<!-- WORKFLOW_DOC_INDEX:START -->"
        end = "<!-- WORKFLOW_DOC_INDEX:END -->"
        if start in content and end in content:
            before = content.split(start)[0]
            after = content.split(end, 1)[1]
            content = before + block + after
        else:
            content = content.rstrip() + "\n\n" + block
        MAIN_API_DOC.write_text(content, encoding="utf-8")

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    @staticmethod
    def _write_json(path: Path, payload: Any) -> None:
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=self._settings.comfyui_base_url,
            timeout=30.0,
            trust_env=False,
        )


from app.services.workflow_service import workflow_service

workflow_admin_service = WorkflowAdminService(workflow_service=workflow_service)


def get_workflow_admin_service() -> WorkflowAdminService:
    return workflow_admin_service
