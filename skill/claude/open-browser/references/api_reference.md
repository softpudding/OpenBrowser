# OpenBrowser HTTP API

Read this file when you need raw API calls instead of the helper scripts.

## Base URLs

- HTTP: `http://127.0.0.1:8765`
- WebSocket: `ws://127.0.0.1:8766`

## Health and readiness

Check the server:

```bash
curl http://127.0.0.1:8765/health
curl http://127.0.0.1:8765/api
curl http://127.0.0.1:8765/api/config/llm
```

Validate a browser UUID:

```bash
curl http://127.0.0.1:8765/browsers/YOUR_BROWSER_UUID/valid
```

## Conversations

Create a conversation:

```bash
curl -X POST http://127.0.0.1:8765/agent/conversations \
  -H 'Content-Type: application/json' \
  -d '{
    "cwd": ".",
    "browser_id": "YOUR_BROWSER_UUID"
  }'
```

Poll conversation status:

```bash
curl http://127.0.0.1:8765/agent/conversations/CONVERSATION_ID
```

Delete a conversation:

```bash
curl -X DELETE http://127.0.0.1:8765/agent/conversations/CONVERSATION_ID
```

## Submit a task with SSE

```bash
curl -N -X POST http://127.0.0.1:8765/agent/conversations/CONVERSATION_ID/messages \
  -H 'Content-Type: application/json' \
  -H 'Accept: text/event-stream' \
  -d '{
    "text": "Open https://example.com and report the title",
    "cwd": ".",
    "browser_id": "YOUR_BROWSER_UUID"
  }'
```

`browser_id` is required for actual browser control unless the
conversation is already bound to a browser UUID.

## Attaching images to the user message

The `/messages` endpoint accepts an optional `images` array so a
multimodal LLM can see what the user is describing. Each entry is a
dict with these fields:

| field        | required | notes                                        |
|--------------|----------|----------------------------------------------|
| `data_uri`   | yes      | `data:image/...;base64,...` — must start with `data:image/` |
| `mime_type`  | no       | Informational; the server parses it from the URI as well |
| `name`       | no       | Used in the history marker                    |
| `size_bytes` | no       | Populated by helper scripts                   |

Server limits (kept in sync with the frontend): at most 8 images per
message, each at most 10 MB of raw bytes pre-encoding. Exceeding either
returns HTTP 400 with a descriptive `detail`.

```bash
DATA_URI="data:image/png;base64,$(base64 -i /tmp/screenshot.png | tr -d '\n')"
curl -N -X POST http://127.0.0.1:8765/agent/conversations/CONVERSATION_ID/messages \
  -H 'Content-Type: application/json' \
  -H 'Accept: text/event-stream' \
  -d "$(jq -n --arg text "Compare the current page to this screenshot." \
               --arg cwd "." \
               --arg uuid "$OPENBROWSER_CHROME_UUID" \
               --arg uri "$DATA_URI" \
               '{text: $text, cwd: $cwd, browser_id: $uuid, images: [{data_uri: $uri, name: "screenshot.png"}]}')"
```

The `send_task.py` helper handles the base64 + data URI packaging for
you — prefer `--image PATH` over a hand-rolled curl unless you need API-level control.

## Reusing a conversation across turns

To send a follow-up turn to the same browser context (preserving the
agent's recent observations and screenshots), POST to the same
`/messages` URL with the existing `CONVERSATION_ID`. The Claude flavor
of `send_task.py` exposes this via `--conversation-id`.

## Useful event types

- `agent_event`: thoughts, actions, observations, assistant messages,
  and the system prompt (`SystemPromptEvent` is suppressed by default in
  `send_task.py` — pass `--show-system-prompt` to see it)
- `usage_metrics`: model and cost information
- `complete`: terminal completion event

## Proxy gotcha

If your shell sets `HTTP_PROXY` / `HTTPS_PROXY` globally, prefix calls
with `NO_PROXY="127.0.0.1,localhost"` so curl talks to the local server
directly. The Python helper scripts use `urllib` and respect the same
environment variable.
