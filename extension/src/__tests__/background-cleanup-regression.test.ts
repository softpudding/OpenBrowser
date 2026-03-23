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
    expect(backgroundSource).toContain('cleanupTabState(conversationId, tabId);');
  });

  test('swipe screenshots use extended render wait without settle retries', () => {
    expect(backgroundSource).toContain("case 'swipe_element': {");
    expect(backgroundSource).toContain('          900,');
  });
});
