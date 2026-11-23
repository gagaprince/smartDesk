"""Schemas for the LoRA library management feature."""

from pydantic import BaseModel, Field


class Category(BaseModel):
    id: str
    name: str


class Dimension(BaseModel):
    id: str
    name: str
    categories: list[Category] = Field(default_factory=list)


class LoraEntry(BaseModel):
    # ComfyUI object_info 返回的相对路径名, 同时作为标签存储的主键
    name: str
    # False 表示模型不在已配置的 LoRA 根目录内, 缩略图相关操作不可用
    managed: bool
    thumbnail_ready: bool = False
    # dimension_id -> [category_id]
    tags: dict[str, list[str]] = Field(default_factory=dict)


class LibraryOverview(BaseModel):
    dimensions: list[Dimension]
    loras: list[LoraEntry]
    roots: list[str]


class DimensionsRequest(BaseModel):
    dimensions: list[Dimension]


class BatchTagRequest(BaseModel):
    names: list[str]
    # 仅包含需要覆盖的维度; 未出现的维度保持原值, 空列表表示清空该维度
    tags: dict[str, list[str]]


class ThumbnailRequest(BaseModel):
    name: str
    # data:image/png;base64,... 形式, 由渲染层把生成图统一转成 PNG
    image_data: str


class DeleteLorasRequest(BaseModel):
    names: list[str]


class DeleteLorasResult(BaseModel):
    deleted: list[str] = Field(default_factory=list)
    failed: list[dict[str, str]] = Field(default_factory=list)


class RenameLoraRequest(BaseModel):
    # ComfyUI 相对路径名(标签存储主键), 如 qwen\selftrain\a.safetensors
    name: str
    # 新文件名(不含目录), 可省略 .safetensors 后缀
    new_name: str


class RenameLoraResult(BaseModel):
    old_name: str
    new_name: str
