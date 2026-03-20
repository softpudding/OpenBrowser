import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { goBack, goForward } from '../tabs';

describe('tabs history navigation', () => {
  beforeEach(() => {
    const executeScript = mock();

    (globalThis as any).chrome = {
      scripting: {
        executeScript,
      },
      tabs: {
        query: mock(async () => []),
        create: mock(async () => ({ id: 1 })),
        remove: mock(async () => undefined),
        get: mock(async (tabId: number) => ({ id: tabId })),
        reload: mock(async () => undefined),
      },
    };
  });

  test('goBack reports failure and skips navigation when there is no back history', async () => {
    const executeScript = (globalThis as any).chrome.scripting.executeScript;
    executeScript.mockResolvedValueOnce([{ result: { length: 1, canGoBack: false, canGoForward: false } }]);

    const result = await goBack(7);

    expect(result.success).toBe(false);
    expect(result.error).toContain('No previous page');
    expect(executeScript).toHaveBeenCalledTimes(1);
  });

  test('goForward reports failure and skips navigation when there is no forward history', async () => {
    const executeScript = (globalThis as any).chrome.scripting.executeScript;
    executeScript.mockResolvedValueOnce([{ result: { length: 2, canGoBack: true, canGoForward: false } }]);

    const result = await goForward(7);

    expect(result.success).toBe(false);
    expect(result.error).toContain('No forward page');
    expect(executeScript).toHaveBeenCalledTimes(1);
  });
});
