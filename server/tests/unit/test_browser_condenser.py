"""Tests for OpenBrowser-specific condenser tuning."""

from openhands.sdk import LLM
from openhands.sdk.context.condenser import LLMSummarizingCondenser

from server.agent.browser_condenser import (
    DEFAULT_BROWSER_CONDENSER_MAX_SIZE,
    configure_browser_condenser,
    derive_browser_condenser_max_tokens,
)


def test_derive_browser_condenser_max_tokens_from_context_window() -> None:
    llm = LLM.model_construct(model="test-model", max_input_tokens=100_000)

    assert derive_browser_condenser_max_tokens(llm) == 70_000


def test_derive_browser_condenser_max_tokens_returns_none_without_context_window() -> (
    None
):
    llm = LLM.model_construct(model="test-model", max_input_tokens=None)

    assert derive_browser_condenser_max_tokens(llm) is None


def test_configure_browser_condenser_prefers_token_limit() -> None:
    llm = LLM.model_construct(model="test-model", max_input_tokens=100_000)
    condenser = LLMSummarizingCondenser(llm=llm, max_size=80, keep_first=4)

    configured = configure_browser_condenser(condenser, llm)

    assert isinstance(configured, LLMSummarizingCondenser)
    assert configured.max_size == DEFAULT_BROWSER_CONDENSER_MAX_SIZE
    assert configured.max_tokens == 70_000
    assert condenser.max_size == 80
    assert condenser.max_tokens is None


def test_derive_browser_condenser_max_tokens_uses_small_model_override() -> None:
    """Small models with known long-context attention decay get a stricter
    token budget than the 0.7×context_window derivation, even when their
    advertised context window is much larger.

    Rationale: session d1395b5d ran qwen3.5-flash past ~100 events with no
    condensation and watched the model lose track of the original user
    message. The override forces the condenser to kick in earlier for
    these models regardless of advertised context size.
    """
    llm = LLM.model_construct(
        model="dashscope/qwen3.5-flash", max_input_tokens=1_000_000
    )

    assert derive_browser_condenser_max_tokens(llm) == 100_000


def test_derive_browser_condenser_max_tokens_override_matches_model_substring() -> None:
    """The override matches by substring so provider prefixes (litellm
    style like ``dashscope/qwen3.5-flash`` or ``openai/qwen3.5-flash``)
    still trigger the small-model cap.
    """
    for model_name in (
        "qwen3.5-flash",
        "dashscope/qwen3.5-flash",
        "openai/qwen3.5-flash-preview",
    ):
        llm = LLM.model_construct(model=model_name, max_input_tokens=1_000_000)
        assert derive_browser_condenser_max_tokens(llm) == 100_000, model_name


def test_derive_browser_condenser_max_tokens_override_ignores_unrelated_models() -> (
    None
):
    """Models not in the override map keep the 0.7×context_window
    derivation."""
    llm = LLM.model_construct(
        model="dashscope/qwen3.5-plus", max_input_tokens=1_000_000
    )

    assert derive_browser_condenser_max_tokens(llm) == 700_000


def test_configure_browser_condenser_applies_small_model_override() -> None:
    """When the LLM matches a small-model override, ``configure`` must use
    the override value rather than the context-window derivation, even if
    the derivation would give a higher threshold."""
    llm = LLM.model_construct(
        model="dashscope/qwen3.5-flash", max_input_tokens=1_000_000
    )
    condenser = LLMSummarizingCondenser(llm=llm, max_size=80, keep_first=4)

    configured = configure_browser_condenser(condenser, llm)

    assert isinstance(configured, LLMSummarizingCondenser)
    assert configured.max_tokens == 100_000


def test_configure_browser_condenser_preserves_explicit_token_limit() -> None:
    llm = LLM.model_construct(model="test-model", max_input_tokens=100_000)
    condenser = LLMSummarizingCondenser(
        llm=llm,
        max_size=80,
        max_tokens=55_000,
        keep_first=4,
    )

    configured = configure_browser_condenser(condenser, llm)

    assert isinstance(configured, LLMSummarizingCondenser)
    assert configured.max_size == DEFAULT_BROWSER_CONDENSER_MAX_SIZE
    assert configured.max_tokens == 55_000
