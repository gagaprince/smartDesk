"""Schemas for workflow template registry and generation jobs."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class ParamDef(BaseModel):
    """One externally exposed parameter and its injection path(s) in the API graph."""

    key: str
    label: str
    type: Literal["string", "int", "float", "bool", "enum"]
    required: bool = False
    default: Any | None = None
    choices: list[str] | None = None
    enum_source: str | None = None
    multiline: bool = False
    min: float | None = None
    max: float | None = None
    path: list[str | int] | None = None
    paths: list[list[str | int]] | None = None


class WorkflowDef(BaseModel):
    workflow_id: str
    name: str
    description: str = ""
    template: str
    output_node: str
    params: list[ParamDef]


class InvokeRequest(BaseModel):
    params: dict[str, Any] = Field(default_factory=dict)


class JobInfo(BaseModel):
    job_id: str
    workflow_id: str
    workflow_name: str
    status: Literal["queued", "running", "success", "error"]
    submitted_params: dict[str, Any]
    image_url: str | None = None
    error: str | None = None
    node_errors: dict[str, Any] | None = None
    created_at: datetime
    finished_at: datetime | None = None


class LoraOptions(BaseModel):
    loras: list[str]
