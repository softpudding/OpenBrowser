"""Example test to verify pytest setup."""

import pytest


def test_framework_setup(sample_fixture):
    """Verify the test framework is properly configured."""
    assert sample_fixture["status"] == "ok"


def test_conversation_id_fixture(mock_conversation_id):
    """Verify the conversation ID fixture works."""
    assert mock_conversation_id == "test-conversation-123"


@pytest.mark.asyncio
async def test_async_support():
    """Verify pytest-asyncio is working."""
    import asyncio

    await asyncio.sleep(0)
    assert True
