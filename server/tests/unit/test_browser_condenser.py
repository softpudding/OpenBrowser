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
