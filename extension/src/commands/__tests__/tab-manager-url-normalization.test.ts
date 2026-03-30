import { describe, expect, test } from 'bun:test';

import { normalizeNavigableUrl } from '../tab-manager';

describe('tab URL normalization', () => {
  test('adds https for bare hostnames', () => {
    expect(normalizeNavigableUrl('example.com')).toBe('https://example.com');
  });

  test('preserves explicit file URLs', () => {
    expect(normalizeNavigableUrl('file:///Users/test/index.html')).toBe(
      'file:///Users/test/index.html',
    );
  });

  test('preserves explicit http URLs', () => {
    expect(normalizeNavigableUrl('http://localhost:8080')).toBe(
      'http://localhost:8080',
    );
  });
});
