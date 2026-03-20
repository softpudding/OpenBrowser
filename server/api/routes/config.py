"""Configuration management endpoints."""

import os

from fastapi import APIRouter, HTTPException, Request

from server.core.llm_config import (
    DEFAULT_ALIAS,
    DEFAULT_BASE_URL,
    DEFAULT_MODEL,
    LLMConfig,
    llm_config_manager,
)

router = APIRouter(prefix="/api/config", tags=["config"])


def _mask_llm_config(config: LLMConfig, default_alias: str) -> dict[str, object]:
    """Mask sensitive fields in an LLM config for API responses."""
    return {
        "alias": config.alias,
        "model": config.model,
        "base_url": config.base_url,
        "api_key": "********" if config.api_key else None,
        "has_api_key": config.api_key is not None and len(config.api_key) > 0,
        "is_default": config.alias == default_alias,
    }


def _build_full_config_response() -> dict[str, object]:
    """Build the normalized config response used by GET endpoints."""
    config = llm_config_manager.get_full_config()
    default_config = None
    for llm_config in config.llm_configs:
        if llm_config.alias == config.default_llm_alias:
            default_config = llm_config
            break
    if default_config is None and config.llm_configs:
        default_config = config.llm_configs[0]
    if default_config is None:
        raise ValueError("No LLM configs available")
    masked_default = _mask_llm_config(default_config, config.default_llm_alias)
    masked_configs = [
        _mask_llm_config(llm_config, config.default_llm_alias)
        for llm_config in config.llm_configs
    ]
    return {
        "llm": masked_default,
        "llm_configs": masked_configs,
        "default_llm_alias": config.default_llm_alias,
        "default_cwd": config.default_cwd,
        "is_configured": llm_config_manager.is_configured(),
    }


def _parse_llm_payload(data: dict, existing_configs: dict[str, LLMConfig]) -> LLMConfig:
    """Parse one LLM config payload, preserving existing masked API keys."""
    alias = (data.get("alias") or DEFAULT_ALIAS).strip() or DEFAULT_ALIAS
    model = data.get("model", DEFAULT_MODEL)
    base_url = data.get("base_url", DEFAULT_BASE_URL)
    api_key = data.get("api_key")

    if api_key == "********":
        existing_config = existing_configs.get(alias)
        api_key = existing_config.api_key if existing_config else None

    return LLMConfig(alias=alias, model=model, base_url=base_url, api_key=api_key)


@router.get("/llm")
async def get_llm_config():
    """Get LLM configuration (API keys masked)."""
    try:
        full_config = _build_full_config_response()
        return {
            "success": True,
            "config": full_config["llm"],
            "configs": full_config["llm_configs"],
            "default_alias": full_config["default_llm_alias"],
        }
    except Exception as e:
        import logging

        logging.getLogger(__name__).error(f"Error getting LLM config: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/llm")
async def update_llm_config(request: Request):
    """Update LLM configuration.

    Accepts the multi-config payload used by the current frontend.
    """
    try:
        data = await request.json()
        existing_configs = {
            llm_config.alias: llm_config
            for llm_config in llm_config_manager.get_llm_configs()
        }

        raw_configs = data.get("configs")
        default_alias = data.get("default_alias")

        if isinstance(raw_configs, list):
            llm_configs = [
                _parse_llm_payload(item, existing_configs)
                for item in raw_configs
                if isinstance(item, dict)
            ]
            if not llm_configs:
                raise HTTPException(
                    status_code=400, detail="At least one LLM config is required"
                )

            aliases = [llm_config.alias for llm_config in llm_configs]
            if len(set(aliases)) != len(aliases):
                raise HTTPException(
                    status_code=400, detail="LLM config aliases must be unique"
                )

            selected_default_alias = (
                (default_alias or "").strip() if isinstance(default_alias, str) else ""
            )
            if not selected_default_alias:
                selected_default_alias = aliases[0]

            if selected_default_alias not in aliases:
                raise HTTPException(
                    status_code=400,
                    detail=f"default_alias must match one of the configured aliases: {selected_default_alias}",
                )

            llm_config_manager.set_llm_configs(llm_configs, selected_default_alias)
        else:
            raise HTTPException(
                status_code=400,
                detail="configs field is required and must be a list",
            )

        full_config = _build_full_config_response()
        return {
            "success": True,
            "message": "LLM configuration updated successfully",
            "config": full_config["llm"],
            "configs": full_config["llm_configs"],
            "default_alias": full_config["default_llm_alias"],
        }
    except HTTPException:
        raise
    except Exception as e:
        import logging

        logging.getLogger(__name__).error(f"Error updating LLM config: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/cwd")
async def get_default_cwd():
    """Get default working directory."""
    try:
        cwd = llm_config_manager.get_default_cwd()
        return {"success": True, "default_cwd": cwd}
    except Exception as e:
        import logging

        logging.getLogger(__name__).error(f"Error getting default CWD: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/cwd")
async def set_default_cwd(request: Request):
    """Set default working directory."""
    try:
        data = await request.json()
        cwd = data.get("cwd")

        if not cwd:
            raise HTTPException(status_code=400, detail="cwd field is required")

        if not os.path.isdir(cwd):
            raise HTTPException(
                status_code=400, detail=f"Directory does not exist: {cwd}"
            )

        updated_cwd = llm_config_manager.set_default_cwd(cwd)

        return {
            "success": True,
            "message": "Default working directory updated successfully",
            "default_cwd": updated_cwd,
        }
    except HTTPException:
        raise
    except Exception as e:
        import logging

        logging.getLogger(__name__).error(f"Error setting default CWD: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("")
async def get_full_config():
    """Get full application configuration (API keys masked)."""
    try:
        return {"success": True, "config": _build_full_config_response()}
    except Exception as e:
        import logging

        logging.getLogger(__name__).error(f"Error getting full config: {e}")
        raise HTTPException(status_code=500, detail=str(e))
