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

import { drawHighlights } from '../commands/visual-highlight';
import { highlightSingleElement } from '../commands/single-highlight';
import { elementCache } from '../commands/element-cache';
import { generateElementId } from '../commands/hash-utils';
import {
  performElementClick,
  performElementHover,
  performElementScroll,
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
} from '../utils/collision-detection';
import { buildHitTestVisibilityHelpersScript } from '../utils/hit-test-visibility';
import { buildLayoutStabilityHelpersScript } from '../utils/layout-stability';
import {
  HIGHLIGHT_CONSISTENCY_CONFIG,
  evaluateHighlightConsistency,
} from '../utils/highlight-consistency';
import { HIGHLIGHT_SCREENSHOT_CAPTURE_OPTIONS } from '../utils/highlight-screenshot';
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

        wsClient.sendCommand(responseWithId as any).catch((error) => {
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
        wsClient.sendCommand(errorResponse as any).catch(console.error);
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
        wsClient.sendCommand({ type: 'ping' } as any).catch(() => {
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
        wsClient.sendCommand(errorResponse as any).catch(console.error);
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
              0,
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
        const elementType =
          command.element_type || (keywords ? 'any' : 'clickable');
        const page = command.page || 1;

        // Build script to detect elements IN PAGE CONTEXT
        const detectionScript = `
          (async function() {
            const elementType = "${elementType}";
            ${buildHitTestVisibilityHelpersScript()}
            ${buildLayoutStabilityHelpersScript()}
            const traceStart = performance.now();

            function trace(stage, details) {
              const elapsed = Math.round(performance.now() - traceStart);
              const suffix = details ? ' ' + details : '';
              console.log('[HighlightTrace] ' + stage + ' +' + elapsed + 'ms' + suffix);
            }

            async function waitForLayoutStability() {
              const startTime = performance.now();

              function isRectInViewport(rect) {
                return rect.width > 0 &&
                       rect.height > 0 &&
                       rect.top < window.innerHeight &&
                       rect.bottom > 0 &&
                       rect.left < window.innerWidth &&
                       rect.right > 0;
              }

              function countPendingViewportImages() {
                return Array.from(document.images).filter((img) => {
                  const rect = img.getBoundingClientRect();
                  return isRectInViewport(rect) && !img.complete;
                }).length;
              }

              function countViewportMedia() {
                const mediaElements = Array.from(
                  document.querySelectorAll('img, video, canvas'),
                );
                let total = 0;
                let complete = 0;

                for (const media of mediaElements) {
                  const rect = media.getBoundingClientRect();
                  if (!isRectInViewport(rect)) {
                    continue;
                  }

                  total++;

                  if (
                    media.tagName === 'IMG' &&
                    'complete' in media &&
                    media.complete
                  ) {
                    complete++;
                    continue;
                  }

                  if (
                    media.tagName === 'VIDEO' &&
                    media.readyState >= 2
                  ) {
                    complete++;
                    continue;
                  }

                  if (media.tagName === 'CANVAS') {
                    complete++;
                  }
                }

                return { total, complete };
              }

              function countVisibleClickableCandidates() {
                const clickableCandidates = document.querySelectorAll(
                  'a, button, [role="button"], input[type="button"], input[type="submit"], input[type="checkbox"], input[type="radio"]',
                );
                let count = 0;

                for (const candidate of clickableCandidates) {
                  const rect = candidate.getBoundingClientRect();
                  if (
                    rect.width <= 0 ||
                    rect.height <= 0 ||
                    !isRectInViewport(rect)
                  ) {
                    continue;
                  }

                  if (!isVisible(candidate)) {
                    continue;
                  }

                  count++;

                  if (count >= 24) {
                    break;
                  }
                }

                return count;
              }

              function collectViewportTextMetrics() {
                const textCandidates = document.querySelectorAll(
                  'h1, h2, h3, h4, p, span, a, button, li',
                );
                let textBlockCount = 0;
                let textCharCount = 0;

                for (const candidate of textCandidates) {
                  const rect = candidate.getBoundingClientRect();
                  if (
                    rect.width <= 0 ||
                    rect.height <= 0 ||
                    !isRectInViewport(rect)
                  ) {
                    continue;
                  }

                  if (!isVisible(candidate)) {
                    continue;
                  }

                  const text = (candidate.textContent || '')
                    .replace(/\\s+/g, ' ')
                    .trim();

                  if (text.length < 8) {
                    continue;
                  }

                  textBlockCount++;
                  textCharCount += Math.min(text.length, 120);

                  if (textBlockCount >= 24 || textCharCount >= 800) {
                    break;
                  }
                }

                return { textBlockCount, textCharCount };
              }

              function getPageMetrics() {
                const viewportMedia = countViewportMedia();
                const viewportText = collectViewportTextMetrics();
                return {
                  bodyHeight: Math.round(document.body?.getBoundingClientRect().height || 0),
                  scrollHeight: Math.round(document.documentElement?.scrollHeight || 0),
                  pendingImages: countPendingViewportImages(),
                  viewportMediaCount: viewportMedia.total,
                  completeViewportMediaCount: viewportMedia.complete,
                  textBlockCount: viewportText.textBlockCount,
                  textCharCount: viewportText.textCharCount,
                  visibleClickableCount: countVisibleClickableCandidates(),
                };
              }

              const finalMetrics = getPageMetrics();
              const pageReady = document.readyState === 'complete';
              const viewportImagesReady = finalMetrics.pendingImages === 0;
              const meaningfulContent =
                hasMeaningfulViewportContent(finalMetrics);
              const contentScore = getLayoutContentScore(finalMetrics);
              const stabilized =
                pageReady && viewportImagesReady && meaningfulContent;

              return {
                stabilized,
                waitedMs: Math.round(performance.now() - startTime),
                quietForMs: stabilized ? layoutStabilityConfig.quietWindowMs : 0,
                meaningfulContent,
                contentScore,
                pendingViewportImages: finalMetrics.pendingImages,
                bodyHeight: finalMetrics.bodyHeight,
                scrollHeight: finalMetrics.scrollHeight,
                viewportMediaCount: finalMetrics.viewportMediaCount,
                completeViewportMediaCount: finalMetrics.completeViewportMediaCount,
                textBlockCount: finalMetrics.textBlockCount,
                textCharCount: finalMetrics.textCharCount,
                visibleClickableCount: finalMetrics.visibleClickableCount,
                pageReady,
              };
            }

            trace('start', 'elementType=' + elementType);
            
            function isVisible(el) {
              const style = window.getComputedStyle(el);
              return style.display !== 'none' && 
                     style.visibility !== 'hidden' && 
                     style.opacity !== '0';
            }
            
            function isInViewport(el) {
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0 &&
                     rect.top < window.innerHeight && rect.bottom > 0;
            }
            
            function getBBox(el) {
              const rect = el.getBoundingClientRect();
              return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
            }
            
            function generateSelector(el) {
              // Priority 1: ID (most unique)
              if (el.id) {
                try {
                  return '#' + CSS.escape(el.id);
                } catch (e) {
                  // Fallback if CSS.escape not available
                  return '#' + el.id.replace(/([.#\[\],\s:+>~])/g, '\\$1');
                }
              }
              
              // Priority 2: name attribute
              const name = el.getAttribute('name');
              if (name) {
                try {
                  return '[name="' + CSS.escape(name) + '"]';
                } catch (e) {
                  return '[name="' + name.replace(/"/g, '\\"') + '"]';
                }
              }
              
              // Priority 3: data-testid
              const dataTestId = el.getAttribute('data-testid');
              if (dataTestId) {
                try {
                  return '[data-testid="' + CSS.escape(dataTestId) + '"]';
                } catch (e) {
                  return '[data-testid="' + dataTestId.replace(/"/g, '\\"') + '"]';
                }
              }
              
              // Priority 4: aria-label
              const ariaLabel = el.getAttribute('aria-label');
              if (ariaLabel) {
                try {
                  return '[aria-label="' + CSS.escape(ariaLabel) + '"]';
                } catch (e) {
                  return '[aria-label="' + ariaLabel.replace(/"/g, '\\"') + '"]';
                }
              }
              
              // Priority 5: Build full CSS path with nth-of-type for uniqueness
              const path = [];
              let current = el;
              
              while (current && current !== document.documentElement) {
                let selector = current.tagName.toLowerCase();
                
                // Add nth-of-type if there are siblings with same tag
                const parent = current.parentElement;
                if (parent) {
                  const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
                  if (siblings.length > 1) {
                    const index = siblings.indexOf(current) + 1;
                    selector += ':nth-of-type(' + index + ')';
                  }
                }
                
                path.unshift(selector);
                current = parent;
                
                // Stop if path is already unique
                if (parent) {
                  try {
                    const testSelector = path.join(' > ');
                    if (document.querySelectorAll(testSelector).length === 1) {
                      break;
                    }
                  } catch (e) {
                    // Invalid selector, continue building path
                  }
                }
              }
              
              return path.join(' > ');
            }
            
            function isClickable(el) {
              const tag = el.tagName.toLowerCase();

              // Exclude <select> elements - they should be detected as 'selectable' type
              // <select>'s intent is to "choose a value", not "trigger/click"
              if (tag === 'select') return false;

              // Check tag names
              if (tag === 'a' || tag === 'button') return true;
              
              // Check input types
              if (tag === 'input') {
                const type = el.type?.toLowerCase();
                // Include interactive input types: submit, button, image, reset, checkbox, radio
                if (type === 'submit' || type === 'button' || type === 'image' || type === 'reset' || 
                    type === 'checkbox' || type === 'radio') {
                  return true;
                }
                return false;
              }
              
              // Check attributes
              if (el.getAttribute('role') === 'button') return true;
              if (el.hasAttribute('onclick')) return true;
              if (el.hasAttribute('ng-click')) return true;
              if (el.hasAttribute('@click')) return true;
              
              // Check for cursor: pointer style (broad indicator of interactivity)
              // But exclude large container elements that might be styled this way
              const style = window.getComputedStyle(el);
              if (style.cursor === 'pointer') {
                // Exclude body/html and very large container elements
                if (tag === 'body' || tag === 'html') {
                  return false;
                }
                
                // Check if element is unreasonably large (more than 80% of viewport)
                const rect = el.getBoundingClientRect();
                const viewportArea = window.innerWidth * window.innerHeight;
                const elementArea = rect.width * rect.height;
                if (elementArea > viewportArea * 0.8) {
                  return false;
                }
                
                // IMPORTANT: Skip container elements that have clickable children
                // This prevents parent containers from overlapping with their children
                if (hasClickableChildren(el)) {
                  return false;
                }
                
                // IMPORTANT: Skip elements that have a clickable ancestor
                // This prevents nested elements inside <a>, <button>, etc. from being detected separately
                if (hasClickableAncestor(el)) {
                  return false;
                }
                
                return true;
              }
              
              return false;
            }
            
            // Check if element has a clickable ancestor (traverse up the DOM tree)
            // This prevents nested elements inside <a>, <button>, etc. from being detected as separate clickables
            function hasClickableAncestor(el) {
              let parent = el.parentElement;
              
              while (parent && parent !== document.body) {
                const parentTag = parent.tagName.toLowerCase();
                
                // Check if parent is inherently clickable (tag-based)
                if (parentTag === 'a' || parentTag === 'button') {
                  return true;
                }
                
                // Check for input types that are clickable
                if (parentTag === 'input') {
                  const type = parent.type?.toLowerCase();
                  // Include interactive input types: submit, button, image, reset, checkbox, radio
                  if (type === 'submit' || type === 'button' || type === 'image' || type === 'reset' ||
                      type === 'checkbox' || type === 'radio') {
                    return true;
                  }
                }
                
                // Check for explicit click attributes
                if (parent.getAttribute('role') === 'button' ||
                    parent.hasAttribute('onclick') ||
                    parent.hasAttribute('ng-click') ||
                    parent.hasAttribute('@click')) {
                  return true;
                }
                
                parent = parent.parentElement;
              }
              
              return false;
            }
            
            // Check if element contains any clickable children (depth 2)
            // Only check for explicit interactive elements, not cursor: pointer (which may be inherited)
            function hasClickableChildren(el) {
              const interactiveDescendants = [];

              function isExplicitInteractiveElement(node) {
                const nodeTag = node.tagName.toLowerCase();
                if (nodeTag === 'button' || nodeTag === 'a' || nodeTag === 'select' || nodeTag === 'textarea') {
                  return true;
                }

                if (nodeTag === 'input') {
                  return true;
                }

                if (node.getAttribute('role') === 'button') {
                  return true;
                }

                if (
                  node.hasAttribute('onclick') ||
                  node.hasAttribute('ng-click') ||
                  node.hasAttribute('@click')
                ) {
                  return true;
                }

                return false;
              }

              function collectInteractiveDescendants(node, depth) {
                if (depth > 3) return;

                const children = node.children;
                for (let i = 0; i < children.length; i++) {
                  const child = children[i];
                  const childRect = child.getBoundingClientRect();
                  if (childRect.width <= 0 || childRect.height <= 0) {
                    continue;
                  }
                  if (!isVisible(child)) {
                    continue;
                  }
                  if (!getElementHitTestVisibility(child).visible) {
                    continue;
                  }
                  if (isExplicitInteractiveElement(child)) {
                    interactiveDescendants.push(child);
                    continue;
                  }
                  collectInteractiveDescendants(child, depth + 1);
                }
              }

              collectInteractiveDescendants(el, 1);

              if (interactiveDescendants.length >= 2) {
                return true;
              }

              if (interactiveDescendants.length === 1) {
                const parentRect = el.getBoundingClientRect();
                const childRect = interactiveDescendants[0].getBoundingClientRect();
                const parentArea = parentRect.width * parentRect.height;
                const childArea = childRect.width * childRect.height;

                if (parentArea > 0 && childArea / parentArea >= 0.6) {
                  return true;
                }
              }

              return false;
            }
            
            function isScrollable(el) {
              const style = window.getComputedStyle(el);
              const overflow = style.overflow + style.overflowY + style.overflowX;
              
              // 1. 传统滚动：overflow为auto/scroll
              const hasScrollStyle = overflow.includes('auto') || overflow.includes('scroll');
              
              // 2. 隐藏overflow但实际可滚动（Swiper、transform滚动等）
              const isHiddenButScrollable = style.overflow === 'hidden';
              
              // 3. 检测实际滚动能力（垂直和水平）
              const hasVerticalScroll = el.scrollHeight > el.clientHeight;
              const hasHorizontalScroll = el.scrollWidth > el.clientWidth;
              const canScroll = hasVerticalScroll || hasHorizontalScroll;
              
              // 4. 排除body和html（避免误检整个页面）
              const tag = el.tagName.toLowerCase();
              if (tag === 'body' || tag === 'html') return false;
              
              // 5. 组合条件：有scroll样式或hidden但可滚动
              return (hasScrollStyle || isHiddenButScrollable) && canScroll;
            }
            
            function isInputable(el) {
              const tag = el.tagName.toLowerCase();
              if (tag === 'input' || tag === 'textarea') return true;
              if (el.getAttribute('contenteditable') === 'true') return true;
              return false;
            }
            
            function isHoverable(el) {
              const style = window.getComputedStyle(el);
              if (style.cursor !== 'pointer') return false;
              
              // Exclude if element has a clickable ancestor (prevent duplicates)
              let parent = el.parentElement;
              while (parent && parent !== document.body) {
                const parentTag = parent.tagName.toLowerCase();
                // Check if parent is inherently clickable
                if (['a', 'button', 'input', 'select', 'textarea'].includes(parentTag)) {
                  return false;
                }
                // Check if parent has click handlers
                if (parent.getAttribute('role') === 'button' || 
                    parent.onclick || parent.getAttribute('onclick') ||
                    parent.getAttribute('ng-click') || parent.getAttribute('@click')) {
                  return false;
                }
                parent = parent.parentElement;
              }
              return true;
            }

            function isSelectable(el) {
              const tag = el.tagName.toLowerCase();
              if (tag === 'select') return true;
              return false;
            }

            trace('layoutStability:start');
            const layoutStability = await waitForLayoutStability();
            trace(
              'layoutStability:end',
              'stabilized=' + layoutStability.stabilized +
                ' waitedMs=' + layoutStability.waitedMs +
                ' pendingImages=' + layoutStability.pendingViewportImages,
            );
            const counts = { clickable: 0, scrollable: 0, inputable: 0, hoverable: 0, selectable: 0 };
            const elements = [];
            trace('querySelectorAll:start');
            const allElements = Array.from(document.querySelectorAll('*'));
            trace('querySelectorAll:end', 'count=' + allElements.length);
            const activeTopLayerRoot = getActiveTopLayerRoot();
            trace('scan:start');
            let scannedCount = 0;
            
            for (const el of allElements) {
              scannedCount++;
              if (scannedCount % 1000 === 0) {
                trace(
                  'scan:progress',
                  'processed=' + scannedCount + ' matched=' + elements.length,
                );
              }
              if (!isVisible(el)) continue;
              if (!isInViewport(el)) continue;
              if (!isElementInActiveTopLayer(el, activeTopLayerRoot)) continue;
              if (!getElementHitTestVisibility(el).visible) continue;
              
              let type = null;
              if (elementType === 'any') {
                // Check all types in priority order, assign first match
                // Priority: clickable > scrollable > inputable > hoverable > selectable
                if (isClickable(el)) type = 'clickable';
                else if (isScrollable(el)) type = 'scrollable';
                else if (isInputable(el)) type = 'inputable';
                else if (isHoverable(el)) type = 'hoverable';
                else if (isSelectable(el)) type = 'selectable';
              } else if (elementType === 'clickable' && isClickable(el)) type = 'clickable';
              else if (elementType === 'scrollable' && isScrollable(el)) type = 'scrollable';
              else if (elementType === 'inputable' && isInputable(el)) type = 'inputable';
              else if (elementType === 'hoverable' && isHoverable(el)) type = 'hoverable';
              else if (elementType === 'selectable' && isSelectable(el)) type = 'selectable';
              
              if (type) {
                const bbox = getBBox(el);
                if (bbox.width > 0 && bbox.height > 0) {
                  elements.push({
                    id: '',  // Placeholder - will be replaced by hash in background script
                    type: type,
                    tagName: el.tagName.toLowerCase(),
                    selector: generateSelector(el),
                    html: el.outerHTML ? el.outerHTML.trim() : undefined,
                    bbox: bbox,
                    isVisible: true,
                    isInViewport: true
                  });
                  counts[type]++;
                }
              }
            }
            trace(
              'scan:end',
              'processed=' + scannedCount +
                ' matched=' + elements.length +
                ' counts=' + JSON.stringify(counts),
            );
            
            // Smart sorting: prioritize action buttons over large containers
            trace('sort:start', 'count=' + elements.length);
            elements.sort((a, b) => {
              function getPriority(el) {
                const tag = el.tagName.toLowerCase();
                const area = el.bbox.width * el.bbox.height;
                const viewportArea = window.innerWidth * window.innerHeight;
                const sizeRatio = area / viewportArea;
                let score = 0;
                
                // 1. BUTTON elements get highest priority
                if (tag === 'button') score += 2000;
                
                // 2. Links get medium priority
                if (tag === 'a') score += 1000;
                
                // 3. Penalize large containers (>5% of viewport)
                if (sizeRatio > 0.05) score -= 1000;
                
                // 4. Boost small interactive elements (<0.5% of viewport)
                if (sizeRatio < 0.005 && sizeRatio > 0.00001) score += 500;
                
                // 5. Position: top elements first (lower Y = higher priority)
                score += Math.max(0, 2000 - el.bbox.y);
                
                return score;
              }
              return getPriority(b) - getPriority(a);
            });
            trace('sort:end', 'count=' + elements.length);
            
            // Deduplicate: Remove larger elements that mostly contain smaller elements
            trace('dedupe:start', 'count=' + elements.length);
            const deduplicated = [];
            const SKIP_OVERLAP_RATIO = 0.6; // If smaller element overlaps >60% with larger, skip larger
            
            for (let i = 0; i < elements.length; i++) {
              const larger = elements[i];
              const largerArea = larger.bbox.width * larger.bbox.height;
              let shouldSkip = false;
              
              // Check if this larger element mostly contains any smaller element already added
              for (let j = i + 1; j < elements.length; j++) {
                const smaller = elements[j];
                const smallerArea = smaller.bbox.width * smaller.bbox.height;
                
                // Skip if not much smaller (allow 20% size difference)
                if (smallerArea > largerArea * 0.8) continue;
                
                // Calculate overlap
                const xOverlap = Math.max(0, Math.min(larger.bbox.x + larger.bbox.width, smaller.bbox.x + smaller.bbox.width) - Math.max(larger.bbox.x, smaller.bbox.x));
                const yOverlap = Math.max(0, Math.min(larger.bbox.y + larger.bbox.height, smaller.bbox.y + smaller.bbox.height) - Math.max(larger.bbox.y, smaller.bbox.y));
                const overlapArea = xOverlap * yOverlap;
                
                // If smaller element is mostly (>60%) inside the larger element, skip the larger
                if (overlapArea / smallerArea > SKIP_OVERLAP_RATIO) {
                  shouldSkip = true;
                  break;
                }
              }
              
              if (!shouldSkip) {
                deduplicated.push(larger);
              }
            }
            trace(
              'dedupe:end',
              'before=' + elements.length + ' after=' + deduplicated.length,
            );
            
            
            trace(
              'return',
              'elements=' + deduplicated.length + ' totalElapsed=' + Math.round(performance.now() - traceStart) + 'ms',
            );
            return {
              elements: deduplicated,
              counts,
              layoutStability,
              viewport: {
                width: window.innerWidth,
                height: window.innerHeight
              }
            };
          })();
        `;

        const maxHighlightAttempts = 3;

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
            12000, // timeout
          );

          if (!detectionResult.success || !detectionResult.result?.value) {
            return {
              success: false,
              error: detectionResult.error || 'Failed to detect elements',
              timestamp: Date.now(),
            };
          }

          const allElements = detectionResult.result.value.elements || [];
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
              `⏳ [HighlightElements] Layout stability: ${JSON.stringify(layoutStability)}`,
            );
          }

          if (
            layoutStability &&
            !layoutStability.stabilized &&
            attempt < maxHighlightAttempts
          ) {
            const retryDelayMs = 250 * attempt;
            console.warn(
              `⚠️ [HighlightElements] Quick stability check says page is still settling, retrying in ${retryDelayMs}ms (attempt ${attempt}/${maxHighlightAttempts})`,
            );
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
            continue;
          }

          // Process keywords if provided (keywords list)
          const keywordFilterStart = Date.now();
          let keywordList: string[] = [];
          if (keywords && keywords.length > 0) {
            keywordList = keywords
              .map((k) => k.trim().toLowerCase())
              .filter((k) => k.length > 0);
          }

          // Filter by keywords if keyword list is not empty
          let filteredElements = allElements;
          if (keywordList.length > 0) {
            filteredElements = allElements.filter((el: InteractiveElement) => {
              if (!el.html) return false;
              const htmlLower = el.html.toLowerCase();
              // Match if ANY keyword is found (OR logic)
              return keywordList.some((keyword) => htmlLower.includes(keyword));
            });
            console.log(
              `🔍 [HighlightElements] Keywords [${keywordList.join(', ')}] matched ${filteredElements.length} of ${allElements.length} elements`,
            );
          }
          console.log(
            `⏱️ [HighlightTrace] background keyword-filter ${Date.now() - keywordFilterStart}ms (keywords=${keywordList.length}, kept=${filteredElements.length}/${allElements.length})`,
          );

          // Generate hash IDs for filtered elements (collision-free, content-aware)
          const hashStart = Date.now();
          const existingHashes = new Set<string>();
          for (const element of filteredElements) {
            const { id } = generateElementId(
              element.type,
              element.selector,
              existingHashes,
              element.html,
            );
            element.id = id;
            existingHashes.add(id);
          }
          console.log(
            `⏱️ [HighlightTrace] background hash-ids ${Date.now() - hashStart}ms (count=${filteredElements.length})`,
          );

          let paginatedElements: InteractiveElement[];
          let totalPages: number;
          let currentPage = page;

          if (keywordList.length > 0) {
            // Keyword mode: return all matching elements, no pagination
            paginatedElements = filteredElements;
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
            70,
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
          const devicePixelRatio =
            screenshotResult.metadata?.devicePixelRatio || 1;
          const viewportWidth = screenshotResult.metadata?.viewportWidth || 0;
          const viewportHeight = screenshotResult.metadata?.viewportHeight || 0;
          console.log(
            `📐 [HighlightElements] Device pixel ratio: ${devicePixelRatio}`,
          );
          console.log(
            `📐 [HighlightElements] Viewport: ${viewportWidth}x${viewportHeight} CSS pixels`,
          );
          console.log(
            `📐 [HighlightElements] Expected image size: ${viewportWidth * devicePixelRatio}x${viewportHeight * devicePixelRatio} device pixels`,
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

          if (
            highlightConsistency.shouldRetry &&
            attempt < maxHighlightAttempts
          ) {
            console.warn(
              `⚠️ [HighlightElements] Layout drift detected after screenshot, retrying (attempt ${attempt}/${maxHighlightAttempts})`,
            );
            continue;
          }

          if (highlightConsistency.shouldRetry) {
            console.warn(
              `⚠️ [HighlightElements] Layout drift still detected on final attempt, returning latest screenshot`,
            );
          }

          const cacheStoreStart = Date.now();
          elementCache.storeElements(
            conversationId,
            activeTabId,
            filteredElements,
          );
          console.log(
            `⏱️ [HighlightTrace] background cache-store ${Date.now() - cacheStoreStart}ms (count=${filteredElements.length})`,
          );

          // Log first few element bboxes for debugging
          if (paginatedElements.length > 0) {
            console.log(
              `📍 [HighlightElements] First element bbox:`,
              JSON.stringify(paginatedElements[0].bbox),
            );
          }

          // Draw highlights on screenshot (scale coordinates by DPR)
          const drawHighlightsStart = Date.now();
          const highlightedScreenshot = await drawHighlights(
            screenshotResult.imageData,
            paginatedElements,
            {
              scale: devicePixelRatio,
              viewportWidth,
              viewportHeight,
            },
          );
          console.log(
            `⏱️ [HighlightTrace] background draw-highlights ${Date.now() - drawHighlightsStart}ms (elements=${paginatedElements.length})`,
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
              elements: paginatedElements,
              totalElements: filteredElements.length,
              totalPages: totalPages,
              page: currentPage,
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

      case 'keyboard_input': {
        if (!command.conversation_id)
          throw new Error('conversation_id required');
        const inputTabId = command.tab_id;
        if (inputTabId === undefined || inputTabId === null)
          throw new Error('tab_id is required');

        const inputResult = await performKeyboardInput(
          command.conversation_id,
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

        if (!elementId) {
          throw new Error('element_id is required for get_element_html');
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
          elementId,
        );

        if (!element) {
          console.warn(
            `⚠️ [GetElementHtml] Element ${elementId} not found in cache for conversation ${conversationId}, tab ${activeTabId}`,
          );
          return {
            success: false,
            error: `Element ${elementId} not found in cache. The element may have been invalidated or the page may have changed. Try highlight_elements again.`,
            data: { element_id: elementId, html: null },
            timestamp: Date.now(),
          };
        }

        // Return the cached HTML
        const html = element.html || '<not available>';
        console.log(
          `✅ [GetElementHtml] Retrieved HTML for element ${elementId} from cache (${html.length} chars)`,
        );

        return {
          success: true,
          message: `Retrieved HTML for element ${elementId}`,
          data: {
            element_id: elementId,
            html: html,
            tagName: element.tagName,
            type: element.type,
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
        if (!activeTabId) {
          throw new Error(`No active tab for conversation ${conversationId}`);
        }

        // Get element from cache
        const element = elementCache.getElementById(
          conversationId,
          activeTabId,
          command.element_id,
        );
        if (!element) {
          return {
            success: false,
            error: `Element ${command.element_id} not found in cache. Call highlight_elements() first.`,
            timestamp: Date.now(),
          };
        }

        // ============================================================
        // Re-fetch current bbox using cached selector (bbox may be stale if page scrolled)
        // ============================================================
        const escapedSelector = element.selector
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"');
        const bboxScript = `
          (function() {
            const el = document.querySelector("${escapedSelector}");
            if (!el) return null;
            const rect = el.getBoundingClientRect();
            return {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height
            };
          })();
        `;

        let freshBbox = element.bbox; // Default to cached bbox
        try {
          const bboxResult = await javascript.executeJavaScript(
            activeTabId,
            conversationId,
            bboxScript,
            true,
            false,
            5000,
          );
          if (bboxResult.success && bboxResult.result?.value) {
            const fetchedBbox = bboxResult.result.value as {
              x: number;
              y: number;
              width: number;
              height: number;
            };
            freshBbox = fetchedBbox;
            console.log(
              `📐 [SingleHighlight] Fresh bbox for ${element.id}:`,
              JSON.stringify(freshBbox),
            );
          } else {
            console.warn(
              `⚠️ [SingleHighlight] Failed to fetch fresh bbox for ${element.id}:`,
              {
                error: bboxResult.error,
                selector: element.selector,
                cachedBbox: element.bbox,
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
          80,
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
              `Element ${element.id} is not visible in the current viewport. ${scrollHint}`.trim(),
            data: {
              elementId: element.id,
              bbox: freshBbox,
              viewportWidth,
              viewportHeight,
            },
            timestamp: Date.now(),
          };
        }

        // Create element with fresh bbox for drawing
        const elementWithFreshBbox = {
          ...element,
          bbox: freshBbox,
        };

        // Draw single element highlight
        const highlightedScreenshot = await highlightSingleElement(
          screenshotResult.imageData,
          elementWithFreshBbox,
          {
            scale: screenshotResult.metadata?.devicePixelRatio || 1,
            viewportWidth: screenshotResult.metadata?.viewportWidth || 0,
            viewportHeight: screenshotResult.metadata?.viewportHeight || 0,
          },
        );

        return {
          success: true,
          data: {
            html: element.html || '',
            screenshot: await compressIfNeeded(
              highlightedScreenshot,
              getCompressionThreshold(),
            ),
            elementId: command.element_id,
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
    await wsClient.sendCommand(event as any);
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
