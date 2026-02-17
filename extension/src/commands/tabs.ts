/**
 * Tab Management Tool
 */

/**
 * Get all tabs across all windows
 */
export async function getAllTabs(): Promise<any> {
  const tabs = await chrome.tabs.query({});
  
  return {
    success: true,
    tabs: tabs.map((tab) => ({
      id: tab.id,
      url: tab.url,
      title: tab.title,
      active: tab.active,
      windowId: tab.windowId,
      index: tab.index,
    })),
    count: tabs.length,
  };
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
  
  const tab = await chrome.tabs.create({ url: targetUrl, active: true });
  
  return {
    success: true,
    tabId: tab.id,
    url: tab.url,
    message: `Opened new tab: ${targetUrl}`,
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