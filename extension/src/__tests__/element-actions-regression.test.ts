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

  test('performElementClick routes editable clicks through the visible activation surface', () => {
    expect(elementActionsSource).toContain(
      'function getInteractiveActivationTarget(target)',
    );
    expect(elementActionsSource).toContain(
      'function resolveActivationDispatchTarget(target, activationTarget)',
    );
    expect(elementActionsSource).toContain(
      'dispatchActivationPress(activationTarget, activation.point);',
    );
    expect(elementActionsSource).toContain(
      'dispatchActivationRelease(activationTarget, activation.point);',
    );
  });

  test('performElementClick preserves structured interactive targets like anchors', () => {
    expect(elementActionsSource).toContain(
      'if (isPlaceholderCoverForInput(activationTarget, target))',
    );
    expect(elementActionsSource).toContain(
      'if (isStructuredInteractiveElement(target))',
    );
    expect(elementActionsSource).toContain(
      'keep dispatch on that exact element instead of drifting to a non-interactive ancestor',
    );
  });

  test('performKeyboardInput primes editable activation and beforeinput events', () => {
    expect(elementActionsSource).toContain('const alreadyFocused =');
    expect(elementActionsSource).toContain("new InputEvent('beforeinput'");
  });

  test('performElementSwipe includes gesture fallback and settle wait', () => {
    expect(elementActionsSource).toContain(
      'async function performGestureSwipe',
    );
    expect(elementActionsSource).toContain('await waitForSwipeToSettle(');
    expect(elementActionsSource).toContain("stepMethod = 'gesture';");
  });

  test('performElementSwipe refuses generic horizontal scroll fallback for non-swipable containers', () => {
    expect(elementActionsSource).toContain('const canUseScrollFallback =');
    expect(elementActionsSource).toContain(
      'Selected element does not appear to be a swipeable carousel; use scroll_element or re-highlight a swipable region',
    );
  });

  test('performElementSwipe prefers zero-animation library transitions', () => {
    expect(elementActionsSource).toContain('currentApi.slideNext(0)');
    expect(elementActionsSource).toContain('currentApi.slidePrev(0)');
    expect(elementActionsSource).toContain('currentApi.scrollNext(true)');
    expect(elementActionsSource).toContain(
      'currentApi.slideTo(targetIndex, 0)',
    );
  });
});
