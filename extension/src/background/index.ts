/**
 * Background Script - Main entry point for Chrome extension (Strict Mode)
 *
 * All commands require conversation_id to be provided by server.
 * No default fallback behavior.
 */

import { wsClient } from '../websocket/client';
import {
  captureScreenshot,
  compressIfNeeded,
  getCompressionThreshold,
} from '../commands/screenshot';
import { DialogBlockedError } from '../commands/screenshot';
import { DialogType } from '../commands/dialog';
import { tabs } from '../commands/tabs';
import { tabManager } from '../commands/tab-manager';
import { javascript } from '../commands/javascript';
import { debuggerSessionManager } from '../commands/debugger-manager';
import { dialogManager } from '../commands/dialog';
import { extractGroundedElements } from '../commands/grounded-elements';
import { handleGetAccessibilityTree } from '../commands/accessibility';
import { clearScreenshotCache } from '../commands/computer';

import { drawHighlights } from '../commands/visual-highlight';
import { highlightSingleElement } from '../commands/single-highlight';
import { elementCache } from '../commands/element-cache';
import { assignSequentialElementIds } from '../commands/element-id';
import {
  buildHighlightDetectionScript,
  filterHighlightElementsByKeywords,
  normalizeHighlightKeywords,
} from '../commands/highlight-detection';
import {
  performElementClick,
  performElementHover,
  performElementScroll,
  performElementSwipe,
  performKeyboardInput,
  performElementSelect,
} from '../commands/element-actions';
import {
  LABEL_FONT_SIZE,
  LABEL_PADDING,
  LABEL_HEIGHT,
  MAX_LABEL_WIDTH,
} from '../commands/label-constants';
import { getOrCreateUUID } from '../uuid/uuidGenerator';
import {
  selectCollisionFreePage,
  calculateTotalPages,
  sortElementsByVisualOrder,
} from '../utils/collision-detection';
import {
  HIGHLIGHT_CONSISTENCY_CONFIG,
  evaluateHighlightConsistency,
  isRepeatedHighlightDrift,
  type HighlightConsistencyResult,
} from '../utils/highlight-consistency';
import {
  getHighlightReadinessRetryDelay,
  type HighlightPageState,
} from '../utils/layout-stability';
import {
  HIGHLIGHT_SCREENSHOT_CAPTURE_OPTIONS,
  TAB_VIEW_SCREENSHOT_CAPTURE_OPTIONS,
} from '../utils/highlight-screenshot';
import type { Command, CommandResponse, InteractiveElement } from '../types';
console.log('🚀 OpenBrowser extension starting (Strict Mode)...');

const SERVER_HTTP_URL = 'http://127.0.0.1:8765';
let currentConnectionId: string | null = null;

async function compressScreenshotResult<T extends { imageData?: string }>(
  screenshotResult: T | null | undefined,
): Promise<T | null | undefined> {
  if (!screenshotResult?.imageData) {
    return screenshotResult;
  }

  const compressedResult = await compressIfNeeded(
    screenshotResult,
    getCompressionThreshold(),
  );

  return (compressedResult as T | null | undefined) ?? screenshotResult;
}

function buildStoredHighlightPages(options: {
  filteredElements: InteractiveElement[];
  totalPages: number;
  viewportWidth: number;
  viewportHeight: number;
  keywordMode: boolean;
}): InteractiveElement[][] {
  const {
    filteredElements,
    totalPages,
    viewportWidth,
    viewportHeight,
    keywordMode,
  } = options;

  if (keywordMode) {
    return [
      assignSequentialElementIds(
        sortElementsByVisualOrder(assignSequentialElementIds(filteredElements)),
      ),
    ];
  }

  const pages: InteractiveElement[][] = [];
  for (let page = 1; page <= totalPages; page++) {
    const pageElements = selectCollisionFreePage(
      filteredElements,
      page,
      viewportWidth,
      viewportHeight,
    );
    pages.push(assignSequentialElementIds(sortElementsByVisualOrder(pageElements)));
  }

  return pages;
}

function buildSnapshotPageRefreshScript(options: {
  elements: InteractiveElement[];
  expectedDocumentId?: string;
}): string {
  const { elements, expectedDocumentId } = options;
  const refreshTargets = elements.map((element) => ({
    id: element.id,
    selector: element.selector,
    fingerprint: element.fingerprint || '',
  }));

  return `
    (() => {
      const expectedDocumentId = ${JSON.stringify(expectedDocumentId || '')};
      const refreshTargets = ${JSON.stringify(refreshTargets)};

      function normalizeIdentityWhitespace(value, maxLength = 240) {
        const normalized = String(value ?? '')
          .replace(/\\s+/g, ' ')
          .trim();
        return normalized.slice(0, maxLength).toLowerCase();
      }

      function getIdentityAttributeTokens(el, attributeNames) {
        const tokens = [];
        for (const attributeName of attributeNames) {
          const value = el.getAttribute(attributeName);
          if (!value) {
            continue;
          }

          const normalized = normalizeIdentityWhitespace(value, 80);
          if (normalized) {
            tokens.push(normalized);
          }
        }
        return tokens;
      }

      function getIdentityClassTokens(el) {
        return Array.from(el.classList)
          .filter(
            (token) =>
              token.length > 1 &&
              token.length <= 40 &&
              /^[a-z0-9_-]+$/i.test(token),
          )
          .slice(0, 4)
          .map((token) => token.toLowerCase());
      }

      function getElementTextForIdentity(el) {
        if (el instanceof HTMLInputElement) {
          const inputType = (el.type || '').toLowerCase();
          if (
            inputType === 'button' ||
            inputType === 'submit' ||
            inputType === 'reset'
          ) {
            return normalizeIdentityWhitespace(el.value, 120);
          }
        }

        return normalizeIdentityWhitespace(el.textContent || '', 160);
      }

      function getCurrentDocumentId() {
        return \`\${Math.trunc(performance.timeOrigin)}|\${location.href}\`;
      }

      function getElementFingerprint(el) {
        const tokens = [
          el.tagName.toLowerCase(),
          ...getIdentityAttributeTokens(el, [
            'role',
            'type',
            'name',
            'id',
            'aria-label',
            'title',
            'placeholder',
            'data-testid',
            'data-test-id',
          ]),
          ...getIdentityClassTokens(el),
        ];

        const text = getElementTextForIdentity(el);
        if (text) {
          tokens.push(text);
        }

        return normalizeIdentityWhitespace(tokens.join(' | '), 240);
      }

      function splitFingerprintTokens(value) {
        return Array.from(
          new Set(
            String(value ?? '')
              .toLowerCase()
              .split(/[^a-z0-9]+/i)
              .filter((token) => token.length > 1),
          ),
        );
      }

      function fingerprintsLookCompatible(expected, current) {
        if (!expected || !current) {
          return true;
        }
        if (expected === current) {
          return true;
        }

        const expectedTokens = splitFingerprintTokens(expected);
        const currentTokens = new Set(splitFingerprintTokens(current));
        if (expectedTokens.length === 0) {
          return true;
        }

        let overlap = 0;
        for (const token of expectedTokens) {
          if (currentTokens.has(token)) {
            overlap += 1;
          }
        }

        return overlap >= Math.max(2, Math.min(4, Math.ceil(expectedTokens.length * 0.5)));
      }

      const currentDocumentId = getCurrentDocumentId();
      if (expectedDocumentId && currentDocumentId !== expectedDocumentId) {
        return {
          ok: false,
          stale: true,
          error:
            'Highlight snapshot is stale because the document changed. Call highlight_elements() again.',
        };
      }

      const refreshed = [];
      for (const target of refreshTargets) {
        let el = null;
        try {
          el = document.querySelector(target.selector);
        } catch (error) {
          return {
            ok: false,
            stale: true,
            error:
              'Highlight snapshot is stale because a cached selector is no longer valid. Call highlight_elements() again.',
          };
        }

        if (!el) {
          return {
            ok: false,
            stale: true,
            error:
              'Highlight snapshot is stale because a highlighted element disappeared. Call highlight_elements() again.',
          };
        }

        const currentFingerprint = getElementFingerprint(el);
        if (
          !fingerprintsLookCompatible(target.fingerprint, currentFingerprint)
        ) {
          return {
            ok: false,
            stale: true,
            error:
              'Highlight snapshot is stale because highlighted element identities changed. Call highlight_elements() again.',
          };
        }

        const rect = el.getBoundingClientRect();
        refreshed.push({
          id: target.id,
          bbox: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
        });
      }

      return {
        ok: true,
        refreshed,
      };
    })();
  `;
}

async function renderHighlightSnapshotPage(options: {
  tabId: number;
  conversationId: string;
  elements: InteractiveElement[];
  totalElements: number;
  totalPages: number;
  page: number;
  highlightSnapshotId: number;
  expectedDocumentId?: string;
  pageState: HighlightPageState | 'snapshot_reused';
  readinessReasons: string[];
}): Promise<CommandResponse> {
  const {
    tabId,
    conversationId,
    elements,
    totalElements,
    totalPages,
    page,
    highlightSnapshotId,
    expectedDocumentId,
    pageState,
    readinessReasons,
  } = options;

  let renderElements = elements;
  const refreshResult = await javascript.executeJavaScript(
    tabId,
    conversationId,
    buildSnapshotPageRefreshScript({
      elements,
      expectedDocumentId,
    }),
    true,
    false,
    2500,
  );
  const refreshPayload = refreshResult.result?.value;

  if (refreshResult.success && refreshPayload?.ok) {
    const refreshedById = new Map<
      string,
      {
        bbox: {
          x: number;
          y: number;
          width: number;
          height: number;
        };
      }
    >(
      Array.isArray(refreshPayload.refreshed)
        ? refreshPayload.refreshed
            .filter(
              (
                refreshedElement: unknown,
              ): refreshedElement is {
                id: string;
                bbox: {
                  x: number;
                  y: number;
                  width: number;
                  height: number;
                };
              } =>
                typeof refreshedElement === 'object' &&
                refreshedElement !== null &&
                'id' in refreshedElement &&
                'bbox' in refreshedElement,
            )
            .map((refreshedElement) => [
              refreshedElement.id,
              { bbox: refreshedElement.bbox },
            ])
        : [],
    );

    renderElements = elements.map((element) => ({
      ...element,
      bbox: refreshedById.get(element.id)?.bbox || element.bbox,
    }));
  } else if (
    refreshResult.success &&
    refreshPayload &&
    refreshPayload.ok === false
  ) {
    return {
      success: false,
      error:
        refreshPayload.error ||
        `Highlight snapshot ${highlightSnapshotId} is stale. Call highlight_elements() again.`,
      timestamp: Date.now(),
    };
  } else if (!refreshResult.success) {
    console.warn(
      `⚠️ [HighlightElements] Failed to refresh cached snapshot ${highlightSnapshotId} before rendering page ${page}: ${refreshResult.error || 'unknown error'}`,
    );
  }

  const screenshotResult = await captureScreenshot(
    tabId,
    conversationId,
    true,
    90,
    false,
    0,
    HIGHLIGHT_SCREENSHOT_CAPTURE_OPTIONS,
  );

  if (!screenshotResult?.success || !screenshotResult?.imageData) {
    return {
      success: false,
      error: `Failed to capture screenshot: ${screenshotResult?.success === false ? 'Screenshot command failed' : 'No image data returned'}`,
      timestamp: Date.now(),
    };
  }

  const imageScale =
    screenshotResult.metadata?.imageScale ||
    screenshotResult.metadata?.devicePixelRatio ||
    1;
  const viewportWidth = screenshotResult.metadata?.viewportWidth || 0;
  const viewportHeight = screenshotResult.metadata?.viewportHeight || 0;

  const highlightedScreenshot = await drawHighlights(
    screenshotResult.imageData,
    renderElements,
    {
      scale: imageScale,
      viewportWidth,
      viewportHeight,
    },
  );
  const compressedScreenshot = await compressIfNeeded(
    highlightedScreenshot,
    getCompressionThreshold(),
  );

  return {
    success: true,
    data: {
      highlight_snapshot_id: highlightSnapshotId,
      elements: renderElements,
      totalElements,
      totalPages,
      page,
      pageState,
      readinessReasons,
      screenshot: compressedScreenshot,
      ...(screenshotResult?.dialog_auto_accepted
        ? {
            dialog_auto_accepted: screenshotResult.dialog_auto_accepted,
          }
        : {}),
      ...(screenshotResult?.dialog_auto_accepted_list
        ? {
            dialog_auto_accepted_list:
              screenshotResult.dialog_auto_accepted_list,
          }
        : {}),
    },
    timestamp: Date.now(),
  };
}

function buildHighlightConsistencyScript(
  elements: InteractiveElement[],
): string {
  const samples = elements
    .slice(0, HIGHLIGHT_CONSISTENCY_CONFIG.maxSampleSize)
    .map((element) => ({
      id: element.id,
      selector: element.selector,
      bbox: element.bbox,
    }));

  return `
    (() => {
      const samples = ${JSON.stringify(samples)};

      function getBBox(el) {
        const rect = el.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
      }

      return {
        samples: samples.flatMap((sample) => {
          try {
            const el = document.querySelector(sample.selector);
            if (!el) {
              return [];
            }

            return [{
              id: sample.id,
              bbox: getBBox(el),
            }];
          } catch (error) {
            return [];
          }
        }),
      };
    })();
  `;
}

function cleanupTabState(conversationId: string, tabId: number): void {
  elementCache.invalidate(conversationId, tabId);
  dialogManager.disableForTab(tabId);
  clearScreenshotCache(tabId);
}

// ============================================================================
// Command Queue Management System
// ============================================================================

/**
 * Command queue item interface
 */
interface QueuedCommand {
  data: any;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  addedAt: number;
}

/**
 * Command Queue Manager
 * Prevents command stacking and ensures proper flow control
 */
class CommandQueueManager {
  private queue: QueuedCommand[] = [];
  private isProcessing = false;
  private commandCooldown = 1000; // 1 second cooldown between commands
  private lastCommandEndTime = 0;
  private performanceHistory: Array<{
    type: string;
    duration: number;
    timestamp: number;
  }> = [];
  private readonly maxHistory = 20;

  /**
   * Add command to queue
   */
  async enqueue(data: any): Promise<any> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        data,
        resolve,
        reject,
        addedAt: Date.now(),
      });

      // Start processing if not already processing
      if (!this.isProcessing) {
        this.processQueue();
      }

      // Log queue status
      if (this.queue.length > 3) {
        console.warn(
          `⚠️ Command queue growing: ${this.queue.length} commands pending`,
        );
      }
    });
  }

  /**
   * Process the command queue
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const queuedCommand = this.queue.shift()!;
      const waitTime = Date.now() - queuedCommand.addedAt;

      // Warn about long wait times
      if (waitTime > 5000) {
        console.warn(
          `⌛ Command waited ${waitTime}ms in queue before processing`,
        );
      }

      try {
        // Apply cooldown between commands if needed
        const timeSinceLastCommand = Date.now() - this.lastCommandEndTime;
        if (timeSinceLastCommand < this.commandCooldown) {
          const cooldownDelay = this.commandCooldown - timeSinceLastCommand;
          console.log(`⏸️ Command cooldown: waiting ${cooldownDelay}ms`);
          await new Promise((resolve) => setTimeout(resolve, cooldownDelay));
        }

        // Process the command
        const result = await this.processCommand(queuedCommand.data);
        queuedCommand.resolve(result);

        // Update last command end time
        this.lastCommandEndTime = Date.now();
      } catch (error) {
        queuedCommand.reject(error as Error);
        this.lastCommandEndTime = Date.now();
      }
    }

    this.isProcessing = false;
  }

  /**
   * Process individual command (original command handling logic)
   * Public method so watchdog can wrap it
   */
  public async processCommand(data: any): Promise<any> {
    // This is the original command handling logic from wsClient.onMessage
    const commandId = data.command_id || `unknown_${Date.now()}`;
    const commandType = data.type || 'unknown';
    const commandStartTime = Date.now();

    // Track command execution
    wsClient.trackCommandStart(commandId, commandType, {
      conversation_id: data.conversation_id,
      action: data.action,
      tab_id: data.tab_id,
      url: data.url,
    });

    try {
      const response = await handleCommand(data as Command);
      const commandDuration = Date.now() - commandStartTime;

      // Record performance
      this.recordPerformance(commandType, commandDuration);

      // Warn about long-running commands
      if (commandDuration > 10000) {
        console.warn(
          `⚠️ Long command execution: ${commandType} took ${commandDuration}ms`,
        );
      }

      // Send response back to server
      if (wsClient.isConnected()) {
        const responseWithId = {
          ...response,
          command_id: data.command_id,
          timestamp: Date.now(),
        };

        wsClient
          .sendMessage({
            type: 'command_response',
            ...responseWithId,
          })
          .catch((error) => {
            console.error('Failed to send response:', error);
          });
      }

      return response;
    } catch (error) {
      console.error('Error handling command:', error);
      const commandDuration = Date.now() - commandStartTime;

      // Send error response
      const errorResponse: CommandResponse = {
        success: false,
        command_id: data.command_id,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now(),
      };

      if (wsClient.isConnected()) {
        wsClient
          .sendMessage({ type: 'command_response', ...errorResponse })
          .catch(console.error);
      }

      if (commandDuration > 10000) {
        console.warn(
          `⚠️ Long failed command: ${commandType} failed after ${commandDuration}ms`,
        );
      }

      throw error;
    } finally {
      // End command tracking
      wsClient.trackCommandEnd(commandId);
    }
  }

  /**
   * Record command performance for monitoring
   */
  private recordPerformance(type: string, duration: number): void {
    this.performanceHistory.push({
      type,
      duration,
      timestamp: Date.now(),
    });

    if (this.performanceHistory.length > this.maxHistory) {
      this.performanceHistory.shift();
    }

    // Detect performance degradation
    if (this.performanceHistory.length >= 5) {
      const recent = this.performanceHistory.slice(-5);
      const avgDuration =
        recent.reduce((sum, cmd) => sum + cmd.duration, 0) / recent.length;

      if (avgDuration > 5000) {
        console.warn(
          `📉 Performance degradation detected: avg command time ${avgDuration.toFixed(0)}ms`,
        );

        // Adaptive cooldown adjustment
        if (avgDuration > 10000) {
          this.commandCooldown = 2000; // Increase to 2 seconds
          console.log(
            `⚙️ Increased command cooldown to ${this.commandCooldown}ms`,
          );
        }
      } else if (avgDuration < 1000 && this.commandCooldown > 1000) {
        // Reset cooldown if performance improves
        this.commandCooldown = 1000;
        console.log(`⚙️ Reset command cooldown to ${this.commandCooldown}ms`);
      }
    }
  }

  /**
   * Get queue status
   */
  getStatus() {
    return {
      queueLength: this.queue.length,
      isProcessing: this.isProcessing,
      lastCommandEndTime: this.lastCommandEndTime,
      performanceHistory: [...this.performanceHistory],
    };
  }

  /**
   * Clear queue (emergency cleanup)
   */
  clearQueue(): void {
    console.warn(
      `🧹 Clearing command queue with ${this.queue.length} pending commands`,
    );

    for (const queuedCommand of this.queue) {
      queuedCommand.reject(new Error('Command queue cleared'));
    }

    this.queue = [];
    this.isProcessing = false;
  }
}

// Initialize command queue manager
const commandQueue = new CommandQueueManager();

// ============================================================================
// Watchdog Timer for Main Thread Freeze Detection
// ============================================================================

/**
 * Watchdog timer detects when main thread is frozen
 */
class WatchdogTimer {
  private lastCheckTime = Date.now();
  private watchdogInterval: number | null = null;
  private readonly CHECK_INTERVAL = 3000; // Check every 3 seconds
  private readonly FREEZE_THRESHOLD = 5000; // 5 seconds without check = frozen

  start(): void {
    console.log('🔍 Watchdog timer started');

    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
    }

    this.lastCheckTime = Date.now();

    this.watchdogInterval = setInterval(() => {
      const now = Date.now();
      const timeSinceLastCheck = now - this.lastCheckTime;

      if (timeSinceLastCheck > this.FREEZE_THRESHOLD) {
        console.error(
          `🚨 WATCHDOG: Main thread may be frozen! No check for ${timeSinceLastCheck}ms`,
        );

        // Emergency cleanup if main thread appears frozen
        this.emergencyCleanup();
      }

      this.lastCheckTime = now;
    }, this.CHECK_INTERVAL) as unknown as number;
  }

  stop(): void {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
      console.log('🔍 Watchdog timer stopped');
    }
  }

  tick(): void {
    this.lastCheckTime = Date.now();
  }

  private emergencyCleanup(): void {
    console.warn('🆘 Watchdog emergency cleanup initiated');

    // Clear command queue to free up resources
    commandQueue.clearQueue();

    // Try to send heartbeat if WebSocket is still connected
    if (wsClient.isConnected()) {
      try {
        // Try to send immediate ping
        wsClient.sendMessage({ type: 'ping' }).catch(() => {
          // Ignore errors during emergency
        });
      } catch (error) {
        // Ignore errors during emergency cleanup
      }
    }
  }

  getStatus() {
    return {
      lastCheckTime: this.lastCheckTime,
      timeSinceLastCheck: Date.now() - this.lastCheckTime,
      isRunning: this.watchdogInterval !== null,
    };
  }
}

// Initialize watchdog timer
const watchdog = new WatchdogTimer();
watchdog.start();

// Update watchdog on each command processing - wrap the processCommand method
const originalProcessCommand = commandQueue.processCommand.bind(commandQueue);
commandQueue.processCommand = async function (data: any) {
  watchdog.tick();
  return originalProcessCommand(data);
};

// ============================================================================

// Initialize tab manager
tabManager
  .initialize()
  .then(() => {
    console.log('✅ Tab manager initialized');
  })
  .catch((error) => {
    console.error('❌ Failed to initialize tab manager:', error);
  });

// Initialize WebSocket connection
wsClient
  .connect()
  .then(() => {
    tabManager.updateStatus('idle');
    console.log('🌐 WebSocket connected, tab manager status updated');
  })
  .catch((error) => {
    console.error('Failed to connect to WebSocket server:', error);
    tabManager.updateStatus('disconnected');
  });

// Listen for WebSocket disconnection
wsClient.onDisconnect(() => {
  console.log('🌐 WebSocket disconnected, updating tab manager status');
  currentConnectionId = null;
  tabManager.updateStatus('disconnected');
});

// Listen for commands from WebSocket server
wsClient.onMessage(async (data) => {
  // Only handle command messages (not responses or server messages)
  if (data.type && !data.success && !data.error) {
    // Skip server messages that are not commands
    if (
      data.type === 'connected' ||
      data.type === 'ping' ||
      data.type === 'pong'
    ) {
      if (data.type === 'connected') {
        currentConnectionId =
          typeof data.connection_id === 'string' ? data.connection_id : null;

        if (currentConnectionId) {
          registerBrowserIdentity(currentConnectionId).catch((error) => {
            console.error('❌ Failed to register browser identity:', error);
          });
        }
      }
      console.log(
        `📨 Received server message: ${data.type}`,
        data.message || '',
      );
      return;
    }

    // Log command receipt
    const commandType = data.type || 'unknown';
    const commandId = data.command_id || `unknown_${Date.now()}`;
    console.log(`📨 Received command: ${commandType} (ID: ${commandId})`);

    // Add command to queue for processing
    try {
      await commandQueue.enqueue(data);
      console.log(
        `✅ Command ${commandType} (ID: ${commandId}) processed successfully`,
      );
    } catch (error) {
      console.error(
        `❌ Command ${commandType} (ID: ${commandId}) failed:`,
        error,
      );

      // Send error response if still connected
      if (wsClient.isConnected()) {
        const errorResponse: CommandResponse = {
          success: false,
          command_id: data.command_id,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: Date.now(),
        };
        wsClient
          .sendMessage({ type: 'command_response', ...errorResponse })
          .catch(console.error);
      }
    }
  }
});

async function openUuidPage(): Promise<void> {
  const uuidPageUrl = chrome.runtime.getURL('uuid/uuidPage.html');
  await chrome.tabs.create({ url: uuidPageUrl, active: true });
}

async function registerBrowserIdentity(connectionId: string): Promise<void> {
  const browserUuid = await getOrCreateUUID();
  const response = await fetch(`${SERVER_HTTP_URL}/browsers/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      uuid: browserUuid,
      connection_id: connectionId,
      ttl_hours: 24,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Browser registration failed (${response.status}): ${errorText || response.statusText}`,
    );
  }

  console.log(`🔐 Browser UUID registered successfully: ${browserUuid}`);
}

chrome.runtime.onInstalled.addListener(() => {
  openUuidPage().catch((error) => {
    console.error('❌ Failed to open UUID page on install:', error);
  });
});

chrome.action.onClicked.addListener(() => {
  openUuidPage().catch((error) => {
    console.error('❌ Failed to open UUID page from action click:', error);
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'openbrowser:register-browser-identity') {
    return false;
  }

  if (!currentConnectionId) {
    sendResponse({
      success: false,
      error: 'Extension is not connected to the OpenBrowser server yet.',
    });
    return false;
  }

  registerBrowserIdentity(currentConnectionId)
    .then(() => {
      sendResponse({ success: true });
    })
    .catch((error) => {
      sendResponse({
        success: false,
        error:
          error instanceof Error ? error.message : 'Unknown registration error',
      });
    });

  return true;
});

/**
 * Handle incoming commands (Strict Mode)
 * All commands require conversation_id to be provided by server.
 */
async function handleCommand(command: Command): Promise<CommandResponse> {
  console.log(`📨 Handling command: ${command.type}`, command);

  try {
    switch (command.type) {
      case 'screenshot': {
        // ✅ STRICT MODE: conversation_id is REQUIRED
        if (!command.conversation_id) {
          throw new Error(
            'conversation_id is required for screenshot command (strict mode)',
          );
        }

        const conversationId = command.conversation_id;

        // Always use current active tab for the conversation (ignore tab_id if provided)
        const activeTabId = tabManager.getCurrentActiveTabId(conversationId);
        if (!activeTabId) {
          throw new Error(
            `No active tab found for conversation ${conversationId}. Use tab init or specify tab_id.`,
          );
        }

        console.log(
          `📸 [Screenshot] Using active tab ${activeTabId} for conversation ${conversationId} (ignoring provided tab_id: ${command.tab_id || 'none'})`,
        );

        console.log(
          `📸 [Screenshot] Starting for tab ${activeTabId}, conversation: ${conversationId}`,
        );

        // Ensure tab is managed by tab manager for this conversation
        await tabManager.ensureTabManaged(activeTabId, conversationId);
        tabManager.updateTabActivity(activeTabId, conversationId);

        // Take screenshot in background (no tab activation)
        const screenshotResult = await captureScreenshot(
          activeTabId,
          conversationId,
          command.include_cursor !== false,
          command.quality || 90,
          false, // resizeToPreset: false for WYSIWYG mode
          0, // waitForRender
        );
        const compressedScreenshotResult =
          await compressScreenshotResult(screenshotResult);

        console.log(`✅ [Screenshot] Completed for tab ${activeTabId}`);

        return {
          success: true,
          message: 'Screenshot captured',
          data: compressedScreenshotResult,
          timestamp: Date.now(),
        };
      }

      case 'tab': {
        // ✅ STRICT MODE: conversation_id is REQUIRED
        if (!command.conversation_id) {
          throw new Error(
            'conversation_id is required for tab command (strict mode)',
          );
        }
        const conversationId = command.conversation_id;
        console.log(`🔍 [Tab Command] conversation_id: "${conversationId}"`);

        switch (command.action) {
          case 'init':
            if (!command.url) {
              throw new Error('URL is required for init action');
            }
            const initResult = await tabManager.initializeSession(
              command.url,
              conversationId,
            );

            console.log(
              `🚀 [Tab Init] Session ${conversationId} initialized with tab ${initResult.tabId}`,
            );

            // Set the newly created tab as active
            tabManager.setCurrentActiveTabId(conversationId, initResult.tabId);

            // Capture screenshot after initialization
            const initScreenshotResult = await captureScreenshot(
              initResult.tabId,
              conversationId,
              true,
              90,
              false,
              0,
            );
            const compressedInitScreenshotResult =
              await compressScreenshotResult(initScreenshotResult);

            return {
              success: true,
              message: `Session ${conversationId} initialized with ${command.url}`,
              data: {
                tabId: initResult.tabId,
                groupId: initResult.groupId,
                url: initResult.url,
                conversationId: conversationId,
                isManaged: true,
                screenshot: compressedInitScreenshotResult?.imageData,
                ...(compressedInitScreenshotResult?.dialog_auto_accepted
                  ? {
                      dialog_auto_accepted:
                        compressedInitScreenshotResult.dialog_auto_accepted,
                    }
                  : {}),
                ...(compressedInitScreenshotResult?.dialog_auto_accepted_list
                  ? {
                      dialog_auto_accepted_list:
                        compressedInitScreenshotResult.dialog_auto_accepted_list,
                    }
                  : {}),
              },
              timestamp: Date.now(),
            };

          case 'open':
            if (!command.url) {
              throw new Error('URL is required for open action');
            }
            const openResult = await tabs.openTab(command.url, conversationId);

            // Set the newly opened tab as active if it has a tabId
            if (openResult.tabId) {
              tabManager.setCurrentActiveTabId(
                conversationId,
                openResult.tabId,
              );
            }

            // Capture screenshot after opening
            const openScreenshotResult = openResult.tabId
              ? await captureScreenshot(
                  openResult.tabId,
                  conversationId,
                  true,
                  90,
                  false,
                  0,
                )
              : null;
            const compressedOpenScreenshotResult =
              await compressScreenshotResult(openScreenshotResult);

            return {
              success: true,
              message: openResult.message,
              data: {
                ...openResult,
                conversationId: conversationId,
                screenshot: compressedOpenScreenshotResult?.imageData,
                ...(compressedOpenScreenshotResult?.dialog_auto_accepted
                  ? {
                      dialog_auto_accepted:
                        compressedOpenScreenshotResult.dialog_auto_accepted,
                    }
                  : {}),
                ...(compressedOpenScreenshotResult?.dialog_auto_accepted_list
                  ? {
                      dialog_auto_accepted_list:
                        compressedOpenScreenshotResult.dialog_auto_accepted_list,
                    }
                  : {}),
              },
              timestamp: Date.now(),
            };

          case 'close':
            if (!command.tab_id) {
              throw new Error('tab_id is required for close action');
            }
            const closeResult = await tabs.closeTab(command.tab_id);
            return {
              success: true,
              message: closeResult.message,
              data: {
                ...closeResult,
                conversationId: conversationId,
              },
              timestamp: Date.now(),
            };

          case 'switch':
            if (!command.tab_id) {
              throw new Error('tab_id is required for switch action');
            }
            const switchResult = await tabs.switchToTab(command.tab_id);
            await tabManager.ensureTabManaged(command.tab_id, conversationId);
            tabManager.updateTabActivity(command.tab_id, conversationId);

            // Set the switched-to tab as active
            tabManager.setCurrentActiveTabId(conversationId, command.tab_id);

            // Capture screenshot after switching
            const switchScreenshotResult = await captureScreenshot(
              command.tab_id,
              conversationId,
              true,
              90,
              false,
              0,
            );
            const compressedSwitchScreenshotResult =
              await compressScreenshotResult(switchScreenshotResult);

            return {
              success: true,
              message: switchResult.message,
              data: {
                ...switchResult,
                conversationId: conversationId,
                screenshot: compressedSwitchScreenshotResult?.imageData,
                ...(compressedSwitchScreenshotResult?.dialog_auto_accepted
                  ? {
                      dialog_auto_accepted:
                        compressedSwitchScreenshotResult.dialog_auto_accepted,
                    }
                  : {}),
                ...(compressedSwitchScreenshotResult?.dialog_auto_accepted_list
                  ? {
                      dialog_auto_accepted_list:
                        compressedSwitchScreenshotResult.dialog_auto_accepted_list,
                    }
                  : {}),
              },
              timestamp: Date.now(),
            };

          case 'list':
            // ✅ STRICT MODE: conversation_id already checked above
            const listResult = await tabs.getAllTabs(true, conversationId);
            const conversationTabs = tabManager.getManagedTabs(conversationId);
            return {
              success: true,
              message: `Found ${listResult.count} tabs (${conversationTabs.length} in conversation ${conversationId})`,
              data: {
                ...listResult,
                conversationId: conversationId,
                conversationTabs: conversationTabs,
              },
              timestamp: Date.now(),
            };

          case 'refresh':
            if (!command.tab_id) {
              throw new Error('tab_id is required for refresh action');
            }
            await tabManager.ensureTabManaged(command.tab_id, conversationId);
            tabManager.updateTabActivity(command.tab_id, conversationId);
            const refreshResult = await tabs.refreshTab(command.tab_id);

            // Capture screenshot after refresh
            const refreshScreenshotResult = await captureScreenshot(
              command.tab_id,
              conversationId,
              true,
              90,
              false,
              0,
            );
            const compressedRefreshScreenshotResult =
              await compressScreenshotResult(refreshScreenshotResult);

            return {
              success: true,
              message: refreshResult.message,
              data: {
                ...refreshResult,
                conversationId: conversationId,
                screenshot: compressedRefreshScreenshotResult?.imageData,
                ...(compressedRefreshScreenshotResult?.dialog_auto_accepted
                  ? {
                      dialog_auto_accepted:
                        compressedRefreshScreenshotResult.dialog_auto_accepted,
                    }
                  : {}),
                ...(compressedRefreshScreenshotResult?.dialog_auto_accepted_list
                  ? {
                      dialog_auto_accepted_list:
                        compressedRefreshScreenshotResult.dialog_auto_accepted_list,
                    }
                  : {}),
              },
              timestamp: Date.now(),
            };
          case 'view': {
            // View action: Capture screenshot of current active tab
            const viewActiveTabId =
              tabManager.getCurrentActiveTabId(conversationId);
            if (!viewActiveTabId) {
              throw new Error(
                `No active tab found for conversation ${conversationId}. Use tab init first.`,
              );
            }

            await tabManager.ensureTabManaged(viewActiveTabId, conversationId);
            tabManager.updateTabActivity(viewActiveTabId, conversationId);

            console.log(
              `👁️ [Tab View] Capturing screenshot for tab ${viewActiveTabId}, conversation: ${conversationId}`,
            );

            const viewScreenshotResult = await captureScreenshot(
              viewActiveTabId,
              conversationId,
              true,
              90,
              false,
              350,
              TAB_VIEW_SCREENSHOT_CAPTURE_OPTIONS,
            );
            const compressedViewScreenshotResult =
              await compressScreenshotResult(viewScreenshotResult);

            return {
              success: true,
              message: `View captured for tab ${viewActiveTabId}`,
              data: {
                tabId: viewActiveTabId,
                conversationId: conversationId,
                screenshot: compressedViewScreenshotResult?.imageData,
                ...(compressedViewScreenshotResult?.dialog_auto_accepted
                  ? {
                      dialog_auto_accepted:
                        compressedViewScreenshotResult.dialog_auto_accepted,
                    }
                  : {}),
                ...(compressedViewScreenshotResult?.dialog_auto_accepted_list
                  ? {
                      dialog_auto_accepted_list:
                        compressedViewScreenshotResult.dialog_auto_accepted_list,
                    }
                  : {}),
              },
              timestamp: Date.now(),
            };
          }

          case 'back':
          case 'forward': {
            // Determine which tab to use: provided tab_id or current active tab
            let targetTabId: number;
            if (command.tab_id) {
              targetTabId = command.tab_id;
              console.log(
                `↩️ [Tab ${command.action}] Using provided tab_id ${targetTabId}`,
              );
            } else {
              const activeTabId =
                tabManager.getCurrentActiveTabId(conversationId);
              if (!activeTabId) {
                throw new Error(
                  `No active tab found for conversation ${conversationId}. Use tab init first or specify tab_id.`,
                );
              }
              targetTabId = activeTabId;
              console.log(
                `↩️ [Tab ${command.action}] Using current active tab ${targetTabId}`,
              );
            }

            await tabManager.ensureTabManaged(targetTabId, conversationId);
            tabManager.updateTabActivity(targetTabId, conversationId);

            console.log(
              `↩️ [Tab ${command.action}] Navigating ${command.action} in tab ${targetTabId}, conversation: ${conversationId}`,
            );

            // Execute back or forward navigation
            const navigationResult =
              command.action === 'back'
                ? await tabs.goBack(targetTabId)
                : await tabs.goForward(targetTabId);

            // Capture screenshot after navigation
            const screenshotResult = await captureScreenshot(
              targetTabId,
              conversationId,
              true,
              90,
              false,
              0,
            );
            const compressedNavigationScreenshotResult =
              await compressScreenshotResult(screenshotResult);

            return {
              success: true,
              message: navigationResult.message,
              data: {
                ...navigationResult,
                tabId: targetTabId,
                conversationId: conversationId,
                screenshot: compressedNavigationScreenshotResult?.imageData,
                ...(compressedNavigationScreenshotResult?.dialog_auto_accepted
                  ? {
                      dialog_auto_accepted:
                        compressedNavigationScreenshotResult.dialog_auto_accepted,
                    }
                  : {}),
                ...(compressedNavigationScreenshotResult?.dialog_auto_accepted_list
                  ? {
                      dialog_auto_accepted_list:
                        compressedNavigationScreenshotResult.dialog_auto_accepted_list,
                    }
                  : {}),
              },
              timestamp: Date.now(),
            };
          }

          default:
            throw new Error(`Unknown tab action: ${(command as any).action}`);
        }
      }

      case 'cleanup_session': {
        // ✅ STRICT MODE: conversation_id is REQUIRED
        if (!command.conversation_id) {
          throw new Error(
            'conversation_id is required for cleanup_session (strict mode)',
          );
        }
        const cleanupConversationId = command.conversation_id;
        console.log(
          `🧹 [Cleanup Session] Cleaning up session ${cleanupConversationId}`,
        );
        const managedTabs = tabManager.getManagedTabs(cleanupConversationId);

        for (const managedTab of managedTabs) {
          cleanupTabState(cleanupConversationId, managedTab.tabId);
        }

        // Clear any conversation-scoped cache entries that may remain after
        // tabs are closed or the session has already partially cleaned up.
        elementCache.invalidate(cleanupConversationId);

        // 清理 tab manager 会话
        await tabManager.cleanupSession(cleanupConversationId);

        // 清理 debugger 会话（detach 所有相关 tabs）
        await debuggerSessionManager.cleanupSession(cleanupConversationId);

        return {
          success: true,
          message: `Session ${cleanupConversationId} cleaned up successfully`,
          data: {
            conversationId: cleanupConversationId,
          },
          timestamp: Date.now(),
        };
      }

      case 'get_tabs': {
        // ✅ STRICT MODE: conversation_id is REQUIRED for managed_only=true
        const getTabsManagedOnly = command.managed_only !== false;

        if (getTabsManagedOnly) {
          if (!command.conversation_id) {
            throw new Error(
              'conversation_id is required for get_tabs with managed_only=true (strict mode)',
            );
          }
          const conversationTabs = tabManager.getManagedTabs(
            command.conversation_id,
          );

          // ✅ FIX: Query Chrome API to get active status for each tab
          const tabsWithActive = await Promise.all(
            conversationTabs.map(async (managedTab) => {
              try {
                const chromeTab = await chrome.tabs.get(managedTab.tabId);
                return {
                  ...managedTab,
                  active: chromeTab.active, // Add active status from Chrome API
                  index: chromeTab.index, // Also add index for consistency
                };
              } catch (error) {
                // Tab might have been closed, return with active=false
                console.warn(
                  `Tab ${managedTab.tabId} not found, marking as inactive`,
                );
                return {
                  ...managedTab,
                  active: false,
                  index: -1,
                };
              }
            }),
          );

          return {
            success: true,
            message: `Found ${tabsWithActive.length} managed tabs in conversation ${command.conversation_id}`,
            data: {
              tabs: tabsWithActive,
              count: tabsWithActive.length,
              conversationId: command.conversation_id,
              managed_only: true,
            },
            timestamp: Date.now(),
          };
        } else {
          // Get all tabs (no conversation filter)
          const allTabsResult = await tabs.getAllTabs(
            false,
            command.conversation_id,
          );
          return {
            success: true,
            message: `Found ${allTabsResult.count} tabs total`,
            data: {
              ...allTabsResult,
              managed_only: false,
            },
            timestamp: Date.now(),
          };
        }
      }

      case 'javascript_execute': {
        // ✅ STRICT MODE: conversation_id is REQUIRED
        if (!command.conversation_id) {
          throw new Error(
            'conversation_id is required for javascript_execute command (strict mode)',
          );
        }

        const conversationId = command.conversation_id;

        // Determine which tab to execute JavaScript in
        // Always use current active tab for the conversation (ignore tab_id if provided)
        const activeTabId = tabManager.getCurrentActiveTabId(conversationId);
        if (!activeTabId) {
          throw new Error(
            `No active tab found for conversation ${conversationId}. Use tab init or specify tab_id.`,
          );
        }

        console.log(
          `📜 [JavaScript] Executing in active tab ${activeTabId}, conversation: ${conversationId} (ignoring provided tab_id: ${command.tab_id || 'none'})`,
        );

        // Ensure tab is managed by tab manager for this conversation
        await tabManager.ensureTabManaged(activeTabId, conversationId);
        tabManager.updateTabActivity(activeTabId, conversationId);

        const jsStartTime = Date.now();

        const jsResult = await javascript.executeJavaScript(
          activeTabId,
          conversationId,
          command.script,
          command.return_by_value !== false,
          command.await_promise === true,
          command.timeout || 30000,
        );

        const jsDuration = Date.now() - jsStartTime;
        console.log(`✅ [JavaScript] Execution completed in ${jsDuration}ms`);

        // Determine which tab to screenshot: latest new tab if created, otherwise original tab
        let screenshotTabId = activeTabId;
        if (jsResult.new_tabs_created && jsResult.new_tabs_created.length > 0) {
          const latestNewTab =
            jsResult.new_tabs_created[jsResult.new_tabs_created.length - 1];
          screenshotTabId = latestNewTab.tabId;
          console.log(
            `📸 [JavaScript] New tabs detected, screenshot will be on latest new tab ${screenshotTabId}`,
          );

          // Update active tab for the conversation to the new tab
          tabManager.setCurrentActiveTabId(conversationId, screenshotTabId);
        }

        // Always take screenshot
        const jsScreenshotResult = await captureScreenshot(
          screenshotTabId,
          conversationId,
          true,
          90,
          false,
          0,
        );
        const compressedJsScreenshotResult =
          await compressScreenshotResult(jsScreenshotResult);

        return {
          success: true,
          message: 'JavaScript executed successfully',
          data: {
            ...jsResult,
            screenshot: compressedJsScreenshotResult?.imageData,
            ...(compressedJsScreenshotResult?.dialog_auto_accepted
              ? {
                  dialog_auto_accepted:
                    compressedJsScreenshotResult.dialog_auto_accepted,
                }
              : {}),
            ...(compressedJsScreenshotResult?.dialog_auto_accepted_list
              ? {
                  dialog_auto_accepted_list:
                    compressedJsScreenshotResult.dialog_auto_accepted_list,
                }
              : {}),
          },
          timestamp: Date.now(),
          duration: jsDuration,
        };
      }

      case 'handle_dialog': {
        // ✅ STRICT MODE: conversation_id is REQUIRED
        if (!command.conversation_id) {
          throw new Error(
            'conversation_id is required for handle_dialog command (strict mode)',
          );
        }

        const conversationId = command.conversation_id;
        const action = command.action; // 'accept' or 'dismiss'

        console.log(
          `💬 [HandleDialog] Handling dialog for conversation ${conversationId}: action=${action}`,
        );

        // Get the active tab for this conversation
        const activeTabId = tabManager.getCurrentActiveTabId(conversationId);
        if (!activeTabId) {
          throw new Error(
            `No active tab found for conversation ${conversationId}. Use tab init first.`,
          );
        }

        // Check if there's an active dialog
        if (!dialogManager.hasActiveDialog(activeTabId)) {
          return {
            success: false,
            error: 'No dialog is currently open. There is nothing to handle.',
            timestamp: Date.now(),
          };
        }

        const existingDialog = dialogManager.getActiveDialog(activeTabId)!;
        console.log(
          `💬 [HandleDialog] Found dialog: type=${existingDialog.dialogType}, message="${existingDialog.message}"`,
        );

        try {
          // Handle the dialog (may cascade to another dialog)
          const handleResult = await dialogManager.handleDialog(
            activeTabId,
            action,
            command.prompt_text,
          );

          console.log(
            `✅ [HandleDialog] Dialog handled: status=${handleResult.status}`,
          );

          // If a new dialog cascaded, return info about it
          if (
            handleResult.status === 'dialog_cascaded' &&
            handleResult.newDialog
          ) {
            console.log(
              `💬 [HandleDialog] Cascading dialog detected: type=${handleResult.newDialog.type}`,
            );

            // Auto-accept if it's an alert (no decision needed)
            if (!handleResult.newDialog.needsDecision) {
              console.log(`💬 [HandleDialog] Auto-accepting cascading alert`);
              await dialogManager.autoAcceptDialog(activeTabId);

              // Take screenshot after auto-accept
              const screenshotResult = await captureScreenshot(
                activeTabId,
                conversationId,
                true, // include_cursor
                90, // quality
                false, // resizeToPreset
                0, // waitForRender
              );

              return {
                success: true,
                message: `Dialog handled (${action}), cascading alert auto-accepted: "${handleResult.newDialog.message}"`,
                data: {
                  previousDialog: handleResult.previousDialog,
                  cascadingDialog: {
                    type: handleResult.newDialog.type,
                    message: handleResult.newDialog.message,
                    autoAccepted: true,
                  },
                  screenshot: await compressIfNeeded(
                    screenshotResult,
                    getCompressionThreshold(),
                  ),
                  ...(screenshotResult?.dialog_auto_accepted
                    ? {
                        dialog_auto_accepted:
                          screenshotResult.dialog_auto_accepted,
                      }
                    : {}),
                  ...(screenshotResult?.dialog_auto_accepted_list
                    ? {
                        dialog_auto_accepted_list:
                          screenshotResult.dialog_auto_accepted_list,
                      }
                    : {}),
                },
                timestamp: Date.now(),
              };
            }

            // Return info about the cascading dialog (needs decision)
            return {
              success: true,
              message: `Dialog handled (${action}), but a new ${handleResult.newDialog.type} dialog opened: "${handleResult.newDialog.message}". Use handle_dialog again to respond.`,
              dialog_opened: true,
              dialog: {
                type: handleResult.newDialog.type,
                message: handleResult.newDialog.message,
                url: handleResult.newDialog.url,
                needsDecision: handleResult.newDialog.needsDecision,
              },
              data: {
                previousDialog: handleResult.previousDialog,
                cascadingDialog: handleResult.newDialog,
              },
              timestamp: Date.now(),
            };
          }

          // No cascade - dialog handling complete
          // Take screenshot to show the result
          const screenshotResult = await captureScreenshot(
            activeTabId,
            conversationId,
            true, // include_cursor
            90, // quality
            false, // resizeToPreset
            0, // waitForRender
          );

          console.log(
            `✅ [HandleDialog] Dialog handling complete, screenshot captured`,
          );

          return {
            success: true,
            message: `Dialog handled successfully: ${handleResult.previousDialog.type} ${action}ed`,
            data: {
              handledDialog: handleResult.previousDialog,
              screenshot: await compressIfNeeded(
                screenshotResult,
                getCompressionThreshold(),
              ),
              ...(screenshotResult?.dialog_auto_accepted
                ? {
                    dialog_auto_accepted: screenshotResult.dialog_auto_accepted,
                  }
                : {}),
              ...(screenshotResult?.dialog_auto_accepted_list
                ? {
                    dialog_auto_accepted_list:
                      screenshotResult.dialog_auto_accepted_list,
                  }
                : {}),
            },
            timestamp: Date.now(),
          };
        } catch (error) {
          console.error(`❌ [HandleDialog] Failed to handle dialog:`, error);
          if (error instanceof DialogBlockedError) {
            const response: any = {
              success: false,
              error: error.message,
              dialog_opened: true,
              dialog: {
                type: error.dialogType as DialogType,
                message: error.dialogMessage,
                needsDecision: error.needsDecision,
              },
              timestamp: Date.now(),
            };

            // Include auto-accepted dialogs if any
            if (
              error.autoAcceptedDialogs &&
              error.autoAcceptedDialogs.length > 0
            ) {
              response.auto_accepted_dialogs = error.autoAcceptedDialogs.map(
                (dialog) => ({
                  type: dialog.dialogType,
                  message: dialog.message,
                  url: dialog.url,
                  timestamp: dialog.timestamp,
                }),
              );
            }

            return response;
          }
          return {
            success: false,
            error: `Failed to handle dialog: ${error instanceof Error ? error.message : String(error)}`,
            timestamp: Date.now(),
          };
        }
      }

      case 'highlight_elements': {
        if (!command.conversation_id) {
          throw new Error(
            'conversation_id is required for highlight_elements command',
          );
        }
        const conversationId = command.conversation_id;
        const activeTabId = tabManager.getCurrentActiveTabId(conversationId);
        if (!activeTabId) {
          throw new Error(`No active tab for conversation ${conversationId}`);
        }

        const keywords = command.keywords;
        const elementType = command.element_type || 'any';
        const page = command.page || 1;
        const highlightSnapshotId = command.highlight_snapshot_id;
        const requestedKeywords = normalizeHighlightKeywords(keywords);

        if (
          highlightSnapshotId !== undefined &&
          highlightSnapshotId !== null
        ) {
          const baseSnapshot = elementCache.getSnapshotPage(
            conversationId,
            activeTabId,
            highlightSnapshotId,
          );
          if (!baseSnapshot) {
            return {
              success: false,
              error: `Highlight snapshot ${highlightSnapshotId} was not found or expired. Call highlight_elements() again.`,
              timestamp: Date.now(),
            };
          }

          const cachedKeywords = normalizeHighlightKeywords(baseSnapshot.keywords);
          if (baseSnapshot.elementType !== elementType) {
            return {
              success: false,
              error: `Highlight snapshot ${highlightSnapshotId} was created for element_type="${baseSnapshot.elementType}", but the current request asked for "${elementType}". Start a new highlight from page 1 instead.`,
              timestamp: Date.now(),
            };
          }

          if (
            cachedKeywords.length !== requestedKeywords.length ||
            cachedKeywords.some(
              (keyword, index) => keyword !== requestedKeywords[index],
            )
          ) {
            return {
              success: false,
              error: `Highlight snapshot ${highlightSnapshotId} was created with different keywords. Start a new highlight from page 1 instead.`,
              timestamp: Date.now(),
            };
          }

          const continuedSnapshot = elementCache.forkSnapshotPage(
            conversationId,
            activeTabId,
            highlightSnapshotId,
            page,
          );
          if (!continuedSnapshot) {
            return {
              success: false,
              error: `Failed to continue from highlight snapshot ${highlightSnapshotId}. Call highlight_elements() again.`,
              timestamp: Date.now(),
            };
          }

          return await renderHighlightSnapshotPage({
            tabId: activeTabId,
            conversationId,
            elements: continuedSnapshot.elements,
            totalElements: continuedSnapshot.totalElements,
            totalPages: continuedSnapshot.totalPages,
            page: continuedSnapshot.page,
            highlightSnapshotId: continuedSnapshot.snapshotId,
            expectedDocumentId: continuedSnapshot.documentId,
            pageState: 'snapshot_reused',
            readinessReasons: [],
          });
        }

        if (page > 1) {
          return {
            success: false,
            error:
              'page > 1 requires highlight_snapshot_id so pagination stays on the same frozen highlight inventory. Call highlight_elements() page 1 first.',
            timestamp: Date.now(),
          };
        }

        const detectionScript = buildHighlightDetectionScript({
          elementType,
        });

        const maxHighlightAttempts = 3;
        const highlightDetectionTimeoutMs = 18000;
        let previousConsistency: HighlightConsistencyResult | null = null;

        for (let attempt = 1; attempt <= maxHighlightAttempts; attempt++) {
          console.log(
            `🔁 [HighlightElements] Attempt ${attempt}/${maxHighlightAttempts}`,
          );

          // Execute detection script in page context
          const detectionResult = await javascript.executeJavaScript(
            activeTabId,
            conversationId,
            detectionScript,
            true, // returnByValue
            true, // awaitPromise
            highlightDetectionTimeoutMs, // timeout
          );

          if (!detectionResult.success || !detectionResult.result?.value) {
            return {
              success: false,
              error: detectionResult.error || 'Failed to detect elements',
              timestamp: Date.now(),
            };
          }

          const allElements = detectionResult.result.value.elements || [];
          const detectedDocumentId =
            typeof detectionResult.result.value.documentId === 'string'
              ? detectionResult.result.value.documentId
              : '';
          const detectedViewport = detectionResult.result.value.viewport || {};
          const layoutStability = detectionResult.result.value.layoutStability;
          const highlightTraceStart = Date.now();
          const detectedViewportWidth =
            typeof detectedViewport.width === 'number'
              ? detectedViewport.width
              : 0;
          const detectedViewportHeight =
            typeof detectedViewport.height === 'number'
              ? detectedViewport.height
              : 0;
          if (layoutStability) {
            console.log(
              `⏳ [HighlightElements] Readiness snapshot: ${JSON.stringify(layoutStability)}`,
            );
          }

          // Do not wait inside the page for "stability". Hidden/background tabs
          // can throttle page timers hard enough that page-side polling becomes
          // the dominant source of highlight timeouts. Instead, classify the
          // current snapshot and do at most a couple of short background-side
          // retries when the viewport still looks like a loading/skeleton state.
          const pageState: HighlightPageState =
            layoutStability?.state || 'ready';
          const readinessReasons = Array.isArray(layoutStability?.reasons)
            ? layoutStability.reasons
            : [];

          if (pageState === 'not_ready' && attempt < maxHighlightAttempts) {
            const retryDelayMs = getHighlightReadinessRetryDelay(attempt);
            console.warn(
              `⚠️ [HighlightElements] Readiness state is not_ready (${readinessReasons.join(', ') || 'no reasons'}), retrying in ${retryDelayMs}ms (attempt ${attempt}/${maxHighlightAttempts})`,
            );
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
            continue;
          }

          const keywordFilterStart = Date.now();
          const keywordFiltering = filterHighlightElementsByKeywords(
            allElements,
            keywords,
          );
          const keywordList = keywordFiltering.keywords;
          const filteredElements = keywordFiltering.elements;

          if (keywordList.length > 0) {
            console.log(
              `🔍 [HighlightElements] Keywords [${keywordList.join(', ')}] matched ${filteredElements.length} of ${allElements.length} elements`,
            );
          }
          console.log(
            `⏱️ [HighlightTrace] background keyword-filter ${Date.now() - keywordFilterStart}ms (keywords=${keywordList.length}, kept=${filteredElements.length}/${allElements.length})`,
          );

          let paginatedElements: InteractiveElement[];
          let totalPages: number;
          let currentPage = page;

          if (keywordList.length > 0) {
            // Keyword mode: return all matching elements, no pagination.
            // Assign temporary numeric IDs so the consistency check can
            // correlate samples before the final display-order renumbering.
            paginatedElements = assignSequentialElementIds(filteredElements);
            totalPages = 1;
            currentPage = 1;
            console.log(
              `🔍 [HighlightElements] Keywords [${keywordList.join(', ')}] matched ${paginatedElements.length} elements (no pagination)`,
            );
          } else {
            // Normal collision-aware pagination
            const paginationSelectionStart = Date.now();
            paginatedElements = selectCollisionFreePage(
              filteredElements,
              page,
              detectedViewportWidth,
              detectedViewportHeight,
            );
            const paginationSelectionMs = Date.now() - paginationSelectionStart;
            const totalPagesStart = Date.now();
            totalPages = calculateTotalPages(
              filteredElements,
              detectedViewportWidth,
              detectedViewportHeight,
            );
            const totalPagesMs = Date.now() - totalPagesStart;
            console.log(
              `📄 [HighlightElements] Page ${page}/${totalPages}, showing ${paginatedElements.length} of ${filteredElements.length} elements`,
            );
            console.log(
              `⏱️ [HighlightTrace] background pagination select=${paginationSelectionMs}ms totalPages=${totalPagesMs}ms (page=${page}, viewport=${detectedViewportWidth}x${detectedViewportHeight})`,
            );
          }

          // Capture screenshot
          const screenshotStart = Date.now();
          const screenshotResult = await captureScreenshot(
            activeTabId,
            conversationId,
            true,
            90,
            false,
            0,
            HIGHLIGHT_SCREENSHOT_CAPTURE_OPTIONS,
          );

          // Validate screenshot result
          if (!screenshotResult?.success || !screenshotResult?.imageData) {
            return {
              success: false,
              error: `Failed to capture screenshot: ${screenshotResult?.success === false ? 'Screenshot command failed' : 'No image data returned'}`,
              timestamp: Date.now(),
            };
          }
          console.log(
            `📸 [HighlightElements] Screenshot captured, size: ${screenshotResult.imageData.length} bytes`,
          );
          console.log(
            `⏱️ [HighlightTrace] background screenshot ${Date.now() - screenshotStart}ms`,
          );

          // Get device pixel ratio for coordinate scaling
          const imageScale =
            screenshotResult.metadata?.imageScale ||
            screenshotResult.metadata?.devicePixelRatio ||
            1;
          const viewportWidth = screenshotResult.metadata?.viewportWidth || 0;
          const viewportHeight = screenshotResult.metadata?.viewportHeight || 0;
          console.log(
            `📐 [HighlightElements] Image scale: ${imageScale}`,
          );
          console.log(
            `📐 [HighlightElements] Viewport: ${viewportWidth}x${viewportHeight} CSS pixels`,
          );
          console.log(
            `📐 [HighlightElements] Expected image size: ${Math.round(viewportWidth * imageScale)}x${Math.round(viewportHeight * imageScale)} device pixels`,
          );

          const consistencyCheckStart = Date.now();
          const consistencyScript =
            buildHighlightConsistencyScript(paginatedElements);
          const consistencyResult = await javascript.executeJavaScript(
            activeTabId,
            conversationId,
            consistencyScript,
            true,
            false,
            2000,
          );
          const currentConsistencySamples =
            consistencyResult.success &&
            consistencyResult.result?.value?.samples &&
            Array.isArray(consistencyResult.result.value.samples)
              ? consistencyResult.result.value.samples
              : [];
          const highlightConsistency = evaluateHighlightConsistency(
            paginatedElements
              .slice(0, HIGHLIGHT_CONSISTENCY_CONFIG.maxSampleSize)
              .map((element) => ({
                id: element.id,
                bbox: element.bbox,
              })),
            currentConsistencySamples,
          );
          console.log(
            `⏱️ [HighlightTrace] background consistency-check ${Date.now() - consistencyCheckStart}ms (checked=${highlightConsistency.checkedCount}, matched=${highlightConsistency.matchedCount}, missing=${highlightConsistency.missingCount}, shifted=${highlightConsistency.shiftedCount}, maxCenterShift=${highlightConsistency.maxCenterShift}, maxSizeDelta=${highlightConsistency.maxSizeDelta}, retry=${highlightConsistency.shouldRetry})`,
          );
          const repeatedDrift = isRepeatedHighlightDrift(
            highlightConsistency,
            previousConsistency,
          );

          if (
            highlightConsistency.shouldRetry &&
            attempt < maxHighlightAttempts &&
            !repeatedDrift
          ) {
            previousConsistency = highlightConsistency;
            console.warn(
              `⚠️ [HighlightElements] Layout drift detected after screenshot, retrying (attempt ${attempt}/${maxHighlightAttempts})`,
            );
            continue;
          }

          if (highlightConsistency.shouldRetry) {
            console.warn(
              repeatedDrift
                ? `⚠️ [HighlightElements] Layout drift repeated with near-identical metrics, returning latest screenshot`
                : `⚠️ [HighlightElements] Layout drift still detected on final attempt, returning latest screenshot`,
            );
          }

          // Preserve the original highlight pipeline order for detection,
          // pagination, and consistency checks. Only sort and renumber at the
          // rendering boundary so the screenshot/response stay intuitive
          // without changing the stability gate.
          const storedPages = buildStoredHighlightPages({
            filteredElements,
            totalPages,
            viewportWidth: detectedViewportWidth,
            viewportHeight: detectedViewportHeight,
            keywordMode: keywordList.length > 0,
          });
          const displayOrderedElements = storedPages[currentPage - 1] ?? [];

          const cacheStoreStart = Date.now();
          const storedSnapshot = elementCache.storeSnapshot({
            conversationId,
            tabId: activeTabId,
            documentId: detectedDocumentId,
            elementType,
            keywords: keywordList,
            totalElements: filteredElements.length,
            pages: storedPages,
            page: currentPage,
          });
          console.log(
            `⏱️ [HighlightTrace] background cache-store ${Date.now() - cacheStoreStart}ms (snapshot=${storedSnapshot.snapshotId}, count=${displayOrderedElements.length})`,
          );

          // Log first few element bboxes for debugging
          if (displayOrderedElements.length > 0) {
            console.log(
              `📍 [HighlightElements] First element bbox:`,
              JSON.stringify(displayOrderedElements[0].bbox),
            );
          }

          // Draw highlights on screenshot (scale coordinates by DPR)
          const drawHighlightsStart = Date.now();
          const highlightedScreenshot = await drawHighlights(
            screenshotResult.imageData,
            storedSnapshot.elements,
            {
              scale: imageScale,
              viewportWidth,
              viewportHeight,
            },
          );
          console.log(
            `⏱️ [HighlightTrace] background draw-highlights ${Date.now() - drawHighlightsStart}ms (elements=${storedSnapshot.elements.length})`,
          );

          const compressStart = Date.now();
          const compressedScreenshot = await compressIfNeeded(
            highlightedScreenshot,
            getCompressionThreshold(),
          );
          console.log(
            `⏱️ [HighlightTrace] background compress ${Date.now() - compressStart}ms`,
          );
          console.log(
            `⏱️ [HighlightTrace] background total ${Date.now() - highlightTraceStart}ms`,
          );

          return {
            success: true,
            data: {
              highlight_snapshot_id: storedSnapshot.snapshotId,
              elements: storedSnapshot.elements,
              totalElements: filteredElements.length,
              totalPages: totalPages,
              page: currentPage,
              pageState,
              readinessReasons,
              screenshot: compressedScreenshot,
              ...(screenshotResult?.dialog_auto_accepted
                ? {
                    dialog_auto_accepted: screenshotResult.dialog_auto_accepted,
                  }
                : {}),
              ...(screenshotResult?.dialog_auto_accepted_list
                ? {
                    dialog_auto_accepted_list:
                      screenshotResult.dialog_auto_accepted_list,
                  }
                : {}),
            },
            timestamp: Date.now(),
          };
        }

        return {
          success: false,
          error: 'Failed to produce a stable highlight screenshot',
          timestamp: Date.now(),
        };
      }

      case 'click_element': {
        if (!command.conversation_id)
          throw new Error('conversation_id required');
        const clickTabId = command.tab_id;
        if (clickTabId === undefined || clickTabId === null)
          throw new Error('tab_id is required');

        const clickResult = await performElementClick(
          command.conversation_id,
          command.highlight_snapshot_id,
          command.element_id,
          clickTabId,
        );

        // Determine which tab to screenshot: latest new tab if created, otherwise original tab
        let screenshotTabId = clickTabId;
        if (
          clickResult.new_tabs_created &&
          clickResult.new_tabs_created.length > 0
        ) {
          const latestNewTab =
            clickResult.new_tabs_created[
              clickResult.new_tabs_created.length - 1
            ];
          screenshotTabId = latestNewTab.tabId;
          console.log(
            `📸 [ClickElement] New tabs detected, screenshot will be on latest new tab ${screenshotTabId}`,
          );

          // Update active tab for the conversation to the new tab
          tabManager.setCurrentActiveTabId(
            command.conversation_id,
            screenshotTabId,
          );
        }

        const clickScreenshotResult = await captureScreenshot(
          screenshotTabId,
          command.conversation_id,
          true,
          90,
          false,
          0,
        );
        const compressedClickScreenshotResult = await compressScreenshotResult(
          clickScreenshotResult,
        );

        return {
          success: clickResult.success,
          data: {
            ...clickResult,
            screenshot: compressedClickScreenshotResult?.imageData,
            ...(compressedClickScreenshotResult?.dialog_auto_accepted
              ? {
                  dialog_auto_accepted:
                    compressedClickScreenshotResult.dialog_auto_accepted,
                }
              : {}),
            ...(compressedClickScreenshotResult?.dialog_auto_accepted_list
              ? {
                  dialog_auto_accepted_list:
                    compressedClickScreenshotResult.dialog_auto_accepted_list,
                }
              : {}),
          },
          error: clickResult.error,
          timestamp: Date.now(),
        };
      }

      case 'hover_element': {
        if (!command.conversation_id)
          throw new Error('conversation_id required');
        const hoverTabId = command.tab_id;
        if (hoverTabId === undefined || hoverTabId === null)
          throw new Error('tab_id is required');

        const hoverResult = await performElementHover(
          command.conversation_id,
          command.highlight_snapshot_id,
          command.element_id,
          hoverTabId,
        );
        const hoverScreenshotResult = await captureScreenshot(
          hoverTabId,
          command.conversation_id,
          true,
          90,
          false,
          0,
        );
        const compressedHoverScreenshotResult = await compressScreenshotResult(
          hoverScreenshotResult,
        );

        return {
          success: hoverResult.success,
          data: {
            ...hoverResult,
            screenshot: compressedHoverScreenshotResult?.imageData,
            ...(compressedHoverScreenshotResult?.dialog_auto_accepted
              ? {
                  dialog_auto_accepted:
                    compressedHoverScreenshotResult.dialog_auto_accepted,
                }
              : {}),
            ...(compressedHoverScreenshotResult?.dialog_auto_accepted_list
              ? {
                  dialog_auto_accepted_list:
                    compressedHoverScreenshotResult.dialog_auto_accepted_list,
                }
              : {}),
          },
          error: hoverResult.error,
          timestamp: Date.now(),
        };
      }

      case 'scroll_element': {
        if (!command.conversation_id)
          throw new Error('conversation_id required');
        const scrollTabId = command.tab_id;
        if (scrollTabId === undefined || scrollTabId === null)
          throw new Error('tab_id is required');

        // element_id is optional - if not provided, scrolls the entire page
        const scrollResult = await performElementScroll(
          command.conversation_id,
          command.highlight_snapshot_id,
          command.element_id,
          command.direction || 'down',
          scrollTabId,
          command.scroll_amount || 0.5,
        );
        const scrollScreenshotResult = await captureScreenshot(
          scrollTabId,
          command.conversation_id,
          true,
          90,
          false,
          0,
        );
        const compressedScrollScreenshotResult = await compressScreenshotResult(
          scrollScreenshotResult,
        );

        return {
          success: scrollResult.success,
          data: {
            ...scrollResult,
            screenshot: compressedScrollScreenshotResult?.imageData,
            ...(compressedScrollScreenshotResult?.dialog_auto_accepted
              ? {
                  dialog_auto_accepted:
                    compressedScrollScreenshotResult.dialog_auto_accepted,
                }
              : {}),
            ...(compressedScrollScreenshotResult?.dialog_auto_accepted_list
              ? {
                  dialog_auto_accepted_list:
                    compressedScrollScreenshotResult.dialog_auto_accepted_list,
                }
              : {}),
          },
          error: scrollResult.error,
          timestamp: Date.now(),
        };
      }

      case 'swipe_element': {
        if (!command.conversation_id)
          throw new Error('conversation_id required');
        const swipeTabId = command.tab_id;
        if (swipeTabId === undefined || swipeTabId === null)
          throw new Error('tab_id is required');

        const swipeResult = await performElementSwipe(
          command.conversation_id,
          command.highlight_snapshot_id,
          command.element_id,
          command.direction || 'next',
          swipeTabId,
          command.swipe_count || 1,
        );
        const swipeScreenshotResult = await captureScreenshot(
          swipeTabId,
          command.conversation_id,
          true,
          90,
          false,
          900,
          TAB_VIEW_SCREENSHOT_CAPTURE_OPTIONS,
        );
        const compressedSwipeScreenshotResult = await compressScreenshotResult(
          swipeScreenshotResult,
        );

        return {
          success: swipeResult.success,
          data: {
            ...swipeResult,
            screenshot: compressedSwipeScreenshotResult?.imageData,
            ...(compressedSwipeScreenshotResult?.dialog_auto_accepted
              ? {
                  dialog_auto_accepted:
                    compressedSwipeScreenshotResult.dialog_auto_accepted,
                }
              : {}),
            ...(compressedSwipeScreenshotResult?.dialog_auto_accepted_list
              ? {
                  dialog_auto_accepted_list:
                    compressedSwipeScreenshotResult.dialog_auto_accepted_list,
                }
              : {}),
          },
          error: swipeResult.error,
          timestamp: Date.now(),
        };
      }

      case 'keyboard_input': {
        if (!command.conversation_id)
          throw new Error('conversation_id required');
        const inputTabId = command.tab_id;
        if (inputTabId === undefined || inputTabId === null)
          throw new Error('tab_id is required');

        const inputResult = await performKeyboardInput(
          command.conversation_id,
          command.highlight_snapshot_id,
          command.element_id,
          command.text,
          inputTabId,
        );
        const inputScreenshotResult = await captureScreenshot(
          inputTabId,
          command.conversation_id,
          true,
          90,
          false,
          0,
        );
        const compressedInputScreenshotResult = await compressScreenshotResult(
          inputScreenshotResult,
        );

        return {
          success: inputResult.success,
          data: {
            ...inputResult,
            screenshot: compressedInputScreenshotResult?.imageData,
            ...(compressedInputScreenshotResult?.dialog_auto_accepted
              ? {
                  dialog_auto_accepted:
                    compressedInputScreenshotResult.dialog_auto_accepted,
                }
              : {}),
            ...(compressedInputScreenshotResult?.dialog_auto_accepted_list
              ? {
                  dialog_auto_accepted_list:
                    compressedInputScreenshotResult.dialog_auto_accepted_list,
                }
              : {}),
          },
          error: inputResult.error,
          timestamp: Date.now(),
        };
      }

      case 'select_element': {
        if (!command.conversation_id)
          throw new Error('conversation_id required');
        const selectTabId = command.tab_id;
        if (selectTabId === undefined || selectTabId === null)
          throw new Error('tab_id is required');

        const selectResult = await performElementSelect(
          command.conversation_id,
          command.highlight_snapshot_id,
          command.element_id,
          selectTabId,
          command.value,
        );
        const selectScreenshotResult = await captureScreenshot(
          selectTabId,
          command.conversation_id,
          true,
          90,
          false,
          0,
        );
        const compressedSelectScreenshotResult = await compressScreenshotResult(
          selectScreenshotResult,
        );

        return {
          success: selectResult.success,
          data: {
            ...selectResult,
            screenshot: compressedSelectScreenshotResult?.imageData,
            ...(compressedSelectScreenshotResult?.dialog_auto_accepted
              ? {
                  dialog_auto_accepted:
                    compressedSelectScreenshotResult.dialog_auto_accepted,
                }
              : {}),
            ...(compressedSelectScreenshotResult?.dialog_auto_accepted_list
              ? {
                  dialog_auto_accepted_list:
                    compressedSelectScreenshotResult.dialog_auto_accepted_list,
                }
              : {}),
          },
          error: selectResult.error,
          timestamp: Date.now(),
        };
      }

      case 'get_element_html': {
        if (!command.conversation_id)
          throw new Error('conversation_id required for get_element_html');
        const conversationId = command.conversation_id;
        const elementId = command.element_id;
        const highlightSnapshotId = command.highlight_snapshot_id;

        if (!elementId) {
          throw new Error('element_id is required for get_element_html');
        }
        if (highlightSnapshotId === undefined || highlightSnapshotId === null) {
          throw new Error(
            'highlight_snapshot_id is required for get_element_html',
          );
        }

        // Get current active tab for this conversation
        const activeTabId = tabManager.getCurrentActiveTabId(conversationId);
        if (!activeTabId) {
          throw new Error(
            `No active tab found for conversation ${conversationId}. Use tab init first.`,
          );
        }

        // Look up the element in the cache
        const element = elementCache.getElementById(
          conversationId,
          activeTabId,
          highlightSnapshotId,
          elementId,
        );

        if (!element) {
          console.warn(
            `⚠️ [GetElementHtml] Element ${elementId} not found in cache for conversation ${conversationId}, tab ${activeTabId}, snapshot ${highlightSnapshotId}`,
          );
          return {
            success: false,
            error: `Element ${elementId} not found in cache for highlight snapshot ${highlightSnapshotId}. The snapshot may have expired or the page may have changed. Try highlight_elements again.`,
            data: {
              element_id: elementId,
              highlight_snapshot_id: highlightSnapshotId,
              html: null,
            },
            timestamp: Date.now(),
          };
        }

        // Return the cached HTML
        const html = element.element.html || '<not available>';
        console.log(
          `✅ [GetElementHtml] Retrieved HTML for element ${elementId} from cache (${html.length} chars)`,
        );

        return {
          success: true,
          message: `Retrieved HTML for element ${elementId}`,
          data: {
            element_id: elementId,
            highlight_snapshot_id: highlightSnapshotId,
            html: html,
            tagName: element.element.tagName,
            type: element.element.type,
          },
          timestamp: Date.now(),
        };
      }

      case 'highlight_single_element': {
        if (!command.conversation_id) {
          throw new Error(
            'conversation_id is required for highlight_single_element command',
          );
        }
        const conversationId = command.conversation_id;
        const activeTabId = tabManager.getCurrentActiveTabId(conversationId);
        const highlightSnapshotId = command.highlight_snapshot_id;
        if (!activeTabId) {
          throw new Error(`No active tab for conversation ${conversationId}`);
        }
        if (highlightSnapshotId === undefined || highlightSnapshotId === null) {
          throw new Error(
            'highlight_snapshot_id is required for highlight_single_element command',
          );
        }

        // Get element from cache
        const element = elementCache.getElementById(
          conversationId,
          activeTabId,
          highlightSnapshotId,
          command.element_id,
        );
        if (!element) {
          return {
            success: false,
            error: `Element ${command.element_id} not found in cache for highlight snapshot ${highlightSnapshotId}. Call highlight_elements() again.`,
            timestamp: Date.now(),
          };
        }

        // ============================================================
        // Re-fetch current bbox using cached selector (bbox may be stale if page scrolled)
        // ============================================================
        const escapedSelector = element.element.selector
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"');
        const escapedDocumentId = element.documentId
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"');
        const escapedFingerprint = (element.element.fingerprint || '')
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"');
        const bboxScript = `
          (function() {
            function normalizeIdentityWhitespace(value, maxLength = 240) {
              const normalized = String(value ?? '')
                .replace(/\\s+/g, ' ')
                .trim();
              return normalized.slice(0, maxLength).toLowerCase();
            }

            function getIdentityAttributeTokens(el, attributeNames) {
              const tokens = [];
              for (const attributeName of attributeNames) {
                const value = el.getAttribute(attributeName);
                if (!value) {
                  continue;
                }
                const normalized = normalizeIdentityWhitespace(value, 80);
                if (normalized) {
                  tokens.push(normalized);
                }
              }
              return tokens;
            }

            function getIdentityClassTokens(el) {
              return Array.from(el.classList)
                .filter(
                  (token) =>
                    token.length > 1 &&
                    token.length <= 40 &&
                    /^[a-z0-9_-]+$/i.test(token),
                )
                .slice(0, 4)
                .map((token) => token.toLowerCase());
            }

            function getElementTextForIdentity(el) {
              if (el instanceof HTMLInputElement) {
                const inputType = (el.type || '').toLowerCase();
                if (
                  inputType === 'button' ||
                  inputType === 'submit' ||
                  inputType === 'reset'
                ) {
                  return normalizeIdentityWhitespace(el.value, 120);
                }
              }

              return normalizeIdentityWhitespace(el.textContent || '', 160);
            }

            function getElementFingerprint(el) {
              const tokens = [
                el.tagName.toLowerCase(),
                ...getIdentityAttributeTokens(el, [
                  'role',
                  'type',
                  'name',
                  'id',
                  'aria-label',
                  'title',
                  'placeholder',
                  'data-testid',
                  'data-test-id',
                ]),
                ...getIdentityClassTokens(el),
              ];

              const text = getElementTextForIdentity(el);
              if (text) {
                tokens.push(text);
              }

              return normalizeIdentityWhitespace(tokens.join(' | '), 240);
            }

            function splitFingerprintTokens(value) {
              return Array.from(
                new Set(
                  String(value ?? '')
                    .toLowerCase()
                    .split(/[^a-z0-9]+/i)
                    .filter((token) => token.length > 1),
                ),
              );
            }

            function fingerprintsLookCompatible(expected, current) {
              if (!expected || !current) {
                return true;
              }
              if (expected === current) {
                return true;
              }
              const expectedTokens = splitFingerprintTokens(expected);
              const currentTokens = new Set(splitFingerprintTokens(current));
              if (expectedTokens.length === 0) {
                return true;
              }

              let overlap = 0;
              for (const token of expectedTokens) {
                if (currentTokens.has(token)) {
                  overlap += 1;
                }
              }
              return overlap >= Math.max(2, Math.min(4, Math.ceil(expectedTokens.length * 0.5)));
            }

            const el = document.querySelector("${escapedSelector}");
            const expectedDocumentId = "${escapedDocumentId}";
            const expectedFingerprint = "${escapedFingerprint}";
            const currentDocumentId = \`\${Math.trunc(performance.timeOrigin)}|\${location.href}\`;
            if (expectedDocumentId && currentDocumentId !== expectedDocumentId) {
              return {
                ok: false,
                stale: true,
                error:
                  "Highlight snapshot is stale because the document changed. Call highlight_elements() again."
              };
            }
            if (!el) {
              return {
                ok: false,
                stale: true,
                error:
                  "Element not found in DOM for this highlight snapshot. Call highlight_elements() again."
              };
            }
            const currentFingerprint = getElementFingerprint(el);
            if (!fingerprintsLookCompatible(expectedFingerprint, currentFingerprint)) {
              return {
                ok: false,
                stale: true,
                error:
                  "Highlight snapshot is stale because the target element identity changed. Call highlight_elements() again."
              };
            }
            const rect = el.getBoundingClientRect();
            return {
              ok: true,
              bbox: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height
              }
            };
          })();
        `;

        let freshBbox = element.element.bbox; // Default to cached bbox
        try {
          const bboxResult = await javascript.executeJavaScript(
            activeTabId,
            conversationId,
            bboxScript,
            true,
            false,
            5000,
          );
          if (bboxResult.success && bboxResult.result?.value?.ok) {
            const fetchedBbox = bboxResult.result.value.bbox as {
              x: number;
              y: number;
              width: number;
              height: number;
            };
            freshBbox = fetchedBbox;
            console.log(
              `📐 [SingleHighlight] Fresh bbox for ${element.element.id}:`,
              JSON.stringify(freshBbox),
            );
          } else if (
            bboxResult.success
            && bboxResult.result?.value
            && bboxResult.result.value.ok === false
          ) {
            return {
              success: false,
              error:
                bboxResult.result.value.error ||
                `Element ${command.element_id} is stale for highlight snapshot ${highlightSnapshotId}. Call highlight_elements() again.`,
              timestamp: Date.now(),
            };
          } else {
            console.warn(
              `⚠️ [SingleHighlight] Failed to fetch fresh bbox for ${element.element.id}:`,
              {
                error: bboxResult.error,
                selector: element.element.selector,
                cachedBbox: element.element.bbox,
                resultValue: bboxResult.result?.value,
                rawResult: bboxResult.result,
              },
            );
          }
        } catch (bboxError) {
          console.warn(
            `⚠️ [SingleHighlight] Error fetching bbox, using cached:`,
            bboxError,
          );
        }

        // Capture screenshot
        const screenshotResult = await captureScreenshot(
          activeTabId,
          conversationId,
          true,
          90,
        );

        // ============================================================
        // Check if element is visible in viewport
        // ============================================================
        const viewportWidth = screenshotResult.metadata?.viewportWidth || 1280;
        const viewportHeight = screenshotResult.metadata?.viewportHeight || 720;

        // Element is considered visible if at least part of it is in the viewport
        const isVisibleInViewport =
          freshBbox.x < viewportWidth && // Left edge is left of right boundary
          freshBbox.x + freshBbox.width > 0 && // Right edge is right of left boundary
          freshBbox.y < viewportHeight && // Top edge is above bottom boundary
          freshBbox.y + freshBbox.height > 0; // Bottom edge is below top boundary

        if (!isVisibleInViewport) {
          // Determine scroll direction hint
          let scrollHint = '';
          if (freshBbox.y >= viewportHeight) {
            scrollHint =
              'The element is below the viewport. Try scrolling down or using scroll_element to bring it into view.';
          } else if (freshBbox.y + freshBbox.height <= 0) {
            scrollHint =
              'The element is above the viewport. Try scrolling up or using scroll_element to bring it into view.';
          } else if (freshBbox.x >= viewportWidth) {
            scrollHint =
              'The element is to the right of the viewport. Try scrolling right or using scroll_element to bring it into view.';
          } else if (freshBbox.x + freshBbox.width <= 0) {
            scrollHint =
              'The element is to the left of the viewport. Try scrolling left or using scroll_element to bring it into view.';
          }

          return {
            success: false,
            error:
              `Element ${element.element.id} is not visible in the current viewport. ${scrollHint}`.trim(),
            data: {
              elementId: element.element.id,
              highlight_snapshot_id: highlightSnapshotId,
              bbox: freshBbox,
              viewportWidth,
              viewportHeight,
            },
            timestamp: Date.now(),
          };
        }

        // Create element with fresh bbox for drawing
        const elementWithFreshBbox = {
          ...element.element,
          bbox: freshBbox,
        };

        // Draw single element highlight
        const highlightedScreenshot = await highlightSingleElement(
          screenshotResult.imageData,
          elementWithFreshBbox,
          {
            scale:
              screenshotResult.metadata?.imageScale ||
              screenshotResult.metadata?.devicePixelRatio ||
              1,
            viewportWidth: screenshotResult.metadata?.viewportWidth || 0,
            viewportHeight: screenshotResult.metadata?.viewportHeight || 0,
          },
        );

        return {
          success: true,
          data: {
            html: element.element.html || '',
            screenshot: await compressIfNeeded(
              highlightedScreenshot,
              getCompressionThreshold(),
            ),
            elementId: command.element_id,
            highlight_snapshot_id: highlightSnapshotId,
            ...(screenshotResult?.dialog_auto_accepted
              ? { dialog_auto_accepted: screenshotResult.dialog_auto_accepted }
              : {}),
            ...(screenshotResult?.dialog_auto_accepted_list
              ? {
                  dialog_auto_accepted_list:
                    screenshotResult.dialog_auto_accepted_list,
                }
              : {}),
          },
          timestamp: Date.now(),
        };
      }

      default:
        throw new Error(`Unknown command type: ${(command as any).type}`);
    }
  } catch (error) {
    console.error(`Command ${(command as any).type} failed:`, error);
    if (error instanceof DialogBlockedError) {
      const response: any = {
        success: false,
        command_id: command.command_id,
        error: error.message,
        dialog_opened: true,
        dialog: {
          type: error.dialogType as DialogType,
          message: error.dialogMessage,
          needsDecision: error.needsDecision,
        },
        timestamp: Date.now(),
      };

      // Include auto-accepted dialogs if any
      if (error.autoAcceptedDialogs && error.autoAcceptedDialogs.length > 0) {
        response.auto_accepted_dialogs = error.autoAcceptedDialogs.map(
          (dialog) => ({
            type: dialog.dialogType,
            message: dialog.message,
            url: dialog.url,
            timestamp: dialog.timestamp,
          }),
        );
      }

      return response;
    }
    return {
      success: false,
      command_id: command.command_id,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: Date.now(),
    };
  }
}

/**
 * Send tab switched event to server
 */
async function sendTabSwitchedEvent(
  conversationId: string,
  tabId: number,
): Promise<void> {
  try {
    if (!wsClient.isConnected()) {
      console.warn(
        `⚠️ Cannot send tab_switched event: WebSocket not connected`,
      );
      return;
    }

    const event = {
      type: 'event',
      event_type: 'tab_switched',
      conversation_id: conversationId,
      tab_id: tabId,
      timestamp: Date.now(),
    };

    console.log(
      `🔄 [TabEvent] Sending tab_switched event: ${conversationId} -> ${tabId}`,
    );
    await wsClient.sendMessage(event);
    console.log(`✅ [TabEvent] Tab switched event sent successfully`);
  } catch (error) {
    console.error('❌ [TabEvent] Failed to send tab switched event:', error);
  }
}

// Register tab switched listener with tab manager
tabManager.addTabSwitchedListener((conversationId: string, tabId: number) => {
  console.log(
    `🔄 [Background] Tab switched listener called: ${conversationId} -> ${tabId}`,
  );
  // Send event to server asynchronously (don't await)
  sendTabSwitchedEvent(conversationId, tabId).catch(console.error);
});

tabManager.addTabClosedListener((conversationId: string, tabId: number) => {
  cleanupTabState(conversationId, tabId);
});

console.log('✅ OpenBrowser extension loaded (Strict Mode)');

// Export constants and functions for testing
export { LABEL_FONT_SIZE, LABEL_PADDING, LABEL_HEIGHT, MAX_LABEL_WIDTH };
export {
  expandBBoxWithLabel,
  elementsCollide,
  selectCollisionFreePage,
  getLabelBBox,
  bboxesIntersect,
  isLabelWithinViewport,
  calculateTotalPages,
  type LabelPosition,
} from '../utils/collision-detection';
export type { BBox } from '../utils/collision-detection';
