/**
 * Dev-only: auto-reload the extension when Vite rebuilds.
 *
 * Connects to a tiny WebSocket server started by the `npm run dev` Vite
 * plugin (ws://127.0.0.1:8767). On receiving a "reload" message, calls
 * chrome.runtime.reload() to pick up the new build from dist/.
 *
 * This module is only imported when __DEV__ is true, and tree-shaken
 * out of production builds.
 *
 * MV3 service workers are killed after ~30s of inactivity. We use both
 * setInterval (fast reconnect while SW is alive) and chrome.alarms
 * (wakes the SW after it has been terminated) to stay connected.
 */

const RELOAD_WS_URL = 'ws://127.0.0.1:8767';
const RECONNECT_INTERVAL_MS = 2000;
const KEEPALIVE_ALARM = 'dev-reload-keepalive';

let ws: WebSocket | null = null;

function connect() {
  if (ws) return;

  try {
    ws = new WebSocket(RELOAD_WS_URL);

    ws.onopen = () => {
      console.log('🔄 [DevReload] Connected to Vite reload server');
    };

    ws.onmessage = (event) => {
      if (event.data === 'reload') {
        console.log('🔄 [DevReload] Rebuild detected — reloading extension...');
        chrome.runtime.reload();
      }
    };

    ws.onclose = () => {
      ws = null;
    };

    ws.onerror = () => {
      ws?.close();
      ws = null;
    };
  } catch {
    ws = null;
  }
}

export function initDevReload() {
  console.log('🔄 [DevReload] Initializing dev auto-reload (port 8767)');

  // Fast reconnect while the service worker is alive
  setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      connect();
    }
  }, RECONNECT_INTERVAL_MS);

  // Alarm-based fallback: wakes the SW even after Chrome terminates it
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === KEEPALIVE_ALARM) {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        connect();
      }
    }
  });

  // Initial connection
  connect();
}
