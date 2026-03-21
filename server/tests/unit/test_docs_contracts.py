"""Contract tests for documentation staying aligned with current code."""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
AGENTS_DOC = REPO_ROOT / "AGENTS.md"
PYPROJECT = REPO_ROOT / "pyproject.toml"
JAVASCRIPT_COMMAND = REPO_ROOT / "extension" / "src" / "commands" / "javascript.ts"


def test_agents_does_not_advertise_removed_cli_surface() -> None:
    """Project docs should not advertise CLI entry points that the package no longer ships."""
    agents_text = AGENTS_DOC.read_text(encoding="utf-8")
    pyproject_text = PYPROJECT.read_text(encoding="utf-8")

    assert '# chrome-cli = "cli.main:main"  # cli directory removed' in pyproject_text
    assert "chrome-cli" not in agents_text
    assert "cli/main.py" not in agents_text


def test_agents_screenshot_behavior_table_is_not_self_contradictory() -> None:
    """Each command should appear with one screenshot behavior in the docs, not both yes and no."""
    agents_text = AGENTS_DOC.read_text(encoding="utf-8")

    contradictory_commands = [
        "tab init",
        "tab open",
        "tab switch",
        "tab refresh",
    ]

    for command in contradictory_commands:
        assert f"| `{command}` | Yes |" not in agents_text or (
            f"| `{command}` | Returns tab info only |" not in agents_text
        )


def test_dialog_docs_do_not_promise_alert_auto_accept_when_javascript_path_defers_it() -> (
    None
):
    """Docs should not promise alert auto-accept if the JavaScript path explicitly defers all dialog handling."""
    agents_text = AGENTS_DOC.read_text(encoding="utf-8")
    javascript_text = JAVASCRIPT_COMMAND.read_text(encoding="utf-8")

    assert "Alert → Auto-accept" not in agents_text or (
        "without auto-accepting even for alerts" not in javascript_text
    )
