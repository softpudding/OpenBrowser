/**
 * Document-scoped element cache manager.
 *
 * Each conversation/tab keeps one active cache for the current highlighted
 * document:
 * 1. Persistent element-id assignments for the current document
 * 2. A merged element lookup table keyed only by element_id
 * 3. Latest highlight metadata for the current document
 */

import type { ElementType, InteractiveElement } from '../types';
import {
  buildElementIdentityKey,
  generateUniqueHash,
  getStableIdentityInput,
  normalizeVisualElementIdInput,
} from './element-id';

interface DocumentElementCacheEntry {
  tabId: number;
  createdAt: number;
  lastAccessedAt: number;
  documentId: string;
  elementType: ElementType;
  keywords: string[];
  totalElements: number;
  totalPages: number;
  idByIdentityKey: Map<string, string>;
  usedIds: Set<string>;
  elementsById: Map<string, InteractiveElement>;
}

export interface StoredHighlightPage {
  page: number;
  totalPages: number;
  totalElements: number;
  elementType: ElementType;
  keywords: string[];
  documentId: string;
  elements: InteractiveElement[];
}

export interface CachedElementLookup {
  documentId: string;
  elementType: ElementType;
  keywords: string[];
  totalElements: number;
  totalPages: number;
  requestedElementId: string;
  resolvedElementId: string;
  normalizedRequestedElementId: string;
  elementIdCorrected: boolean;
  element: InteractiveElement;
}

export interface ElementIdSuggestion {
  elementId: string;
  html: string;
  matchedPositions: number;
}

export const ELEMENT_CACHE_TTL_MS = 1_200_000; // 20 minutes
export const ELEMENT_CACHE_TTL_DESCRIPTION = `${ELEMENT_CACHE_TTL_MS / 60_000} minutes`;

class ElementCacheImpl {
  private documents = new Map<string, DocumentElementCacheEntry>();

  private buildDocumentKey(conversationId: string, tabId: number): string {
    return `${conversationId}:${tabId}`;
  }

  private isExpired(timestamp: number): boolean {
    return Date.now() - timestamp > ELEMENT_CACHE_TTL_MS;
  }

  private cloneElement(
    element: InteractiveElement,
    id: string,
  ): InteractiveElement {
    return {
      ...element,
      bbox: { ...element.bbox },
      id,
    };
  }

  private touchEntry(entry: DocumentElementCacheEntry): void {
    entry.lastAccessedAt = Date.now();
  }

  private cleanupExpired(): void {
    for (const [key, entry] of this.documents.entries()) {
      if (this.isExpired(entry.lastAccessedAt)) {
        this.documents.delete(key);
        console.log(`⏰ [ElementCache] Document cache expired for key ${key}`);
      }
    }
  }

  private getOrCreateEntry(options: {
    conversationId: string;
    tabId: number;
    documentId: string;
    elementType: ElementType;
    keywords: string[];
    totalElements: number;
    totalPages: number;
  }): DocumentElementCacheEntry {
    const {
      conversationId,
      tabId,
      documentId,
      elementType,
      keywords,
      totalElements,
      totalPages,
    } = options;

    this.cleanupExpired();

    const key = this.buildDocumentKey(conversationId, tabId);
    const existing = this.documents.get(key);
    const now = Date.now();

    if (existing && existing.documentId === documentId) {
      existing.lastAccessedAt = now;
      existing.elementType = elementType;
      existing.keywords = [...keywords];
      existing.totalElements = totalElements;
      existing.totalPages = totalPages;
      return existing;
    }

    const created: DocumentElementCacheEntry = {
      tabId,
      createdAt: now,
      lastAccessedAt: now,
      documentId,
      elementType,
      keywords: [...keywords],
      totalElements,
      totalPages,
      idByIdentityKey: new Map(),
      usedIds: new Set(),
      elementsById: new Map(),
    };

    this.documents.set(key, created);
    console.log(
      `📁 [ElementCache] Started new document cache for conversation ${conversationId}, tab ${tabId}, document ${documentId}`,
    );
    return created;
  }

  private assignIdsForEntry(
    entry: DocumentElementCacheEntry,
    elements: InteractiveElement[],
  ): InteractiveElement[] {
    const assignedIds = new Array<string>(elements.length);

    const elementsByStableKey = elements
      .map((element, index) => ({
        element,
        index,
        identityKey: buildElementIdentityKey(element),
      }))
      .sort((left, right) => {
        const keyOrder = left.identityKey.localeCompare(right.identityKey);
        if (keyOrder !== 0) {
          return keyOrder;
        }
        return left.index - right.index;
      });

    for (const { element, index, identityKey } of elementsByStableKey) {
      let elementId = entry.idByIdentityKey.get(identityKey);
      if (!elementId) {
        if (element.id && !entry.usedIds.has(element.id)) {
          elementId = element.id;
        } else {
          const { hash } = generateUniqueHash(
            element.selector,
            entry.usedIds,
            getStableIdentityInput(element),
          );
          elementId = hash;
        }
        entry.idByIdentityKey.set(identityKey, elementId);
        entry.usedIds.add(elementId);
      }
      assignedIds[index] = elementId;
    }

    return elements.map((element, index) =>
      this.cloneElement(element, assignedIds[index] || element.id),
    );
  }

  storeHighlightResult(options: {
    conversationId: string;
    tabId: number;
    documentId: string;
    elementType: ElementType;
    keywords?: string[];
    totalElements: number;
    totalPages: number;
    page: number;
    pages: InteractiveElement[][];
  }): StoredHighlightPage {
    const {
      conversationId,
      tabId,
      documentId,
      elementType,
      keywords = [],
      totalElements,
      totalPages,
      page,
      pages,
    } = options;

    const entry = this.getOrCreateEntry({
      conversationId,
      tabId,
      documentId,
      elementType,
      keywords,
      totalElements,
      totalPages,
    });

    const assignedPages = pages.map((pageElements) =>
      this.assignIdsForEntry(entry, pageElements),
    );

    for (const pageElements of assignedPages) {
      for (const element of pageElements) {
        entry.elementsById.set(
          element.id,
          this.cloneElement(element, element.id),
        );
      }
    }

    this.touchEntry(entry);

    console.log(
      `📁 [ElementCache] Stored ${assignedPages.length} highlight pages for conversation ${conversationId}, tab ${tabId} (${totalElements} total elements on document ${documentId})`,
    );

    return {
      page,
      totalPages,
      totalElements,
      elementType,
      keywords: [...keywords],
      documentId,
      elements: (assignedPages[Math.max(0, page - 1)] ?? []).map((element) =>
        this.cloneElement(element, element.id),
      ),
    };
  }

  getElementById(
    conversationId: string,
    tabId: number,
    elementId: string,
  ): CachedElementLookup | undefined {
    this.cleanupExpired();

    const key = this.buildDocumentKey(conversationId, tabId);
    const entry = this.documents.get(key);
    if (!entry || entry.tabId !== tabId) {
      return undefined;
    }

    this.touchEntry(entry);
    const requestedElementId = elementId;
    const normalizedRequestedElementId =
      normalizeVisualElementIdInput(requestedElementId);
    let resolvedElementId = requestedElementId;
    let element = entry.elementsById.get(requestedElementId);

    if (!element && normalizedRequestedElementId !== requestedElementId) {
      element = entry.elementsById.get(normalizedRequestedElementId);
      if (element) {
        resolvedElementId = normalizedRequestedElementId;
      }
    }

    if (!element) {
      return undefined;
    }

    return {
      documentId: entry.documentId,
      elementType: entry.elementType,
      keywords: [...entry.keywords],
      totalElements: entry.totalElements,
      totalPages: entry.totalPages,
      requestedElementId,
      resolvedElementId,
      normalizedRequestedElementId,
      elementIdCorrected: requestedElementId !== resolvedElementId,
      element: this.cloneElement(element, element.id),
    };
  }

  getElementIdSuggestions(
    conversationId: string,
    tabId: number,
    elementId: string,
    limit: number = 3,
  ): ElementIdSuggestion[] {
    this.cleanupExpired();

    const key = this.buildDocumentKey(conversationId, tabId);
    const entry = this.documents.get(key);
    if (!entry || entry.tabId !== tabId) {
      return [];
    }

    this.touchEntry(entry);

    const normalizedRequestedElementId =
      normalizeVisualElementIdInput(elementId).toUpperCase();
    if (!normalizedRequestedElementId) {
      return [];
    }

    const minimumMatchedPositions = Math.max(
      2,
      normalizedRequestedElementId.length - 1,
    );

    return Array.from(entry.elementsById.values())
      .map((element) => {
        const candidateId = element.id.toUpperCase();
        if (
          candidateId === normalizedRequestedElementId ||
          candidateId.length !== normalizedRequestedElementId.length
        ) {
          return null;
        }

        const matchedPositions = Array.from(candidateId).reduce(
          (count, char, index) =>
            count +
            (char === normalizedRequestedElementId.charAt(index) ? 1 : 0),
          0,
        );
        const weightedPositionScore = Array.from(candidateId).reduce(
          (score, char, index) =>
            score +
            (char === normalizedRequestedElementId.charAt(index)
              ? normalizedRequestedElementId.length - index
              : 0),
          0,
        );

        if (matchedPositions < minimumMatchedPositions) {
          return null;
        }

        return {
          elementId: element.id,
          html: compactHtmlSnippet(element.html || `<${element.tagName}>`),
          matchedPositions,
          weightedPositionScore,
        };
      })
      .filter(
        (
          suggestion,
        ): suggestion is ElementIdSuggestion & {
          weightedPositionScore: number;
        } => suggestion !== null,
      )
      .sort((left, right) => {
        if (right.matchedPositions !== left.matchedPositions) {
          return right.matchedPositions - left.matchedPositions;
        }
        if (right.weightedPositionScore !== left.weightedPositionScore) {
          return right.weightedPositionScore - left.weightedPositionScore;
        }
        return left.elementId.localeCompare(right.elementId);
      })
      .map(
        ({ weightedPositionScore: _weightedPositionScore, ...suggestion }) =>
          suggestion,
      )
      .slice(0, Math.max(0, limit));
  }

  invalidate(conversationId: string, tabId?: number): void {
    const keysToDelete = Array.from(this.documents.keys()).filter((key) => {
      if (tabId === undefined) {
        return key.startsWith(`${conversationId}:`);
      }
      return key === this.buildDocumentKey(conversationId, tabId);
    });

    for (const key of keysToDelete) {
      this.documents.delete(key);
    }

    if (keysToDelete.length > 0) {
      const scope = tabId !== undefined ? `tab ${tabId}` : 'all tabs';
      console.log(
        `🗑️ [ElementCache] Invalidated ${keysToDelete.length} document caches for conversation ${conversationId} (${scope})`,
      );
    }
  }

  clearAll(): void {
    this.documents.clear();
    console.log('🧹 [ElementCache] Cleared all caches');
  }

  get size(): number {
    return this.documents.size;
  }
}

export const elementCache = new ElementCacheImpl();

function compactHtmlSnippet(html: string): string {
  return html.replace(/\s+/g, ' ').trim().slice(0, 180);
}

export function buildElementCacheMissMessage(options: {
  conversationId: string;
  tabId: number;
  elementId: string;
  refreshHint?: string;
}): string {
  const {
    conversationId,
    tabId,
    elementId,
    refreshHint = 'Call highlight_elements() again to refresh the element cache.',
  } = options;
  const normalizedElementId = normalizeVisualElementIdInput(elementId);
  const suggestions = elementCache.getElementIdSuggestions(
    conversationId,
    tabId,
    normalizedElementId,
  );

  const baseMessage =
    normalizedElementId && normalizedElementId !== elementId
      ? `Element '${elementId}' was interpreted as '${normalizedElementId}' for visual-safe ID matching, but no cached element matched.`
      : `Element '${elementId}' not found in cache.`;
  const ttlMessage = `Highlight caches expire after ${ELEMENT_CACHE_TTL_DESCRIPTION}. ${refreshHint}`;

  if (suggestions.length === 0) {
    return `${baseMessage} ${ttlMessage}`;
  }

  const suggestedIds = suggestions
    .map((suggestion) => `'${suggestion.elementId}'`)
    .join(', ');
  const suggestedHtml = suggestions
    .map((suggestion) => `${suggestion.elementId}: ${suggestion.html}`)
    .join(' | ');

  return `${baseMessage} ${ttlMessage} Maybe try ${suggestedIds}. Candidate HTML: ${suggestedHtml}`;
}
