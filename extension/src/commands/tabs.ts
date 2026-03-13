/**
 * Tab Management Tool
 */

import { tabManager } from './tab-manager';

/**
 * Get all tabs across all windows
 * @param managedOnly If true, only returns tabs in the managed tab group
 * @param conversationId Optional conversation ID for managed tabs filtering
 */
export async function getAllTabs(managedOnly: boolean = true, conversationId?: string): Promise<any> {
  let tabs: chrome.tabs.Tab[];
  
  if (managedOnly) {
    // Only get managed tabs for specific conversation
    const managedTabs = conversationId ? tabManager.getManagedTabs(conversationId) : [];
    const managedTabIds = managedTabs.map(t => t.tabId);
    
    if (managedTabIds.length > 0) {
      // Query all tabs and filter to only managed tabs
      tabs = await chrome.tabs.query({});
      tabs = tabs.filter(tab => tab.id && managedTabIds.includes(tab.id));
    } else {
      // No managed tabs, return empty list
      tabs = [];
    }
    
    return {
      success: true,
      tabs: tabs.map((tab) => ({
        id: tab.id,
        url: tab.url,
        title: tab.title,
        active: tab.active,
        windowId: tab.windowId,
        index: tab.index,
        isManaged: true,
      })),
      count: tabs.length,
      managedOnly: true,
      conversationId: conversationId,
      message: `Found ${tabs.length} managed tab(s)` + (conversationId ? ` in conversation ${conversationId}` : ''),
    };
  } else {
    // Get all tabs (backward compatibility)
    tabs = await chrome.tabs.query({});
    
    // Get managed tabs for info (need conversationId to know which tabs are managed)
    const managedTabs = conversationId ? tabManager.getManagedTabs(conversationId) : [];
    const managedTabIds = new Set(managedTabs.map(t => t.tabId));
    
    return {
      success: true,
      tabs: tabs.map((tab) => ({
        id: tab.id,
        url: tab.url,
        title: tab.title,
        active: tab.active,
        windowId: tab.windowId,
        index: tab.index,
        isManaged: tab.id ? managedTabIds.has(tab.id) : false,
      })),
      count: tabs.length,
      managedCount: managedTabs.length,
      managedOnly: false,
      conversationId: conversationId,
      message: `Found ${tabs.length} tab(s) (${managedTabs.length} managed)` + (conversationId ? ` in conversation ${conversationId}` : ''),
    };
  }
}

/**
 * Open new tab
 * @param url URL to open
 * @param conversationId Optional conversation ID to manage the tab
 */
export async function openTab(url: string, conversationId?: string): Promise<any> {
  // Ensure URL has protocol
  let targetUrl = url;
  // if (!url.match(/^https?:\/\//)) {
  //   targetUrl = `https://${url}`;
  // }
  
  // Use tab manager to open managed tab if conversationId provided
  if (conversationId) {
    try {
      const managedTab = await tabManager.openManagedTab(targetUrl, false, conversationId);
      
      return {
        success: true,
        tabId: managedTab.tabId,
        groupId: managedTab.groupId,
        url: targetUrl,
        message: `Opened new managed tab: ${targetUrl}`,
        isManaged: true,
      };
    } catch (error) {
      console.error('Failed to open managed tab, falling back to regular tab:', error);
      // Fall through to regular tab creation
    }
  }
  
  // Fallback to regular tab creation (or no conversationId provided)
  const tab = await chrome.tabs.create({ url: targetUrl, active: false });
  
  // If conversationId provided, try to add to management even after fallback
  if (conversationId && tab.id) {
    try {
      await tabManager.addTabToManagement(tab.id, conversationId);
      return {
        success: true,
        tabId: tab.id,
        url: tab.url,
        message: `Opened new tab and added to management: ${targetUrl}`,
        isManaged: true,
      };
    } catch (error) {
      console.warn('Could not add tab to management:', error);
    }
  }
  
  return {
    success: true,
    tabId: tab.id,
    url: tab.url,
    message: `Opened new tab: ${targetUrl} (not managed)`,
    isManaged: false,
  };
}

/**
 * Close tab
 */
export async function closeTab(tabId: number): Promise<any> {
  await chrome.tabs.remove(tabId);
  
  return {
    success: true,
    message: `Closed tab ${tabId}`,
  };
}

/**
 * Switch to tab (internal operation only - does NOT activate the tab)
 * Updates internal state to mark this tab as the active tab for automation
 */
export async function switchToTab(tabId: number): Promise<any> {
  // IMPORTANT: Do NOT activate the tab - we keep it in background
  // This ensures we don't disrupt user's browsing experience
  
  // Just verify the tab exists and is accessible
  try {
    await chrome.tabs.get(tabId);
    
    return {
      success: true,
      message: `Internal state switched to tab ${tabId} (tab remains in background)`,
    };
  } catch (error) {
    throw new Error(`Cannot switch to tab ${tabId}: ${error instanceof Error ? error.message : 'Tab not found'}`);
  }
}

/**
 * Refresh tab
 */
export async function refreshTab(tabId: number): Promise<any> {
  await chrome.tabs.reload(tabId);
  
  return {
    success: true,
    message: `Refreshed tab ${tabId}`,
  };
}

/**
 * Get current active tab
 */
export async function getCurrentTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

export const tabs = {
  getAllTabs,
  openTab,
  closeTab,
  switchToTab,
  refreshTab,
  getCurrentTab,
};