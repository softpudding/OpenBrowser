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
function updateConnectionStatus(connected: boolean): void {
  if (connected) {
    statusBadge.className = 'status-badge connected';
    statusText.textContent = 'Connected';
  } else {
    statusBadge.className = 'status-badge disconnected';
    statusText.textContent = 'Disconnected';
  }
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
 * Start periodic connection checks
 */
function startConnectionChecks(): void {
  // Check immediately
  checkServerConnection().then(updateConnectionStatus);
  
  // Then check every 5 seconds
  connectionCheckInterval = window.setInterval(async () => {
    const connected = await checkServerConnection();
    updateConnectionStatus(connected);
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