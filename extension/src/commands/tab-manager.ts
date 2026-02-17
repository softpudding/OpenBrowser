/**
 * Tab Manager with Tab Group Support
 * Inspired by MANUS Chrome Plugin design
 */

// Tab group constants
const TAB_GROUP_NAME = 'Local Chrome Control';
const TAB_GROUP_COLOR = 'grey' as chrome.tabGroups.ColorEnum;
const TAB_GROUP_COLLAPSED = false;

export interface ManagedTab {
  tabId: number;
  groupId?: number;
  windowId: number;
  url: string;
  title?: string;
  createdAt: number;
  lastActivity: number;
}

export class TabManager {
  private managedTabs: Map<number, ManagedTab> = new Map();
  private mainGroupId: number | null = null;
  private statusUpdateInterval: number | null = null;
  private currentStatus: 'active' | 'idle' | 'disconnected' = 'idle';

  /**
   * Initialize the tab manager
   */
  async initialize(): Promise<void> {
    console.log('📁 [TabManager] Initializing tab manager...');
    
    // Check if tabGroups API is available
    if (!chrome.tabGroups) {
      console.warn('⚠️ [TabManager] tabGroups API not available, falling back to simple tab management');
      return;
    }
    
    // Find existing tab group
    await this.findOrCreateTabGroup();
    
    // Setup listeners
    this.setupListeners();
    
    // Start status update interval
    this.startStatusUpdates();
    
    console.log('✅ [TabManager] Initialized');
  }

  /**
   * Find existing tab group or create a new one
   */
  private async findOrCreateTabGroup(): Promise<void> {
    try {
      // Query existing tab groups
      const groups = await chrome.tabGroups.query({ title: TAB_GROUP_NAME });
      
      if (groups.length > 0) {
        // Use the first matching group
        this.mainGroupId = groups[0].id;
        console.log(`✅ [TabManager] Found existing tab group: ${TAB_GROUP_NAME} (ID: ${this.mainGroupId})`);
        
        // Get tabs in this group
        const tabsInGroup = await chrome.tabs.query({ groupId: this.mainGroupId });
        for (const tab of tabsInGroup) {
          if (tab.id) {
            this.managedTabs.set(tab.id, {
              tabId: tab.id,
              groupId: this.mainGroupId,
              windowId: tab.windowId,
              url: tab.url || '',
              title: tab.title,
              createdAt: Date.now(),
              lastActivity: Date.now()
            });
          }
        }
      } else {
        console.log(`📁 [TabManager] No existing tab group found, will create when needed`);
      }
    } catch (error) {
      console.error('❌ [TabManager] Error finding/creating tab group:', error);
    }
  }

  /**
   * Create a new tab group in the current window
   */
  private async createTabGroup(windowId: number): Promise<number> {
    try {
      // Create a group with a single tab (we'll add tabs to it later)
      // First get the current window if not specified
      const targetWindowId = windowId || (await chrome.windows.getCurrent()).id;
      
      // Create a dummy tab to group (we'll remove it if it's not needed)
      const dummyTab = await chrome.tabs.create({
        url: 'about:blank',
        active: false,
        windowId: targetWindowId
      });
      
      // Group the tab
      const groupId = await chrome.tabs.group({
        createProperties: { windowId: targetWindowId },
        tabIds: [dummyTab.id]
      });
      
      // Update group properties
      await chrome.tabGroups.update(groupId, {
        title: TAB_GROUP_NAME,
        collapsed: TAB_GROUP_COLLAPSED,
        color: TAB_GROUP_COLOR
      });
      
      // Remove the dummy tab if it's still about:blank
      if (dummyTab.url === 'about:blank' || dummyTab.url === 'chrome://newtab/') {
        await chrome.tabs.remove(dummyTab.id);
      } else {
        // Keep the tab and add to managed tabs
        this.managedTabs.set(dummyTab.id, {
          tabId: dummyTab.id,
          groupId,
          windowId: targetWindowId,
          url: dummyTab.url || '',
          title: dummyTab.title,
          createdAt: Date.now(),
          lastActivity: Date.now()
        });
      }
      
      this.mainGroupId = groupId;
      console.log(`✅ [TabManager] Created new tab group: ${TAB_GROUP_NAME} (ID: ${groupId})`);
      
      return groupId;
    } catch (error) {
      console.error('❌ [TabManager] Error creating tab group:', error);
      throw error;
    }
  }

  /**
   * Open a new tab and add it to the managed tab group
   */
  async openManagedTab(url: string, active: boolean = true): Promise<ManagedTab> {
    console.log(`📁 [TabManager] Opening managed tab: ${url}`);
    
    // Ensure URL has protocol
    let targetUrl = url;
    if (!url.match(/^https?:\/\//)) {
      targetUrl = `https://${url}`;
    }
    
    // Create the tab
    const tab = await chrome.tabs.create({ url: targetUrl, active });
    
    // Add to tab group if available
    let groupId = this.mainGroupId;
    if (chrome.tabGroups && tab.id) {
      if (!this.mainGroupId) {
        // Create group if it doesn't exist
        groupId = await this.createTabGroup(tab.windowId);
      }
      
      // Add tab to group
      if (groupId && tab.id) {
        try {
          await chrome.tabs.group({
            groupId,
            tabIds: [tab.id]
          });
          
          // Move group to left side (after pinned tabs)
          const pinnedTabs = await chrome.tabs.query({ pinned: true, windowId: tab.windowId });
          await chrome.tabGroups.move(groupId, { index: pinnedTabs.length });
        } catch (error) {
          console.warn('⚠️ [TabManager] Could not add tab to group:', error);
        }
      }
    }
    
    // Create managed tab record
    const managedTab: ManagedTab = {
      tabId: tab.id!,
      groupId: groupId || undefined,
      windowId: tab.windowId,
      url: targetUrl,
      title: tab.title,
      createdAt: Date.now(),
      lastActivity: Date.now()
    };
    
    this.managedTabs.set(tab.id!, managedTab);
    
    console.log(`✅ [TabManager] Opened managed tab ${tab.id} in ${groupId ? 'group ' + groupId : 'no group'}`);
    
    return managedTab;
  }

  /**
   * Add an existing tab to the managed group
   */
  async addTabToManagement(tabId: number): Promise<boolean> {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab) {
        console.warn(`⚠️ [TabManager] Tab ${tabId} not found`);
        return false;
      }
      
      // Check if already managed
      if (this.managedTabs.has(tabId)) {
        console.log(`📁 [TabManager] Tab ${tabId} is already managed`);
        return true;
      }
      
      // Add to group if available
      let groupId = this.mainGroupId;
      if (chrome.tabGroups && tab.id) {
        if (!this.mainGroupId) {
          groupId = await this.createTabGroup(tab.windowId);
        }
        
        if (groupId && tab.id) {
          await chrome.tabs.group({
            groupId,
            tabIds: [tab.id]
          });
        }
      }
      
      // Create managed tab record
      const managedTab: ManagedTab = {
        tabId: tab.id!,
        groupId: groupId || undefined,
        windowId: tab.windowId,
        url: tab.url || '',
        title: tab.title,
        createdAt: Date.now(),
        lastActivity: Date.now()
      };
      
      this.managedTabs.set(tabId, managedTab);
      
      console.log(`✅ [TabManager] Added tab ${tabId} to management`);
      
      return true;
    } catch (error) {
      console.error(`❌ [TabManager] Error adding tab ${tabId} to management:`, error);
      return false;
    }
  }

  /**
   * Remove a tab from management (but don't close it)
   */
  async removeTabFromManagement(tabId: number): Promise<boolean> {
    try {
      if (!this.managedTabs.has(tabId)) {
        return true; // Already not managed
      }
      
      // Remove from group if it's in one
      const managedTab = this.managedTabs.get(tabId);
      if (managedTab?.groupId && chrome.tabGroups) {
        try {
          await chrome.tabs.ungroup([tabId]);
        } catch (error) {
          console.warn(`⚠️ [TabManager] Could not remove tab ${tabId} from group:`, error);
        }
      }
      
      // Remove from tracking
      this.managedTabs.delete(tabId);
      
      console.log(`✅ [TabManager] Removed tab ${tabId} from management`);
      
      return true;
    } catch (error) {
      console.error(`❌ [TabManager] Error removing tab ${tabId} from management:`, error);
      return false;
    }
  }

  /**
   * Get all managed tabs
   */
  getManagedTabs(): ManagedTab[] {
    return Array.from(this.managedTabs.values());
  }

  /**
   * Check if a tab is managed
   */
  isTabManaged(tabId: number): boolean {
    return this.managedTabs.has(tabId);
  }

  /**
   * Update tab group status display
   */
  updateStatus(status: 'active' | 'idle' | 'disconnected'): void {
    if (this.currentStatus === status) return;
    
    this.currentStatus = status;
    
    if (!this.mainGroupId || !chrome.tabGroups) {
      return;
    }
    
    // Update group title with status indicator
    let statusIndicator = '';
    switch (status) {
      case 'active':
        statusIndicator = '🔵'; // Blue circle for active
        break;
      case 'idle':
        statusIndicator = '⚪'; // White circle for idle
        break;
      case 'disconnected':
        statusIndicator = '🔴'; // Red circle for disconnected
        break;
    }
    
    const title = `${TAB_GROUP_NAME} ${statusIndicator}`;
    
    chrome.tabGroups.update(this.mainGroupId, { title }).catch((error) => {
      console.warn('⚠️ [TabManager] Could not update group title:', error);
    });
  }

  /**
   * Update tab activity timestamp
   */
  updateTabActivity(tabId: number): void {
    const managedTab = this.managedTabs.get(tabId);
    if (managedTab) {
      managedTab.lastActivity = Date.now();
      this.managedTabs.set(tabId, managedTab);
      
      // Update status to active
      this.updateStatus('active');
    }
  }

  /**
   * Ensure a tab is managed (add to management if not already)
   */
  async ensureTabManaged(tabId: number): Promise<boolean> {
    if (this.isTabManaged(tabId)) {
      return true;
    }
    
    return await this.addTabToManagement(tabId);
  }

  /**
   * Get or create a managed tab for the current active tab
   */
  async getOrCreateManagedTabForCurrent(): Promise<ManagedTab | null> {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab?.id) {
        return null;
      }
      
      await this.ensureTabManaged(activeTab.id);
      return this.managedTabs.get(activeTab.id) || null;
    } catch (error) {
      console.error('❌ [TabManager] Error getting/creating managed tab for current:', error);
      return null;
    }
  }

  /**
   * Cleanup managed tabs that are no longer open
   */
  async cleanup(): Promise<void> {
    console.log('🧹 [TabManager] Cleaning up managed tabs...');
    
    const tabIds = Array.from(this.managedTabs.keys());
    const existingTabs = await chrome.tabs.query({});
    const existingTabIds = new Set(existingTabs.map(tab => tab.id).filter(Boolean) as number[]);
    
    let cleanedCount = 0;
    for (const tabId of tabIds) {
      if (!existingTabIds.has(tabId)) {
        this.managedTabs.delete(tabId);
        cleanedCount++;
      }
    }
    
    console.log(`✅ [TabManager] Cleaned up ${cleanedCount} closed tabs`);
    
    // If no managed tabs left, update status
    if (this.managedTabs.size === 0) {
      this.updateStatus('idle');
    }
  }

  /**
   * Setup event listeners
   */
  private setupListeners(): void {
    // Listen for tab removal
    chrome.tabs.onRemoved.addListener((tabId) => {
      if (this.managedTabs.has(tabId)) {
        console.log(`🗑️ [TabManager] Managed tab ${tabId} was closed`);
        this.managedTabs.delete(tabId);
        
        // Update status if no tabs left
        if (this.managedTabs.size === 0) {
          this.updateStatus('idle');
        }
      }
    });
    
    // Listen for tab updates (title changes, URL changes)
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (this.managedTabs.has(tabId)) {
        const managedTab = this.managedTabs.get(tabId)!;
        
        // Update URL if changed
        if (changeInfo.url) {
          managedTab.url = changeInfo.url;
        }
        
        // Update title if changed
        if (changeInfo.title) {
          managedTab.title = changeInfo.title;
        }
        
        this.managedTabs.set(tabId, managedTab);
      }
    });
    
    // Listen for tab group updates
    if (chrome.tabGroups && chrome.tabGroups.onUpdated) {
      chrome.tabGroups.onUpdated.addListener((group) => {
        if (group.id === this.mainGroupId) {
          console.log(`📁 [TabManager] Tab group updated:`, group.title);
        }
      });
    }
    
    // Listen for tab group removal
    if (chrome.tabGroups && chrome.tabGroups.onRemoved) {
      chrome.tabGroups.onRemoved.addListener((group) => {
        if (group.id === this.mainGroupId) {
          console.log(`🗑️ [TabManager] Tab group was removed: ${TAB_GROUP_NAME}`);
          this.mainGroupId = null;
          
          // Clear managed tabs that were in this group
          for (const [tabId, managedTab] of this.managedTabs.entries()) {
            if (managedTab.groupId === group.id) {
              this.managedTabs.delete(tabId);
            }
          }
        }
      });
    }
  }

  /**
   * Start periodic status updates
   */
  private startStatusUpdates(): void {
    if (this.statusUpdateInterval) {
      clearInterval(this.statusUpdateInterval);
    }
    
    // Update status every 30 seconds to handle idle timeouts
    this.statusUpdateInterval = setInterval(() => {
      this.checkIdleStatus();
    }, 30000) as unknown as number;
  }

  /**
   * Check if system has been idle and update status
   */
  private checkIdleStatus(): void {
    if (this.currentStatus !== 'active' || this.managedTabs.size === 0) {
      return;
    }
    
    const now = Date.now();
    const idleThreshold = 60000; // 1 minute
    
    // Check if any tab has been active recently
    let isActive = false;
    for (const managedTab of this.managedTabs.values()) {
      if (now - managedTab.lastActivity < idleThreshold) {
        isActive = true;
        break;
      }
    }
    
    if (!isActive) {
      this.updateStatus('idle');
    }
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    if (this.statusUpdateInterval) {
      clearInterval(this.statusUpdateInterval);
      this.statusUpdateInterval = null;
    }
    
    this.managedTabs.clear();
    console.log('🧹 [TabManager] Disposed');
  }
}

// Singleton instance
export const tabManager = new TabManager();