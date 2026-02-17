/**
 * Chrome DevTools Protocol Commander
 * Based on AIPex implementation
 */

const DEFAULT_CDP_TIMEOUT = 15000; // Increased from 10 to 15 seconds for background tabs
const MAX_RETRIES = 2;
const RETRY_DELAY = 500; // ms

const pendingCommands = new Map<
  number,
  Set<{ reject: (error: Error) => void; command: string }>
>();

export function rejectPendingCommands(tabId: number, reason: string): void {
  const pending = pendingCommands.get(tabId);
  if (pending) {
    for (const { reject, command } of pending) {
      reject(new Error(`CDP command '${command}' aborted: ${reason}`));
    }
    pending.clear();
    pendingCommands.delete(tabId);
  }
}

export class CdpCommander {
  constructor(readonly tabId: number) {}

  async sendCommand<T = unknown>(
    command: string,
    params: Record<string, unknown>,
    timeout: number = DEFAULT_CDP_TIMEOUT,
    retries: number = MAX_RETRIES,
  ): Promise<T> {
    const attempt = async (attemptNumber: number): Promise<T> => {
      console.log(`🔧 [CDP] Sending command '${command}' (attempt ${attemptNumber}/${retries + 1})`, 
                  Object.keys(params).length > 0 ? params : '');
      
      return new Promise((resolve, reject) => {
        const pendingEntry = { reject, command };

        const timeoutId = setTimeout(() => {
          const pending = pendingCommands.get(this.tabId);
          if (pending) {
            pending.delete(pendingEntry);
          }
          reject(
            new Error(`CDP command '${command}' timed out after ${timeout}ms`),
          );
        }, timeout);

        if (!pendingCommands.has(this.tabId)) {
          pendingCommands.set(this.tabId, new Set());
        }
        pendingCommands.get(this.tabId)!.add(pendingEntry);

        chrome.debugger.sendCommand(
          { tabId: this.tabId },
          command,
          params,
          (result) => {
            clearTimeout(timeoutId);

            const pending = pendingCommands.get(this.tabId);
            if (pending) {
              pending.delete(pendingEntry);
            }

            if (chrome.runtime.lastError) {
              const error = chrome.runtime.lastError.message || 'Unknown CDP error';
              console.error(`❌ [CDP] Command '${command}' failed:`, error);
              reject(
                new Error(
                  `Failed to send CDP command '${command}': ${error}`,
                ),
              );
            } else {
              console.log(`✅ [CDP] Command '${command}' successful`);
              resolve(result as T);
            }
          },
        );
      });
    };

    let lastError: Error | null = null;
    
    for (let i = 0; i <= retries; i++) {
      try {
        return await attempt(i + 1);
      } catch (error) {
        lastError = error as Error;
        
        // Check if we should retry
        if (i < retries) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          
          // Only retry certain types of errors
          const shouldRetry = errorMessage.includes('timed out') || 
                            errorMessage.includes('failed to send') ||
                            errorMessage.includes('background tab') ||
                            !errorMessage.includes('invalid');
          
          if (shouldRetry) {
            console.log(`🔄 [CDP] Retrying command '${command}' after ${RETRY_DELAY}ms (${i + 1}/${retries})`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (i + 1))); // Exponential backoff
            continue;
          }
        }
        
        // If we shouldn't retry or this was the last attempt, break
        break;
      }
    }
    
    // If we get here, all retries failed
    throw lastError || new Error(`Failed to execute CDP command '${command}' after ${retries + 1} attempts`);
  }
}