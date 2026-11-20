"""AIComicBuilder 兼容协议路由, 路径前缀 /v1 与应用配置的 Base URL 对齐。"""

from __future__ import annotations

from fastapi import APIRouter, Header
from fastapi.responses import JSONResponse

from app.schemas.compat import (
    CompatErrorBody,
    GenRequest,
    GenResponse,
    LoraItem,
    LorasResponse,
    ModelsResponse,
)
from app.services.compat_service import CompatError, compat_service

router = APIRouter(prefix="/v1", tags=["aicompat"])


def _error_response(exc: CompatError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": CompatErrorBody(
            type=exc.error_type, message=exc.message
        ).model_dump()},
    )


@router.get("/models", response_model=ModelsResponse)
def list_models(authorization: str = Header(default="")) -> ModelsResponse:
    # 内网 Bearer 令牌约定为可选, 这里只接收不强制校验
    return ModelsResponse(
        data=[{"id": workflow_id} for workflow_id in compat_service.list_models()]
    )


@router.get("/loras", response_model=LorasResponse)
async def list_loras(
    authorization: str = Header(default=""),
) -> LorasResponse | JSONResponse:
    try:
        loras = await compat_service.list_loras()
    except CompatError as exc:
        return _error_response(exc)
    return LorasResponse(data=[LoraItem(id=lora) for lora in loras])


@router.post("/images/generations", response_model=GenResponse)
async def generate_images(
    body: GenRequest,
    authorization: str = Header(default=""),
) -> GenResponse | JSONResponse:
    try:
        b64_json = await compat_service.generate(body)
    except CompatError as exc:
        return _error_response(exc)
    return GenResponse(data=[{"b64_json": b64_json}])
