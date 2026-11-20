"""VRAM management endpoints."""

from fastapi import APIRouter, Depends

from app.schemas.common import ApiResponse
from app.schemas.vram import ReleaseResult
from app.services.vram_service import VramService, get_vram_service

router = APIRouter(prefix="/vram", tags=["vram"])


@router.post("/release", response_model=ApiResponse[ReleaseResult])
def release_vram(
    service: VramService = Depends(get_vram_service),
) -> ApiResponse[ReleaseResult]:
    """依次释放 Ollama、ComfyUI 显存，并返回释放前后的占用对比。"""
    return ApiResponse(data=service.release_all())
