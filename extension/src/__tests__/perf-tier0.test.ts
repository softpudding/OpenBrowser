/**
 * TDD tests for PERF-SPEC Tier 0: Pure-Sleep and Waste Elimination
 *
 * These tests verify the structural changes described in the spec without
 * requiring Chrome APIs or a running browser.
 */
import { describe, expect, test } from 'bun:test';

import {
  HIGHLIGHT_POST_DETECTION_CAPTURE_OPTIONS,
  TAB_VIEW_SCREENSHOT_CAPTURE_OPTIONS,
} from '../utils/highlight-screenshot';

// ---------------------------------------------------------------------------
// T0-A: executeJavaScript skipNewTabDetection parameter
// ---------------------------------------------------------------------------
describe('T0-A: executeJavaScript skipNewTabDetection', () => {
  test('javascript.ts source contains skipNewTabDetection parameter', async () => {
    // javascript.ts imports chrome-only modules so we can't import it in test.
    // Instead, verify the source code has the new parameter.
    const fs = await import('fs');
    const source = fs.readFileSync(
      new URL('../commands/javascript.ts', import.meta.url),
      'utf-8',
    );
    // The function signature must include the new parameter
    expect(source).toContain('skipNewTabDetection');
    // The sleep must be wrapped in a conditional
    expect(source).toContain('if (!skipNewTabDetection)');
  });

  test('background/index.ts passes skipNewTabDetection=true for highlight calls', async () => {
    const fs = await import('fs');
    const source = fs.readFileSync(
      new URL('../background/index.ts', import.meta.url),
      'utf-8',
    );
    // Both detection and consistency executeJavaScript calls must skip tab detection
    const matches = source.match(
      /skipNewTabDetection.*highlight detection never creates tabs|skipNewTabDetection.*consistency check never creates tabs/g,
    );
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// T0-C: Post-detection screenshot uses no-warmup capture options
// ---------------------------------------------------------------------------
describe('T0-C: HIGHLIGHT_POST_DETECTION_CAPTURE_OPTIONS', () => {
  test('exists and disables warmup', () => {
    expect(HIGHLIGHT_POST_DETECTION_CAPTURE_OPTIONS).toBeDefined();
    expect(HIGHLIGHT_POST_DETECTION_CAPTURE_OPTIONS.warmupBeforeCapture).toBe(
      false,
    );
  });

  test('inherits base format and dimension settings', () => {
    expect(HIGHLIGHT_POST_DETECTION_CAPTURE_OPTIONS.preferredFormat).toBe(
      'jpeg',
    );
    expect(HIGHLIGHT_POST_DETECTION_CAPTURE_OPTIONS.maxOutputWidth).toBe(1920);
    expect(HIGHLIGHT_POST_DETECTION_CAPTURE_OPTIONS.maxOutputHeight).toBe(1080);
  });

  test('TAB_VIEW options still have warmup enabled (unchanged)', () => {
    expect(TAB_VIEW_SCREENSHOT_CAPTURE_OPTIONS.warmupBeforeCapture).toBe(true);
    expect(TAB_VIEW_SCREENSHOT_CAPTURE_OPTIONS.warmupMaxAttempts).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// T0-E: TreeWalker starts at body, not documentElement
// ---------------------------------------------------------------------------
describe('T0-E: TreeWalker body start', () => {
  test('getCandidateElementsForScan code references document.body for capped scan', async () => {
    // Read the injected script source and verify the capped walker starts at body.
    const fs = await import('fs');
    const source = fs.readFileSync(
      new URL('../commands/highlight-detection.injected.js', import.meta.url),
      'utf-8',
    );
    // The capped TreeWalker path should use document.body, not document.documentElement
    const treeWalkerMatch = source.match(
      /document\.createTreeWalker\(\s*([\w.]+)/,
    );
    expect(treeWalkerMatch).not.toBeNull();
    // After the fix, should be document.body (or a variable assigned from body)
    expect(treeWalkerMatch![1]).not.toBe('document.documentElement');
  });
});
