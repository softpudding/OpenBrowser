/**
 * Dev-only: auto-reload the extension when Vite rebuilds.
 *
 * Connects to a tiny WebSocket server started by the Vite reload plugin
 * (ws://127.0.0.1:8767). On receiving a "reload" message, calls
 * chrome.runtime.reload() to pick up the new build from dist/.
 *
 * This module is only imported when __DEV__ is true, and tree-shaken
 * out of production builds.
 */

const RELOAD_WS_URL = 'ws://127.0.0.1:8767';
const RECONNECT_INTERVAL = 3000;

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function connect() {
  if (ws) return;

  try {
    ws = new WebSocket(RELOAD_WS_URL);

    ws.onopen = () => {
      console.log('🔄 [DevReload] Connected to Vite reload server');
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    ws.onmessage = (event) => {
      if (event.data === 'reload') {
        console.log('🔄 [DevReload] Rebuild detected — reloading extension...');
        chrome.runtime.reload();
      }
    };

    ws.onclose = () => {
      ws = null;
      scheduleReconnect();
    };

    ws.onerror = () => {
      ws?.close();
      ws = null;
    };
  } catch {
    ws = null;
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_INTERVAL);
}

export function initDevReload() {
  console.log('🔄 [DevReload] Initializing dev auto-reload (port 8767)');
  connect();
}
