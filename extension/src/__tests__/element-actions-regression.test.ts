import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const elementActionsSource = readFileSync(
  resolve(import.meta.dir, '..', 'commands', 'element-actions.ts'),
  'utf8',
);

describe('Element action regressions', () => {
  test('performElementClick awaits async JavaScript execution', () => {
    const clickBlockMatch = elementActionsSource.match(
      /export async function performElementClick[\s\S]*?jsResult = await executeJavaScript\(\s*tabId,\s*conversationId,\s*script,\s*true,\s*true,\s*timeout,\s*\)/,
    );

    expect(clickBlockMatch).not.toBeNull();
  });

  test('performElementClick reports unresolved promise results explicitly', () => {
    expect(elementActionsSource).toContain(
      'Click JavaScript returned an unresolved Promise instead of a resolved result',
    );
  });

  test('performElementSwipe includes gesture fallback and settle wait', () => {
    expect(elementActionsSource).toContain('async function performGestureSwipe');
    expect(elementActionsSource).toContain('await waitForSwipeToSettle(');
    expect(elementActionsSource).toContain("stepMethod = 'gesture';");
  });
});
