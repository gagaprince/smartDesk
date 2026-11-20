"""Application settings, overridable via environment variables or a local .env file."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "comfyui-ctrl"
    # 仅监听本机, 由 SmartDesk  Electron 主进程在本地拉起
    app_host: str = "127.0.0.1"
    app_port: int = 8888
    log_level: str = "info"

    # 被编排的 ComfyUI 服务地址
    comfyui_host: str = "127.0.0.1"
    comfyui_port: int = 8188

    # AIComicBuilder 兼容层: ComfyUI 的 input 目录(参考图落盘), 留空则带参考图的请求报错
    comfyui_input_dir: str = ""
    # LoRA 模型根目录, 分号分隔; LoRA 模型管理页据此解析磁盘路径与同名缩略图
    comfyui_loras_dirs: str = ""
    # task_type -> workflow_id 路由表, 相对路径基于子项目根目录
    task_routing_file: str = "workflows/task_routing.json"
    # 兼容层单个出图任务同步等待上限(秒), 应用侧总超时为 10 分钟
    compat_job_timeout: float = 540.0

    # 显存回收: Ollama 探活地址(客户端视角, 刻意不使用 OLLAMA_HOST 命名,
    # 该变量属于 Ollama 自身且为 host:port 格式, 会破坏 URL 拼接)
    ollama_client_host: str = "127.0.0.1"
    ollama_client_port: int = 11434
    # 触发回收后等待驱动实际归还显存的等待时长(秒)
    vram_settle_seconds: float = 6.0

    @property
    def comfyui_base_url(self) -> str:
        return f"http://{self.comfyui_host}:{self.comfyui_port}"

    @property
    def lora_roots(self) -> list:
        from pathlib import Path

        return [
            Path(item.strip())
            for item in self.comfyui_loras_dirs.split(";")
            if item.strip()
        ]

    @property
    def ollama_base_url(self) -> str:
        return f"http://{self.ollama_client_host}:{self.ollama_client_port}"


@lru_cache
def get_settings() -> Settings:
    return Settings()

