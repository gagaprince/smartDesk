"""FastAPI application entry point (SmartDesk 内置版, 仅保留工作流相关能力)."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import (
    admin_workflows,
    compat,
    health,
    lora_library,
    vram,
    workflows,
)
from app.core.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.basicConfig(
        level=settings.log_level.upper(),
        format="%(asctime)s %(levelname)s %(name)s - %(message)s",
    )
    logger.info(
        "%s starting on %s:%s (comfyui: %s)",
        settings.app_name,
        settings.app_host,
        settings.app_port,
        settings.comfyui_base_url,
    )
    from app.services.workflow_admin_service import workflow_admin_service

    workflow_admin_service.sync_workflow_docs()
    yield
    logger.info("%s stopped", settings.app_name)


app = FastAPI(title=settings.app_name, version="0.2.0", lifespan=lifespan)

# Electron 渲染层与该服务端口不同, 需要放开跨域
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(workflows.router, prefix="/api/v1")
app.include_router(admin_workflows.router, prefix="/api/v1")
app.include_router(admin_workflows.enum_router, prefix="/api/v1")
app.include_router(lora_library.router, prefix="/api/v1")
app.include_router(compat.router)
app.include_router(vram.router, prefix="/api/v1")
