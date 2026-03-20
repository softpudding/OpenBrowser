import { describe, test, expect } from 'bun:test';
import { generateShortHash, generateUniqueHash, generateElementId } from '../hash-utils';

describe('hash-utils', () => {
  describe('generateShortHash', () => {
    test('returns a deterministic 6-character base36 hash', () => {
      const cssPath = 'div#content > p.text';
      const hash1 = generateShortHash(cssPath);
      const hash2 = generateShortHash(cssPath);

      expect(hash1).toHaveLength(6);
      expect(hash1).toMatch(/^[0-9a-z]{6}$/);
      expect(hash1).toBe(hash2);
    });

    test('changes when HTML content or salt changes', () => {
      const cssPath = 'div#content';

      expect(generateShortHash(cssPath)).not.toBe(
        generateShortHash(cssPath, '<button>Click</button>'),
      );
      expect(generateShortHash(cssPath)).not.toBe(
        generateShortHash(cssPath, undefined, 1),
      );
    });
  });

  describe('generateUniqueHash', () => {
    test('returns the base hash when there is no collision', () => {
      const existingHashes = new Set<string>();
      const result = generateUniqueHash('div#content', existingHashes);

      expect(result.hash).toBe(generateShortHash('div#content'));
      expect(result.salt).toBe(0);
    });

    test('increments salt until it finds a free hash', () => {
      const cssPath = 'div#content';
      const existingHashes = new Set<string>([
        generateShortHash(cssPath, undefined, 0),
        generateShortHash(cssPath, undefined, 1),
      ]);

      const result = generateUniqueHash(cssPath, existingHashes);

      expect(result.salt).toBe(2);
      expect(existingHashes.has(result.hash)).toBe(false);
    });

    test('falls back to Date.now salt after max attempts', () => {
      const cssPath = 'div#content';
      const originalNow = Date.now;
      Date.now = () => 424242;

      try {
        const existingHashes = new Set<string>();
        for (let i = 0; i < 5; i++) {
          existingHashes.add(generateShortHash(cssPath, undefined, i));
        }

        const result = generateUniqueHash(cssPath, existingHashes, undefined, 5);

        expect(result.salt).toBe(424242);
        expect(result.hash).toBe(generateShortHash(cssPath, undefined, 424242));
      } finally {
        Date.now = originalNow;
      }
    });
  });

  describe('generateElementId', () => {
    test('returns a pure hash and ignores element type prefixes', () => {
      const existingHashes = new Set<string>();
      const clickable = generateElementId('click', 'div#content', existingHashes);
      const input = generateElementId('input', 'div#content', existingHashes);

      expect(clickable.id).toBe(clickable.hash);
      expect(clickable.id).toMatch(/^[0-9a-z]{6}$/);
      expect(clickable.hash).toBe(input.hash);
    });

    test('does not mutate the caller-owned existing hash set', () => {
      const existingHashes = new Set<string>();

      generateElementId('click', 'div#content', existingHashes);

      expect(existingHashes.size).toBe(0);
    });

    test('changes the hash when HTML content changes', () => {
      const cssPath = 'div#content';

      const withoutHtml = generateElementId('click', cssPath, new Set<string>());
      const withHtml = generateElementId(
        'click',
        cssPath,
        new Set<string>(),
        '<button>Submit</button>',
      );

      expect(withoutHtml.hash).not.toBe(withHtml.hash);
    });
  });
});
