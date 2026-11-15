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

    @property
    def comfyui_base_url(self) -> str:
        return f"http://{self.comfyui_host}:{self.comfyui_port}"


@lru_cache
def get_settings() -> Settings:
    return Settings()

