/**
 * Tab Manager with Tab Group Support
 * Supports multiple conversation sessions with isolated tab groups
 * Inspired by MANUS Chrome Plugin design
 */

// Tab group constants
const TAB_GROUP_NAME = 'OpenBrowser';
const TAB_GROUP_COLOR = 'grey' as chrome.tabGroups.Color;
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

// Session state for each conversation
export interface TabGroupState {
  groupId: number | null;
  managedTabs: Map<number, ManagedTab>;
  conversationId: string;
  createdAt: number;
  lastActivity: number;
  status: 'active' | 'idle' | 'disconnected';
  currentActiveTabId: number | null; // Current active tab for this conversation
}

export class TabManager {
  // ✅ Multi-session support: Map conversation_id -> TabGroupState
  private sessions: Map<string, TabGroupState> = new Map();
  private statusUpdateInterval: number | null = null;

  // Event listeners for tab switching
  private tabSwitchedListeners: Array<
    (conversationId: string, tabId: number) => void
  > = [];

  /**
   * Initialize the tab manager
   */
  async initialize(): Promise<void> {
    console.log('📁 [TabManager] Initializing multi-session tab manager...');

    // Check if tabGroups API is available
    if (!chrome.tabGroups) {
      console.warn(
        '⚠️ [TabManager] tabGroups API not available, falling back to simple tab management',
      );
      return;
    }

    // Setup listeners
    this.setupListeners();

    // Start status update interval
    this.startStatusUpdates();

    console.log('✅ [TabManager] Multi-session tab manager initialized');
  }

  /**
   * Get or create session state for a conversation
   */
  private getOrCreateSession(conversationId: string): TabGroupState {
    if (!this.sessions.has(conversationId)) {
      console.log(
        `📁 [TabManager] Creating new session state for conversation: ${conversationId}`,
      );
      this.sessions.set(conversationId, {
        groupId: null,
        managedTabs: new Map(),
        conversationId,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        status: 'idle',
        currentActiveTabId: null,
      });
    }
    return this.sessions.get(conversationId)!;
  }

  /**
   * Find existing tab group or create a new one for a conversation
   */
  private async findOrCreateTabGroup(
    conversationId: string,
  ): Promise<number | null> {
    try {
      const session = this.getOrCreateSession(conversationId);

      // If we already have a groupId, verify it still exists
      if (session.groupId !== null) {
        try {
          const existingGroup = await chrome.tabGroups.get(session.groupId);
          if (existingGroup) {
            console.log(
              `✅ [TabManager] Using existing tab group for ${conversationId}: ${existingGroup.title} (ID: ${session.groupId})`,
            );
            return session.groupId;
          }
        } catch (error) {
          // Group might have been deleted, continue to find or create
          console.log(
            `⚠️ [TabManager] Previous group ${session.groupId} not found for ${conversationId}, will find or create new one`,
          );
          session.groupId = null;
        }
      }

      // Generate group name for this conversation
      const groupName = this.generateGroupName(conversationId);

      // Query existing tab groups by name
      const groups = await chrome.tabGroups.query({ title: groupName });

      if (groups.length > 0) {
        // Use the first matching group
        session.groupId = groups[0].id;
        console.log(
          `✅ [TabManager] Found existing tab group for ${conversationId}: ${groupName} (ID: ${session.groupId})`,
        );

        // Get tabs in this group
        const tabsInGroup = await chrome.tabs.query({
          groupId: session.groupId,
        });
        for (const tab of tabsInGroup) {
          if (tab.id) {
            session.managedTabs.set(tab.id, {
              tabId: tab.id,
              groupId: session.groupId,
              windowId: tab.windowId,
              url: tab.url || '',
              title: tab.title,
              createdAt: Date.now(),
              lastActivity: Date.now(),
            });
          }
        }
        return session.groupId;
      } else {
        console.log(
          `📁 [TabManager] No existing tab group found for ${conversationId}, will create when needed`,
        );
        return null;
      }
    } catch (error) {
      console.error(
        `❌ [TabManager] Error finding/creating tab group for ${conversationId}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Generate tab group name for a conversation
   * Always uses a suffix based on the conversation ID for uniqueness.
   */
  private generateGroupName(conversationId: string): string {
    console.log(
      `🔍 [generateGroupName] Called with conversationId: "${conversationId}"`,
    );
    // Use first 8 characters of conversation ID for shorter group names
    const shortId =
      conversationId && conversationId.length >= 8
        ? conversationId.substring(0, 8)
        : conversationId && conversationId.length > 0
          ? conversationId
          : 'default';
    const groupName = `${TAB_GROUP_NAME}-${shortId}`;
    console.log(
      `✅ [generateGroupName] Generated group name: "${groupName}" for conversationId: "${conversationId}"`,
    );
    return groupName;
  }

  /**
   * Position a tab group to the left side (after pinned tabs)
   */
  private async positionTabGroup(
    groupId: number,
    windowId: number,
  ): Promise<void> {
    try {
      const pinnedTabs = await chrome.tabs.query({ pinned: true, windowId });
      await chrome.tabGroups.move(groupId, { index: pinnedTabs.length });
      console.log(
        `✅ [TabManager] Positioned group ${groupId} after ${pinnedTabs.length} pinned tabs`,
      );
    } catch (error) {
      console.warn(
        `⚠️ [TabManager] Could not position group ${groupId}:`,
        error,
      );
    }
  }

  /**
   * Create a new tab group for a conversation
   * Note: This now just prepares the group, no dummy tab needed
   */

  /**
   * Initialize a new managed session with a starting URL
   * This creates the tab group and opens the first tab
   */
  async initializeSession(
    startUrl: string,
    conversationId: string,
  ): Promise<ManagedTab> {
    console.log(
      `🚀 [TabManager] Initializing new session for ${conversationId} with URL: ${startUrl}`,
    );

    const session = this.getOrCreateSession(conversationId);

    // Ensure URL has protocol
    let targetUrl = startUrl;

    // FIXME(softpudding): I removed this so file can be accessed directly.
    // if (!startUrl.match(/^https?:\/\//)) {
    //   targetUrl = `https://${startUrl}`;
    // }

    // First, ensure we have a tab group (find existing or create new)

    // ⬇️ DEBUG: Print current window's existing tab groups before initialization
    if (!chrome.tabGroups) {
      throw new Error(
        'chrome.tabGroups API is not available. Ensure Chrome version >= 85 and "tabGroups" permission is declared in manifest.json',
      );
    }
    try {
      const currentWindow = await chrome.windows.getCurrent();
      const allGroups = await chrome.tabGroups.query({
        windowId: currentWindow.id,
      });
      console.log(
        `🔍 [DEBUG-${conversationId.substring(0, 8)}] Current window has ${allGroups.length} existing groups:`,
        allGroups.map((g) => ({ id: g.id, title: g.title, color: g.color })),
      );
    } catch (e) {
      console.log(
        `🔍 [DEBUG-${conversationId.substring(0, 8)}] Failed to query existing groups:`,
        e,
      );
    }
    if (!session.groupId && chrome.tabGroups) {
      console.log(
        `📁 [TabManager] Finding or creating tab group for session ${conversationId}`,
      );
      const groupId = await this.findOrCreateTabGroup(conversationId);
      console.log(
        `🔍 [DEBUG-${conversationId.substring(0, 8)}] findOrCreateTabGroup returned: ${groupId}`,
      );
      if (!groupId) {
        console.log(
          `📁 [TabManager] No existing tab group found for ${conversationId}, will create with first tab`,
        );
      }
      console.log(
        `✅ [TabManager] Tab group ready for ${conversationId}: ${session.groupId}`,
      );
    }

    // Create the first tab
    const tab = await chrome.tabs.create({ url: targetUrl, active: false });

    // ⬇️ DEBUG: Print initial groupId of the created tab
    console.log(
      `🔍 [DEBUG-${conversationId.substring(0, 8)}] Created tab ${tab.id}, initial groupId: ${tab.groupId}, windowId: ${tab.windowId}`,
    );

    // ⬇️ FIX: If Chrome auto-grouped the tab, remove it from that group first
    if (
      tab.groupId !== undefined &&
      tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE
    ) {
      console.log(
        `⚠️ [DEBUG-${conversationId.substring(0, 8)}] Tab was auto-grouped into group ${tab.groupId}, removing it first`,
      );
      try {
        await chrome.tabs.ungroup([tab.id!]);
        console.log(
          `✅ [DEBUG-${conversationId.substring(0, 8)}] Successfully removed tab from auto-assigned group`,
        );
      } catch (e) {
        console.warn(
          `⚠️ [DEBUG-${conversationId.substring(0, 8)}] Failed to ungroup tab:`,
          e,
        );
      }
    }

    if (!tab.id) {
      throw new Error('Failed to create tab for session initialization');
    }

    // Add to management
    await this.addTabToManagement(tab.id, conversationId);

    // ⬇️ DEBUG: Verify tab was moved to correct group
    try {
      const finalTab = await chrome.tabs.get(tab.id);
      console.log(
        `🔍 [DEBUG-${conversationId.substring(0, 8)}] After addTabToManagement, tab ${tab.id} groupId: ${finalTab.groupId}, expected: ${session.groupId}`,
      );
    } catch (e) {
      console.log(
        `🔍 [DEBUG-${conversationId.substring(0, 8)}] Failed to verify final tab groupId:`,
        e,
      );
    }

    // Update session status
    this.updateSessionStatus(conversationId, 'active');

    console.log(
      `✅ [TabManager] Session ${conversationId} initialized with tab ${tab.id} in group ${session.groupId}`,
    );

    const managedTab = session.managedTabs.get(tab.id);
    if (!managedTab) {
      throw new Error('Failed to retrieve managed tab after creation');
    }

    return managedTab;
  }

  /**
   * Check if session is initialized (has a tab group and at least one managed tab)
   */
  isSessionInitialized(conversationId: string): boolean {
    const session = this.sessions.get(conversationId);
    return (
      session !== undefined &&
      session.groupId !== null &&
      session.managedTabs.size > 0
    );
  }

  /**
   * Get all conversation IDs
   */
  getAllConversationIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Get only managed tabs for a specific conversation
   */
  getManagedTabsOnly(conversationId: string): ManagedTab[] {
    const session = this.sessions.get(conversationId);
    return session ? Array.from(session.managedTabs.values()) : [];
  }

  /**
   * Open a new tab and add it to the managed tab group
   */
  async openManagedTab(
    url: string,
    active: boolean = false,
    conversationId: string,
  ): Promise<ManagedTab> {
    console.log(
      `📁 [TabManager] Opening managed tab for ${conversationId}: ${url}`,
    );

    const session = this.getOrCreateSession(conversationId);

    // Ensure URL has protocol
    let targetUrl = url;
    if (!url.match(/^https?:\/\//)) {
      targetUrl = `https://${url}`;
    }

    // Create the tab
    const tab = await chrome.tabs.create({ url: targetUrl, active });

    // Use addTabToManagement for consistent group handling
    const added = await this.addTabToManagement(tab.id!, conversationId);
    if (!added) {
      console.warn(
        `⚠️ [TabManager] Failed to add tab ${tab.id} to management for ${conversationId}`,
      );
      // Fall back to creating managed tab record manually
      const fallbackManagedTab: ManagedTab = {
        tabId: tab.id!,
        groupId: undefined,
        windowId: tab.windowId,
        url: targetUrl,
        title: tab.title,
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };
      session.managedTabs.set(tab.id!, fallbackManagedTab);
      session.lastActivity = Date.now();
      console.log(
        `✅ [TabManager] Opened managed tab ${tab.id} for ${conversationId} (fallback, no group)`,
      );
      return fallbackManagedTab;
    }

    // Get the managed tab that was created by addTabToManagement
    const managedTab = session.managedTabs.get(tab.id!);
    if (!managedTab) {
      throw new Error(
        `Failed to retrieve managed tab ${tab.id} after adding to management`,
      );
    }

    console.log(
      `✅ [TabManager] Opened managed tab ${tab.id} for ${conversationId} in ${managedTab.groupId ? 'group ' + managedTab.groupId : 'no group'}`,
    );

    return managedTab;
  }

  /**
   * Add an existing tab to the managed group
   */
  async addTabToManagement(
    tabId: number,
    conversationId: string,
  ): Promise<boolean> {
    try {
      const session = this.getOrCreateSession(conversationId);
      const tab = await chrome.tabs.get(tabId);
      if (!tab) {
        console.warn(`⚠️ [TabManager] Tab ${tabId} not found`);
        return false;
      }

      // Check if already managed
      if (session.managedTabs.has(tabId)) {
        console.log(
          `📁 [TabManager] Tab ${tabId} is already managed for ${conversationId}`,
        );
        return true;
      }

      // Add to group if available
      let groupId = session.groupId;
      if (chrome.tabGroups && tab.id) {
        if (!session.groupId) {
          // ✅ FIX: Create group with first real tab instead of dummy tab
          const groupName = this.generateGroupName(conversationId);
          console.log(
            `📁 [TabManager] Creating tab group with first real tab for ${conversationId}`,
          );

          groupId = await chrome.tabs.group({
            createProperties: { windowId: tab.windowId },
            tabIds: [tab.id],
          });

          // Update group properties
          await chrome.tabGroups.update(groupId, {
            title: groupName,
            collapsed: TAB_GROUP_COLLAPSED,
            color: TAB_GROUP_COLOR,
          });

          session.groupId = groupId;
          console.log(
            `✅ [TabManager] Created tab group for ${conversationId}: ${groupName} (ID: ${groupId})`,
          );

          // Position the new group
          await this.positionTabGroup(groupId, tab.windowId);
        } else {
          // Add to existing group
          await chrome.tabs.group({
            groupId: groupId!,
            tabIds: [tab.id],
          });

          // Position the group (ensure consistent placement)
          await this.positionTabGroup(groupId!, tab.windowId);
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
        lastActivity: Date.now(),
      };

      session.managedTabs.set(tabId, managedTab);

      console.log(
        `✅ [TabManager] Added tab ${tabId} to management for ${conversationId}`,
      );

      return true;
    } catch (error) {
      console.error(
        `❌ [TabManager] Error adding tab ${tabId} to management:`,
        error,
      );
      return false;
    }
  }

  /**
   * Remove a tab from management (but don't close it)
   */
  async removeTabFromManagement(
    tabId: number,
    conversationId: string,
  ): Promise<boolean> {
    try {
      const session = this.sessions.get(conversationId);
      if (!session || !session.managedTabs.has(tabId)) {
        return true; // Already not managed
      }

      // Remove from group if it's in one
      const managedTab = session.managedTabs.get(tabId);
      if (managedTab?.groupId && chrome.tabGroups) {
        try {
          await chrome.tabs.ungroup([tabId]);
        } catch (error) {
          console.warn(
            `⚠️ [TabManager] Could not remove tab ${tabId} from group:`,
            error,
          );
        }
      }

      // Remove from tracking
      session.managedTabs.delete(tabId);

      console.log(
        `✅ [TabManager] Removed tab ${tabId} from management for ${conversationId}`,
      );

      return true;
    } catch (error) {
      console.error(
        `❌ [TabManager] Error removing tab ${tabId} from management:`,
        error,
      );
      return false;
    }
  }

  /**
   * Get all managed tabs for a specific conversation
   */
  getManagedTabs(conversationId: string): ManagedTab[] {
    const session = this.sessions.get(conversationId);
    return session ? Array.from(session.managedTabs.values()) : [];
  }

  /**
   * Check if a tab is managed in a specific conversation
   */
  isTabManaged(tabId: number, conversationId: string): boolean {
    const session = this.sessions.get(conversationId);
    return session ? session.managedTabs.has(tabId) : false;
  }

  /**
   * Find conversation ID that manages a given tab ID
   */
  findConversationIdByTabId(tabId: number): string | null {
    for (const [conversationId, session] of this.sessions.entries()) {
      if (session.managedTabs.has(tabId)) {
        return conversationId;
      }
    }
    return null;
  }

  /**
   * Find conversation ID by tab group ID (most accurate for managed tabs)
   */
  async findConversationByGroup(tabId: number): Promise<string | null> {
    // Check if tab groups API is available
    if (!chrome.tabGroups) {
      console.log(
        `ℹ️ [TabManager] Tab groups API not available, skipping group detection for tab ${tabId}`,
      );
      return null;
    }

    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab) {
        return null;
      }

      // Check if tab is in a group (groupId may be -1 for no group)
      if (
        tab.groupId === undefined ||
        tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE
      ) {
        return null;
      }

      const groupId = tab.groupId;
      for (const [conversationId, session] of this.sessions.entries()) {
        if (session.groupId === groupId) {
          return conversationId;
        }
      }
    } catch (error) {
      console.warn(
        `⚠️ [TabManager] Error finding conversation by group for tab ${tabId}:`,
        error,
      );
    }
    return null;
  }

  /**
   * Update session status display
   */
  updateSessionStatus(
    conversationId: string,
    status: 'active' | 'idle' | 'disconnected',
  ): void {
    const session = this.sessions.get(conversationId);
    if (!session || session.status === status) return;

    session.status = status;
    session.lastActivity = Date.now();

    if (!session.groupId || !chrome.tabGroups) {
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

    const groupName = this.generateGroupName(conversationId);
    const title = `${groupName} ${statusIndicator}`;

    chrome.tabGroups.update(session.groupId, { title }).catch((error) => {
      console.warn(
        `⚠️ [TabManager] Could not update group title for ${conversationId}:`,
        error,
      );
    });
  }

  /**
   * Update global status (for backward compatibility)
   */
  updateStatus(status: 'active' | 'idle' | 'disconnected'): void {
    // Update all sessions with the global status
    for (const conversationId of this.sessions.keys()) {
      this.updateSessionStatus(conversationId, status);
    }
  }

  /**
   * Update tab activity timestamp
   */
  updateTabActivity(tabId: number, conversationId: string): void {
    const session = this.sessions.get(conversationId);
    if (!session) return;

    const managedTab = session.managedTabs.get(tabId);
    if (managedTab) {
      managedTab.lastActivity = Date.now();
      session.managedTabs.set(tabId, managedTab);
      session.lastActivity = Date.now();

      // Update status to active
      this.updateSessionStatus(conversationId, 'active');
    }
  }

  /**
   * Ensure a tab is managed (add to management if not already)
   */
  async ensureTabManaged(
    tabId: number,
    conversationId: string,
  ): Promise<boolean> {
    if (this.isTabManaged(tabId, conversationId)) {
      return true;
    }

    return await this.addTabToManagement(tabId, conversationId);
  }

  /**
   * Get or create a managed tab for the current active tab
   */
  async getOrCreateManagedTabForCurrent(
    conversationId: string,
  ): Promise<ManagedTab | null> {
    try {
      const [activeTab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!activeTab?.id) {
        return null;
      }

      await this.ensureTabManaged(activeTab.id, conversationId);
      const session = this.sessions.get(conversationId);
      return session?.managedTabs.get(activeTab.id) || null;
    } catch (error) {
      console.error(
        `❌ [TabManager] Error getting/creating managed tab for current in ${conversationId}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Cleanup managed tabs that are no longer open (all sessions)
   */
  async cleanup(): Promise<void> {
    console.log('🧹 [TabManager] Cleaning up all sessions...');

    const existingTabs = await chrome.tabs.query({});
    const existingTabIds = new Set(
      existingTabs.map((tab) => tab.id).filter(Boolean) as number[],
    );

    let totalCleaned = 0;
    for (const [conversationId, session] of this.sessions.entries()) {
      let cleanedCount = 0;
      for (const tabId of Array.from(session.managedTabs.keys())) {
        if (!existingTabIds.has(tabId)) {
          session.managedTabs.delete(tabId);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        console.log(
          `✅ [TabManager] Cleaned up ${cleanedCount} closed tabs for ${conversationId}`,
        );
      }

      // If no managed tabs left, update status
      if (session.managedTabs.size === 0) {
        this.updateSessionStatus(conversationId, 'idle');
      }

      totalCleaned += cleanedCount;
    }

    console.log(
      `✅ [TabManager] Total cleaned: ${totalCleaned} tabs across all sessions`,
    );
  }

  /**
   * Cleanup a specific session and close its tabs
   */
  async cleanupSession(conversationId: string): Promise<void> {
    console.log(`🧹 [TabManager] Cleaning up session ${conversationId}...`);

    const session = this.sessions.get(conversationId);
    if (!session) {
      console.log(`⚠️ [TabManager] Session ${conversationId} not found`);
      return;
    }

    // Close all managed tabs
    const tabIds = Array.from(session.managedTabs.keys());
    for (const tabId of tabIds) {
      try {
        await chrome.tabs.remove(tabId);
      } catch (error) {
        console.warn(`⚠️ [TabManager] Could not close tab ${tabId}:`, error);
      }
    }

    // Remove tab group if it exists
    if (session.groupId && chrome.tabGroups) {
      try {
        // Chrome tabGroups API doesn't have a remove method - group will be auto-removed when all tabs are closed
        // Alternatively, we could ungroup all tabs first, but closing tabs should be sufficient
        console.log(
          `✅ [TabManager] Tab group ${session.groupId} will be auto-removed after closing all tabs for ${conversationId}`,
        );
      } catch (error) {
        console.warn(
          `⚠️ [TabManager] Could not remove group ${session.groupId}:`,
          error,
        );
      }
    }

    // Remove session
    this.sessions.delete(conversationId);
    console.log(`✅ [TabManager] Session ${conversationId} cleaned up`);
  }

  /**
   * Setup event listeners
   */
  private setupListeners(): void {
    // Listen for tab removal
    chrome.tabs.onRemoved.addListener((tabId) => {
      // Find which session this tab belongs to
      for (const [conversationId, session] of this.sessions.entries()) {
        if (session.managedTabs.has(tabId)) {
          console.log(
            `🗑️ [TabManager] Managed tab ${tabId} was closed for ${conversationId}`,
          );

          // Check if this was the current active tab
          const wasActiveTab = session.currentActiveTabId === tabId;

          session.managedTabs.delete(tabId);

          // Clear active tab if it was the one closed
          if (wasActiveTab) {
            session.currentActiveTabId = null;
            console.log(
              `🗑️ [TabManager] Active tab ${tabId} was closed, clearing active tab for ${conversationId}`,
            );
          }

          // Update status if no tabs left
          if (session.managedTabs.size === 0) {
            this.updateSessionStatus(conversationId, 'idle');
          }
          break;
        }
      }
    });

    // Listen for tab creation (new tabs opened from managed tabs)
    chrome.tabs.onCreated.addListener(async (tab) => {
      console.log(
        `➕ [TabManager] Tab created: ${tab.id}, openerTabId: ${tab.openerTabId}, active: ${tab.active}, windowId: ${tab.windowId}`,
      );

      if (!tab.id) {
        console.log(`⚠️ [TabManager] Tab created without ID, skipping`);
        return;
      }

      const tabId = tab.id;
      let conversationId: string | null = null;
      let detectionMethod = 'none';

      // Method A: Try openerTabId first (most accurate for link clicks)
      if (tab.openerTabId) {
        conversationId = this.findConversationIdByTabId(tab.openerTabId);
        if (conversationId) {
          detectionMethod = 'openerTabId';
          console.log(
            `➕ [TabManager] New tab ${tabId} opened from managed tab ${tab.openerTabId} in conversation ${conversationId} (via ${detectionMethod})`,
          );
        } else {
          console.log(
            `ℹ️ [TabManager] New tab ${tabId} has openerTabId ${tab.openerTabId} but opener is not managed or no conversation found`,
          );
        }
      }

      // Method B: If openerTabId failed, try tab group detection (most accurate for managed tabs)
      if (!conversationId) {
        conversationId = await this.findConversationByGroup(tabId);
        if (conversationId) {
          detectionMethod = 'groupId';
          console.log(
            `➕ [TabManager] New tab ${tabId} detected via tab group in conversation ${conversationId} (via ${detectionMethod})`,
          );
        }
      }

      // If we found a conversation, add to management and set as active
      if (conversationId) {
        await this.addTabToManagement(tabId, conversationId);

        // Auto-switch to new tab when opened from a managed tab
        // This matches user expectation: clicking a link should go to the new page
        this.setCurrentActiveTabId(conversationId, tabId);
        console.log(
          `🔄 [TabManager] Auto-switched to new tab ${tabId} in conversation ${conversationId} (detected via ${detectionMethod})`,
        );
      } else {
        console.log(
          `ℹ️ [TabManager] New tab ${tabId} could not be associated with any conversation`,
        );
      }
    });

    // Listen for tab activation (when user switches tabs)
    chrome.tabs.onActivated.addListener(async (activeInfo) => {
      const { tabId, windowId } = activeInfo;
      console.log(
        `🎯 [TabManager] Tab activated: ${tabId} in window ${windowId}`,
      );

      // Method A: Try tab ID first (already managed)
      let conversationId = this.findConversationIdByTabId(tabId);
      let detectionMethod = conversationId ? 'tabId' : 'none';

      // Method B: If not found by tab ID, try tab group detection
      if (!conversationId) {
        conversationId = await this.findConversationByGroup(tabId);
        if (conversationId) {
          detectionMethod = 'groupId';
          console.log(
            `🎯 [TabManager] Activated tab ${tabId} not in managedTabs, but belongs to tab group in conversation ${conversationId}`,
          );

          // Add this tab to management since it's in a managed group
          await this.addTabToManagement(tabId, conversationId);
          console.log(
            `➕ [TabManager] Added activated tab ${tabId} to management via group detection`,
          );
        }
      }

      if (conversationId) {
        // Update as active for its conversation
        console.log(
          `🎯 [TabManager] Activated tab ${tabId} is managed, updating as active for conversation ${conversationId} (detected via ${detectionMethod})`,
        );
        this.setCurrentActiveTabId(conversationId, tabId);
      } else {
        console.log(
          `ℹ️ [TabManager] Activated tab ${tabId} is not managed and window ${windowId} has no managed conversation`,
        );
      }
    });

    // Listen for tab updates (title changes, URL changes)
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, _tab) => {
      // Find which session this tab belongs to
      for (const [_conversationId, session] of this.sessions.entries()) {
        if (session.managedTabs.has(tabId)) {
          const managedTab = session.managedTabs.get(tabId)!;

          // Update URL if changed
          if (changeInfo.url) {
            managedTab.url = changeInfo.url;
          }

          // Update title if changed
          if (changeInfo.title) {
            managedTab.title = changeInfo.title;
          }

          session.managedTabs.set(tabId, managedTab);
          break;
        }
      }
    });

    // Listen for tab group updates
    if (chrome.tabGroups && chrome.tabGroups.onUpdated) {
      chrome.tabGroups.onUpdated.addListener((group) => {
        // Find which session this group belongs to
        for (const [conversationId, session] of this.sessions.entries()) {
          if (session.groupId === group.id) {
            console.log(
              `📁 [TabManager] Tab group updated for ${conversationId}:`,
              group.title,
            );
            break;
          }
        }
      });
    }

    // Listen for tab group removal
    if (chrome.tabGroups && chrome.tabGroups.onRemoved) {
      chrome.tabGroups.onRemoved.addListener((group) => {
        // Find which session this group belongs to
        for (const [conversationId, session] of this.sessions.entries()) {
          if (session.groupId === group.id) {
            console.log(
              `🗑️ [TabManager] Tab group was removed for ${conversationId}`,
            );
            session.groupId = null;

            // Clear managed tabs that were in this group
            for (const [tabId, managedTab] of session.managedTabs.entries()) {
              if (managedTab.groupId === group.id) {
                session.managedTabs.delete(tabId);
              }
            }
            break;
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
    const now = Date.now();
    const idleThreshold = 60000; // 1 minute

    // Check each session
    for (const [conversationId, session] of this.sessions.entries()) {
      if (session.status !== 'active' || session.managedTabs.size === 0) {
        continue;
      }

      // Check if any tab has been active recently
      let isActive = false;
      for (const managedTab of session.managedTabs.values()) {
        if (now - managedTab.lastActivity < idleThreshold) {
          isActive = true;
          break;
        }
      }

      if (!isActive) {
        this.updateSessionStatus(conversationId, 'idle');
      }
    }
  }

  /**
   * Set current active tab for a conversation
   * @param notifyListeners Whether to notify tab switched listeners (default: true)
   */
  setCurrentActiveTabId(
    conversationId: string,
    tabId: number,
    notifyListeners: boolean = true,
  ): void {
    const session = this.sessions.get(conversationId);
    if (!session) {
      console.warn(
        `⚠️ [TabManager] Cannot set active tab ${tabId}: session ${conversationId} not found`,
      );
      return;
    }

    // Verify tab exists in managed tabs
    if (!session.managedTabs.has(tabId)) {
      console.warn(
        `⚠️ [TabManager] Cannot set active tab ${tabId}: tab not managed in session ${conversationId}`,
      );
      return;
    }

    // Only update if different
    if (session.currentActiveTabId === tabId) {
      return;
    }

    session.currentActiveTabId = tabId;
    console.log(
      `✅ [TabManager] Set active tab for ${conversationId}: ${tabId}`,
    );

    // Notify listeners
    if (notifyListeners) {
      this.notifyTabSwitchedListeners(conversationId, tabId);
    }
  }

  /**
   * Get current active tab ID for a conversation
   * Returns the first managed tab if no active tab is set
   */
  getCurrentActiveTabId(conversationId: string): number | null {
    const session = this.sessions.get(conversationId);
    if (!session || session.managedTabs.size === 0) {
      return null;
    }

    // If active tab is set and still exists, return it
    if (
      session.currentActiveTabId &&
      session.managedTabs.has(session.currentActiveTabId)
    ) {
      return session.currentActiveTabId;
    }

    // Otherwise, return the first managed tab
    const firstTabId = Array.from(session.managedTabs.keys())[0];
    if (firstTabId) {
      // Auto-set as active for consistency
      session.currentActiveTabId = firstTabId;
      return firstTabId;
    }

    return null;
  }

  /**
   * Get current active tab for a conversation
   */
  getCurrentActiveTab(conversationId: string): ManagedTab | null {
    const tabId = this.getCurrentActiveTabId(conversationId);
    if (!tabId) return null;

    const session = this.sessions.get(conversationId);
    return session?.managedTabs.get(tabId) || null;
  }

  /**
   * Add listener for tab switched events
   */
  addTabSwitchedListener(
    listener: (conversationId: string, tabId: number) => void,
  ): void {
    this.tabSwitchedListeners.push(listener);
  }

  /**
   * Remove listener for tab switched events
   */
  removeTabSwitchedListener(
    listener: (conversationId: string, tabId: number) => void,
  ): void {
    const index = this.tabSwitchedListeners.indexOf(listener);
    if (index > -1) {
      this.tabSwitchedListeners.splice(index, 1);
    }
  }

  /**
   * Notify all tab switched listeners
   */
  private notifyTabSwitchedListeners(
    conversationId: string,
    tabId: number,
  ): void {
    console.log(
      `🔄 [TabManager] Notifying ${this.tabSwitchedListeners.length} listeners about tab switch: ${conversationId} -> ${tabId}`,
    );
    for (const listener of this.tabSwitchedListeners) {
      try {
        listener(conversationId, tabId);
      } catch (error) {
        console.error('Error in tab switched listener:', error);
      }
    }
  }

  /**
   * Notify that a tab has been switched to (legacy method)
   */
  notifyTabSwitched(conversationId: string, tabId: number): void {
    console.log(`🔄 [TabManager] Tab switched in ${conversationId}: ${tabId}`);
    this.setCurrentActiveTabId(conversationId, tabId);
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    if (this.statusUpdateInterval) {
      clearInterval(this.statusUpdateInterval);
      this.statusUpdateInterval = null;
    }

    this.sessions.clear();
    console.log('🧹 [TabManager] Disposed');
  }
}

// Singleton instance
export const tabManager = new TabManager();
