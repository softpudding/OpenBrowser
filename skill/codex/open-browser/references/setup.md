# OpenBrowser setup

Read this file only when the local OpenBrowser service is not ready yet.

## What must exist

- Python and project dependencies installed
- Chrome extension built and loaded
- OpenBrowser server running on `127.0.0.1:8765`
- LLM config saved in the OpenBrowser UI
- A valid browser UUID copied from the extension UUID page

## Automated steps

From the repo root:

```bash
uv sync
cd extension
npm install
npm run build
cd ..
uv run local-chrome-server serve
```

## Manual steps for the user

Codex cannot complete these Chrome/UI actions on its own:

1. Open `chrome://extensions/`
2. Enable Developer mode
3. Load unpacked extension from `extension/dist`
4. Copy the browser UUID shown by the extension page
5. Open `http://localhost:8765`
6. Save a valid LLM configuration in Settings

Treat the browser UUID as a capability token. Anyone with that UUID can drive the browser that registered it.

## Quick verification

```bash
python3 skill/codex/open-browser/scripts/check_status.py --chrome-uuid "$OPENBROWSER_CHROME_UUID"
```

Expected outcome:

- server is running
- extension is connected
- LLM config is present
- browser UUID is valid and registered
