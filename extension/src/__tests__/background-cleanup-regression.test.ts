import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const backgroundSource = readFileSync(
  resolve(import.meta.dir, '..', 'background', 'index.ts'),
  'utf8',
);

describe('Background cleanup regressions', () => {
  test('cleanup_session clears per-tab and per-conversation browser state', () => {
    expect(backgroundSource).toContain(
      'cleanupTabState(cleanupConversationId, managedTab.tabId);',
    );
    expect(backgroundSource).toContain(
      'elementCache.invalidate(cleanupConversationId);',
    );
  });

  test('tab close events are wired into browser-state cleanup', () => {
    expect(backgroundSource).toContain('tabManager.addTabClosedListener');
    expect(backgroundSource).toContain(
      'cleanupTabState(conversationId, tabId);',
    );
  });

  test('swipe screenshots reuse tab-view warmup capture options', () => {
    expect(backgroundSource).toContain("case 'swipe_element': {");
    expect(backgroundSource).toContain("logLabel: 'SwipeElement'");
    expect(backgroundSource).toContain('preconditionWaitForRender: 900');
    expect(backgroundSource).toContain(
      'preconditionCaptureOptions: TAB_VIEW_SCREENSHOT_CAPTURE_OPTIONS',
    );
  });

  test('highlight warmup defaults to tab-view capture options', () => {
    expect(backgroundSource).toContain(
      'captureOptions = TAB_VIEW_SCREENSHOT_CAPTURE_OPTIONS',
    );
    expect(backgroundSource).toContain(
      'preconditionCaptureOptions ?? TAB_VIEW_SCREENSHOT_CAPTURE_OPTIONS',
    );
    expect(backgroundSource).toContain(
      'const screenshotResult = await captureScreenshot(',
    );
    expect(backgroundSource).not.toContain(
      'HIGHLIGHT_SCREENSHOT_CAPTURE_OPTIONS',
    );
  });

  test('navigation defaults prime the page with a raw screenshot before highlight', () => {
    expect(backgroundSource).toContain('async function runRawScreenshotPrime(');
    expect(backgroundSource).toContain('primeWithRawScreenshot: true');
    expect(backgroundSource).toContain("logLabel: 'Tab Init'");
    expect(backgroundSource).toContain("logLabel: 'Tab Open'");
    expect(backgroundSource).toContain("logLabel: 'Tab Refresh'");
  });

  test('post-action screenshots reuse the default highlighted page-state helper', () => {
    expect(backgroundSource).toContain(
      'async function captureDefaultHighlightedPageState(',
    );
    expect(backgroundSource).toContain("logLabel: 'ClickElement'");
    expect(backgroundSource).toContain("logLabel: 'Tab Init'");
  });

  test('tab view still uses the raw screenshot path', () => {
    expect(backgroundSource).toContain("case 'view': {");
    expect(backgroundSource).toContain(
      'const viewScreenshotResult = await captureScreenshot(',
    );
  });
});
