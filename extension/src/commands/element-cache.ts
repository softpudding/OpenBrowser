/**
 * Highlight snapshot cache manager.
 *
 * Two cache layers are maintained:
 * 1. Frozen highlight inventories used for stable pagination across pages.
 * 2. Page-scoped highlight snapshots returned to callers and used for
 *    element interactions together with page-local element IDs.
 */

import type { ElementType, InteractiveElement } from '../types';

interface HighlightInventoryEntry {
  tabId: number;
  createdAt: number;
  lastAccessedAt: number;
  documentId: string;
  elementType: ElementType;
  keywords: string[];
  totalElements: number;
  pages: InteractiveElement[][];
}

interface HighlightSnapshotViewEntry {
  tabId: number;
  inventoryId: number;
  createdAt: number;
  page: number;
}

export interface HighlightSnapshotPage {
  snapshotId: number;
  inventoryId: number;
  page: number;
  totalPages: number;
  totalElements: number;
  elementType: ElementType;
  keywords: string[];
  documentId: string;
  elements: InteractiveElement[];
}

export interface CachedElementLookup {
  snapshotId: number;
  inventoryId: number;
  page: number;
  totalPages: number;
  totalElements: number;
  documentId: string;
  elementType: ElementType;
  keywords: string[];
  element: InteractiveElement;
}

export const ELEMENT_CACHE_TTL_MS = 1_200_000; // 20 minutes
export const ELEMENT_CACHE_TTL_DESCRIPTION = `${ELEMENT_CACHE_TTL_MS / 60_000} minutes`;
const MAX_HIGHLIGHT_INVENTORIES_PER_TAB = 12;

class ElementCacheImpl {
  private inventories = new Map<string, HighlightInventoryEntry>();

  private snapshotViews = new Map<string, HighlightSnapshotViewEntry>();

  private nextInventoryId = 1;

  private nextSnapshotId = 1;

  private buildInventoryKey(
    conversationId: string,
    tabId: number,
    inventoryId: number,
  ): string {
    return `${conversationId}:${tabId}:inventory:${inventoryId}`;
  }

  private buildSnapshotKey(
    conversationId: string,
    tabId: number,
    snapshotId: number,
  ): string {
    return `${conversationId}:${tabId}:snapshot:${snapshotId}`;
  }

  private touchInventory(entry: HighlightInventoryEntry): void {
    entry.lastAccessedAt = Date.now();
  }

  private isExpired(timestamp: number): boolean {
    return Date.now() - timestamp > ELEMENT_CACHE_TTL_MS;
  }

  private removeInventoryByKey(key: string): void {
    const inventory = this.inventories.get(key);
    if (!inventory) {
      return;
    }

    this.inventories.delete(key);

    const snapshotKeysToDelete: string[] = [];
    for (const [snapshotKey, snapshot] of this.snapshotViews.entries()) {
      if (snapshot.inventoryId === this.parseInventoryIdFromKey(key)) {
        snapshotKeysToDelete.push(snapshotKey);
      }
    }
    for (const snapshotKey of snapshotKeysToDelete) {
      this.snapshotViews.delete(snapshotKey);
    }

    console.log(
      `🗑️ [ElementCache] Removed highlight inventory ${key} (${inventory.pages.length} pages, ${snapshotKeysToDelete.length} snapshots)`,
    );
  }

  private parseInventoryIdFromKey(key: string): number {
    const maybeId = Number.parseInt(key.split(':').at(-1) ?? '', 10);
    return Number.isFinite(maybeId) ? maybeId : -1;
  }

  private cleanupExpired(): void {
    const activeInventoryKeys = new Set<string>();

    for (const [snapshotKey, snapshot] of this.snapshotViews.entries()) {
      if (this.isExpired(snapshot.createdAt)) {
        this.snapshotViews.delete(snapshotKey);
        console.log(`⏰ [ElementCache] Snapshot expired for key ${snapshotKey}`);
        continue;
      }

      const inventoryKey = snapshotKey.replace(
        /:snapshot:\d+$/,
        `:inventory:${snapshot.inventoryId}`,
      );
      activeInventoryKeys.add(inventoryKey);
    }

    const inventoryKeysToDelete: string[] = [];
    for (const [inventoryKey, inventory] of this.inventories.entries()) {
      if (this.isExpired(inventory.lastAccessedAt)) {
        inventoryKeysToDelete.push(inventoryKey);
        continue;
      }

      if (!activeInventoryKeys.has(inventoryKey) && this.isExpired(inventory.createdAt)) {
        inventoryKeysToDelete.push(inventoryKey);
      }
    }

    for (const inventoryKey of inventoryKeysToDelete) {
      this.removeInventoryByKey(inventoryKey);
    }
  }

  private pruneInventoriesForTab(conversationId: string, tabId: number): void {
    const prefix = `${conversationId}:${tabId}:inventory:`;
    const matchingInventories = Array.from(this.inventories.entries())
      .filter(([key]) => key.startsWith(prefix))
      .sort((a, b) => a[1].createdAt - b[1].createdAt);

    if (matchingInventories.length <= MAX_HIGHLIGHT_INVENTORIES_PER_TAB) {
      return;
    }

    const toDelete = matchingInventories.slice(
      0,
      matchingInventories.length - MAX_HIGHLIGHT_INVENTORIES_PER_TAB,
    );
    for (const [inventoryKey] of toDelete) {
      this.removeInventoryByKey(inventoryKey);
    }
  }

  storeSnapshot(options: {
    conversationId: string;
    tabId: number;
    documentId: string;
    elementType: ElementType;
    keywords?: string[];
    totalElements: number;
    pages: InteractiveElement[][];
    page: number;
  }): HighlightSnapshotPage {
    const {
      conversationId,
      tabId,
      documentId,
      elementType,
      keywords = [],
      totalElements,
      pages,
      page,
    } = options;

    this.cleanupExpired();

    const inventoryId = this.nextInventoryId++;
    const snapshotId = this.nextSnapshotId++;
    const now = Date.now();
    const inventoryKey = this.buildInventoryKey(conversationId, tabId, inventoryId);
    const snapshotKey = this.buildSnapshotKey(conversationId, tabId, snapshotId);

    this.inventories.set(inventoryKey, {
      tabId,
      createdAt: now,
      lastAccessedAt: now,
      documentId,
      elementType,
      keywords: [...keywords],
      totalElements,
      pages: pages.map((snapshotPage) =>
        snapshotPage.map((element) => ({
          ...element,
          bbox: { ...element.bbox },
        })),
      ),
    });

    this.snapshotViews.set(snapshotKey, {
      tabId,
      inventoryId,
      createdAt: now,
      page,
    });

    this.pruneInventoriesForTab(conversationId, tabId);

    const snapshotPage = this.getSnapshotPage(conversationId, tabId, snapshotId);
    if (!snapshotPage) {
      throw new Error(
        `Failed to retrieve newly stored highlight snapshot ${snapshotId}`,
      );
    }

    console.log(
      `📁 [ElementCache] Stored highlight inventory ${inventoryId} and snapshot ${snapshotId} for conversation ${conversationId}, tab ${tabId} (${pages.length} pages, ${totalElements} total elements)`,
    );
    return snapshotPage;
  }

  forkSnapshotPage(
    conversationId: string,
    tabId: number,
    baseSnapshotId: number,
    page: number,
  ): HighlightSnapshotPage | undefined {
    this.cleanupExpired();

    const baseSnapshot = this.getSnapshotView(conversationId, tabId, baseSnapshotId);
    if (!baseSnapshot) {
      return undefined;
    }

    const snapshotId = this.nextSnapshotId++;
    const snapshotKey = this.buildSnapshotKey(conversationId, tabId, snapshotId);
    const now = Date.now();

    this.snapshotViews.set(snapshotKey, {
      tabId,
      inventoryId: baseSnapshot.inventoryId,
      createdAt: now,
      page,
    });

    const inventory = this.getInventory(conversationId, tabId, baseSnapshot.inventoryId);
    if (inventory) {
      this.touchInventory(inventory);
    }

    const snapshotPage = this.getSnapshotPage(conversationId, tabId, snapshotId);
    if (snapshotPage) {
      console.log(
        `📄 [ElementCache] Forked snapshot ${snapshotId} from base ${baseSnapshotId} for conversation ${conversationId}, tab ${tabId}, page ${page}`,
      );
    }
    return snapshotPage;
  }

  getSnapshotPage(
    conversationId: string,
    tabId: number,
    snapshotId: number,
  ): HighlightSnapshotPage | undefined {
    this.cleanupExpired();

    const snapshot = this.getSnapshotView(conversationId, tabId, snapshotId);
    if (!snapshot) {
      return undefined;
    }

    const inventory = this.getInventory(conversationId, tabId, snapshot.inventoryId);
    if (!inventory) {
      return undefined;
    }

    this.touchInventory(inventory);

    const pageIndex = Math.max(0, snapshot.page - 1);
    const elements = inventory.pages[pageIndex] ?? [];

    return {
      snapshotId,
      inventoryId: snapshot.inventoryId,
      page: snapshot.page,
      totalPages: inventory.pages.length,
      totalElements: inventory.totalElements,
      elementType: inventory.elementType,
      keywords: [...inventory.keywords],
      documentId: inventory.documentId,
      elements: elements.map((element) => ({
        ...element,
        bbox: { ...element.bbox },
      })),
    };
  }

  getElementById(
    conversationId: string,
    tabId: number,
    snapshotId: number,
    elementId: string,
  ): CachedElementLookup | undefined {
    const snapshotPage = this.getSnapshotPage(conversationId, tabId, snapshotId);
    if (!snapshotPage) {
      return undefined;
    }

    const element = snapshotPage.elements.find(
      (candidate) => candidate.id === elementId,
    );
    if (!element) {
      return undefined;
    }

    return {
      snapshotId,
      inventoryId: snapshotPage.inventoryId,
      page: snapshotPage.page,
      totalPages: snapshotPage.totalPages,
      totalElements: snapshotPage.totalElements,
      documentId: snapshotPage.documentId,
      elementType: snapshotPage.elementType,
      keywords: snapshotPage.keywords,
      element,
    };
  }

  getSnapshotView(
    conversationId: string,
    tabId: number,
    snapshotId: number,
  ): HighlightSnapshotViewEntry | undefined {
    if (!conversationId) {
      return undefined;
    }

    const snapshotKey = this.buildSnapshotKey(conversationId, tabId, snapshotId);
    const snapshot = this.snapshotViews.get(snapshotKey);
    if (!snapshot) {
      return undefined;
    }

    if (snapshot.tabId !== tabId || this.isExpired(snapshot.createdAt)) {
      this.snapshotViews.delete(snapshotKey);
      console.log(`⏰ [ElementCache] Snapshot expired or mismatched for key ${snapshotKey}`);
      return undefined;
    }

    return snapshot;
  }

  getInventory(
    conversationId: string,
    tabId: number,
    inventoryId: number,
  ): HighlightInventoryEntry | undefined {
    if (!conversationId) {
      return undefined;
    }

    const inventoryKey = this.buildInventoryKey(conversationId, tabId, inventoryId);
    const inventory = this.inventories.get(inventoryKey);
    if (!inventory) {
      return undefined;
    }

    if (inventory.tabId !== tabId || this.isExpired(inventory.lastAccessedAt)) {
      this.removeInventoryByKey(inventoryKey);
      return undefined;
    }

    return inventory;
  }

  invalidate(conversationId: string, tabId?: number): void {
    const inventoryPrefix =
      tabId !== undefined
        ? `${conversationId}:${tabId}:inventory:`
        : `${conversationId}:`;
    const snapshotPrefix =
      tabId !== undefined
        ? `${conversationId}:${tabId}:snapshot:`
        : `${conversationId}:`;

    const inventoryKeysToDelete = Array.from(this.inventories.keys()).filter((key) =>
      key.startsWith(inventoryPrefix),
    );
    const snapshotKeysToDelete = Array.from(this.snapshotViews.keys()).filter((key) =>
      key.startsWith(snapshotPrefix),
    );

    for (const key of inventoryKeysToDelete) {
      this.inventories.delete(key);
    }
    for (const key of snapshotKeysToDelete) {
      this.snapshotViews.delete(key);
    }

    if (inventoryKeysToDelete.length > 0 || snapshotKeysToDelete.length > 0) {
      const scope = tabId !== undefined ? `tab ${tabId}` : 'all tabs';
      console.log(
        `🗑️ [ElementCache] Invalidated ${inventoryKeysToDelete.length} inventories and ${snapshotKeysToDelete.length} snapshots for conversation ${conversationId} (${scope})`,
      );
    }
  }

  clearAll(): void {
    this.inventories.clear();
    this.snapshotViews.clear();
    console.log('🧹 [ElementCache] Cleared all caches');
  }

  get size(): number {
    return this.snapshotViews.size;
  }
}

export const elementCache = new ElementCacheImpl();
