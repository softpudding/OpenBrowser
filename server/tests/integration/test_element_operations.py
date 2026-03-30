"""Integration tests for element operations.

Tests the REST API endpoints for element operations:
- highlight_elements
- click_element
- keyboard_input

These tests require the server to be running at http://localhost:8765
and the Chrome extension to be connected.
"""

import re
from typing import Any

import pytest
import requests  # type: ignore[import-untyped]

# Server base URL
BASE_URL = "http://localhost:8765"
COMMAND_URL = f"{BASE_URL}/command"


def local_request(method: str, url: str, **kwargs: Any) -> requests.Response:
    """Send a localhost request without inheriting proxy settings."""
    session = requests.Session()
    session.trust_env = False
    return session.request(method, url, **kwargs)


@pytest.fixture
def server_available() -> bool:
    """Check if the server is available for integration tests."""
    try:
        response = local_request("GET", f"{BASE_URL}/health", timeout=2)
        return bool(response.status_code == 200)
    except requests.exceptions.RequestException:
        return False


@pytest.fixture
def managed_tab_id(server_available: bool) -> int:
    """Get a managed tab ID for testing.

    Requires the server to have at least one managed tab open.
    """
    if not server_available:
        pytest.skip("Server not available")

    response = local_request(
        "POST",
        COMMAND_URL,
        json={"type": "get_tabs", "managed_only": True},
        timeout=10,
    )
    data: dict[str, Any] = response.json()

    if data.get("success") and data.get("data", {}).get("tabs"):
        tabs = data["data"]["tabs"]
        tab_id = tabs[0].get("id")
        if tab_id is not None:
            return int(tab_id)

    pytest.skip("No managed tabs available")


@pytest.mark.integration
class TestHighlightElements:
    """Integration tests for highlight_elements command."""

    def test_returns_short_hash_element_ids(
        self, server_available: bool, managed_tab_id: int
    ) -> None:
        """Test that highlight_elements returns short hash element IDs.

        The element IDs should be fixed-width opaque visual-safe hashes.
        """
        if not server_available:
            pytest.skip("Server not available")

        response = local_request(
            "POST",
            COMMAND_URL,
            json={
                "type": "highlight_elements",
                "element_type": "clickable",
                "page": 1,
                "tab_id": managed_tab_id,
            },
            timeout=30,
        )

        assert response.status_code == 200
        data: dict[str, Any] = response.json()

        # Check response success
        assert data.get("success"), f"Command failed: {data.get('error')}"

        # Check elements exist in response
        result_data = data.get("data", {})
        elements = result_data.get("elements", [])

        # If elements exist, verify they use short visual-safe hash IDs.
        if elements:
            for element in elements:
                element_id = element.get("id", "")
                assert re.match(r"^[1-9ACDEFHJKMNOPQRTUVWXY]{3}$", element_id), (
                    "Element ID should be a 3-character visual-safe hash: "
                    f"{element_id}"
                )


@pytest.mark.integration
class TestClickElement:
    """Integration tests for click_element command."""

    def test_matching_tab_id_succeeds(
        self, server_available: bool, managed_tab_id: int
    ) -> None:
        """Test that click_element with matching tab_id succeeds.

        The command should execute without tab_id validation errors
        when the provided tab_id matches a valid managed tab.
        """
        if not server_available:
            pytest.skip("Server not available")

        # First, get elements to click
        highlight_response = local_request(
            "POST",
            COMMAND_URL,
            json={
                "type": "highlight_elements",
                "element_type": "clickable",
                "page": 1,
                "tab_id": managed_tab_id,
            },
            timeout=30,
        )

        highlight_data: dict[str, Any] = highlight_response.json()

        if not highlight_data.get("success"):
            pytest.skip("Could not highlight elements")

        elements = highlight_data.get("data", {}).get("elements", [])
        if not elements:
            pytest.skip("No clickable elements found")

        # Use first element for click test
        element_id = elements[0].get("id")

        # Click with matching tab_id
        click_response = local_request(
            "POST",
            COMMAND_URL,
            json={
                "type": "click_element",
                "element_id": element_id,
                "tab_id": managed_tab_id,
            },
            timeout=30,
        )

        assert click_response.status_code == 200
        click_data: dict[str, Any] = click_response.json()

        # Should succeed (no tab_id validation error)
        assert click_data.get("success"), f"Click failed: {click_data.get('error')}"

        # Error should NOT be about tab_id mismatch
        error_msg = click_data.get("error", "")
        assert "tab_id" not in error_msg.lower() or click_data.get("success")

    def test_mismatched_tab_id_fails(self, server_available: bool) -> None:
        """Test that click_element with non-existent tab_id fails.

        When tab_id doesn't match any valid tab, the command should
        return an error indicating the invalid tab_id.
        """
        if not server_available:
            pytest.skip("Server not available")

        invalid_tab_id = 999999

        response = local_request(
            "POST",
            COMMAND_URL,
            json={
                "type": "click_element",
                "element_id": "A1H",
                "tab_id": invalid_tab_id,
            },
            timeout=30,
        )

        if response.status_code == 200:
            data: dict[str, Any] = response.json()
            assert not data.get("success"), "Expected failure with invalid tab_id"
            error_msg = data.get("error", "").lower()
            assert (
                "tab" in error_msg
                or "not found" in error_msg
                or "invalid" in error_msg
                or "no such" in error_msg
            ), f"Expected tab-related error, got: {data.get('error')}"
        else:
            assert (
                response.status_code == 400
            ), f"Expected 400 for invalid tab_id, got {response.status_code}"


@pytest.mark.integration
class TestKeyboardInput:
    """Integration tests for keyboard_input command."""

    def test_validates_tab_id(
        self, server_available: bool, managed_tab_id: int
    ) -> None:
        """Test that keyboard_input validates tab_id.

        The command should succeed with a valid tab_id and fail
        with an invalid/non-existent tab_id.
        """
        if not server_available:
            pytest.skip("Server not available")

        # First, get inputable elements
        highlight_response = local_request(
            "POST",
            COMMAND_URL,
            json={
                "type": "highlight_elements",
                "element_type": "inputable",
                "page": 1,
                "tab_id": managed_tab_id,
            },
            timeout=30,
        )

        highlight_data: dict[str, Any] = highlight_response.json()

        if not highlight_data.get("success"):
            pytest.skip("Could not highlight inputable elements")

        elements = highlight_data.get("data", {}).get("elements", [])
        if not elements:
            pytest.skip("No inputable elements found")

        # Use first input element
        element_id = elements[0].get("id")

        # Test with valid tab_id - should succeed or fail gracefully
        # (element might not accept input, but no tab_id error)
        valid_response = local_request(
            "POST",
            COMMAND_URL,
            json={
                "type": "keyboard_input",
                "element_id": element_id,
                "text": "test",
                "tab_id": managed_tab_id,
            },
            timeout=30,
        )

        assert valid_response.status_code == 200
        valid_data: dict[str, Any] = valid_response.json()

        # Should not fail due to tab_id issues
        if not valid_data.get("success"):
            error_msg = valid_data.get("error", "").lower()
            # Tab_id validation error should NOT occur with valid tab
            assert "tab_id" not in error_msg or "invalid" not in error_msg

        # Test with invalid tab_id - should fail
        invalid_response = local_request(
            "POST",
            COMMAND_URL,
            json={
                "type": "keyboard_input",
                "element_id": element_id,
                "text": "test",
                "tab_id": 999999,  # Invalid tab_id
            },
            timeout=30,
        )

        assert invalid_response.status_code == 200
        invalid_data: dict[str, Any] = invalid_response.json()

        # Should fail with tab-related error
        assert not invalid_data.get("success"), "Expected failure with invalid tab_id"

        error_msg = invalid_data.get("error", "").lower()
        assert (
            "tab" in error_msg
            or "not found" in error_msg
            or "invalid" in error_msg
            or "no such" in error_msg
        ), f"Expected tab-related error, got: {invalid_data.get('error')}"


@pytest.mark.integration
class TestElementOperationsIntegration:
    """End-to-end integration tests for element operations workflow."""

    def test_full_element_workflow(
        self, server_available: bool, managed_tab_id: int
    ) -> None:
        """Test the complete element interaction workflow.

        1. Highlight elements and get numeric IDs
        2. Verify IDs are in correct format
        3. Click an element with valid tab_id
        """
        if not server_available:
            pytest.skip("Server not available")

        # Step 1: Highlight clickable elements
        highlight_response = local_request(
            "POST",
            COMMAND_URL,
            json={
                "type": "highlight_elements",
                "element_type": "clickable",
                "page": 1,
                "tab_id": managed_tab_id,
            },
            timeout=30,
        )

        assert highlight_response.status_code == 200
        highlight_data: dict[str, Any] = highlight_response.json()
        assert highlight_data.get(
            "success"
        ), f"Highlight failed: {highlight_data.get('error')}"

        elements = highlight_data.get("data", {}).get("elements", [])

        if not elements:
            pytest.skip("No clickable elements found for workflow test")

        # Step 2: Verify element IDs use the short hash format
        element_id = elements[0].get("id")
        assert re.match(
            r"^[1-9ACDEFHJKMNOPQRTUVWXY]{3}$", element_id
        ), f"Invalid element ID format: {element_id}"

        # Step 3: Click with valid tab_id
        click_response = local_request(
            "POST",
            COMMAND_URL,
            json={
                "type": "click_element",
                "element_id": element_id,
                "tab_id": managed_tab_id,
            },
            timeout=30,
        )

        assert click_response.status_code == 200
        click_data: dict[str, Any] = click_response.json()
        assert click_data.get("success"), f"Click failed: {click_data.get('error')}"
