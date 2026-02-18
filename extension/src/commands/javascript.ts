/**
 * JavaScript Execution Tool Implementation
 * Enables execution of JavaScript code in browser tabs via Chrome DevTools Protocol
 */

import { CdpCommander } from './cdp-commander';
import { debuggerManager } from './debugger-manager';

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
 * Execute JavaScript code in a tab using CDP Runtime.evaluate
 * @param tabId Target tab ID
 * @param script JavaScript code to execute
 * @param returnByValue If true, returns result as serializable JSON value (default: true)
 * @param awaitPromise If true, waits for Promise resolution (default: false)
 * @param timeout Maximum execution time in milliseconds (default: 30000)
 * @returns Execution result with success status and data
 */
export async function executeJavaScript(
  tabId: number,
  script: string,
  returnByValue: boolean = true,
  awaitPromise: boolean = false,
  timeout: number = 30000,
): Promise<any> {
  console.log(`📜 [JavaScript] Executing JavaScript in tab ${tabId}:`, script.substring(0, 100) + (script.length > 100 ? '...' : ''));

  // Attach debugger to tab (required for CDP commands)
  const attached = await debuggerManager.safeAttachDebugger(tabId);
  if (!attached) {
    throw new Error('Failed to attach debugger to tab');
  }

  const cdpCommander = new CdpCommander(tabId);

  try {
    // Enable Runtime domain if not already enabled
    try {
      await cdpCommander.sendCommand('Runtime.enable', {}, 5000);
      console.log('✅ [JavaScript] Runtime domain enabled');
    } catch (enableError) {
      console.warn('⚠️ [JavaScript] Runtime.enable failed, but continuing:', enableError);
      // Continue anyway - Runtime might already be enabled
    }

    // Execute JavaScript using Runtime.evaluate
    console.log(`📜 [JavaScript] Sending Runtime.evaluate command`);
    
    const result = await cdpCommander.sendCommand<RuntimeEvaluateResult>('Runtime.evaluate', {
      expression: script,
      returnByValue,
      awaitPromise,
      timeout: timeout, // CDP timeout parameter (milliseconds)
    }, timeout + 5000); // Add buffer for command round-trip

    console.log(`✅ [JavaScript] JavaScript execution successful`);

    // Process result
    const response: any = {
      success: true,
      message: 'JavaScript executed successfully',
    };

    if (result.exceptionDetails) {
      // Execution threw an exception
      const exception = result.exceptionDetails.exception;
      response.success = false;
      response.error = `JavaScript execution threw exception: ${exception?.description || exception?.value || 'Unknown error'}`;
      response.exceptionDetails = result.exceptionDetails;
      console.error(`❌ [JavaScript] JavaScript execution threw exception:`, result.exceptionDetails);
    } else if (result.result) {
      // Execution succeeded
      response.result = result.result;
      
      // Log result type for debugging
      console.log(`📊 [JavaScript] Result type: ${result.result.type}, value:`, 
        result.result.type === 'object' ? `Object(${result.result.subtype || 'unknown'})` :
        result.result.type === 'undefined' ? 'undefined' :
        JSON.stringify(result.result.value).substring(0, 200));
    } else {
      // No result (should not happen with returnByValue: true)
      console.warn('⚠️ [JavaScript] No result returned from Runtime.evaluate');
    }

    return response;
  } catch (error) {
    console.error(`❌ [JavaScript] JavaScript execution failed:`, error);
    throw new Error(`JavaScript execution failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    // Detach debugger to clean up resources
    await debuggerManager.safeDetachDebugger(tabId);
  }
}

/**
 * Execute JavaScript and return primitive value directly
 * Simplified wrapper for common use cases
 */
export async function evaluateJavaScript(
  tabId: number,
  script: string,
  timeout: number = 30000,
): Promise<any> {
  const result = await executeJavaScript(tabId, script, true, false, timeout);
  
  if (!result.success) {
    throw new Error(result.error || 'JavaScript evaluation failed');
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