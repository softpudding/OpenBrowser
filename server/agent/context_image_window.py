"""Configuration helpers for the live tool-image context window."""

from __future__ import annotations

import os

from openhands.sdk import get_logger

logger = get_logger(__name__)

ENV_CONTEXT_IMAGE_WINDOW = "OPENBROWSER_CONTEXT_IMAGE_WINDOW"
DEFAULT_CONTEXT_IMAGE_WINDOW = 3


ROUTINE_REPLAY_CONTEXT_IMAGE_WINDOW = 1


def get_context_image_window(routine_replay: bool = False) -> int | None:
    """Return the tool-image window passed to the SDK Agent.

    Routine-replay conversations use a fixed window of 1: the SOP already
    spells out each step, so a single most-recent screenshot is enough to
    ground the next action and three-frame history would only pad context.

    The default is to keep only the latest screenshot-bearing tool message.
    Environment variable semantics:
    - `-1`: disable SDK filtering entirely (`None`)
    - `0`: keep no screenshot-bearing tool messages
    - `N >= 1`: keep the latest N screenshot-bearing tool messages
    """

    if routine_replay:
        return ROUTINE_REPLAY_CONTEXT_IMAGE_WINDOW

    raw_value = os.getenv(ENV_CONTEXT_IMAGE_WINDOW)
    if raw_value is None or raw_value.strip() == "":
        return DEFAULT_CONTEXT_IMAGE_WINDOW

    try:
        parsed_value = int(raw_value)
    except ValueError:
        logger.warning(
            "Invalid %s=%r; falling back to %s",
            ENV_CONTEXT_IMAGE_WINDOW,
            raw_value,
            DEFAULT_CONTEXT_IMAGE_WINDOW,
        )
        return DEFAULT_CONTEXT_IMAGE_WINDOW
    return parsed_value if parsed_value >= 0 else None
