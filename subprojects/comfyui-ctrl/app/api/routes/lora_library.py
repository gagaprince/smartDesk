"""LoRA library management endpoints."""

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from app.schemas.common import ApiResponse
from app.schemas.lora_library import (
    BatchTagRequest,
    DeleteLorasRequest,
    DeleteLorasResult,
    DimensionsRequest,
    LibraryOverview,
    ThumbnailRequest,
)
from app.services.lora_library_service import (
    LoraLibraryService,
    get_lora_library_service,
)

router = APIRouter(prefix="/admin/lora-library", tags=["lora-library"])


@router.get("", response_model=ApiResponse[LibraryOverview])
async def get_library(
    refresh: bool = False,
    service: LoraLibraryService = Depends(get_lora_library_service),
) -> ApiResponse[LibraryOverview]:
    try:
        data = await service.get_library(force_refresh=refresh)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail=f"ComfyUI 不可达：{exc}") from exc
    return ApiResponse(data=data)


@router.put("/dimensions", response_model=ApiResponse[dict])
def save_dimensions(
    request: DimensionsRequest,
    service: LoraLibraryService = Depends(get_lora_library_service),
) -> ApiResponse[dict]:
    try:
        return ApiResponse(data=service.save_dimensions(request.dimensions))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/tags/batch", response_model=ApiResponse[dict])
def batch_tag(
    request: BatchTagRequest,
    service: LoraLibraryService = Depends(get_lora_library_service),
) -> ApiResponse[dict]:
    try:
        return ApiResponse(
            data=service.batch_tag(request.names, request.tags)
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/thumbnail")
def get_thumbnail(
    name: str,
    service: LoraLibraryService = Depends(get_lora_library_service),
) -> FileResponse:
    try:
        thumbnail_path = service.get_thumbnail_path(name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="缩略图不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return FileResponse(str(thumbnail_path))


@router.post("/thumbnail", response_model=ApiResponse[dict])
def save_thumbnail(
    request: ThumbnailRequest,
    service: LoraLibraryService = Depends(get_lora_library_service),
) -> ApiResponse[dict]:
    try:
        thumbnail_path = service.save_thumbnail(request.name, request.image_data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"缩略图写入失败：{exc}") from exc
    return ApiResponse(data={"name": request.name, "thumbnail": str(thumbnail_path)})


@router.post("/delete", response_model=ApiResponse[DeleteLorasResult])
def delete_loras(
    request: DeleteLorasRequest,
    service: LoraLibraryService = Depends(get_lora_library_service),
) -> ApiResponse[DeleteLorasResult]:
    try:
        return ApiResponse(data=DeleteLorasResult(**service.delete_loras(request.names)))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"文件删除失败：{exc}") from exc
