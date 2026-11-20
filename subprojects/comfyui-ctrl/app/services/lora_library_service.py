"""LoRA library: tag dimensions, per-model tags and same-name png thumbnails.

Persisted state lives in workflows/lora_library.json next to the workflow
definitions. Model files themselves are resolved through the configured
COMFYUI_LORAS_DIRS roots; thumbnail files sit next to the model with the
same stem and a .png suffix.
"""

from __future__ import annotations

import base64
import binascii
import json
import logging
import re
import uuid
from pathlib import Path

from app.core.config import Settings, get_settings
from app.schemas.lora_library import Dimension
from app.services.workflow_service import (
    PROJECT_ROOT,
    WorkflowService,
    get_workflow_service,
)

logger = logging.getLogger(__name__)

STORE_FILE = PROJECT_ROOT / "workflows" / "lora_library.json"
DATA_URL_PATTERN = re.compile(
    r"^data:(?P<mime>[\w.+-]+/[\w.+-]+);base64,(?P<data>.+)$", re.DOTALL
)
PNG_SIGNATURE = b"\x89PNG"

DEFAULT_DIMENSIONS: list[dict] = [
    {
        "id": "base",
        "name": "基座模型",
        "categories": [
            {"id": "flux", "name": "flux"},
            {"id": "qwen", "name": "qwen"},
            {"id": "pony", "name": "pony"},
        ],
    },
    {
        "id": "function",
        "name": "功能",
        "categories": [
            {"id": "portrait", "name": "人像"},
            {"id": "style", "name": "风格"},
            {"id": "landscape", "name": "风景"},
            {"id": "architecture", "name": "建筑"},
        ],
    },
]


class LoraLibraryService:
    def __init__(
        self,
        workflow_service: WorkflowService,
        settings: Settings | None = None,
    ) -> None:
        self._workflows = workflow_service
        self._settings = settings or get_settings()
        self._store: dict = self._load_store()

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------
    def _load_store(self) -> dict:
        if STORE_FILE.exists():
            try:
                store = json.loads(STORE_FILE.read_text(encoding="utf-8"))
                if isinstance(store.get("dimensions"), list) and isinstance(
                    store.get("tags"), dict
                ):
                    return store
                logger.warning("lora library store malformed, reseeding: %s", STORE_FILE)
            except (OSError, json.JSONDecodeError):
                logger.exception("failed reading lora library store, reseeding")
        store = {"dimensions": json.loads(json.dumps(DEFAULT_DIMENSIONS)), "tags": {}}
        self._write_store(store)
        return store

    @staticmethod
    def _write_store(store: dict) -> None:
        STORE_FILE.parent.mkdir(parents=True, exist_ok=True)
        STORE_FILE.write_text(
            json.dumps(store, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def _save(self) -> None:
        self._write_store(self._store)

    # ------------------------------------------------------------------
    # Dimensions and categories
    # ------------------------------------------------------------------
    async def get_library(self, force_refresh: bool = False) -> dict:
        names = await self._workflows.list_loras(force_refresh=force_refresh)
        tags_map = self._store.get("tags", {})
        loras = []
        for name in names:
            model_path = self.resolve_model_path(name)
            thumbnail_path = (
                model_path.with_suffix(".png") if model_path is not None else None
            )
            loras.append(
                {
                    "name": name,
                    "managed": model_path is not None,
                    "thumbnail_ready": bool(
                        thumbnail_path is not None and thumbnail_path.is_file()
                    ),
                    "tags": tags_map.get(name, {}),
                }
            )
        return {
            "dimensions": self._store["dimensions"],
            "loras": loras,
            "roots": [str(root) for root in self._settings.lora_roots],
        }

    def save_dimensions(self, dimensions: list[Dimension]) -> dict:
        cleaned: list[dict] = []
        dimension_ids: set[str] = set()
        dimension_names: set[str] = set()
        valid_category_ids: set[str] = set()
        for dimension in dimensions:
            dim_name = dimension.name.strip()
            if not dim_name:
                raise ValueError("维度名称不能为空")
            if dim_name in dimension_names:
                raise ValueError(f"维度名称重复：{dim_name}")
            dimension_names.add(dim_name)
            dim_id = dimension.id.strip() or f"dim_{uuid.uuid4().hex[:8]}"
            while dim_id in dimension_ids:
                dim_id = f"dim_{uuid.uuid4().hex[:8]}"
            dimension_ids.add(dim_id)

            categories: list[dict] = []
            category_names: set[str] = set()
            for category in dimension.categories:
                cat_name = category.name.strip()
                if not cat_name:
                    raise ValueError(f"维度 {dim_name} 下存在空分类名称")
                if cat_name in category_names:
                    raise ValueError(f"维度 {dim_name} 下分类名称重复：{cat_name}")
                category_names.add(cat_name)
                cat_id = category.id.strip() or f"cat_{uuid.uuid4().hex[:8]}"
                while cat_id in valid_category_ids:
                    cat_id = f"cat_{uuid.uuid4().hex[:8]}"
                valid_category_ids.add(cat_id)
                categories.append({"id": cat_id, "name": cat_name})
            cleaned.append({"id": dim_id, "name": dim_name, "categories": categories})

        self._prune_tags(dimension_ids, valid_category_ids)
        self._store["dimensions"] = cleaned
        self._save()
        return self._store

    def batch_tag(self, names: list[str], tags: dict[str, list[str]]) -> dict:
        if not names:
            raise ValueError("请先选择至少一个模型")
        valid_dimensions = {
            dim["id"]: {cat["id"] for cat in dim["categories"]}
            for dim in self._store["dimensions"]
        }
        clean_tags: dict[str, list[str]] = {}
        for dim_id, category_ids in tags.items():
            if dim_id not in valid_dimensions:
                raise ValueError(f"维度不存在：{dim_id}")
            unique_ids = list(dict.fromkeys(category_ids))
            unknown = [item for item in unique_ids if item not in valid_dimensions[dim_id]]
            if unknown:
                raise ValueError(f"维度 {dim_id} 下分类不存在：{', '.join(unknown)}")
            clean_tags[dim_id] = unique_ids

        tags_map = self._store.setdefault("tags", {})
        for name in names:
            if not isinstance(name, str) or not name.strip():
                raise ValueError("模型名称不合法")
            current = dict(tags_map.get(name, {}))
            for dim_id, category_ids in clean_tags.items():
                if category_ids:
                    current[dim_id] = category_ids
                else:
                    current.pop(dim_id, None)
            if current:
                tags_map[name] = current
            else:
                tags_map.pop(name, None)
        self._save()
        return self._store

    def _prune_tags(
        self, dimension_ids: set[str], category_ids: set[str]
    ) -> None:
        tags_map = self._store.get("tags", {})
        for name, assignments in list(tags_map.items()):
            pruned = {}
            for dim_id, cat_ids in assignments.items():
                if dim_id not in dimension_ids:
                    continue
                kept = [cat_id for cat_id in cat_ids if cat_id in category_ids]
                if kept:
                    pruned[dim_id] = kept
            if pruned:
                tags_map[name] = pruned
            else:
                tags_map.pop(name, None)

    # ------------------------------------------------------------------
    # Disk paths and thumbnails
    # ------------------------------------------------------------------
    def resolve_model_path(self, name: str) -> Path | None:
        """Resolve a ComfyUI-relative lora name against configured roots."""
        if not name or Path(name).is_absolute() or ".." in Path(name).parts:
            return None
        for root in self._settings.lora_roots:
            if not root.is_dir():
                continue
            root_resolved = root.resolve()
            candidate = (root_resolved / name).resolve()
            if root_resolved in candidate.parents and candidate.is_file():
                return candidate
        return None

    def get_thumbnail_path(self, name: str) -> Path:
        model_path = self.resolve_model_path(name)
        if model_path is None:
            raise ValueError("模型文件不在已配置的 LoRA 根目录内")
        thumbnail_path = model_path.with_suffix(".png")
        if not thumbnail_path.is_file():
            raise FileNotFoundError(name)
        return thumbnail_path

    def save_thumbnail(self, name: str, image_data: str) -> Path:
        model_path = self.resolve_model_path(name)
        if model_path is None:
            raise ValueError("模型文件不在已配置的 LoRA 根目录内，无法保存缩略图")
        match = DATA_URL_PATTERN.match(image_data.strip())
        if not match or match.group("mime") != "image/png":
            raise ValueError("缩略图必须是 image/png 的 data URL")
        try:
            raw = base64.b64decode(match.group("data"), validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("缩略图 base64 解码失败") from exc
        if not raw.startswith(PNG_SIGNATURE):
            raise ValueError("缩略图内容不是合法 PNG")
        thumbnail_path = model_path.with_suffix(".png")
        thumbnail_path.write_bytes(raw)
        logger.info("lora thumbnail saved: %s", thumbnail_path)
        return thumbnail_path

    def delete_loras(self, names: list[str]) -> dict:
        """Delete model files together with same-name thumbnails and tags.

        Only managed models (resolved inside configured roots) can be
        deleted. Per-item failures are collected and returned so the UI can
        report partial results; tags are removed only after the file is
        actually gone.
        """
        if not names:
            raise ValueError("请先选择至少一个模型")
        deleted: list[str] = []
        failed: list[dict[str, str]] = []
        tags_map = self._store.setdefault("tags", {})
        for name in names:
            if not isinstance(name, str) or not name.strip():
                failed.append({"name": str(name), "reason": "模型名称不合法"})
                continue
            model_path = self.resolve_model_path(name)
            if model_path is None:
                failed.append(
                    {"name": name, "reason": "模型文件不在已配置的 LoRA 根目录内"}
                )
                continue
            try:
                thumbnail_path = model_path.with_suffix(".png")
                if thumbnail_path.is_file():
                    thumbnail_path.unlink()
                model_path.unlink()
            except OSError as exc:
                failed.append({"name": name, "reason": f"文件删除失败：{exc}"})
                continue
            tags_map.pop(name, None)
            deleted.append(name)
            logger.info("lora model deleted: %s", model_path)
        if deleted:
            self._save()
        return {"deleted": deleted, "failed": failed}

lora_library_service = LoraLibraryService(workflow_service=get_workflow_service())


def get_lora_library_service() -> LoraLibraryService:
    return lora_library_service
