"""Workflow invocation and generation job endpoints."""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

import httpx

from app.schemas.common import ApiResponse
from app.schemas.workflow import InvokeRequest, JobInfo, LoraOptions, WorkflowDef
from app.services.workflow_service import (
    WorkflowInvokeError,
    WorkflowService,
    get_workflow_service,
)

router = APIRouter(tags=["workflows"])


@router.get("/workflows", response_model=ApiResponse[list[WorkflowDef]])
async def list_workflows(
    service: WorkflowService = Depends(get_workflow_service),
) -> ApiResponse[list[WorkflowDef]]:
    return ApiResponse(data=service.list_workflows())


@router.get("/workflows/loras", response_model=ApiResponse[LoraOptions])
async def list_loras(
    service: WorkflowService = Depends(get_workflow_service),
) -> ApiResponse[LoraOptions]:
    try:
        return ApiResponse(data=LoraOptions(loras=await service.list_loras()))
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail=f"ComfyUI 不可达：{exc}") from exc


@router.get(
    "/workflows/{workflow_id}",
    response_model=ApiResponse[WorkflowDef],
)
async def get_workflow(
    workflow_id: str,
    service: WorkflowService = Depends(get_workflow_service),
) -> ApiResponse[WorkflowDef]:
    try:
        return ApiResponse(data=service.get_workflow(workflow_id))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="工作流不存在") from exc


@router.post(
    "/workflows/{workflow_id}/invoke",
    response_model=ApiResponse[JobInfo],
)
async def invoke_workflow(
    workflow_id: str,
    request: InvokeRequest,
    service: WorkflowService = Depends(get_workflow_service),
) -> ApiResponse[JobInfo]:
    try:
        job = await service.invoke(workflow_id, request.params)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="工作流不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except WorkflowInvokeError as exc:
        raise HTTPException(status_code=400, detail=exc.payload) from exc
    except httpx.ConnectError as exc:
        raise HTTPException(status_code=503, detail=f"ComfyUI 不可达：{exc}") from exc
    return ApiResponse(data=job)


@router.get("/jobs", response_model=ApiResponse[list[JobInfo]])
def list_jobs(
    service: WorkflowService = Depends(get_workflow_service),
) -> ApiResponse[list[JobInfo]]:
    return ApiResponse(data=service.list_jobs())


@router.get("/jobs/{job_id}", response_model=ApiResponse[JobInfo])
def get_job(
    job_id: str,
    service: WorkflowService = Depends(get_workflow_service),
) -> ApiResponse[JobInfo]:
    try:
        return ApiResponse(data=service.get_job(job_id))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="任务不存在") from exc


@router.get("/jobs/{job_id}/image")
def get_job_image(
    job_id: str,
    service: WorkflowService = Depends(get_workflow_service),
) -> FileResponse:
    try:
        image_path = service.get_job_image_path(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="图片尚未生成") from exc
    return FileResponse(str(image_path))
