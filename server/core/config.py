import os
from typing import Optional
from pydantic_settings import BaseSettings


class ServerConfig(BaseSettings):
    """Server configuration"""

    host: str = "127.0.0.1"
    port: int = 8765
    websocket_port: int = 8766
    max_command_queue: int = 100
    command_timeout: float = (
        30.0  # Keep above extension-side highlight retries and screenshot capture time
    )
    screenshot_dir: str = "./screenshots"
    log_level: str = "INFO"

    # Chrome extension settings
    extension_id: Optional[str] = None
    native_messaging: bool = False  # Use WebSocket by default

    class Config:
        env_prefix = "CHROME_SERVER_"
        case_sensitive = False

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        # Ensure screenshot directory exists
        os.makedirs(self.screenshot_dir, exist_ok=True)


config = ServerConfig()
