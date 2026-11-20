"""Pydantic models for VRAM release operations."""

from pydantic import BaseModel


class ReleaseStep(BaseModel):
    service: str
    success: bool
    skipped: bool = False
    message: str
    detail: dict | None = None


class ReleaseResult(BaseModel):
    steps: list[ReleaseStep]
    before_used_mib: int | None = None
    after_used_mib: int | None = None
    freed_mib: int | None = None
