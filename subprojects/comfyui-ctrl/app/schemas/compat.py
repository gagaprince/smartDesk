"""AIComicBuilder 兼容协议请求/响应模型.

协议来源: AIComicBuilder-ComfyUI自定义Provider对接.md, 服务端只承接
「一次 HTTP 请求换一张图」的同步生图抽象, 响应固定走 base64 模式。
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class RefImage(BaseModel):
    """应用侧下发的参考图, data 为不带 data: 前缀的 base64。"""

    label: str | None = None
    mime_type: str
    data: str


class GenRequest(BaseModel):
    model: str
    prompt: str
    n: int = 1
    size: str | None = None
    aspect_ratio: str | None = None
    quality: str | None = None
    task_type: str = "generic"
    lora: str | None = None
    strength: float | None = None
    reference_images: list[RefImage] = Field(default_factory=list)


class ImageData(BaseModel):
    b64_json: str


class GenResponse(BaseModel):
    data: list[ImageData]


class ModelItem(BaseModel):
    id: str


class ModelsResponse(BaseModel):
    data: list[ModelItem]


class LoraItem(BaseModel):
    id: str


class LorasResponse(BaseModel):
    data: list[LoraItem]


class CompatErrorBody(BaseModel):
    type: str
    message: str
