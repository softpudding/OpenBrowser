/**
 * JavaScript Execution Tool Implementation
 * Enables execution of JavaScript code in browser tabs via Chrome DevTools Protocol
 * Uses session-based long connection debugger management
 *
 * DIALOG HANDLING:
 * When JavaScript triggers a dialog (alert/confirm/prompt), Runtime.evaluate hangs.
 * This module uses Promise.race to detect dialogs and handle them gracefully.
 *
 * Flow:
 * 1. Enable dialog handling before execution
 * 2. Race: Runtime.evaluate vs dialog event vs timeout
 * 3. If dialog opens:
 *    - Alert: auto-accept, return result
 *    - Confirm/Prompt: return dialog info, wait for handle_dialog action
 */

import { CdpCommander } from './cdp-commander';
import { tabManager } from './tab-manager';
import { debuggerSessionManager } from './debugger-manager';
import { dialogManager, DialogInfo } from './dialog';

/**
 * CDP Runtime.evaluate response type
 */
interface RuntimeEvaluateResult {
  result?: {
    type: string;
    subtype?: string;
    value?: any;
    description?: string;
    objectId?: string;
    className?: string;
  };
  exceptionDetails?: {
    exception?: {
      type?: string;
      subtype?: string;
      value?: any;
      description?: string;
    };
    text?: string;
    lineNumber?: number;
    columnNumber?: number;
    stackTrace?: any;
  };
}

/**
 * Console output entry type
 */
interface ConsoleOutputEntry {
  type:
    | 'log'
    | 'warn'
    | 'error'
    | 'info'
    | 'debug'
    | 'table'
    | 'trace'
    | 'dir'
    | string;
  args: any[]; // Serialized console arguments
  timestamp: number;
  url?: string;
  line?: number;
  column?: number;
}

/**
 * Result type for executeJavaScript
 */
export interface JavaScriptResult {
  success: boolean;
  message?: string;
  error?: string;
  result?: any;
  consoleOutput?: ConsoleOutputEntry[];
  suggestions?: string[];
  exceptionDetails?: any;
  // Dialog-related fields
  dialog_opened?: boolean;
  dialog?: {
    type: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
    message: string;
    url?: string;
    needsDecision: boolean;
  };
  // Tab creation tracking
  new_tabs_created?: Array<{
    tabId: number;
    url: string;
    title?: string;
    loading?: boolean;
  }>;
}

/**
 * Execute JavaScript code in a tab using CDP Runtime.evaluate
 * Races against dialog events and timeout
 *
 * @param tabId Target tab ID
 * @param conversationId Session ID for debugger lifecycle management (REQUIRED)
 * @param script JavaScript code to execute
 * @param returnByValue If true, returns result as serializable JSON value (default: true)
 * @param awaitPromise If true, waits for Promise resolution (default: false)
 * @param timeout Maximum execution time in milliseconds (default: 30000)
 * @returns Execution result with success status, data, console output, and dialog info if applicable
 */
export async function executeJavaScript(
  tabId: number,
  conversationId: string,
  script: string,
  returnByValue: boolean = true,
  awaitPromise: boolean = false,
  timeout: number = 30000,
  skipNewTabDetection: boolean = false,
): Promise<JavaScriptResult> {
  console.log(
    `📜 [JavaScript] Executing JavaScript in tab ${tabId} session ${conversationId}:`,
    script.substring(0, 100) + (script.length > 100 ? '...' : ''),
  );

  // ============================================================
  // STEP 1: Check for existing dialog (blocking state)
  // Note: We don't handle dialogs here - they will be handled by captureScreenshot
  // ============================================================
  if (dialogManager.hasActiveDialog(tabId)) {
    const existingDialog = dialogManager.getActiveDialog(tabId)!;
    console.log(`💬 [JavaScript] Blocked: dialog already open on tab ${tabId}`);
    return {
      success: false,
      error: `Cannot execute JavaScript: A ${existingDialog.dialogType} dialog is open. Use handle_dialog to respond first.`,
      dialog_opened: true,
      dialog: {
        type: existingDialog.dialogType,
        message: existingDialog.message,
        url: existingDialog.url,
        needsDecision: existingDialog.needsDecision,
      },
    };
  }

  // ============================================================
  // STEP 1.5: Capture current managed tabs for comparison later
  // ============================================================
  const tabsBeforeJs = tabManager.getManagedTabsOnly(conversationId);
  const tabIdsBeforeJs = new Set(tabsBeforeJs.map((tab) => tab.tabId));
  console.log(
    `📊 [JavaScript] Tab snapshot before JS: ${tabIdsBeforeJs.size} tabs`,
  );

  // ============================================================
  // STEP 2: Attach debugger and enable domains
  // ============================================================
  const attached = await debuggerSessionManager.attachDebugger(
    tabId,
    conversationId,
  );
  if (!attached) {
    throw new Error('Failed to attach debugger to tab');
  }

  const cdpCommander = new CdpCommander(tabId);

  // Enable dialog handling for this tab
  await dialogManager.enableForTab(tabId);

  // Collect console output during script execution
  const consoleOutput: ConsoleOutputEntry[] = [];
  let consoleListener:
    | ((
        source: chrome.debugger.Debuggee,
        method: string,
        params?: object,
      ) => void)
    | null = null;

  // Dialog detection state
  let dialogDetected: DialogInfo | null = null;
  let dialogResolve: ((info: DialogInfo) => void) | null = null;
  const dialogPromise = new Promise<DialogInfo>((resolve) => {
    dialogResolve = resolve;
  });

  try {
    // Enable Runtime domain if not already enabled
    try {
      await cdpCommander.sendCommand('Runtime.enable', {}, 5000);
      console.log('✅ [JavaScript] Runtime domain enabled');
    } catch (enableError) {
      console.warn(
        '⚠️ [JavaScript] Runtime.enable failed, but continuing:',
        enableError,
      );
    }

    // Set up console listener to capture console API calls
    consoleListener = (
      source: chrome.debugger.Debuggee,
      method: string,
      params?: object,
    ) => {
      if (source.tabId === tabId && method === 'Runtime.consoleAPICalled') {
        const consoleParams = params as any;

        // Serialize console arguments for transmission
        const serializedArgs = (consoleParams.args || []).map((arg: any) => {
          if (arg.type === 'string') {
            return arg.value || arg.description || '';
          } else if (arg.type === 'number') {
            return arg.value || 0;
          } else if (arg.type === 'boolean') {
            return arg.value || false;
          } else if (arg.type === 'undefined') {
            return undefined;
          } else if (arg.type === 'object' || arg.type === 'function') {
            return (
              arg.description ||
              arg.preview?.description ||
              JSON.stringify(arg.value || {})
            );
          } else {
            return arg.description || arg.value || String(arg);
          }
        });

        consoleOutput.push({
          type: consoleParams.type || 'log',
          args: serializedArgs,
          timestamp: consoleParams.timestamp || Date.now(),
          url: consoleParams.stackTrace?.callFrames?.[0]?.url,
          line: consoleParams.stackTrace?.callFrames?.[0]?.lineNumber,
          column: consoleParams.stackTrace?.callFrames?.[0]?.columnNumber,
        });

        console.log(
          `🖥️ [Console] Captured ${consoleParams.type}:`,
          ...serializedArgs,
        );
      }
    };

    // Register console listener
    chrome.debugger.onEvent.addListener(consoleListener);
    console.log('🎯 [JavaScript] Console listener registered');

    // ============================================================
    // STEP 3: Set up dialog resolver and race
    // ============================================================
    if (dialogResolve) {
      dialogManager.setDialogResolver(tabId, (info: DialogInfo) => {
        dialogDetected = info;
        dialogResolve!(info);
      });
    }

    // Create JS execution promise
    const jsExecutionPromise = cdpCommander.sendCommand<RuntimeEvaluateResult>(
      'Runtime.evaluate',
      {
        expression: script,
        returnByValue,
        awaitPromise,
        timeout: timeout,
      },
      timeout + 5000,
    );

    // Create timeout promise
    const timeoutPromise = new Promise<null>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`JavaScript execution timed out after ${timeout}ms`));
      }, timeout + 5000);
    });

    // Race: JS execution vs dialog event vs timeout
    console.log(
      `📜 [JavaScript] Starting race: JS execution vs dialog vs timeout (${timeout}ms)`,
    );

    try {
      const raceResult = await Promise.race([
        jsExecutionPromise.then((r) => ({ type: 'js' as const, result: r })),
        dialogPromise.then((d) => ({ type: 'dialog' as const, dialog: d })),
        timeoutPromise.then(() => ({ type: 'timeout' as const })),
      ]);

      // ============================================================
      // CASE A: Dialog opened during execution
      // ============================================================
      if (raceResult.type === 'dialog') {
        const dialogInfo = raceResult.dialog;
        console.log(
          `💬 [JavaScript] Dialog opened during execution: type=${dialogInfo.dialogType}, message="${dialogInfo.message}"`,
        );

        // Set conversation ID for the dialog
        dialogInfo.conversationId = conversationId;

        // ALL dialog handling is deferred to captureScreenshot
        // We just return dialog info without auto-accepting even for alerts
        console.log(
          `💬 [JavaScript] Dialog opened during execution: ${dialogInfo.dialogType} (message: "${dialogInfo.message}") - Deferring to captureScreenshot`,
        );

        // Detect new tabs created
        await new Promise((resolve) => setTimeout(resolve, 500));
        const tabsAfterDialog = tabManager.getManagedTabsOnly(conversationId);
        const newTabsDialog = tabsAfterDialog.filter(
          (tab) => !tabIdsBeforeJs.has(tab.tabId),
        );

        return {
          success: true,
          message: `JavaScript execution paused: ${dialogInfo.dialogType} dialog opened. Dialog will be handled by screenshot.`,
          consoleOutput: consoleOutput.length > 0 ? consoleOutput : undefined,
          dialog_opened: true,
          dialog: {
            type: dialogInfo.dialogType,
            message: dialogInfo.message,
            url: dialogInfo.url,
            needsDecision: dialogInfo.needsDecision, // Keep original needsDecision value
          },
          new_tabs_created:
            newTabsDialog.length > 0
              ? newTabsDialog.map((tab) => ({
                  tabId: tab.tabId,
                  url: tab.url,
                  title: tab.title,
                  loading: !tab.url || tab.url === 'chrome://newtab/',
                }))
              : undefined,
        };
      }

      // ============================================================
      // CASE B: JavaScript completed normally
      // ============================================================
      if (raceResult.type === 'js') {
        const result = raceResult.result;
        console.log(`✅ [JavaScript] JavaScript execution completed normally`);

        const response: JavaScriptResult = {
          success: true,
          message: 'JavaScript executed successfully',
          consoleOutput: consoleOutput.length > 0 ? consoleOutput : undefined,
        };

        if (result.exceptionDetails) {
          const exception = result.exceptionDetails.exception;
          response.success = false;

          const errorDescription =
            exception?.description || exception?.value || 'Unknown error';

          if (errorDescription.includes('Illegal return statement')) {
            response.error =
              'JavaScript contains an invalid return statement. Wrap your code in an IIFE: (() => { return value; })()';
            response.suggestions = [
              'Use: (() => { const x = document.title; return {title: x}; })()',
              'Avoid: return document.title (direct return outside function)',
            ];
          } else if (errorDescription.includes('is not a valid selector')) {
            response.error =
              'Invalid CSS selector. querySelector does not support jQuery-style selectors like :contains()';
            response.suggestions = [
              'Use: Array.from(document.querySelectorAll("button")).find(b => b.textContent.includes("SEND"))',
              'Avoid: document.querySelector("button:contains(\\"SEND\\")")',
            ];
          } else if (
            errorDescription.includes('circular') ||
            errorDescription.includes('Converting')
          ) {
            response.error =
              'Return value cannot be serialized to JSON. Do not return DOM nodes or objects with circular references';
            response.suggestions = [
              'Use: element.textContent instead of element',
              'Use: {count: document.querySelectorAll("button").length} instead of document.querySelectorAll("button")',
              'Use: Array.from(elements).map(e => e.textContent) instead of elements',
            ];
          } else {
            response.error = `JavaScript execution threw exception: ${errorDescription}`;
          }

          response.exceptionDetails = result.exceptionDetails;
          console.error(
            `❌ [JavaScript] JavaScript execution threw exception:`,
            result.exceptionDetails,
          );
        } else if (result.result) {
          response.result = result.result;

          console.log(
            `📊 [JavaScript] Result type: ${result.result.type}, value:`,
            result.result.type === 'object'
              ? `Object(${result.result.subtype || 'unknown'})`
              : result.result.type === 'undefined'
                ? 'undefined'
                : JSON.stringify(result.result.value).substring(0, 200),
          );
        } else {
          console.warn(
            '⚠️ [JavaScript] No result returned from Runtime.evaluate',
          );
        }

        // ============================================================
        // STEP 4: Detect new tabs created by JavaScript
        // ============================================================
        if (!skipNewTabDetection) {
          await new Promise((resolve) => setTimeout(resolve, 500)); // Wait for onCreated listener
          const tabsAfterJs = tabManager.getManagedTabsOnly(conversationId);
          const newTabs = tabsAfterJs.filter(
            (tab) => !tabIdsBeforeJs.has(tab.tabId),
          );

          if (newTabs.length > 0) {
            console.log(
              `📊 [JavaScript] Detected ${newTabs.length} new tabs created`,
            );
            response.new_tabs_created = newTabs.map((tab) => ({
              tabId: tab.tabId,
              url: tab.url,
              title: tab.title,
              loading: !tab.url || tab.url === 'chrome://newtab/',
            }));
          }
        }

        return response;
      }

      // This shouldn't happen (timeout throws, doesn't resolve)
      throw new Error('Unexpected race result');
    } catch (error) {
      // ============================================================
      // CASE C: Timeout or other error
      // ============================================================
      console.error(`❌ [JavaScript] Execution error:`, error);

      // Check if a dialog was detected (might have opened right before timeout)
      if (dialogDetected) {
        const dd: DialogInfo = dialogDetected; // Type guard for TypeScript
        console.log(
          `💬 [JavaScript] Dialog detected during error handling: ${dd.dialogType} (message: "${dd.message}") - Deferring to captureScreenshot`,
        );

        // All dialog handling deferred to captureScreenshot
        return {
          success: true,
          message: `JavaScript execution error with dialog: ${dd.dialogType} dialog opened. Dialog will be handled by screenshot.`,
          consoleOutput: consoleOutput.length > 0 ? consoleOutput : undefined,
          dialog_opened: true,
          dialog: {
            type: dd.dialogType,
            message: dd.message,
            url: dd.url,
            needsDecision: dd.needsDecision, // Keep original needsDecision value
          },
        };
      }

      throw error;
    }
  } finally {
    // Clean up listeners
    if (consoleListener) {
      chrome.debugger.onEvent.removeListener(consoleListener);
      console.log('🔌 [JavaScript] Console listener removed');
    }

    // Clear dialog resolver
    dialogManager.clearDialogResolver(tabId);
  }
}

/**
 * Execute JavaScript and return primitive value directly
 * Simplified wrapper for common use cases
 */
export async function evaluateJavaScript(
  tabId: number,
  conversationId: string,
  script: string,
  timeout: number = 30000,
): Promise<any> {
  const result = await executeJavaScript(
    tabId,
    conversationId,
    script,
    true,
    false,
    timeout,
  );

  if (!result.success) {
    throw new Error(result.error || 'JavaScript evaluation failed');
  }

  // If dialog opened, throw with dialog info
  if (result.dialog_opened) {
    const dialogError = new Error(
      `Dialog opened: ${result.dialog?.type} - "${result.dialog?.message}"`,
    );
    (dialogError as any).dialog = result.dialog;
    throw dialogError;
  }

  // Extract value from CDP result object
  if (result.result && result.result.type === 'undefined') {
    return undefined;
  }

  return result.result?.value;
}

export const javascript = {
  executeJavaScript,
  evaluateJavaScript,
};
