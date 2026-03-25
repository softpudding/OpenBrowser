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
    expect(result.map((element) => element.selector)).toEqual(['#a', '#b', '#c']);
  });

  test('does not mutate the caller-owned element objects', () => {
    const original = [createElement('keep-me', '#a')];

    const result = assignSequentialElementIds(original);

    expect(original[0].id).toBe('keep-me');
    expect(result[0].id).toBe('1');
    expect(result[0]).not.toBe(original[0]);
  });
});

describe('element-cache latest highlight snapshot', () => {
  test('replaces the previous highlight snapshot for the same conversation', () => {
    elementCache.clearAll();

    elementCache.storeElements('conv-1', 101, [createElement('1', '#old')]);
    expect(elementCache.getElementById('conv-1', 101, '1')?.selector).toBe('#old');

    elementCache.storeElements('conv-1', 101, [createElement('1', '#new')]);

    expect(elementCache.getElementById('conv-1', 101, '1')?.selector).toBe('#new');
    expect(elementCache.getElementById('conv-1', 101, '2')).toBeUndefined();
  });

  test('clears old ids even when the next highlight returns no elements', () => {
    elementCache.clearAll();

    elementCache.storeElements('conv-2', 101, [createElement('1', '#old')]);
    expect(elementCache.getElementById('conv-2', 101, '1')).toBeDefined();

    elementCache.storeElements('conv-2', 101, []);

    expect(elementCache.getElementById('conv-2', 101, '1')).toBeUndefined();
  });
});
