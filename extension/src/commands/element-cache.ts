/**
 * Element Cache Manager
 * Stores the latest highlight snapshot per conversation with auto-invalidation.
 */

import type { InteractiveElement } from '../types';

interface CacheEntry {
  element: InteractiveElement; // Single element
  tabId: number; // Tab ID for validation
  timestamp: number;
}

export const ELEMENT_CACHE_TTL_MS = 1_200_000; // 20 minutes
export const ELEMENT_CACHE_TTL_DESCRIPTION = `${ELEMENT_CACHE_TTL_MS / 60_000} minutes`;
class ElementCacheImpl {
  private cache = new Map<string, CacheEntry>();

  /**
   * Generate composite cache key
   */
  private buildKey(
    conversationId: string,
    tabId: number,
    elementId: string,
  ): string {
    return `${conversationId}:${tabId}:${elementId}`;
  }

  /**
   * Store the latest highlight snapshot for a conversation and tab.
   *
   * Every new highlight replaces the previous highlight snapshot for the
   * conversation so old numeric IDs immediately become invalid.
   */
  storeElements(
    conversationId: string,
    tabId: number,
    elements: InteractiveElement[],
  ): void {
    if (!conversationId) {
      return;
    }

    this.invalidate(conversationId);

    if (!elements.length) {
      console.log(
        `🗂️ [ElementCache] Cleared latest highlight snapshot for conversation ${conversationId} (no elements to store)`,
      );
      return;
    }

    const timestamp = Date.now();

    for (const element of elements) {
      const key = this.buildKey(conversationId, tabId, element.id);
      this.cache.set(key, {
        element,
        tabId,
        timestamp,
      });
    }

    console.log(
      `📁 [ElementCache] Stored ${elements.length} latest-highlight elements for conversation ${conversationId}, tab ${tabId} (total: ${this.cache.size})`,
    );
  }

  /**
   * Get all elements for a conversation from the latest highlight snapshot.
   */
  getElements(conversationId: string): InteractiveElement[] | undefined {
    if (!conversationId) {
      return undefined;
    }

    const now = Date.now();
    const elements: InteractiveElement[] = [];
    const expiredKeys: string[] = [];

    // Iterate through all cache entries
    for (const [key, entry] of this.cache.entries()) {
      // Check if this entry belongs to the conversation
      if (key.startsWith(`${conversationId}:`)) {
        // Check if expired
        if (now - entry.timestamp > ELEMENT_CACHE_TTL_MS) {
          expiredKeys.push(key);
          continue;
        }
        elements.push(entry.element);
      }
    }

    // Cleanup expired entries
    for (const key of expiredKeys) {
      this.cache.delete(key);
      console.log(`⏰ [ElementCache] Cache expired for key ${key}`);
    }

    return elements.length > 0 ? elements : undefined;
  }

  /**
   * Find a specific element by ID within a conversation and tab
   * Validates tab_id match - returns undefined if mismatch
   */
  getElementById(
    conversationId: string,
    tabId: number,
    elementId: string,
  ): InteractiveElement | undefined {
    if (!conversationId || !elementId) {
      return undefined;
    }

    const key = this.buildKey(conversationId, tabId, elementId);
    const entry = this.cache.get(key);

    if (!entry) {
      return undefined;
    }

    // Check if expired
    if (Date.now() - entry.timestamp > ELEMENT_CACHE_TTL_MS) {
      this.cache.delete(key);
      console.log(`⏰ [ElementCache] Cache expired for key ${key}`);
      return undefined;
    }

    // Validate tab_id match
    if (entry.tabId !== tabId) {
      console.log(
        `⚠️ [ElementCache] Tab ID mismatch: expected ${tabId}, found ${entry.tabId} for key ${key}`,
      );
      return undefined;
    }

    return entry.element;
  }

  /**
   * Invalidate (clear) cache for a specific conversation
   * If tabId provided, invalidate only that tab's elements
   * If no tabId, invalidate all elements for the conversation
   */
  invalidate(conversationId: string, tabId?: number): void {
    const prefix =
      tabId !== undefined
        ? `${conversationId}:${tabId}:`
        : `${conversationId}:`;

    const keysToDelete: string[] = [];
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }

    if (keysToDelete.length > 0) {
      const scope = tabId !== undefined ? `tab ${tabId}` : 'all tabs';
      console.log(
        `🗑️ [ElementCache] Invalidated ${keysToDelete.length} elements for conversation ${conversationId} (${scope})`,
      );
    }
  }

  /**
   * Clear all cached elements
   */
  clearAll(): void {
    this.cache.clear();
    console.log('🧹 [ElementCache] Cleared all caches');
  }

  /**
   * Get cache size (number of conversations with cached elements)
   */
  get size(): number {
    return this.cache.size;
  }
}

export const elementCache = new ElementCacheImpl();
