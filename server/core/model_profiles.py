"""Model profile configuration for tool selection.

This module centralizes the distinction between "large" and "small" models.
Unknown models default to the large profile so they keep full browser
capabilities unless explicitly constrained here.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path


PROFILE_LARGE = "large"
PROFILE_SMALL = "small"

_CONFIG_PATH = Path(__file__).with_name("model_profiles.json")


@lru_cache(maxsize=1)
def _load_profile_config() -> dict[str, object]:
    """Load model profile configuration from the repository file."""
    with _CONFIG_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def get_model_profile(model_name: str | None) -> str:
    """Return the configured profile name for a model.

    Models not listed in the configuration intentionally default to the large
    profile so newly introduced models keep full browser capabilities.
    """
    config = _load_profile_config()
    default_profile = str(config.get("default_profile", PROFILE_LARGE))

    if not model_name:
        return default_profile

    profiles = config.get("profiles", {})
    if not isinstance(profiles, dict):
        return default_profile

    for profile_name, profile_data in profiles.items():
        if not isinstance(profile_data, dict):
            continue
        models = profile_data.get("models", [])
        if isinstance(models, list) and model_name in models:
            return str(profile_name)

    return default_profile


def is_small_model(model_name: str | None) -> bool:
    """Whether a model is configured as a small model."""
    return get_model_profile(model_name) == PROFILE_SMALL

