"""Schemas for the visual workflow configuration platform (admin console)."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schemas.workflow import ParamDef, WorkflowDef


class ParseRequest(BaseModel):
    graph: dict[str, Any] = Field(..., description="ComfyUI API-format graph")


class ParsedInput(BaseModel):
    """One configurable widget found while walking the API graph."""

    node_id: str
    node_title: str | None
    class_type: str
    input_name: str
    path: list[str]
    current_value: Any | None
    kind: Literal["widget", "link", "wrapper"]
    inferred_type: Literal["string", "int", "float", "bool", "enum", "image", "unknown"]
    choices: list[str] | None = None
    enum_source: str | None = None
    multiline: bool = False
    min: float | None = None
    max: float | None = None
    suggest_export: bool = False
    suggest_key: str | None = None
    suggest_label: str | None = None


class ParsedNode(BaseModel):
    node_id: str
    class_type: str
    title: str | None
    is_output_candidate: bool
    inputs: list[ParsedInput]


class ParseResult(BaseModel):
    node_count: int
    output_candidates: list[str]
    nodes: list[ParsedNode]
    warnings: list[str]


class WorkflowSaveRequest(BaseModel):
    workflow_id: str
    name: str
    description: str = ""
    output_node: str
    template: dict[str, Any]
    params: list[ParamDef]


class TrialRequest(BaseModel):
    name: str = "试跑工作流"
    output_node: str
    template: dict[str, Any]
    params: dict[str, Any] = Field(default_factory=dict)
    param_defs: list[ParamDef]


class RegistryEntry(BaseModel):
    workflow_id: str
    name: str
    description: str
    template: str
    output_node: str
    ok: bool
    error: str | None
    param_count: int
    node_count: int
    updated_at: datetime | None


class ReloadResult(BaseModel):
    loaded: list[str]
    failed: dict[str, str]


class WorkflowDetail(BaseModel):
    definition: WorkflowDef
    template: dict[str, Any]


class EnumOptions(BaseModel):
    source: str
    options: list[str]


class SaveResult(BaseModel):
    entry: RegistryEntry
    doc_path: str
    template_path: str
    definition_path: str
    backed_up: list[str]
