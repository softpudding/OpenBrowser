/**
 * Background Script - Main entry point for Chrome extension
 */

import { wsClient } from '../websocket/client';
import { computer } from '../commands/computer';
import { captureScreenshot } from '../commands/screenshot';
import { tabs } from '../commands/tabs';
import type { Command, CommandResponse } from '../types';

console.log('🚀 Local Chrome Control extension starting...');

// Initialize WebSocket connection
wsClient.connect().catch((error) => {
  console.error('Failed to connect to WebSocket server:', error);
});

// Listen for commands from WebSocket server
wsClient.onMessage(async (data) => {
  // Only handle command messages (not responses or server messages)
  if (data.type && !data.success && !data.error) {
    // Skip server messages that are not commands
    if (data.type === 'connected' || data.type === 'ping' || data.type === 'pong') {
      console.log(`📨 Received server message: ${data.type}`, data.message || '');
      return;
    }
    
    try {
      const response = await handleCommand(data as Command);
      // Send response back to server
      if (wsClient.isConnected()) {
        // Create response with same command_id
        const responseWithId = {
          ...response,
          command_id: data.command_id,
          timestamp: Date.now(),
        };
        
        // Send as raw JSON string
        wsClient.sendCommand(responseWithId as any).catch((error) => {
          console.error('Failed to send response:', error);
        });
      }
    } catch (error) {
      console.error('Error handling command:', error);
      
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
    }
  }
});

/**
 * Handle incoming commands
 */
async function handleCommand(command: Command): Promise<CommandResponse> {
  console.log(`📨 Handling command: ${command.type}`, command);

  try {
    switch (command.type) {
      case 'mouse_move':
        const tabIdForMove = command.tab_id || await getCurrentTabId();
        const moveResult = await computer.performMouseMove(
          tabIdForMove,
          command.dx,
          command.dy
        );
        
        // Update visual mouse position (relative movement)
        const visualUpdateSuccess = await updateVisualMouse(tabIdForMove, {
          x: command.dx,
          y: command.dy,
          action: 'move',
          relative: true,
        });
        
        let finalMessage = moveResult.message;
        if (!visualUpdateSuccess) {
          finalMessage = `${moveResult.message} (Visual mouse update failed - content script may not be loaded)`;
          console.log('⚠️ Visual mouse update failed for mouse_move command');
        }
        
        return {
          success: true,
          message: finalMessage,
          data: {
            ...moveResult.data,
            visualUpdateSuccess,
          },
          timestamp: Date.now(),
        };

      case 'mouse_click':
        const tabIdForClick = command.tab_id || await getCurrentTabId();
        const clickResult = await computer.performClick(
          tabIdForClick,
          0, 0, // Coordinates - will need to be provided or tracked
          command.button || 'left',
          command.count || (command.double ? 2 : 1)
        );
        
        // Update visual mouse for click
        await updateVisualMouse(tabIdForClick, {
          action: 'click',
          button: command.button || 'left',
          count: command.count || (command.double ? 2 : 1),
        });
        
        return {
          success: true,
          message: clickResult.message,
          data: clickResult,
          timestamp: Date.now(),
        };

      case 'mouse_scroll':
        const tabIdForScroll = command.tab_id || await getCurrentTabId();
        const scrollResult = await computer.performScroll(
          tabIdForScroll,
          0, 0, // Coordinates - will need to be provided
          command.direction,
          command.amount || 100
        );
        
        // Update visual mouse for scroll
        await updateVisualMouse(tabIdForScroll, {
          action: 'scroll',
          direction: command.direction,
          amount: command.amount || 100,
        });
        
        return {
          success: true,
          message: scrollResult.message,
          data: scrollResult,
          timestamp: Date.now(),
        };

      case 'keyboard_type':
        const tabIdForType = command.tab_id || await getCurrentTabId();
        const typeResult = await computer.performType(
          tabIdForType,
          command.text
        );
        
        // Visual feedback for typing (optional - could show typing indicator)
        // For now, just log it
        console.log(`⌨️ Typing: "${command.text}"`);
        
        return {
          success: true,
          message: typeResult.message,
          data: typeResult,
          timestamp: Date.now(),
        };

      case 'keyboard_press':
        const tabIdForKeyPress = command.tab_id || await getCurrentTabId();
        const keyResult = await computer.performKeyPress(
          tabIdForKeyPress,
          command.key,
          command.modifiers
        );
        
        // Visual feedback for key press (optional)
        console.log(`⌨️ Key press: ${command.key}${command.modifiers ? ` with modifiers: ${command.modifiers.join('+')}` : ''}`);
        
        return {
          success: true,
          message: keyResult.message,
          data: keyResult,
          timestamp: Date.now(),
        };

      case 'screenshot':
        const screenshotResult = await captureScreenshot(
          command.tab_id,
          command.include_cursor !== false,
          command.quality || 90
        );
        return {
          success: true,
          message: 'Screenshot captured',
          data: screenshotResult,
          timestamp: Date.now(),
        };

      case 'reset_mouse':
        const tabIdForReset = command.tab_id || await getCurrentTabId();
        const resetResult = await computer.resetMousePosition(tabIdForReset);
        
        // Update visual mouse to center
        await updateVisualMouse(tabIdForReset, {
          x: 960,  // Default center X
          y: 540,  // Default center Y
          action: 'move',
          relative: false,
        });
        
        return {
          success: true,
          message: resetResult.message,
          data: resetResult,
          timestamp: Date.now(),
        };

      case 'tab':
        switch (command.action) {
          case 'open':
            if (!command.url) {
              throw new Error('URL is required for open action');
            }
            const openResult = await tabs.openTab(command.url);
            return {
              success: true,
              message: openResult.message,
              data: openResult,
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
              data: closeResult,
              timestamp: Date.now(),
            };

          case 'switch':
            if (!command.tab_id) {
              throw new Error('tab_id is required for switch action');
            }
            const switchResult = await tabs.switchToTab(command.tab_id);
            return {
              success: true,
              message: switchResult.message,
              data: switchResult,
              timestamp: Date.now(),
            };

          case 'list':
            const listResult = await tabs.getAllTabs();
            return {
              success: true,
              message: `Found ${listResult.count} tabs`,
              data: listResult,
              timestamp: Date.now(),
            };

          default:
            throw new Error(`Unknown tab action: ${command.action}`);
        }

      case 'get_tabs':
        const getTabsResult = await tabs.getAllTabs();
        return {
          success: true,
          message: `Found ${getTabsResult.count} tabs`,
          data: getTabsResult,
          timestamp: Date.now(),
        };

      default:
        throw new Error(`Unknown command type: ${command.type}`);
    }
  } catch (error) {
    console.error(`Command ${command.type} failed:`, error);
    return {
      success: false,
      command_id: command.command_id,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: Date.now(),
    };
  }
}

/**
 * Get current active tab ID
 */
async function getCurrentTabId(): Promise<number> {
  const tab = await tabs.getCurrentTab();
  if (!tab?.id) {
    throw new Error('No active tab found');
  }
  return tab.id;
}

/**
 * Send visual mouse update to content script
 */
async function updateVisualMouse(tabId: number, data: any): Promise<boolean> {
  try {
    console.log(`🎯 Attempting to update visual mouse for tab ${tabId}:`, data);
    
    // Check if tab is accessible (not chrome:// page)
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url || '';
    
    console.log(`🌐 Tab URL: ${url}`);
    
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
      console.log('⚠️ Cannot update visual mouse on restricted URL:', url);
      return false;
    }
    
    // Check if content script is loaded by trying to ping it
    let contentScriptLoaded = false;
    try {
      const pingResponse = await chrome.tabs.sendMessage(tabId, {
        type: 'ping',
      });
      console.log(`✅ Content script is responsive in tab ${tabId}`);
      contentScriptLoaded = true;
    } catch (pingError) {
      console.error(`❌ Content script NOT loaded in tab ${tabId}. Error:`, pingError);
      console.log('📝 This could mean:');
      console.log('  1. Page was loaded before extension');
      console.log('  2. Content script failed to inject');
      console.log('  3. Page has CSP restrictions');
      
      // Try to inject content script automatically
      console.log('🔄 Attempting to auto-inject content script...');
      contentScriptLoaded = await injectContentScript(tabId);
      
      if (!contentScriptLoaded) {
        console.log('💡 Suggestion: Reload the page to load content script');
        return false;
      }
    }
    
    console.log(`📤 Sending visual_mouse_update to tab ${tabId}`);
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'visual_mouse_update',
      data: data,
    });
    
    console.log(`📥 Received response from content script:`, response);
    return response?.success === true;
  } catch (error) {
    console.error('❌ Failed to update visual mouse:', error);
    console.error('Full error details:', error instanceof Error ? error.stack : error);
    return false;
  }
}

/**
 * Get viewport info from content script
 */
async function getViewportInfo(tabId: number): Promise<any> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'get_viewport',
    });
    
    if (response?.success) {
      return response.data;
    }
    return null;
  } catch (error) {
    console.error('Failed to get viewport info:', error);
    return null;
  }
}

/**
 * Get visual mouse position from content script
 */
async function getVisualMousePosition(tabId: number): Promise<{x: number, y: number} | null> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'visual_mouse_position',
    });
    
    if (response?.success) {
      return response.data;
    }
    return null;
  } catch (error) {
    console.error('Failed to get visual mouse position:', error);
    return null;
  }
}

/**
 * Check if content script is injected in a tab
 */
async function isContentScriptInjected(tabId: number): Promise<boolean> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'ping',
    });
    return response?.pong === true;
  } catch (error) {
    return false;
  }
}

/**
 * Attempt to inject content script into a tab
 */
async function injectContentScript(tabId: number): Promise<boolean> {
  try {
    console.log(`🔄 Attempting to inject content script into tab ${tabId}`);
    
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url || '';
    
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
      console.log('⚠️ Cannot inject content script into restricted URL:', url);
      return false;
    }
    
    // Check if we have scripting permission
    if (!chrome.scripting) {
      console.error('❌ chrome.scripting API not available');
      return false;
    }
    
    // Try to execute the content script
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
    
    console.log(`✅ Content script injected into tab ${tabId}`);
    
    // Wait a moment for script to initialize
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Verify injection worked
    const isInjected = await isContentScriptInjected(tabId);
    console.log(`✅ Content script verification: ${isInjected ? 'SUCCESS' : 'FAILED'}`);
    
    return isInjected;
  } catch (error) {
    console.error(`❌ Failed to inject content script into tab ${tabId}:`, error);
    return false;
  }
}

/**
 * Handle extension installation/update
 */
chrome.runtime.onInstalled.addListener((details) => {
  console.log(`Extension ${details.reason}:`, details);
  
  if (details.reason === 'install') {
    // Show welcome page or instructions
    chrome.tabs.create({
      url: chrome.runtime.getURL('welcome.html'),
    });
  }
});

/**
 * Handle extension startup
 */
chrome.runtime.onStartup.addListener(() => {
  console.log('Extension starting up...');
  // Reconnect WebSocket
  wsClient.connect().catch(console.error);
});

/**
 * Keep WebSocket connection alive
 */
setInterval(() => {
  if (!wsClient.isConnected()) {
    console.log('WebSocket disconnected, attempting to reconnect...');
    wsClient.connect().catch(console.error);
  }
}, 10000); // Check every 10 seconds

console.log('✅ Local Chrome Control extension ready');