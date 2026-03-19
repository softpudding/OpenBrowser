/**
 * UUID Display Page Script
 * 
 * Displays the browser's UUID with copy and regenerate functionality.
 * Shows connection status to the OpenBrowser server.
 */

import { getOrCreateUUID, storeUUID, clearUUID, generateUUID } from './uuidGenerator';

// DOM Elements
const uuidDisplay = document.getElementById('uuid-display') as HTMLDivElement;
const copyBtn = document.getElementById('copy-btn') as HTMLButtonElement;
const refreshBtn = document.getElementById('refresh-btn') as HTMLButtonElement;
const statusBadge = document.getElementById('status-badge') as HTMLDivElement;
const statusText = document.getElementById('status-text') as HTMLSpanElement;
const toast = document.getElementById('toast') as HTMLDivElement;

// Server connection check
const SERVER_URL = 'http://127.0.0.1:8765';
let connectionCheckInterval: number | null = null;

type BrowserStatus = 'server_unreachable' | 'not_registered' | 'ready';

/**
 * Show a toast notification
 */
function showToast(message: string, type: 'success' | 'error' = 'success'): void {
  toast.textContent = message;
  toast.className = `toast ${type}`;
  
  // Force reflow to restart animation
  void toast.offsetWidth;
  toast.classList.add('show');
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2000);
}

/**
 * Update the connection status UI
 */
function updateConnectionStatus(status: BrowserStatus): void {
  if (status === 'ready') {
    statusBadge.className = 'status-badge connected';
    statusText.textContent = 'UUID Ready';
    return;
  }

  if (status === 'not_registered') {
    statusBadge.className = 'status-badge connecting';
    statusText.textContent = 'Connected, UUID Not Registered';
    return;
  }

  statusBadge.className = 'status-badge disconnected';
  statusText.textContent = 'Server Unreachable';
}

/**
 * Ask the background worker to bind the current UUID to the active websocket
 * connection so the server can route commands to this exact browser.
 */
async function requestBrowserRegistration(): Promise<boolean> {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'openbrowser:register-browser-identity',
    }) as { success?: boolean; error?: string } | undefined;

    if (response?.success) {
      showToast('Browser UUID registered with server', 'success');
      return true;
    }

    if (response?.error) {
      console.warn('Browser registration skipped:', response.error);
    }
  } catch (error) {
    console.warn('Failed to request browser registration:', error);
  }

  return false;
}

/**
 * Check server connection status
 */
async function checkServerConnection(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    
    const response = await fetch(`${SERVER_URL}/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Check if the current UUID is registered and valid on the server.
 */
async function checkBrowserRegistration(uuid: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    const response = await fetch(`${SERVER_URL}/browsers/${encodeURIComponent(uuid)}/valid`, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return false;
    }

    const data = await response.json() as { valid?: boolean };
    return data.valid === true;
  } catch {
    return false;
  }
}

/**
 * Evaluate the full browser connectivity state:
 * 1. Can the server be reached?
 * 2. Is this UUID registered on that server?
 */
async function refreshBrowserStatus(options: { tryRegister?: boolean } = {}): Promise<void> {
  const uuid = uuidDisplay.textContent?.trim();
  const serverReachable = await checkServerConnection();

  if (!serverReachable) {
    updateConnectionStatus('server_unreachable');
    return;
  }

  if (!uuid || uuid === 'Loading...' || uuid === 'Error loading UUID') {
    updateConnectionStatus('not_registered');
    return;
  }

  let isRegistered = await checkBrowserRegistration(uuid);

  if (!isRegistered && options.tryRegister) {
    const registeredNow = await requestBrowserRegistration();
    if (registeredNow) {
      isRegistered = await checkBrowserRegistration(uuid);
    }
  }

  updateConnectionStatus(isRegistered ? 'ready' : 'not_registered');
}

/**
 * Start periodic connection checks
 */
function startConnectionChecks(): void {
  // Check immediately
  refreshBrowserStatus({ tryRegister: true });
  
  // Then check every 5 seconds
  connectionCheckInterval = window.setInterval(async () => {
    await refreshBrowserStatus();
  }, 5000);
}

/**
 * Load and display the UUID
 */
async function loadUUID(): Promise<void> {
  try {
    uuidDisplay.textContent = 'Loading...';
    uuidDisplay.classList.add('loading');
    
    const uuid = await getOrCreateUUID();
    
    uuidDisplay.textContent = uuid;
    uuidDisplay.classList.remove('loading');
    
    // Enable buttons
    copyBtn.disabled = false;
    refreshBtn.disabled = false;
  } catch (error) {
    console.error('Failed to load UUID:', error);
    uuidDisplay.textContent = 'Error loading UUID';
    uuidDisplay.classList.add('loading');
    showToast('Failed to load UUID', 'error');
  }
}

/**
 * Copy UUID to clipboard
 */
async function copyToClipboard(): Promise<void> {
  const uuid = uuidDisplay.textContent;
  
  if (!uuid || uuid === 'Loading...' || uuid === 'Error loading UUID') {
    showToast('No UUID to copy', 'error');
    return;
  }
  
  try {
    await navigator.clipboard.writeText(uuid);
    showToast('UUID copied to clipboard', 'success');
    
    // Visual feedback on button
    const originalText = copyBtn.innerHTML;
    copyBtn.innerHTML = `
      <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
      Copied!
    `;
    
    setTimeout(() => {
      copyBtn.innerHTML = originalText;
    }, 1500);
  } catch (error) {
    console.error('Failed to copy UUID:', error);
    showToast('Failed to copy UUID', 'error');
  }
}

/**
 * Regenerate the UUID
 */
async function regenerateUUID(): Promise<void> {
  // Disable buttons during operation
  copyBtn.disabled = true;
  refreshBtn.disabled = true;
  
  try {
    // Clear existing UUID
    await clearUUID();
    
    // Generate and store new UUID
    const newUUID = generateUUID();
    await storeUUID(newUUID);
    
    // Update display
    uuidDisplay.textContent = newUUID;
    
    await refreshBrowserStatus({ tryRegister: true });
    showToast('UUID regenerated', 'success');
  } catch (error) {
    console.error('Failed to regenerate UUID:', error);
    showToast('Failed to regenerate UUID', 'error');
  } finally {
    // Re-enable buttons
    copyBtn.disabled = false;
    refreshBtn.disabled = false;
  }
}

/**
 * Initialize the page
 */
async function init(): Promise<void> {
  // Load UUID
  await loadUUID();
  
  // Start connection checks
  startConnectionChecks();
  
  // Set up event listeners
  copyBtn.addEventListener('click', copyToClipboard);
  refreshBtn.addEventListener('click', regenerateUUID);
  
  // Clean up on page unload
  window.addEventListener('beforeunload', () => {
    if (connectionCheckInterval !== null) {
      clearInterval(connectionCheckInterval);
    }
  });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
