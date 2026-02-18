/**
 * Background Script - Main entry point for Chrome extension
 */

import { wsClient } from '../websocket/client';
import { computer } from '../commands/computer';
import { captureScreenshot } from '../commands/screenshot';
import { tabs } from '../commands/tabs';
import { tabManager } from '../commands/tab-manager';
import type { Command, CommandResponse } from '../types';

console.log('🚀 OpenBrowser extension starting...');

// Initialize tab manager
tabManager.initialize().then(() => {
  console.log('✅ Tab manager initialized');
}).catch((error) => {
  console.error('❌ Failed to initialize tab manager:', error);
});

// Track current active tab with visual mouse
let currentActiveTabId: number | null = null;

// Initialize WebSocket connection
wsClient.connect().then(() => {
  // Update tab manager status when connected
  tabManager.updateStatus('idle');
  console.log('🌐 WebSocket connected, tab manager status updated');
}).catch((error) => {
  console.error('Failed to connect to WebSocket server:', error);
  // Update tab manager status when connection fails
  tabManager.updateStatus('disconnected');
});

// Listen for WebSocket disconnection
wsClient.onDisconnect(() => {
  console.log('🌐 WebSocket disconnected, updating tab manager status');
  tabManager.updateStatus('disconnected');
});

// Listen for tab removal to cleanup visual mouse
chrome.tabs.onRemoved.addListener((tabId) => {
  if (currentActiveTabId === tabId) {
    console.log(`🗑️ Active tab ${tabId} was closed, resetting currentActiveTabId`);
    currentActiveTabId = null;
  }
});

// Listen for tab activation to manage visual mouse visibility
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const newTabId = activeInfo.tabId;
  console.log(`🔍 Tab activated: ${newTabId}, previous active tab: ${currentActiveTabId}`);
  
  // Clean up visual mouse in previous tab if it was managed
  if (currentActiveTabId !== null && currentActiveTabId !== newTabId) {
    try {
      console.log(`🔄 Cleaning up visual mouse in previous tab ${currentActiveTabId}`);
      await cleanupVisualMouseInTab(currentActiveTabId);
    } catch (error) {
      console.error(`⚠️ Failed to cleanup visual mouse in tab ${currentActiveTabId}:`, error);
    }
  }
  
  // Update current active tab
  currentActiveTabId = newTabId;
  
  // If this tab is managed, update visual mouse position (optional)
  // We don't send visual_mouse_update here because we don't know the mouse position
  // The next command will update it if needed
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
 * Activate a tab to ensure it's visible and responsive for automation
 * Chrome may throttle or pause background tabs, so we need to ensure
 * the tab is fully activated and ready for automation
 */
async function activateTabForAutomation(tabId: number): Promise<void> {
  console.log(`🔧 Activating tab ${tabId} for automation...`);
  
  try {
    // Get tab info to get window ID
    const tab = await chrome.tabs.get(tabId);
    
    // Check if tab is already active and window is focused
    if (tab.active) {
      // Tab is already active, check if window is focused
      const window = await chrome.windows.get(tab.windowId);
      if (window.focused) {
        console.log(`✅ Tab ${tabId} is already active and window is focused`);
        return; // Already fully active
      }
    }
    
    // First, activate the window (bring to front)
    if (tab.windowId) {
      await chrome.windows.update(tab.windowId, { focused: true });
      console.log(`✅ Window ${tab.windowId} focused`);
    }
    
    // Then, activate the tab within the window
    await chrome.tabs.update(tabId, { active: true });
    console.log(`✅ Tab ${tabId} activated`);
    
    // Wait for tab to fully activate and render
    // Chrome needs time to resume rendering and JavaScript execution
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Additional check: ensure tab is now active
    const updatedTab = await chrome.tabs.get(tabId);
    if (!updatedTab.active) {
      console.warn(`⚠️ Tab ${tabId} may not be fully activated after update`);
    }
  } catch (error) {
    console.error(`⚠️ Failed to fully activate tab ${tabId}:`, error);
    // Continue anyway - the command might still work
  }
}

/**
 * Handle incoming commands
 */
async function handleCommand(command: Command): Promise<CommandResponse> {
  console.log(`📨 Handling command: ${command.type}`, command);

  try {
    switch (command.type) {
      case 'mouse_move':
        const tabIdForMove = command.tab_id || await getCurrentTabId();
        // Ensure tab is managed by tab manager
        await tabManager.ensureTabManaged(tabIdForMove);
        // Update tab activity for status tracking
        tabManager.updateTabActivity(tabIdForMove);
        // Activate tab to ensure it's responsive for automation
        await activateTabForAutomation(tabIdForMove);
        const moveResult = await computer.performMouseMove(
          tabIdForMove,
          command.dx,
          command.dy
        );
        
        // Update visual mouse position using actual screen coordinates
        let visualUpdateSuccess = false;
        let visualMessage = '';
        
        if (moveResult.success && moveResult.data?.actualPosition) {
          const { actualPosition } = moveResult.data;
          visualUpdateSuccess = await updateVisualMouse(tabIdForMove, {
            x: actualPosition.x,
            y: actualPosition.y,
            action: 'move',
            relative: false, // Send absolute coordinates
          });
          
          if (!visualUpdateSuccess) {
            visualMessage = ' (Visual mouse update failed - content script may not be loaded)';
            console.log('⚠️ Visual mouse update failed for mouse_move command');
          }
        } else {
          console.warn('Cannot update visual mouse: moveResult missing actualPosition', moveResult);
        }
        
        return {
          success: true,
          message: moveResult.message + visualMessage,
          data: {
            ...moveResult.data,
            visualUpdateSuccess,
          },
          timestamp: Date.now(),
        };

      case 'mouse_click':
        const tabIdForClick = command.tab_id || await getCurrentTabId();
        // Ensure tab is managed by tab manager
        await tabManager.ensureTabManaged(tabIdForClick);
        // Update tab activity for status tracking
        tabManager.updateTabActivity(tabIdForClick);
        // Activate tab to ensure it's responsive for automation
        await activateTabForAutomation(tabIdForClick);
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
        // Ensure tab is managed by tab manager
        await tabManager.ensureTabManaged(tabIdForScroll);
        // Update tab activity for status tracking
        tabManager.updateTabActivity(tabIdForScroll);
        // Activate tab to ensure it's responsive for automation
        await activateTabForAutomation(tabIdForScroll);
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
        // Ensure tab is managed by tab manager
        await tabManager.ensureTabManaged(tabIdForType);
        // Update tab activity for status tracking
        tabManager.updateTabActivity(tabIdForType);
        // Activate tab to ensure it's responsive for automation
        await activateTabForAutomation(tabIdForType);
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
        // Ensure tab is managed by tab manager
        await tabManager.ensureTabManaged(tabIdForKeyPress);
        // Update tab activity for status tracking
        tabManager.updateTabActivity(tabIdForKeyPress);
        // Activate tab to ensure it's responsive for automation
        await activateTabForAutomation(tabIdForKeyPress);
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
        const tabIdForScreenshot = command.tab_id || await getCurrentTabId();
        // Ensure tab is managed by tab manager
        await tabManager.ensureTabManaged(tabIdForScreenshot);
        // Update tab activity for status tracking
        tabManager.updateTabActivity(tabIdForScreenshot);
        // Activate tab to ensure it's responsive for automation
        await activateTabForAutomation(tabIdForScreenshot);
        const screenshotResult = await captureScreenshot(
          tabIdForScreenshot,
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
        // Ensure tab is managed by tab manager
        await tabManager.ensureTabManaged(tabIdForReset);
        // Update tab activity for status tracking
        tabManager.updateTabActivity(tabIdForReset);
        // Activate tab to ensure it's responsive for automation
        await activateTabForAutomation(tabIdForReset);
        const resetResult = await computer.resetMousePosition(tabIdForReset);
        
        // Update visual mouse to actual screen center
        if (resetResult.success && resetResult.data?.actualPosition) {
          const { actualPosition } = resetResult.data;
          await updateVisualMouse(tabIdForReset, {
            x: actualPosition.x,
            y: actualPosition.y,
            action: 'move',
            relative: false,
          });
        } else {
          console.warn('Cannot update visual mouse for reset: missing actualPosition', resetResult);
        }
        
        return {
          success: true,
          message: resetResult.message,
          data: resetResult,
          timestamp: Date.now(),
        };

      case 'tab':
        switch (command.action) {
          case 'init':
            if (!command.url) {
              throw new Error('URL is required for init action');
            }
            // Initialize a new managed session with the given URL
            const initResult = await tabManager.initializeSession(command.url);
            
            // Activate tab for automation (ensures it's ready)
            await activateTabForAutomation(initResult.tabId);
            
            // Initialize mouse position to screen center (like reset command)
            const resetResult = await computer.resetMousePosition(initResult.tabId);
            
            // Update visual mouse to actual screen center
            let visualUpdateSuccess = false;
            if (resetResult.success && resetResult.data?.actualPosition) {
              const { actualPosition } = resetResult.data;
              visualUpdateSuccess = await updateVisualMouse(initResult.tabId, {
                x: actualPosition.x,
                y: actualPosition.y,
                action: 'move',
                relative: false,
              });
            }
            
            return {
              success: true,
              message: `Session initialized with ${command.url}`,
              data: {
                tabId: initResult.tabId,
                groupId: initResult.groupId,
                url: initResult.url,
                isManaged: true,
                mouseReset: resetResult.success,
                visualUpdateSuccess,
              },
              timestamp: Date.now(),
            };

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
            // Ensure tab is managed by tab manager
            await tabManager.ensureTabManaged(command.tab_id);
            // Update tab activity for status tracking
            tabManager.updateTabActivity(command.tab_id);
            // Activate tab (including window focus) for automation
            await activateTabForAutomation(command.tab_id);
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
        // Support managed_only parameter (default: true for backward compatibility)
        const managedOnly = command.managed_only !== false; // true if undefined or true
        const getTabsResult = await tabs.getAllTabs(managedOnly);
        return {
          success: true,
          message: getTabsResult.message || `Found ${getTabsResult.count} tabs`,
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
    
    // Check if we're switching to a new tab
    if (currentActiveTabId !== null && currentActiveTabId !== tabId) {
      console.log(`🔄 Switching from tab ${currentActiveTabId} to tab ${tabId}, cleaning up old visual mouse`);
      // Clean up visual mouse in the previously active tab
      await cleanupVisualMouseInTab(currentActiveTabId).catch(err => {
        console.log(`Non-critical error cleaning up old tab ${currentActiveTabId}:`, err);
      });
    }
    
    // Update current active tab
    currentActiveTabId = tabId;
    console.log(`📌 Current active tab set to: ${currentActiveTabId}`);
    
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
 * Clean up visual mouse pointer in a specific tab
 */
async function cleanupVisualMouseInTab(tabId: number): Promise<boolean> {
  console.log(`🧹 Cleaning up visual mouse pointer in tab ${tabId}...`);
  
  try {
    // Skip chrome:// and chrome-extension:// pages
    const tab = await chrome.tabs.get(tabId);
    if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) {
      console.log(`⚠️ Skipping cleanup for restricted URL: ${tab.url}`);
      return false;
    }
    
    // Check if content script is loaded in this tab
    const contentScriptLoaded = await isContentScriptInjected(tabId);
    
    if (contentScriptLoaded) {
      // Send destroy command to visual mouse
      await chrome.tabs.sendMessage(tabId, {
        type: 'visual_mouse_destroy'
      }).catch(() => {
        // Content script might not respond (e.g., page reloaded)
        console.log(`Tab ${tabId} content script not responsive for cleanup`);
        return false;
      });
      
      console.log(`✅ Cleaned up visual mouse pointer in tab ${tabId}`);
      return true;
    } else {
      console.log(`Tab ${tabId} does not have content script loaded`);
      return false;
    }
  } catch (error) {
    console.error(`❌ Failed to clean up visual mouse in tab ${tabId}:`, error);
    return false;
  }
}

/**
 * Clean up visual mouse pointers in all tabs when extension disconnects
 */
async function cleanupVisualMouseInAllTabs(): Promise<void> {
  console.log('🧹 Cleaning up visual mouse pointers in all tabs...');
  
  try {
    // Get all tabs in all windows
    const tabs = await chrome.tabs.query({});
    
    let cleanupCount = 0;
    
    for (const tab of tabs) {
      if (!tab.id) continue;
      
      // Skip chrome:// and chrome-extension:// pages
      if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) {
        continue;
      }
      
      try {
        // Check if content script is loaded in this tab
        const contentScriptLoaded = await isContentScriptInjected(tab.id);
        
        if (contentScriptLoaded) {
          // Send destroy command to visual mouse
          await chrome.tabs.sendMessage(tab.id, {
            type: 'visual_mouse_destroy'
          }).catch(() => {
            // Content script might not respond (e.g., page reloaded)
            console.log(`Tab ${tab.id} content script not responsive for cleanup`);
          });
          
          cleanupCount++;
        }
      } catch (error) {
        // Tab might have been closed or content script not available
        console.log(`Failed to clean up visual mouse in tab ${tab.id}:`, error);
      }
    }
    
    console.log(`✅ Cleaned up visual mouse pointers in ${cleanupCount} tab(s)`);
  } catch (error) {
    console.error('❌ Failed to cleanup visual mouse pointers:', error);
  }
}

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

// Register disconnect handler to cleanup visual mouse pointers
wsClient.onDisconnect(() => {
  console.log('🔄 WebSocket disconnected, cleaning up visual mouse pointers...');
  // Reset current active tab
  currentActiveTabId = null;
  console.log('📌 Current active tab reset to null');
  // Clean up all visual mouse pointers
  cleanupVisualMouseInAllTabs().catch(console.error);
});

console.log('✅ OpenBrowser extension ready');