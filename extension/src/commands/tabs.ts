/**
 * Tab Management Tool
 */

import { tabManager } from './tab-manager';

/**
 * Get all tabs across all windows
 * @param managedOnly If true, only returns tabs in the managed tab group
 */
export async function getAllTabs(managedOnly: boolean = true): Promise<any> {
  let tabs;
  
  if (managedOnly) {
    // Only get managed tabs
    const managedTabs = tabManager.getManagedTabs();
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
      message: `Found ${tabs.length} managed tab(s)`,
    };
  } else {
    // Get all tabs (backward compatibility)
    tabs = await chrome.tabs.query({});
    
    // Get managed tabs for info
    const managedTabs = tabManager.getManagedTabs();
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
      message: `Found ${tabs.length} tab(s) (${managedTabs.length} managed)`,
    };
  }
}

/**
 * Open new tab
 */
export async function openTab(url: string): Promise<any> {
  // Ensure URL has protocol
  let targetUrl = url;
  if (!url.match(/^https?:\/\//)) {
    targetUrl = `https://${url}`;
  }
  
  // Use tab manager to open managed tab
  try {
    const managedTab = await tabManager.openManagedTab(targetUrl, false);
    
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
    
    // Fallback to regular tab creation
    const tab = await chrome.tabs.create({ url: targetUrl, active: false });
    
    return {
      success: true,
      tabId: tab.id,
      url: tab.url,
      message: `Opened new tab: ${targetUrl} (not managed)`,
      isManaged: false,
    };
  }
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
 * Switch to tab
 */
export async function switchToTab(tabId: number): Promise<any> {
  await chrome.tabs.update(tabId, { active: true });
  
  return {
    success: true,
    message: `Switched to tab ${tabId}`,
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
  getCurrentTab,
};