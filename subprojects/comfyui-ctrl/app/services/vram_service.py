"""Sequential VRAM release for Ollama and ComfyUI.

Mechanisms:
- Ollama: enumerate resident models via GET /api/ps, then POST /api/generate
  with keep_alive=0 for each model. The serve process stays alive.
- ComfyUI: POST /free with unload_models + free_memory. Driver-level CUDA
  cache reclaim happens asynchronously within a few seconds.
- GPU occupancy is measured with nvidia-smi (no extra Python dependency);
  when the eGPU is unmounted and the command fails, measurements stay None.
"""

from __future__ import annotations

import logging
import os
import subprocess
import threading
import time
from pathlib import Path

import httpx

from app.core.config import Settings, get_settings
from app.schemas.vram import ReleaseResult, ReleaseStep

logger = logging.getLogger(__name__)


class VramService:
    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._lock = threading.Lock()

    def release_all(self) -> ReleaseResult:
        """Serialize concurrent calls; Ollama first, then ComfyUI."""
        with self._lock:
            before = self._used_memory_mib()
            steps = [
                self._release_ollama(),
                self._release_comfyui(),
            ]
            # Both services reclaim memory asynchronously after the HTTP
            # APIs return; wait for the driver before measuring "after".
            time.sleep(self._settings.vram_settle_seconds)
            after = self._used_memory_mib()
            freed = None
            if before is not None and after is not None:
                freed = before - after
            return ReleaseResult(
                steps=steps,
                before_used_mib=before,
                after_used_mib=after,
                freed_mib=freed,
            )

    def _used_memory_mib(self) -> int | None:
        system_root = os.environ.get("SystemRoot", r"C:\Windows")
        candidates = [
            str(Path(system_root) / "System32" / "nvidia-smi.exe"),
            "nvidia-smi",
        ]
        for executable in candidates:
            try:
                result = subprocess.run(
                    [
                        executable,
                        "--query-gpu=memory.used",
                        "--format=csv,noheader,nounits",
                    ],
                    capture_output=True,
                    text=True,
                    timeout=8.0,
                    check=True,
                )
            except (OSError, subprocess.SubprocessError):
                continue
            values = [
                int(line.strip())
                for line in result.stdout.splitlines()
                if line.strip().isdigit()
            ]
            if values:
                return sum(values)
            break
        return None

    def _release_ollama(self) -> ReleaseStep:
        base_url = self._settings.ollama_base_url
        try:
            with httpx.Client(timeout=10.0, trust_env=False) as client:
                ps_response = client.get(f"{base_url}/api/ps")
                ps_response.raise_for_status()
                models = ps_response.json().get("models", [])
                if not models:
                    return ReleaseStep(
                        service="ollama",
                        success=True,
                        message="无驻留模型，无需卸载",
                    )
                unloaded: list[str] = []
                for model in models:
                    name = model.get("name") or model.get("model")
                    if not name:
                        continue
                    unload_response = client.post(
                        f"{base_url}/api/generate",
                        json={"model": name, "keep_alive": 0},
                        timeout=15.0,
                    )
                    unload_response.raise_for_status()
                    unloaded.append(name)
                return ReleaseStep(
                    service="ollama",
                    success=True,
                    message=f"已卸载 {len(unloaded)} 个驻留模型",
                    detail={"unloaded_models": unloaded},
                )
        except httpx.ConnectError:
            return ReleaseStep(
                service="ollama",
                success=False,
                skipped=True,
                message="Ollama 服务不可达，已跳过",
            )
        except Exception as exc:
            logger.exception("ollama vram release failed")
            return ReleaseStep(
                service="ollama", success=False, message=f"卸载失败: {exc}"
            )

    def _release_comfyui(self) -> ReleaseStep:
        base_url = self._settings.comfyui_base_url
        try:
            with httpx.Client(timeout=15.0, trust_env=False) as client:
                response = client.post(
                    f"{base_url}/free",
                    json={"unload_models": True, "free_memory": True},
                )
                response.raise_for_status()
            return ReleaseStep(
                service="comfyui",
                success=True,
                message="已触发模型卸载与显存回收",
            )
        except httpx.ConnectError:
            return ReleaseStep(
                service="comfyui",
                success=False,
                skipped=True,
                message="ComfyUI 服务不可达，已跳过",
            )
        except Exception as exc:
            logger.exception("comfyui vram release failed")
            return ReleaseStep(
                service="comfyui", success=False, message=f"释放失败: {exc}"
            )


vram_service = VramService()


def get_vram_service() -> VramService:
    return vram_service
