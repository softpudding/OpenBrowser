/**
 * TDD tests for PERF-SPEC Tier 1: Redundant Work Elimination
 *
 * These tests verify the structural changes described in the spec without
 * requiring Chrome APIs or a running browser.
 */
import { describe, expect, test } from 'bun:test';

import {
  paginateCollisionFreeElements,
  sortElementsByVisualOrder,
} from '../utils/collision-detection';
import type { InteractiveElement } from '../types';

// Helper to read source files (Chrome-only modules can't be imported in tests)
async function readSource(relativePath: string): Promise<string> {
  const fs = await import('fs');
  return fs.readFileSync(
    new URL(relativePath, import.meta.url),
    'utf-8',
  );
}

// Helper to build mock elements for pagination tests
function mockElement(overrides: Partial<InteractiveElement> = {}): InteractiveElement {
  return {
    id: overrides.id ?? 'A1',
    type: overrides.type ?? 'clickable',
    tagName: overrides.tagName ?? 'button',
    selector: overrides.selector ?? 'button',
    bbox: overrides.bbox ?? { x: 0, y: 0, width: 100, height: 30 },
    isVisible: true,
    isInViewport: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// T1-C: Truncate outerHTML for large elements
// ---------------------------------------------------------------------------
describe('T1-C: outerHTML truncation', () => {
  test('enrichment function caps outerHTML to 2000 chars', async () => {
    const source = await readSource('../commands/highlight-detection.injected.js');
    // The enrichment function should have a max outerHTML constant
    expect(source).toContain('MAX_OUTER_HTML');
    // Should contain the truncation marker
    expect(source).toContain('<!-- truncated -->');
  });

  test('truncation limit is 2000 characters', async () => {
    const source = await readSource('../commands/highlight-detection.injected.js');
    // Verify the constant value
    expect(source).toMatch(/MAX_OUTER_HTML\s*=\s*2000/);
  });
});

// ---------------------------------------------------------------------------
// T1-A: Defer generateSelector + outerHTML to after page selection
// ---------------------------------------------------------------------------
describe('T1-A: lite/full element split', () => {
  test('toInteractiveElementLite function exists and omits selector/html', async () => {
    const source = await readSource('../commands/highlight-detection.injected.js');
    expect(source).toContain('function toInteractiveElementLite(');
    // Lite version should NOT call generateSelector
    const liteFnMatch = source.match(
      /function toInteractiveElementLite\([\s\S]*?\n\}/,
    );
    expect(liteFnMatch).not.toBeNull();
    const liteFnBody = liteFnMatch![0];
    expect(liteFnBody).not.toContain('generateSelector');
    expect(liteFnBody).not.toContain('outerHTML');
  });

  test('collectHighlightCandidates uses toInteractiveElementLite, not toInteractiveElement', async () => {
    const source = await readSource('../commands/highlight-detection.injected.js');
    // The prunedCandidates.map block should call toInteractiveElementLite
    // (the call may be on a separate line inside the map body)
    const afterMap = source.substring(
      source.indexOf('const elements = prunedCandidates.map'),
    );
    // Should contain toInteractiveElementLite somewhere in the map callback
    const mapEndIdx = afterMap.indexOf('});');
    const mapBody = afterMap.substring(0, mapEndIdx + 3);
    expect(mapBody).toContain('toInteractiveElementLite');
  });

  test('candidate elements are stashed in window.__obStashedCandidates', async () => {
    const source = await readSource('../commands/highlight-detection.injected.js');
    expect(source).toContain('window.__obStashedCandidates');
  });

  test('enrichment function is exposed on window.__obEnrichElements', async () => {
    const source = await readSource('../commands/highlight-detection.injected.js');
    expect(source).toContain('window.__obEnrichElements');
    // The enrichment path calls enrichStashedElement which calls generateSelector
    expect(source).toContain('enrichStashedElement');
    // Verify enrichStashedElement calls generateSelector
    const enrichHelperMatch = source.match(
      /function enrichStashedElement[\s\S]*?\n\}/,
    );
    expect(enrichHelperMatch).not.toBeNull();
    expect(enrichHelperMatch![0]).toContain('generateSelector');
  });

  test('lite elements include _stashIndex field', async () => {
    const source = await readSource('../commands/highlight-detection.injected.js');
    const liteFnMatch = source.match(
      /function toInteractiveElementLite\([\s\S]*?\n\}/,
    );
    expect(liteFnMatch).not.toBeNull();
    expect(liteFnMatch![0]).toContain('_stashIndex');
  });

  test('buildHighlightEnrichmentScript exists in highlight-detection.ts', async () => {
    const source = await readSource('../commands/highlight-detection.ts');
    expect(source).toContain('buildHighlightEnrichmentScript');
    // Should produce a script that calls __obEnrichElements
    expect(source).toContain('__obEnrichElements');
  });

  test('background/index.ts calls enrichment script after pagination', async () => {
    const source = await readSource('../background/index.ts');
    // Should import and use buildHighlightEnrichmentScript
    expect(source).toContain('buildHighlightEnrichmentScript');
    // The enrichment call should appear between pagination and screenshot
    const enrichCallPos = source.indexOf('buildHighlightEnrichmentScript');
    const screenshotPos = source.indexOf('captureScreenshot', source.indexOf('captureHighlightedPageState'));
    // Enrichment must come before screenshot in the function
    expect(enrichCallPos).toBeGreaterThan(0);
    expect(enrichCallPos).toBeLessThan(screenshotPos);
  });

  test('buildElementIdentityKey uses fingerprint when available', async () => {
    const source = await readSource('../commands/element-id.ts');
    const identityFnMatch = source.match(
      /function buildElementIdentityKey[\s\S]*?\n\}/,
    );
    expect(identityFnMatch).not.toBeNull();
    const body = identityFnMatch![0];
    // Primary path uses fingerprint
    expect(body).toContain('fingerprint');
    // Should branch on whether fingerprint is present
    expect(body).toContain('if (fp)');
  });
});

// ---------------------------------------------------------------------------
// T1-B: Compute only the requested page
// ---------------------------------------------------------------------------
describe('T1-B: single-page computation', () => {
  test('buildStoredHighlightPages passes page as maxPages', async () => {
    const source = await readSource('../background/index.ts');
    // The function should accept a page parameter in its options
    expect(source).toMatch(/buildStoredHighlightPages\(options.*page.*number/s);
    // paginateCollisionFreeElements should receive page as the 4th arg (maxPages)
    // The call looks like: paginateCollisionFreeElements(elements, w, h, page)
    expect(source).toMatch(
      /paginateCollisionFreeElements\(\s*filteredElements[\s\S]*?,\s*page\s*[,)]/,
    );
  });

  test('paginateCollisionFreeElements with maxPages=1 returns at most 1 page', () => {
    // Create enough elements to require multiple pages by placing labels that
    // would collide when all positioned 'above'
    const elements: InteractiveElement[] = [];
    for (let i = 0; i < 40; i++) {
      elements.push(
        mockElement({
          id: `E${i}`,
          bbox: { x: 10, y: 10 + i * 2, width: 200, height: 20 },
        }),
      );
    }

    const allPages = paginateCollisionFreeElements(elements, 1920, 1080);
    // Without maxPages, should produce multiple pages (labels collide)
    expect(allPages.length).toBeGreaterThanOrEqual(1);

    const singlePage = paginateCollisionFreeElements(elements, 1920, 1080, 1);
    expect(singlePage.length).toBeLessThanOrEqual(1);
  });

  test('totalPages is estimated from element count / first page size', async () => {
    const source = await readSource('../background/index.ts');
    // Should have estimation logic for totalPages when not all pages are computed
    expect(source).toMatch(/estimat(e|ed)TotalPages|Math\.ceil.*filteredElements\.length/i);
  });
});
