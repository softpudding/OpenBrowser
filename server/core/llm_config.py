"""
LLM Configuration Manager

Manages LLM configuration (model, base_url, api_key) and default CWD
stored in ~/.openbrowser/llm_config.json
"""

import json
import os
from pathlib import Path
from typing import Dict, Any, Optional
from pydantic import BaseModel, SecretStr
from pydantic.json import pydantic_encoder


class LLMConfig(BaseModel):
    """LLM configuration model"""
    model: str = "dashscope/qwen3.5-plus"
    base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    api_key: Optional[str] = None  # API key must be provided by user


class AppConfig(BaseModel):
    """Application configuration model"""
    llm: LLMConfig = LLMConfig()
    default_cwd: str = "/tmp"


class LLMConfigManager:
    """Manager for LLM and app configuration persisted to file"""
    
    def __init__(self):
        self.config_dir = Path.home() / ".openbrowser"
        self.config_file = self.config_dir / "llm_config.json"
        self._config: Optional[AppConfig] = None
        
    def _ensure_config_dir(self):
        """Ensure configuration directory exists"""
        self.config_dir.mkdir(parents=True, exist_ok=True)
        
    def _load_config(self) -> AppConfig:
        """Load configuration from file"""
        if self._config is not None:
            return self._config
            
        # Start with default config
        config = AppConfig()
        
        # Load from file if it exists
        if self.config_file.exists():
            try:
                with open(self.config_file, 'r') as f:
                    data = json.load(f)
                    # Merge with defaults (allow partial updates)
                    if "llm" in data:
                        llm_data = data["llm"]
                        if "model" in llm_data:
                            config.llm.model = llm_data["model"]
                        if "base_url" in llm_data:
                            config.llm.base_url = llm_data["base_url"]
                        if "api_key" in llm_data and llm_data["api_key"]:
                            config.llm.api_key = llm_data["api_key"]
                    if "default_cwd" in data:
                        config.default_cwd = data["default_cwd"]
            except Exception as e:
                print(f"Warning: Error loading config file: {e}")
                # Continue with defaults
                
        self._config = config
        return config
    
    def _save_config(self, config: AppConfig):
        """Save configuration to file"""
        self._ensure_config_dir()
        
        try:
            with open(self.config_file, 'w') as f:
                json.dump(config.model_dump(), f, indent=2, default=pydantic_encoder)
            self._config = config
        except Exception as e:
            raise RuntimeError(f"Failed to save configuration: {e}")
    
    def get_llm_config(self) -> LLMConfig:
        """Get LLM configuration"""
        config = self._load_config()
        return config.llm
    
    def update_llm_config(self, model: Optional[str] = None, 
                          base_url: Optional[str] = None,
                          api_key: Optional[str] = None) -> LLMConfig:
        """Update LLM configuration"""
        config = self._load_config()
        
        if model is not None:
            config.llm.model = model
        if base_url is not None:
            config.llm.base_url = base_url
        if api_key is not None:
            config.llm.api_key = api_key
            
        self._save_config(config)
        return config.llm
    
    def set_llm_config(self, llm_config: LLMConfig) -> LLMConfig:
        """Set entire LLM configuration"""
        config = self._load_config()
        config.llm = llm_config
        self._save_config(config)
        return config.llm
    
    def get_default_cwd(self) -> str:
        """Get default working directory"""
        config = self._load_config()
        return config.default_cwd
    
    def set_default_cwd(self, cwd: str) -> str:
        """Set default working directory"""
        config = self._load_config()
        config.default_cwd = cwd
        self._save_config(config)
        return config.default_cwd
    
    def get_full_config(self) -> AppConfig:
        """Get full application configuration"""
        return self._load_config()
    
    def update_full_config(self, llm: Optional[LLMConfig] = None,
                          default_cwd: Optional[str] = None) -> AppConfig:
        """Update full application configuration"""
        config = self._load_config()
        
        if llm is not None:
            config.llm = llm
        if default_cwd is not None:
            config.default_cwd = default_cwd
            
        self._save_config(config)
        return config
    
    def is_configured(self) -> bool:
        """Check if LLM is properly configured (has API key)"""
        config = self._load_config()
        return config.llm.api_key is not None and len(config.llm.api_key) > 0
    
    def reset_config(self):
        """Reset configuration to defaults"""
        self._config = None
        if self.config_file.exists():
            try:
                self.config_file.unlink()
            except Exception:
                pass


# Global singleton instance
llm_config_manager = LLMConfigManager()
