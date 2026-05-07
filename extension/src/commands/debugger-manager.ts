/**
 * Debugger Session Manager
 *
 * 会话级别的 Debugger 生命周期管理
 *
 * 设计原则:
 * 1. 长连接优先：会话活跃期间保持 debugger attached
 * 2. 会话隔离：每个 conversation 有独立的 debugger 状态
 * 3. 空闲自动清理：会话空闲超过阈值自动 detach
 * 4. 与 TabManager 集成：生命周期同步
 */

import { rejectPendingCommands } from './cdp-commander';
import { clearScreenshotCache } from './computer';
import { dialogManager } from './dialog';

// ============================================================================
// Types
// ============================================================================

export interface DebuggerSession {
  conversationId: string;
  attachedTabs: Map<number, DebuggerTabState>;
  createdAt: number;
  lastActivity: number;
  status: 'active' | 'idle' | 'disconnected';
}

export interface DebuggerTabState {
  tabId: number;
  attachedAt: number;
  lastUsedAt: number;
  pendingCommands: number; // 正在执行的命令数
}

// ============================================================================
// Constants
// ============================================================================

// 会话空闲超时：5分钟无活动后 detach 所有 tabs
const SESSION_IDLE_TIMEOUT = 5 * 60 * 1000;

// Tab 单独空闲超时：3分钟无使用后可考虑 detach（仅当会话也不活跃时）
const TAB_IDLE_TIMEOUT = 3 * 60 * 1000;

// 心跳检查间隔：30秒
const HEARTBEAT_INTERVAL = 30 * 1000;

// ============================================================================
// DebuggerSessionManager Class
// ============================================================================

export class DebuggerSessionManager {
  // 会话存储：conversationId -> DebuggerSession
  private sessions: Map<string, DebuggerSession> = new Map();

  // 快速查找：tabId -> conversationId
  private tabToSession: Map<number, string> = new Map();

  // attach/detach 操作锁，防止并发问题
  private attachLocks: Map<number, Promise<boolean>> = new Map();

  // 空闲检查定时器
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  // 全局初始化标记
  private initialized = false;

  constructor() {
    this.initialize();
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  private initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    // 监听 debugger 强制 detach（用户手动关闭、页面崩溃等）
    if (chrome.debugger?.onDetach) {
      chrome.debugger.onDetach.addListener((source, reason) => {
        const tabId = source.tabId;
        if (tabId !== undefined) {
          this.handleForcedDetach(tabId, reason);
        }
      });
    }

    // 监听 tab 关闭
    if (chrome.tabs?.onRemoved) {
      chrome.tabs.onRemoved.addListener((tabId) => {
        this.handleTabClosed(tabId);
      });
    }

    // 启动心跳检查
    this.startHeartbeat();

    console.log(
      '🔧 [DebuggerManager] Session-based debugger manager initialized',
    );
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.heartbeatTimer = setInterval(() => {
      this.checkIdleSessions();
    }, HEARTBEAT_INTERVAL);
  }

  // ==========================================================================
  // Session Management
  // ==========================================================================

  /**
   * 获取或创建会话
   */
  private getOrCreateSession(conversationId: string): DebuggerSession {
    if (!this.sessions.has(conversationId)) {
      this.sessions.set(conversationId, {
        conversationId,
        attachedTabs: new Map(),
        createdAt: Date.now(),
        lastActivity: Date.now(),
        status: 'idle',
      });
      console.log(
        `🔧 [DebuggerManager] Created new session: ${conversationId}`,
      );
    }
    return this.sessions.get(conversationId)!;
  }

  /**
   * 获取会话（如果存在）
   */
  getSession(conversationId: string): DebuggerSession | undefined {
    return this.sessions.get(conversationId);
  }

  /**
   * 更新会话活动时间
   */
  touchSession(conversationId: string): void {
    const session = this.sessions.get(conversationId);
    if (session) {
      session.lastActivity = Date.now();
      if (session.status === 'idle') {
        session.status = 'active';
      }
    }
  }

  /**
   * 清理会话（会话结束时调用）
   */
  async cleanupSession(conversationId: string): Promise<void> {
    const session = this.sessions.get(conversationId);
    if (!session) {
      console.log(
        `🔧 [DebuggerManager] Session ${conversationId} not found for cleanup`,
      );
      return;
    }

    console.log(`🧹 [DebuggerManager] Cleaning up session: ${conversationId}`);

    // Detach 所有 tabs
    const detachPromises = Array.from(session.attachedTabs.keys()).map(
      (tabId) => this.detachTab(tabId, 'session cleanup'),
    );

    await Promise.allSettled(detachPromises);

    // 清理索引
    for (const tabId of session.attachedTabs.keys()) {
      this.tabToSession.delete(tabId);
    }

    // 删除会话
    this.sessions.delete(conversationId);

    console.log(`✅ [DebuggerManager] Session ${conversationId} cleaned up`);
  }

  // ==========================================================================
  // Tab Attachment (Long Connection)
  // ==========================================================================

  /**
   * 为会话中的 tab attach debugger（长连接模式）
   *
   * @param tabId 目标 tab
   * @param conversationId 会话 ID
   * @returns 是否成功 attach
   */
  async attachDebugger(
    tabId: number,
    conversationId: string,
  ): Promise<boolean> {
    this.initialize();

    // 检查是否已经在某个会话中 attached
    const existingConversationId = this.tabToSession.get(tabId);
    if (existingConversationId) {
      if (existingConversationId === conversationId) {
        // 同一会话，已 attached，更新活动时间并返回
        const session = this.sessions.get(conversationId);
        if (session) {
          const tabState = session.attachedTabs.get(tabId);
          if (tabState) {
            tabState.lastUsedAt = Date.now();
            this.touchSession(conversationId);
            console.log(
              `🔧 [DebuggerManager] Tab ${tabId} already attached in session ${conversationId}`,
            );
            // Re-assert unthrottle: in-page navigation can drop the
            // emulation flags, so refreshing them on every command is
            // cheap insurance against a slow background tab.
            this.unthrottleRenderer(tabId);
            return true;
          }
        }
      } else {
        // 不同会话，先 detach 再 attach（应该不会发生，但防御性处理）
        console.warn(
          `⚠️ [DebuggerManager] Tab ${tabId} attached in different session ${existingConversationId}, detaching...`,
        );
        await this.detachTab(tabId, 'session switch');
      }
    }

    // 检查操作锁，防止并发 attach
    if (this.attachLocks.has(tabId)) {
      console.log(
        `🔧 [DebuggerManager] Waiting for existing attach operation on tab ${tabId}...`,
      );
      return await this.attachLocks.get(tabId)!;
    }

    // 执行 attach
    const attachPromise = this.doAttach(tabId, conversationId);
    this.attachLocks.set(tabId, attachPromise);

    try {
      const result = await attachPromise;
      return result;
    } finally {
      this.attachLocks.delete(tabId);
    }
  }

  private async doAttach(
    tabId: number,
    conversationId: string,
  ): Promise<boolean> {
    // 获取或创建会话
    const session = this.getOrCreateSession(conversationId);

    // 检查 Chrome debugger API 可用性
    if (!chrome.debugger) {
      console.error('❌ [DebuggerManager] Chrome debugger API not available');
      return false;
    }

    // 检查 tab URL 是否可调试
    try {
      const tab = await chrome.tabs.get(tabId);
      const url = tab.url || '';

      if (
        url.startsWith('chrome://') ||
        url.startsWith('chrome-extension://')
      ) {
        console.error(
          `❌ [DebuggerManager] Cannot attach to restricted URL: ${url}`,
        );
        return false;
      }

      if (tab.status !== 'complete') {
        console.warn(
          `⚠️ [DebuggerManager] Tab ${tabId} is not fully loaded (status: ${tab.status})`,
        );
      }
    } catch (error) {
      console.error(`❌ [DebuggerManager] Failed to get tab ${tabId}:`, error);
      return false;
    }

    // 执行 attach
    return new Promise((resolve) => {
      chrome.debugger.attach({ tabId }, '1.3', () => {
        if (chrome.runtime.lastError) {
          console.error(
            `❌ [DebuggerManager] Failed to attach debugger to tab ${tabId}:`,
            chrome.runtime.lastError.message,
          );
          resolve(false);
        } else {
          // 记录状态
          const now = Date.now();
          session.attachedTabs.set(tabId, {
            tabId,
            attachedAt: now,
            lastUsedAt: now,
            pendingCommands: 0,
          });
          this.tabToSession.set(tabId, conversationId);
          this.touchSession(conversationId);

          console.log(
            `✅ [DebuggerManager] Debugger attached to tab ${tabId} in session ${conversationId}`,
          );

          // The agent's tab usually sits in the background while the user
          // works in their own foreground tab. Chrome aggressively throttles
          // background renderers (timers, rAF, transitions, focus-gated
          // handlers) which makes mouse/keyboard CDP events feel sluggish
          // even though the input is dispatched promptly. Tell the renderer
          // it is focused and active so it runs at foreground priority —
          // both calls are CDP-only and never change OS-level tab focus.
          this.unthrottleRenderer(tabId);

          resolve(true);
        }
      });
    });
  }

  /**
   * Tell the renderer it is focused and active so Chrome doesn't throttle it
   * while the tab sits in the background. Fire-and-forget — failures are
   * logged but do not fail the attach.
   */
  private unthrottleRenderer(tabId: number): void {
    const send = (
      method: string,
      params: Record<string, unknown>,
    ): Promise<void> =>
      new Promise((resolve) => {
        try {
          chrome.debugger.sendCommand({ tabId }, method, params, () => {
            const err = chrome.runtime.lastError;
            if (err) {
              console.warn(
                `⚠️ [DebuggerManager] ${method} on tab ${tabId} failed: ${err.message}`,
              );
            }
            resolve();
          });
        } catch (err) {
          console.warn(
            `⚠️ [DebuggerManager] ${method} on tab ${tabId} threw:`,
            err,
          );
          resolve();
        }
      });

    Promise.all([
      send('Emulation.setFocusEmulationEnabled', { enabled: true }),
      send('Page.setWebLifecycleState', { state: 'active' }),
    ]).catch(() => {
      /* swallowed — individual calls already logged */
    });
  }

  /**
   * Detach 指定 tab 的 debugger
   */
  async detachTab(tabId: number, reason: string = 'manual'): Promise<void> {
    const conversationId = this.tabToSession.get(tabId);
    const session = conversationId ? this.sessions.get(conversationId) : null;
    const tabState = session?.attachedTabs.get(tabId);

    // 清理状态
    if (session && tabState) {
      session.attachedTabs.delete(tabId);
    }
    this.tabToSession.delete(tabId);
    dialogManager.disableForTab(tabId);

    // 拒绝待处理的命令
    rejectPendingCommands(tabId, `Debugger detaching: ${reason}`);

    // 如果没有 attached，直接返回
    if (!tabState) {
      console.log(
        `🔧 [DebuggerManager] Tab ${tabId} not attached, skip detach`,
      );
      return;
    }

    // 执行 detach
    return new Promise((resolve) => {
      if (chrome.debugger?.detach) {
        chrome.debugger.detach({ tabId }, () => {
          if (chrome.runtime.lastError) {
            console.warn(
              `⚠️ [DebuggerManager] Detach error for tab ${tabId}:`,
              chrome.runtime.lastError.message,
            );
          } else {
            console.log(
              `✅ [DebuggerManager] Debugger detached from tab ${tabId} (reason: ${reason})`,
            );
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * 检查 tab 是否已在会话中 attached
   */
  isTabAttached(tabId: number, conversationId: string): boolean {
    const session = this.sessions.get(conversationId);
    if (!session) return false;
    return session.attachedTabs.has(tabId);
  }

  /**
   * 获取 tab 所属的会话 ID
   */
  getTabSession(tabId: number): string | undefined {
    return this.tabToSession.get(tabId);
  }

  // ==========================================================================
  // Command Tracking
  // ==========================================================================

  /**
   * 标记命令开始执行
   */
  beginCommand(tabId: number): void {
    const conversationId = this.tabToSession.get(tabId);
    const session = conversationId ? this.sessions.get(conversationId) : null;
    const tabState = session?.attachedTabs.get(tabId);

    if (tabState) {
      tabState.pendingCommands++;
      tabState.lastUsedAt = Date.now();
      this.touchSession(conversationId!);
    }
  }

  /**
   * 标记命令执行结束
   */
  endCommand(tabId: number): void {
    const conversationId = this.tabToSession.get(tabId);
    const session = conversationId ? this.sessions.get(conversationId) : null;
    const tabState = session?.attachedTabs.get(tabId);

    if (tabState && tabState.pendingCommands > 0) {
      tabState.pendingCommands--;
    }
  }

  // ==========================================================================
  // Idle Detection & Auto Cleanup
  // ==========================================================================

  /**
   * 检查空闲会话并自动清理
   */
  private checkIdleSessions(): void {
    const now = Date.now();

    for (const [conversationId, session] of this.sessions) {
      const sessionIdleTime = now - session.lastActivity;

      // 会话空闲超过阈值，detach 所有 tabs
      if (sessionIdleTime > SESSION_IDLE_TIMEOUT) {
        console.log(
          `⏰ [DebuggerManager] Session ${conversationId} idle for ${sessionIdleTime}ms, detaching all tabs`,
        );
        this.cleanupSession(conversationId).catch((err) => {
          console.error(
            `❌ [DebuggerManager] Failed to cleanup idle session ${conversationId}:`,
            err,
          );
        });
        continue;
      }

      // 检查单个 tab 的空闲时间（仅在会话不活跃时）
      if (session.status === 'idle') {
        for (const [tabId, tabState] of session.attachedTabs) {
          const tabIdleTime = now - tabState.lastUsedAt;

          // Tab 空闲且有未执行完的命令，跳过
          if (tabState.pendingCommands > 0) continue;

          if (tabIdleTime > TAB_IDLE_TIMEOUT) {
            console.log(
              `⏰ [DebuggerManager] Tab ${tabId} idle for ${tabIdleTime}ms in idle session, detaching`,
            );
            this.detachTab(tabId, 'tab idle').catch((err) => {
              console.error(
                `❌ [DebuggerManager] Failed to detach idle tab ${tabId}:`,
                err,
              );
            });
          }
        }
      }
    }
  }

  // ==========================================================================
  // Event Handlers
  // ==========================================================================

  /**
   * 处理强制 detach（用户手动关闭、页面崩溃等）
   */
  private handleForcedDetach(tabId: number, reason: string): void {
    console.log(
      `⚠️ [DebuggerManager] Forced detach for tab ${tabId}: ${reason}`,
    );

    const conversationId = this.tabToSession.get(tabId);
    const session = conversationId ? this.sessions.get(conversationId) : null;

    // 清理状态
    if (session) {
      session.attachedTabs.delete(tabId);
    }
    this.tabToSession.delete(tabId);
    dialogManager.disableForTab(tabId);

    // 拒绝待处理命令
    rejectPendingCommands(tabId, `Debugger forcibly detached: ${reason}`);
  }

  /**
   * 处理 tab 关闭
   */
  private handleTabClosed(tabId: number): void {
    const conversationId = this.tabToSession.get(tabId);
    const session = conversationId ? this.sessions.get(conversationId) : null;

    if (session) {
      session.attachedTabs.delete(tabId);
      console.log(
        `🗑️ [DebuggerManager] Tab ${tabId} closed, removed from session ${conversationId}`,
      );
    }

    this.tabToSession.delete(tabId);
    dialogManager.disableForTab(tabId);
    clearScreenshotCache(tabId);
    rejectPendingCommands(tabId, 'Tab closed');
  }

  // ==========================================================================
  // Status & Debugging
  // ==========================================================================

  /**
   * 获取调试状态信息
   */
  getStatus(): {
    sessions: number;
    attachedTabs: number;
    sessionsDetail: Array<{
      conversationId: string;
      attachedTabs: number;
      status: string;
      lastActivity: number;
    }>;
  } {
    const sessionsDetail = Array.from(this.sessions.values()).map(
      (session) => ({
        conversationId: session.conversationId,
        attachedTabs: session.attachedTabs.size,
        status: session.status,
        lastActivity: session.lastActivity,
      }),
    );

    return {
      sessions: this.sessions.size,
      attachedTabs: this.tabToSession.size,
      sessionsDetail,
    };
  }

  /**
   * 清理所有资源
   */
  dispose(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Detach 所有 tabs
    for (const tabId of this.tabToSession.keys()) {
      this.detachTab(tabId, 'manager dispose').catch(() => {});
    }

    this.sessions.clear();
    this.tabToSession.clear();
    this.attachLocks.clear();

    console.log('🧹 [DebuggerManager] Manager disposed');
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const debuggerSessionManager = new DebuggerSessionManager();
