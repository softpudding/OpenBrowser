"""OpenBrowser-specific condenser tuning."""

from __future__ import annotations

from openhands.sdk import LLM, get_logger
from openhands.sdk.context.condenser import LLMSummarizingCondenser
from openhands.sdk.context.condenser.base import CondenserBase

logger = get_logger(__name__)

DEFAULT_BROWSER_CONDENSER_MAX_SIZE = 1000
DEFAULT_BROWSER_CONDENSER_TOKEN_RATIO = 0.7

# Per-model token caps for models with known long-context attention decay.
# Matched by case-insensitive substring against llm.model so provider
# prefixes (e.g. "dashscope/qwen3.5-flash") and variant suffixes still
# trigger the cap. Session d1395b5d saw qwen3.5-flash lose the original
# user message after ~100 browser events because the condenser's
# context-window-ratio threshold (~700k for a 1M-token model) never fired.
SMALL_MODEL_TOKEN_OVERRIDES: dict[str, int] = {
    "qwen3.5-flash": 100_000,
}


def _small_model_token_override(model: str | None) -> int | None:
    if not model:
        return None
    needle = model.lower()
    for fragment, token_cap in SMALL_MODEL_TOKEN_OVERRIDES.items():
        if fragment.lower() in needle:
            return token_cap
    return None


def derive_browser_condenser_max_tokens(llm: LLM) -> int | None:
    """Derive a token threshold for browser-heavy conversations.

    For models listed in ``SMALL_MODEL_TOKEN_OVERRIDES`` the cap is
    returned directly, regardless of the model's advertised context
    window. Otherwise the threshold is a fraction of the context window.
    """

    override = _small_model_token_override(llm.model)
    if override is not None:
        return override

    max_input_tokens = llm.max_input_tokens
    if not max_input_tokens or max_input_tokens <= 0:
        return None

    max_tokens = int(max_input_tokens * DEFAULT_BROWSER_CONDENSER_TOKEN_RATIO)
    return max_tokens if max_tokens > 0 else None


def configure_browser_condenser(
    condenser: CondenserBase | None,
    llm: LLM,
) -> CondenserBase | None:
    """Prefer token-driven condensation for browser workflows.

    Browser conversations generate many small action/observation events. Keep the
    upstream preset, but raise the event-count guardrail and derive a token limit
    from the model context window so token usage becomes the primary trigger.
    """

    if condenser is None:
        return None

    if not isinstance(condenser, LLMSummarizingCondenser):
        return condenser

    updates: dict[str, int] = {}

    if condenser.max_size < DEFAULT_BROWSER_CONDENSER_MAX_SIZE:
        updates["max_size"] = DEFAULT_BROWSER_CONDENSER_MAX_SIZE

    if condenser.max_tokens is None:
        max_tokens = derive_browser_condenser_max_tokens(llm)
        if max_tokens is not None:
            updates["max_tokens"] = max_tokens

    if not updates:
        return condenser

    configured = condenser.model_copy(update=updates)
    logger.info(
        "Configured browser condenser with max_size=%s and max_tokens=%s",
        configured.max_size,
        configured.max_tokens,
    )
    return configured
