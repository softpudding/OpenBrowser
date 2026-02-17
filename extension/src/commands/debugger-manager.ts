/**
 * Debugger Manager
 * Based on AIPex implementation
 */

import { rejectPendingCommands } from './cdp-commander';

const AUTO_DETACH_TIMEOUT = 30 * 1000;

export class DebuggerManager {
  private debuggerAttachedTabs = new Set<number>();
  private debuggerLock = new Map<number, Promise<boolean>>();
  private autoDetachTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private initialized = false;

  constructor() {
    this.initialize();
  }

  private initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    if (chrome.debugger?.onDetach) {
      chrome.debugger.onDetach.addListener((source, reason) => {
        const tabId = source.tabId;
        if (tabId !== undefined) {
          this.debuggerAttachedTabs.delete(tabId);
          this.cancelAutoDetach(tabId);
          rejectPendingCommands(tabId, `Debugger detached: ${reason}`);
        }
      });
    }

    if (chrome.tabs?.onRemoved) {
      chrome.tabs.onRemoved.addListener((tabId) => {
        this.debuggerAttachedTabs.delete(tabId);
        this.cancelAutoDetach(tabId);
        rejectPendingCommands(tabId, 'Tab closed');
      });
    }
  }

  private scheduleAutoDetach(tabId: number): void {
    if (this.autoDetachTimers.has(tabId)) {
      clearTimeout(this.autoDetachTimers.get(tabId)!);
    }

    const timer = setTimeout(() => {
      this.safeDetachDebugger(tabId, true);
      this.autoDetachTimers.delete(tabId);
    }, AUTO_DETACH_TIMEOUT);

    this.autoDetachTimers.set(tabId, timer);
  }

  private cancelAutoDetach(tabId: number): void {
    if (this.autoDetachTimers.has(tabId)) {
      clearTimeout(this.autoDetachTimers.get(tabId)!);
      this.autoDetachTimers.delete(tabId);
    }
  }

  async safeAttachDebugger(tabId: number): Promise<boolean> {
    this.initialize();
    this.cancelAutoDetach(tabId);

    if (this.debuggerLock.has(tabId)) {
      const result = await this.debuggerLock.get(tabId)!;
      if (result) {
        this.scheduleAutoDetach(tabId);
      }
      return result;
    }

    const attachPromise = new Promise<boolean>((resolve) => {
      if (!chrome.debugger) {
        resolve(false);
        return;
      }

      if (this.debuggerAttachedTabs.has(tabId)) {
        resolve(true);
        return;
      }

      // First, check if tab URL is accessible for debugging
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) {
          console.error(
            '❌ [DEBUG] Failed to get tab info:',
            chrome.runtime.lastError.message,
          );
          resolve(false);
          return;
        }

        // Check if tab URL is a chrome:// URL or other restricted URL
        const url = tab.url || '';
        if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
          console.error(
            '❌ [DEBUG] Cannot attach debugger to restricted URL:',
            url,
          );
          resolve(false);
          return;
        }

        // Check if tab is loading or not fully ready
        if (tab.status !== 'complete') {
          console.warn(
            '⚠️ [DEBUG] Tab is not fully loaded, status:',
            tab.status,
          );
          // We can still try to attach, but warn
        }

        chrome.debugger.attach({ tabId }, '1.3', () => {
          if (chrome.runtime.lastError) {
            console.error(
              '❌ [DEBUG] Failed to attach debugger:',
              chrome.runtime.lastError.message,
            );
            resolve(false);
          } else {
            this.debuggerAttachedTabs.add(tabId);
            console.log('✅ [DEBUG] Debugger attached successfully');
            
            // After attaching debugger, we can try to ensure page is responsive
            // by sending a simple command to check if page is ready
            setTimeout(() => {
              // Try to get page info to verify debugger is working
              chrome.debugger.sendCommand({ tabId }, 'Page.getLayoutMetrics', {}, () => {
                if (chrome.runtime.lastError) {
                  console.warn('⚠️ [DEBUG] Page may not be fully responsive:', chrome.runtime.lastError.message);
                } else {
                  console.log('✅ [DEBUG] Page is responsive');
                }
              });
            }, 100);
            
            resolve(true);
          }
        });
      });
    });

    this.debuggerLock.set(tabId, attachPromise);

    try {
      const result = await attachPromise;
      if (result) {
        this.scheduleAutoDetach(tabId);
      }
      return result;
    } finally {
      this.debuggerLock.delete(tabId);
    }
  }

  async safeDetachDebugger(
    tabId: number,
    immediately: boolean = false,
  ): Promise<void> {
    if (immediately) {
      this.cancelAutoDetach(tabId);
      rejectPendingCommands(tabId, 'Debugger detaching');

      return new Promise((resolve) => {
        if (this.debuggerAttachedTabs.has(tabId) && chrome?.debugger?.detach) {
          chrome.debugger.detach({ tabId }, () => {
            this.debuggerAttachedTabs.delete(tabId);
            resolve();
          });
        } else {
          this.debuggerAttachedTabs.delete(tabId);
          resolve();
        }
      });
    } else {
      this.scheduleAutoDetach(tabId);
      return Promise.resolve();
    }
  }
}

export const debuggerManager = new DebuggerManager();