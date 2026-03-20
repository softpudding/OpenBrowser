# Troubleshooting

Common issues and solutions for OpenBrowser.

## Server Issues

### Server Not Running

**Symptom**: `curl http://localhost:8765/health` fails

**Solution**:
```bash
cd ~/git/OpenBrowser
uv run local-chrome-server serve
```

### Port Already in Use

**Symptom**: "Address already in use" error

**Solution**:
```bash
# Find and kill process using port 8765
lsof -i :8765
kill <PID>

# Then restart the server after freeing the port
uv run local-chrome-server serve
```

## Extension Issues

### Extension Not Connected

**Symptom**: `websocket_connected: false`

**Solution**:
1. Open `chrome://extensions/`
2. Verify extension is enabled
3. Click the **refresh** icon on the extension
4. Check Chrome console for errors (F12 → Console)
5. If still failing, rebuild:
   ```bash
   cd ~/git/OpenBrowser/extension
   npm run build
   ```
6. Then refresh the extension in Chrome

### Browser UUID Invalid Or Not Registered

**Symptom**: `Browser UUID: UUID not registered`, `Invalid or expired browser_id`, or tasks fail immediately

**Solution**:
1. Click the extension icon to reopen the UUID page
2. Confirm the page status becomes `UUID Ready`
3. Copy the current UUID again
4. Re-run:
   ```bash
   python3 skill/openclaw/open-browser/scripts/check_status.py --chrome-uuid YOUR_BROWSER_UUID
   ```
5. If needed, refresh the extension and retry

### Extension Not Loading

**Symptom**: "Manifest file is invalid" or similar error

**Solution**:
1. Ensure you selected `extension/dist` folder (not `extension/`)
2. Rebuild the extension:
   ```bash
   cd ~/git/OpenBrowser/extension
   rm -rf dist node_modules
   npm install
   npm run build
   ```
3. Remove and re-add the extension in Chrome

## API Key Issues

### API Key Not Configured

**Symptom**: `has_api_key: false`

**Solution**:
1. Open http://localhost:8765
2. Click ⚙️ Settings
3. Paste your DashScope API key
4. Click Save

### Invalid API Key

**Symptom**: "Authentication failed" or "Invalid API key"

**Solution**:
1. Verify key starts with `sk-`
2. Check key at https://dashscope.aliyun.com/
3. Ensure no extra whitespace in the key
4. Regenerate key if needed

### API Rate Limiting

**Symptom**: "Rate limit exceeded" error

**Solution**:
- Wait and retry
- DashScope has rate limits; check your quota

## Task Issues

### Task Paused Due to Client Disconnect

**Symptom**: Task stops when exec times out

**Solution**: Use `nohup` background mode:
```bash
OPENBROWSER_CHROME_UUID=YOUR_BROWSER_UUID nohup python3 skill/openclaw/open-browser/scripts/send_task.py "task" > /tmp/ob.log 2>&1 &
sleep 120 && cat /tmp/ob.log
```

### Task Stuck

**Symptom**: No progress for extended time

**Solution**:
1. Check server logs:
   ```bash
   tail -f ~/git/OpenBrowser/chrome_server.log
   ```
2. Look for error messages
3. Check browser window - may be waiting for dialog
4. Kill stuck conversation:
   ```bash
   curl -X DELETE http://localhost:8765/agent/conversations/<id>
   ```

### Pop-ups Blocked

**Symptom**: Clicking links doesn't open new tabs

**Solution**:
1. Check address bar for 🚫 icon
2. Click icon → "Always allow pop-ups from [site]"
3. Or allow globally at `chrome://settings/content/popups`

### Element Not Found

**Symptom**: "Could not locate element" error

**Possible causes**:
- Page still loading
- Element is inside iframe
- Element is dynamically generated
- Element is hidden

**Solution**:
- Wait a few seconds and retry the task
- Check for iframes
- Try JavaScript fallback

## Model Issues

### Wrong Model Selected

**Symptom**: Task too slow or too expensive

**Solution**:
- Switch model at http://localhost:8765 → Settings
- Use `qwen3.5-flash` for simple tasks (cheaper)
- Use `qwen3.5-plus` for complex tasks (faster)
