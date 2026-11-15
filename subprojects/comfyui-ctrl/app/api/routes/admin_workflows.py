"""Admin endpoints for the visual workflow configuration platform."""

from fastapi import APIRouter, Depends, HTTPException

import httpx

from app.schemas.admin import (
    EnumOptions,
    ParseRequest,
    ParseResult,
    RegistryEntry,
    ReloadResult,
    SaveResult,
    TrialRequest,
    WorkflowDetail,
    WorkflowSaveRequest,
)
from app.schemas.common import ApiResponse
from app.schemas.workflow import JobInfo, WorkflowDef
from app.services.workflow_admin_service import (
    WorkflowAdminService,
    get_workflow_admin_service,
)
from app.services.workflow_service import WorkflowService, get_workflow_service

router = APIRouter(prefix="/admin/workflows", tags=["workflow-admin"])
enum_router = APIRouter(prefix="/admin/enums", tags=["workflow-admin"])


@router.post("/parse", response_model=ApiResponse[ParseResult])
async def parse_workflow(
    request: ParseRequest,
    service: WorkflowAdminService = Depends(get_workflow_admin_service),
) -> ApiResponse[ParseResult]:
    try:
        result = await service.parse_graph(request.graph)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ApiResponse(data=result)


@router.post("/trial", response_model=ApiResponse[JobInfo])
async def trial_workflow(
    request: TrialRequest,
    service: WorkflowAdminService = Depends(get_workflow_admin_service),
    workflow_service: WorkflowService = Depends(get_workflow_service),
) -> ApiResponse[JobInfo]:
    if request.output_node not in request.template:
        raise HTTPException(status_code=400, detail=f"输出节点 {request.output_node} 不在模板中")
    definition = WorkflowDef(
        workflow_id="__trial__",
        name=request.name,
        template="",
        output_node=request.output_node,
        params=request.param_defs,
    )
    try:
        WorkflowService.self_check(definition, request.template)
        job = await workflow_service.invoke_graph(
            definition, request.template, request.params
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except httpx.ConnectError as exc:
        raise HTTPException(status_code=503, detail=f"ComfyUI 不可达：{exc}") from exc
    return ApiResponse(data=job)


@router.get("", response_model=ApiResponse[list[RegistryEntry]])
def list_registry(
    workflow_service: WorkflowService = Depends(get_workflow_service),
) -> ApiResponse[list[RegistryEntry]]:
    return ApiResponse(
        data=[RegistryEntry.model_validate(item) for item in workflow_service.registry_status()]
    )


@router.get("/{workflow_id}", response_model=ApiResponse[WorkflowDetail])
def get_workflow_detail(
    workflow_id: str,
    workflow_service: WorkflowService = Depends(get_workflow_service),
) -> ApiResponse[WorkflowDetail]:
    try:
        detail = workflow_service.get_workflow_detail(workflow_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="工作流不存在") from exc
    return ApiResponse(data=WorkflowDetail.model_validate(detail))


@router.post("", response_model=ApiResponse[SaveResult])
def create_workflow(
    request: WorkflowSaveRequest,
    service: WorkflowAdminService = Depends(get_workflow_admin_service),
) -> ApiResponse[SaveResult]:
    try:
        return ApiResponse(data=service.save_workflow(request))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.put("/{workflow_id}", response_model=ApiResponse[SaveResult])
def update_workflow(
    workflow_id: str,
    request: WorkflowSaveRequest,
    service: WorkflowAdminService = Depends(get_workflow_admin_service),
) -> ApiResponse[SaveResult]:
    if workflow_id != request.workflow_id:
        raise HTTPException(status_code=400, detail="路径中的工作流 ID 与请求体不一致")
    try:
        return ApiResponse(data=service.save_workflow(request))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.delete("/{workflow_id}", response_model=ApiResponse[dict])
def delete_workflow(
    workflow_id: str,
    service: WorkflowAdminService = Depends(get_workflow_admin_service),
) -> ApiResponse[dict]:
    service.delete_workflow(workflow_id)
    return ApiResponse(data={"workflow_id": workflow_id, "deleted": True})


@router.post("/reload", response_model=ApiResponse[ReloadResult])
def reload_registry(
    workflow_service: WorkflowService = Depends(get_workflow_service),
) -> ApiResponse[ReloadResult]:
    return ApiResponse(data=ReloadResult.model_validate(workflow_service.reload()))


@enum_router.get("/{source}", response_model=ApiResponse[EnumOptions])
async def get_enum_options(
    source: str,
    service: WorkflowAdminService = Depends(get_workflow_admin_service),
) -> ApiResponse[EnumOptions]:
    try:
        return ApiResponse(data=await service.enum_options(source))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail=f"ComfyUI 不可达：{exc}") from exc
