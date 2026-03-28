import { describe, expect, test } from 'bun:test';

import type { InteractiveElement } from '../../types';
import { elementCache } from '../element-cache';
import {
  ELEMENT_ID_CHARSET,
  ELEMENT_ID_LENGTH,
  assignHashedElementIds,
  generateShortHash,
  normalizeVisualElementIdInput,
} from '../element-id';

function usesAllowedElementIdChars(id: string): boolean {
  return (
    id.length === ELEMENT_ID_LENGTH &&
    [...id].every((char) => ELEMENT_ID_CHARSET.includes(char))
  );
}

function createElement(id: string, selector: string): InteractiveElement {
  return {
    id,
    type: 'clickable',
    tagName: 'button',
    selector,
    html: `<button data-testid="${selector.slice(1)}">Test</button>`,
    bbox: { x: 0, y: 0, width: 10, height: 10 },
    isVisible: true,
    isInViewport: true,
  };
}

describe('element-id', () => {
  test('generates fixed-length visual-safe hashes', () => {
    const hash = generateShortHash('#checkout', '<button>Buy</button>');

    expect(hash).toHaveLength(ELEMENT_ID_LENGTH);
    expect(usesAllowedElementIdChars(hash)).toBe(true);
  });

  test('assigns stable hash ids based on selector and html', () => {
    const result = assignHashedElementIds([
      createElement('old-a', '#checkout'),
      createElement('old-b', '#email'),
      createElement('old-c', '#submit'),
    ]);

    expect(result.every((element) => usesAllowedElementIdChars(element.id))).toBe(
      true,
    );
    expect(new Set(result.map((element) => element.id)).size).toBe(
      result.length,
    );

    const secondPass = assignHashedElementIds([
      createElement('different-a', '#checkout'),
      createElement('different-b', '#email'),
      createElement('different-c', '#submit'),
    ]);

    expect(secondPass.map((element) => element.id)).toEqual(
      result.map((element) => element.id),
    );
  });

  test('keeps ids stable regardless of input array order', () => {
    const original = [
      createElement('first', '#alpha'),
      createElement('second', '#beta'),
      createElement('third', '#gamma'),
    ];
    const reversed = [...original].reverse();

    const originalAssigned = assignHashedElementIds(original);
    const reversedAssigned = assignHashedElementIds(reversed);

    expect(
      Object.fromEntries(
        originalAssigned.map((element) => [element.selector, element.id]),
      ),
    ).toEqual(
      Object.fromEntries(
        reversedAssigned.map((element) => [element.selector, element.id]),
      ),
    );
  });

  test('does not mutate the caller-owned element objects', () => {
    const original = [createElement('keep-me', '#a')];

    const result = assignHashedElementIds(original);

    expect(original[0].id).toBe('keep-me');
    expect(usesAllowedElementIdChars(result[0].id)).toBe(true);
    expect(result[0]).not.toBe(original[0]);
  });

  test('normalizes visually ambiguous 3-character element IDs only', () => {
    expect(normalizeVisualElementIdInput('D02')).toBe('DO2');
    expect(normalizeVisualElementIdInput(' d o 2 ')).toBe('DO2');
    expect(normalizeVisualElementIdInput('id-10')).toBe('id-10');
  });
});

describe('element-cache document cache', () => {
  test('stores highlight pages and resolves element IDs from the current document cache', () => {
    elementCache.clearAll();
    const assignedPages = [
      assignHashedElementIds([createElement('', '#page-1')]),
      assignHashedElementIds([createElement('', '#page-2')]),
    ];

    const storedPage = elementCache.storeHighlightResult({
      conversationId: 'conv-1',
      tabId: 101,
      documentId: 'doc-1',
      elementType: 'any',
      totalElements: 2,
      totalPages: 2,
      pages: assignedPages,
      page: 1,
    });

    expect(storedPage.documentId).toBe('doc-1');
    expect(storedPage.page).toBe(1);
    expect(storedPage.elements.map((element) => element.selector)).toEqual([
      '#page-1',
    ]);
    expect(storedPage.elements[0]?.id).toBe(assignedPages[0]?.[0]?.id);
    const storedElementId = storedPage.elements[0]?.id;
    expect(storedElementId).toBeDefined();

    const lookup = elementCache.getElementById(
      'conv-1',
      101,
      storedElementId!,
    );
    expect(lookup?.element.selector).toBe('#page-1');
    expect(lookup?.documentId).toBe('doc-1');
  });

  test('resolves visually ambiguous requested IDs to the cached visual-safe ID', () => {
    elementCache.clearAll();
    const page = [createElement('DO2', '#page-corrected')];

    elementCache.storeHighlightResult({
      conversationId: 'conv-visual-safe',
      tabId: 202,
      documentId: 'doc-visual-safe',
      elementType: 'any',
      totalElements: 1,
      totalPages: 1,
      pages: [page],
      page: 1,
    });

    const lookup = elementCache.getElementById(
      'conv-visual-safe',
      202,
      'D02',
    );

    expect(lookup?.requestedElementId).toBe('D02');
    expect(lookup?.resolvedElementId).toBe('DO2');
    expect(lookup?.elementIdCorrected).toBe(true);
    expect(lookup?.element.selector).toBe('#page-corrected');
  });
});
