# Troubleshooting

Read this file when readiness checks or task execution fail.

## Server is not reachable

Symptoms:
- `check_status.py` reports server failure
- `curl http://127.0.0.1:8765/health` fails

Fix:

```bash
uv run local-chrome-server serve
```

If the port is busy:

```bash
lsof -i :8765
```

## Extension is not connected

Symptoms:
- `websocket_connected` is `false`
- tasks fail before browser automation starts

Fix:

1. Open `chrome://extensions/`
2. Confirm the OpenBrowser extension is enabled
3. Refresh the extension
4. Rebuild `extension/dist` if necessary with `npm run build`

## Browser UUID is invalid

Symptoms:
- `/browsers/<uuid>/valid` returns `valid: false`
- `send_task.py` fails before creating a useful conversation

Fix:

1. Reopen the extension UUID page
2. Copy the current UUID again
3. Export it as `OPENBROWSER_CHROME_UUID` or pass `--chrome-uuid`
4. Re-run `check_status.py`

## LLM config is missing

Symptoms:
- `check_status.py` shows missing config
- the UI has no saved model/API key

Fix:

1. Open `http://localhost:8765`
2. Open Settings
3. Save the model and API key

## Task stalls or runs too long

Fix:

1. Re-run the task with the Bash tool's `run_in_background: true`
   parameter (Claude Code's native pattern). Claude Code will notify you
   on completion — no `sleep` loop required.
2. As a fallback in shell-only environments, use
   `send_task.py --background --output /tmp/openbrowser.log` and inspect
   with `tail -n 80 /tmp/openbrowser.log`.
3. Poll the conversation with `send_task.py --status CONVERSATION_ID`.

## Final assistant message looks cut off

The Claude flavor of `send_task.py` does **not** truncate messages. If
the last `[message:assistant] …` line still looks incomplete, it almost
certainly means the SSE stream ended early — usually because:

- the agent timed out
- the server lost the websocket to the extension
- the conversation was deleted out from under the request

Confirm with `send_task.py --status CONVERSATION_ID` and check
`~/git/OpenBrowser/chrome_server.log`.

## Conversation cleanup

Delete a stuck conversation:

```bash
curl -X DELETE http://127.0.0.1:8765/agent/conversations/CONVERSATION_ID
```
