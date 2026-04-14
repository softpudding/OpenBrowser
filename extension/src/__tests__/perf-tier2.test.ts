/**
 * TDD tests for PERF-SPEC Tier 2: Scan Efficiency
 *
 * These tests verify the structural changes described in the spec without
 * requiring Chrome APIs or a running browser.
 */
import { describe, expect, test } from 'bun:test';

// Helper to read source files (Chrome-only modules can't be imported in tests)
async function readSource(relativePath: string): Promise<string> {
  const fs = await import('fs');
  return fs.readFileSync(
    new URL(relativePath, import.meta.url),
    'utf-8',
  );
}

// ---------------------------------------------------------------------------
// T2-A: Replace querySelectorAll('*') with targeted interactive selectors
// ---------------------------------------------------------------------------
describe('T2-A: targeted interactive selectors', () => {
  test('INTERACTIVE_SEED_SELECTOR constant exists', async () => {
    const source = await readSource('../commands/highlight-detection.injected.js');
    expect(source).toContain('INTERACTIVE_SEED_SELECTOR');
  });

  test('seed selector covers core interactive elements', async () => {
    const source = await readSource('../commands/highlight-detection.injected.js');
    // Must include the fundamental interactive selectors
    expect(source).toContain("'a[href]'");
    expect(source).toContain("'button'");
    expect(source).toContain("'input'");
    expect(source).toContain("'select'");
    expect(source).toContain("'textarea'");
    expect(source).toContain('[role="button"]');
    expect(source).toContain('[tabindex]');
  });

  test('full scan path uses targeted selectors instead of querySelectorAll(*)', async () => {
    const source = await readSource('../commands/highlight-detection.injected.js');
    // getCandidateElementsForScan delegates to getFullScanCandidates which
    // uses INTERACTIVE_SEED_SELECTOR instead of querySelectorAll('*')
    const fnStart = source.indexOf('function getFullScanCandidates');
    expect(fnStart).toBeGreaterThan(0);
    const fnEnd = source.indexOf('\nfunction ', fnStart + 1);
    const fnBody = source.substring(fnStart, fnEnd);
    expect(fnBody).toContain('INTERACTIVE_SEED_SELECTOR');
    // The main scan call should NOT use querySelectorAll('*')
    expect(fnBody).not.toContain("querySelectorAll('*')");
  });

  test('fallback scan for pointer-cursor clickables exists', async () => {
    const source = await readSource('../commands/highlight-detection.injected.js');
    // Should still handle cursor:pointer divs
    expect(source).toMatch(/cursor.*pointer|pointer.*cursor/);
  });
});

// ---------------------------------------------------------------------------
// T2-B: Defer hit-test visibility to after candidate resolution
// ---------------------------------------------------------------------------
describe('T2-B: deferred hit-test visibility', () => {
  test('resolveElementCandidate is called BEFORE getElementHitTestVisibility', async () => {
    const source = await readSource('../commands/highlight-detection.injected.js');
    // Find the scan loop in collectHighlightCandidates
    const scanStart = source.indexOf('for (const element of allElements)');
    const scanEnd = source.indexOf('const sortedCandidates');
    const scanLoop = source.substring(scanStart, scanEnd);

    const resolvePos = scanLoop.indexOf('resolveElementCandidate');
    const hitTestPos = scanLoop.indexOf('getElementHitTestVisibility');

    expect(resolvePos).toBeGreaterThan(0);
    expect(hitTestPos).toBeGreaterThan(0);
    // resolve must come BEFORE hit-test
    expect(resolvePos).toBeLessThan(hitTestPos);
  });

  test('hit-test is only called for resolved elements', async () => {
    const source = await readSource('../commands/highlight-detection.injected.js');
    const scanStart = source.indexOf('for (const element of allElements)');
    const scanEnd = source.indexOf('const sortedCandidates');
    const scanLoop = source.substring(scanStart, scanEnd);

    // getElementHitTestVisibility should appear after resolvedCandidate null check
    const resolveNullCheck = scanLoop.indexOf('if (!resolvedCandidate)');
    const hitTestCall = scanLoop.indexOf('getElementHitTestVisibility');
    expect(resolveNullCheck).toBeGreaterThan(0);
    expect(hitTestCall).toBeGreaterThan(resolveNullCheck);
  });
});

// ---------------------------------------------------------------------------
// T2-C: Cache getComputedStyle and getBoundingClientRect per scan
// ---------------------------------------------------------------------------
describe('T2-C: style and rect caching', () => {
  test('cachedStyle function exists using WeakMap', async () => {
    const source = await readSource('../commands/highlight-detection.injected.js');
    expect(source).toContain('_styleCache');
    expect(source).toMatch(/new WeakMap.*_styleCache|_styleCache.*new WeakMap/s);
    expect(source).toContain('function cachedStyle(');
  });

  test('cachedRect function exists using WeakMap', async () => {
    const source = await readSource('../commands/highlight-detection.injected.js');
    expect(source).toContain('_rectCache');
    expect(source).toMatch(/new WeakMap.*_rectCache|_rectCache.*new WeakMap/s);
    expect(source).toContain('function cachedRect(');
  });

  test('isElementVisibleForDetection uses cachedStyle instead of getComputedStyle', async () => {
    const source = await readSource('../commands/highlight-detection.injected.js');
    const fnMatch = source.match(
      /function isElementVisibleForDetection[\s\S]*?\n\}/,
    );
    expect(fnMatch).not.toBeNull();
    const fnBody = fnMatch![0];
    expect(fnBody).toContain('cachedStyle(');
    expect(fnBody).not.toContain('window.getComputedStyle(');
  });

  test('isElementVisibleInScrollParent uses cached rect and pre-computed containers', async () => {
    const source = await readSource('../commands/highlight-detection.injected.js');
    const fnMatch = source.match(
      /function isElementVisibleInScrollParent[\s\S]*?\n\}/,
    );
    expect(fnMatch).not.toBeNull();
    const fnBody = fnMatch![0];
    // Uses cachedRect for the element's rect
    expect(fnBody).toContain('cachedRect(');
    // Uses pre-computed container.rect (no need for cachedStyle — styles
    // are already resolved during findScrollContainers)
    expect(fnBody).toContain('container.rect');
  });

  test('isElementInViewportForDetection uses cachedRect', async () => {
    const source = await readSource('../commands/highlight-detection.injected.js');
    const fnMatch = source.match(
      /function isElementInViewportForDetection[\s\S]*?\n\}/,
    );
    expect(fnMatch).not.toBeNull();
    const fnBody = fnMatch![0];
    expect(fnBody).toContain('cachedRect(');
    expect(fnBody).not.toContain('.getBoundingClientRect()');
  });
});

// ---------------------------------------------------------------------------
// T2-D: Pre-compute scroll containers once before main scan
// ---------------------------------------------------------------------------
describe('T2-D: pre-computed scroll containers', () => {
  test('findScrollContainers function exists', async () => {
    const source = await readSource('../commands/highlight-detection.injected.js');
    expect(source).toContain('function findScrollContainers(');
  });

  test('scroll containers are pre-computed before the scan loop', async () => {
    const source = await readSource('../commands/highlight-detection.injected.js');
    const fnStart = source.indexOf('function collectHighlightCandidates');
    const scanLoopStart = source.indexOf(
      'for (const element of allElements)',
      fnStart,
    );
    const preLoopBody = source.substring(fnStart, scanLoopStart);
    // findScrollContainers should be called before the scan loop
    expect(preLoopBody).toContain('findScrollContainers');
  });

  test('isElementVisibleInScrollParent uses pre-computed containers', async () => {
    const source = await readSource('../commands/highlight-detection.injected.js');
    const fnMatch = source.match(
      /function isElementVisibleInScrollParent[\s\S]*?\n\}/,
    );
    expect(fnMatch).not.toBeNull();
    const fnBody = fnMatch![0];
    // Should reference a containers parameter or variable, not walk ancestors
    expect(fnBody).toContain('containers');
    // Should NOT have the old ancestor walk pattern
    expect(fnBody).not.toMatch(
      /let parent = el\.parentElement[\s\S]*?parent\.parentElement/,
    );
  });
});
