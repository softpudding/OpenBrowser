/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Dialog Handling - JavaScript Dialog Manager
 *
 * Handles browser native dialogs (alert, confirm, prompt, beforeunload)
 * using Chrome DevTools Protocol (CDP).
 *
 * DESIGN PRINCIPLES:
 * 1. Dialog state is per-tab, not per-conversation (dialog is a browser-level concept)
 * 2. Only one dialog can be open at a time per tab (browser behavior)
 * 3. Cascading dialogs: handling one dialog may trigger another
 * 4. During dialog state: JS execution and screenshot are BLOCKED
 *
 * STATE MACHINE:
 * - IDLE: No dialog, normal operations allowed
 * - DIALOG_OPEN: Dialog blocking, only handle_dialog allowed
 *
 * FLOW:
 * 1. javascript_execute triggers dialog
 * 2. DialogManager stores dialog info, returns dialog_opened result
 * 3. Server/AI decides: handle_dialog or error
 * 4. handle_dialog executes, may trigger cascading dialog
 * 5. If cascading: repeat from step 2
 * 6. If no cascade: return to IDLE, normal operations resume
 */

import { CdpCommander } from './cdp-commander';

// ============================================================================
// Types
// ============================================================================

export type DialogType = 'alert' | 'confirm' | 'prompt' | 'beforeunload';
export type DialogAction = 'accept' | 'dismiss';

/**
 * Dialog types that require AI decision
 */
export const DECISION_REQUIRED_TYPES: Set<DialogType> = new Set([
  'confirm',
  'prompt',
  'beforeunload',
]);

/**
 * Information about an open dialog
 */
export interface DialogInfo {
  tabId: number;
  conversationId: string;
  dialogType: DialogType;
  message: string;
  url: string;
  timestamp: number;
  hasBrowserHandler: boolean;
  needsDecision: boolean; // true for confirm/prompt/beforeunload
}

/**
 * Result returned when a dialog opens during JS execution
 */
export interface DialogOpenedResult {
  status: 'dialog_opened';
  dialog: {
    type: DialogType;
    message: string;
    url?: string;
    needsDecision: boolean;
  };
}

/**
 * Result returned when a dialog is auto-accepted (alert)
 */
export interface DialogAutoAcceptedResult {
  status: 'dialog_auto_accepted';
  dialog: {
    type: 'alert';
    message: string;
    url?: string;
  };
}

/**
 * Result returned after handling a dialog
 */
export interface DialogHandledResult {
  status: 'dialog_handled' | 'dialog_cascaded';
  previousDialog: {
    type: DialogType;
    action: DialogAction;
  };
  newDialog?: {
    type: DialogType;
    message: string;
    url?: string;
    needsDecision: boolean;
  };
}

// ============================================================================
// DialogManager Class
// ============================================================================

/**
 * DialogManager - Singleton that manages JavaScript dialog handling
 *
 * CRITICAL: This class manages GLOBAL dialog state. Only one dialog
 * can be open per tab at any time (browser limitation).
 */
export class DialogManager {
  // Global dialog event listener
  private dialogListener:
    | ((
        source: chrome.debugger.Debuggee,
        method: string,
        params?: object,
      ) => void)
    | null = null;

  // Active dialogs: tabId -> DialogInfo
  private activeDialogs = new Map<number, DialogInfo>();

  // Tabs with dialog handling enabled
  private enabledTabs = new Set<number>();

  // Dialog event resolvers: tabId -> resolve function
  // Used to signal when a dialog opens during JS execution
  private dialogResolvers = new Map<number, (dialogInfo: DialogInfo) => void>();

  // Cascade detection window (ms)
  private readonly CASCADE_WINDOW = 150;

  /**
   * Enable dialog handling for a tab
   * Must be called before executing JavaScript that might trigger dialogs
   */
  async enableForTab(tabId: number): Promise<void> {
    console.log(`💬 [Dialog] Enabling dialog handling for tab ${tabId}`);

    if (this.enabledTabs.has(tabId)) {
      console.log(`💬 [Dialog] Already enabled for tab ${tabId}`);
      return;
    }

    // Ensure debugger is attached (DialogManager doesn't manage debugger lifecycle)
    // The caller (executeJavaScript) should have already attached debugger

    // Register global listener if not already registered
    if (!this.dialogListener) {
      this.dialogListener = (
        source: chrome.debugger.Debuggee,
        method: string,
        params?: object,
      ) => {
        if (
          method === 'Page.javascriptDialogOpening' &&
          source.tabId !== undefined
        ) {
          this.handleDialogOpening(source.tabId, params);
        }
      };
      chrome.debugger.onEvent.addListener(this.dialogListener);
      console.log('✅ [Dialog] Global dialog event listener registered');
    }

    // Enable Page domain to receive dialog events
    const cdpCommander = new CdpCommander(tabId);
    try {
      await cdpCommander.sendCommand('Page.enable', {}, 5000);
      console.log(`✅ [Dialog] Page domain enabled for tab ${tabId}`);
    } catch (error) {
      // Page.enable may fail if already enabled, which is fine
      console.warn(
        `⚠️ [Dialog] Page.enable failed (may already be enabled):`,
        error,
      );
    }

    this.enabledTabs.add(tabId);
    console.log(`✅ [Dialog] Dialog handling enabled for tab ${tabId}`);
  }

  /**
   * Disable dialog handling for a tab
   */
  disableForTab(tabId: number): void {
    console.log(`💬 [Dialog] Disabling dialog handling for tab ${tabId}`);
    this.enabledTabs.delete(tabId);
    this.activeDialogs.delete(tabId);
    this.dialogResolvers.delete(tabId);
  }

  /**
   * Register a resolver to be called when a dialog opens for this tab
   * This is used by executeJavaScript to wait for dialog events
   */
  setDialogResolver(
    tabId: number,
    resolver: (dialogInfo: DialogInfo) => void,
  ): void {
    this.dialogResolvers.set(tabId, resolver);
    console.log(`💬 [Dialog] Resolver registered for tab ${tabId}`);
  }

  /**
   * Clear the dialog resolver for a tab
   */
  clearDialogResolver(tabId: number): void {
    this.dialogResolvers.delete(tabId);
    console.log(`💬 [Dialog] Resolver cleared for tab ${tabId}`);
  }

  /**
   * Check if there's an active dialog for a tab
   */
  hasActiveDialog(tabId: number): boolean {
    return this.activeDialogs.has(tabId);
  }

  /**
   * Get active dialog info for a tab
   */
  getActiveDialog(tabId: number): DialogInfo | undefined {
    return this.activeDialogs.get(tabId);
  }

  /**
   * Handle Page.javascriptDialogOpening event
   * Called by the global listener when any dialog opens
   */
  private handleDialogOpening(tabId: number, params: any): void {
    console.log(`💬 [Dialog] Dialog opening on tab ${tabId}:`, params);

    // Only process if dialog handling is enabled for this tab
    if (!this.enabledTabs.has(tabId)) {
      console.log(
        `💬 [Dialog] Dialog handling not enabled for tab ${tabId}, ignoring`,
      );
      return;
    }

    const dialogType = params.type as DialogType;
    const dialogInfo: DialogInfo = {
      tabId,
      conversationId: '', // Will be set by caller
      dialogType,
      message: params.message || '',
      url: params.url || '',
      timestamp: Date.now(),
      hasBrowserHandler: params.hasBrowserHandler || false,
      needsDecision: DECISION_REQUIRED_TYPES.has(dialogType),
    };

    // Store dialog info
    this.activeDialogs.set(tabId, dialogInfo);
    console.log(
      `💬 [Dialog] Dialog stored: type=${dialogType}, needsDecision=${dialogInfo.needsDecision}`,
    );

    // Notify resolver if registered (executeJavaScript is waiting)
    const resolver = this.dialogResolvers.get(tabId);
    if (resolver) {
      console.log(`💬 [Dialog] Notifying resolver for tab ${tabId}`);
      resolver(dialogInfo);
    }
  }

  /**
   * Handle a dialog (accept or dismiss)
   * Returns information about any cascading dialog
   */
  async handleDialog(
    tabId: number,
    action: DialogAction,
    promptText?: string,
  ): Promise<DialogHandledResult> {
    console.log(
      `💬 [Dialog] Handling dialog on tab ${tabId}: action=${action}, promptText=${promptText}`,
    );

    const existingDialog = this.activeDialogs.get(tabId);
    if (!existingDialog) {
      throw new Error(`No active dialog found for tab ${tabId}`);
    }

    const cdpCommander = new CdpCommander(tabId);
    const previousType = existingDialog.dialogType;

    // Set up resolver to detect cascading dialog
    let cascadeDialog: DialogInfo | null = null;
    const cascadeResolver = (info: DialogInfo) => {
      cascadeDialog = info;
    };
    this.setDialogResolver(tabId, cascadeResolver);

    try {
      // Execute Page.handleJavaScriptDialog
      await cdpCommander.sendCommand(
        'Page.handleJavaScriptDialog',
        {
          accept: action === 'accept',
          promptText: promptText || '',
        },
        5000,
      );

      console.log(`✅ [Dialog] Dialog handled: ${action}`);

      // Clear the handled dialog
      this.activeDialogs.delete(tabId);

      // Wait for cascade window to detect if a new dialog opens
      await this.waitForCascade();

      // Check if a cascading dialog opened
      if (cascadeDialog) {
        const cd: DialogInfo = cascadeDialog; // Type guard for TypeScript
        console.log(
          `💬 [Dialog] Cascading dialog detected: type=${cd.dialogType}`,
        );

        return {
          status: 'dialog_cascaded',
          previousDialog: {
            type: previousType,
            action,
          },
          newDialog: {
            type: cd.dialogType,
            message: cd.message,
            url: cd.url,
            needsDecision: cd.needsDecision,
          },
        };
      }

      console.log(`✅ [Dialog] No cascade, dialog handling complete`);

      return {
        status: 'dialog_handled',
        previousDialog: {
          type: previousType,
          action,
        },
      };
    } catch (error) {
      console.error(`❌ [Dialog] Failed to handle dialog:`, error);
      // Don't clear dialog info on error - it might still be open
      throw new Error(
        `Failed to handle dialog: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.clearDialogResolver(tabId);
    }
  }

  /**
   * Auto-accept a dialog (used for alerts that don't need decision)
   */
  async autoAcceptDialog(tabId: number): Promise<void> {
    console.log(`💬 [Dialog] Auto-accepting dialog on tab ${tabId}`);

    const dialogInfo = this.activeDialogs.get(tabId);
    if (!dialogInfo) {
      throw new Error(`No active dialog found for tab ${tabId}`);
    }

    const cdpCommander = new CdpCommander(tabId);

    try {
      await cdpCommander.sendCommand(
        'Page.handleJavaScriptDialog',
        {
          accept: true,
          promptText: '',
        },
        5000,
      );

      this.activeDialogs.delete(tabId);
      console.log(`✅ [Dialog] Dialog auto-accepted`);
    } catch (error) {
      console.error(`❌ [Dialog] Failed to auto-accept dialog:`, error);
      throw error;
    }
  }

  /**
   * Wait for cascade window to detect cascading dialogs
   */
  private waitForCascade(): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, this.CASCADE_WINDOW);
    });
  }

  /**
   * Clean up all dialog handling (for extension shutdown)
   */
  cleanup(): void {
    if (this.dialogListener) {
      chrome.debugger.onEvent.removeListener(this.dialogListener);
      this.dialogListener = null;
    }

    this.enabledTabs.clear();
    this.activeDialogs.clear();
    this.dialogResolvers.clear();
    console.log('✅ [Dialog] Dialog manager cleaned up');
  }
}

// Singleton instance
export const dialogManager = new DialogManager();
