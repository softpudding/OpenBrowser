import { describe, expect, test } from 'bun:test';

import type { InteractiveElement } from '../../types';
import { elementCache } from '../element-cache';
import { assignSequentialElementIds } from '../element-id';

function createElement(id: string, selector: string): InteractiveElement {
  return {
    id,
    type: 'clickable',
    tagName: 'button',
    selector,
    bbox: { x: 0, y: 0, width: 10, height: 10 },
    isVisible: true,
    isInViewport: true,
  };
}

describe('element-id', () => {
  test('assigns page-local numeric ids in order', () => {
    const result = assignSequentialElementIds([
      createElement('old-a', '#a'),
      createElement('old-b', '#b'),
      createElement('old-c', '#c'),
    ]);

    expect(result.map((element) => element.id)).toEqual(['1', '2', '3']);
    expect(result.map((element) => element.selector)).toEqual([
      '#a',
      '#b',
      '#c',
    ]);
  });

  test('does not mutate the caller-owned element objects', () => {
    const original = [createElement('keep-me', '#a')];

    const result = assignSequentialElementIds(original);

    expect(original[0].id).toBe('keep-me');
    expect(result[0].id).toBe('1');
    expect(result[0]).not.toBe(original[0]);
  });
});

describe('element-cache highlight snapshots', () => {
  test('stores a page-scoped snapshot and resolves element IDs within that snapshot', () => {
    elementCache.clearAll();

    const snapshot = elementCache.storeSnapshot({
      conversationId: 'conv-1',
      tabId: 101,
      documentId: 'doc-1',
      elementType: 'any',
      totalElements: 2,
      pages: [[createElement('1', '#page-1')], [createElement('1', '#page-2')]],
      page: 1,
    });

    expect(snapshot.snapshotId).toBe(1);
    expect(snapshot.page).toBe(1);
    expect(snapshot.elements.map((element) => element.selector)).toEqual([
      '#page-1',
    ]);

    const lookup = elementCache.getElementById(
      'conv-1',
      101,
      snapshot.snapshotId,
      '1',
    );
    expect(lookup?.element.selector).toBe('#page-1');
    expect(lookup?.documentId).toBe('doc-1');
  });
});
