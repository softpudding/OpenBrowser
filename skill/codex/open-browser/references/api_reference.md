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

`browser_id` is required for actual browser control unless the conversation is already bound to a browser UUID.

## Useful event types

- `agent_event`: thoughts, actions, observations, assistant messages
- `usage_metrics`: model and cost information
- `complete`: terminal completion event
