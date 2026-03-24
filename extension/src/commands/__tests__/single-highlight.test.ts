import { describe, expect, test } from 'bun:test';

import type { InteractiveElement } from '../../types';
import { calculateConfirmationPreviewLayout } from '../single-highlight';

function createElement(
  bbox: InteractiveElement['bbox'],
): InteractiveElement {
  return {
    id: 'abc123',
    type: 'clickable',
    tagName: 'BUTTON',
    selector: '#target',
    bbox,
    isVisible: true,
    isInViewport: true,
  };
}

describe('single-highlight confirmation preview', () => {
  test('uses a bounded close-up crop around the selected element', () => {
    const layout = calculateConfirmationPreviewLayout(
      1280,
      720,
      createElement({ x: 600, y: 280, width: 120, height: 48 }),
      1,
    );

    expect(layout.crop.width).toBe(742);
    expect(layout.crop.height).toBe(418);
    expect(layout.element.x).toBeGreaterThanOrEqual(0);
    expect(layout.element.y).toBeGreaterThanOrEqual(0);
    expect(layout.element.x + layout.element.width).toBeLessThanOrEqual(
      layout.crop.width,
    );
    expect(layout.element.y + layout.element.height).toBeLessThanOrEqual(
      layout.crop.height,
    );
  });

  test('clamps the crop to the top-left image boundary', () => {
    const layout = calculateConfirmationPreviewLayout(
      1280,
      720,
      createElement({ x: 12, y: 10, width: 90, height: 36 }),
      1,
    );

    expect(layout.crop.x).toBe(0);
    expect(layout.crop.y).toBe(0);
    expect(layout.element.x).toBeGreaterThanOrEqual(0);
    expect(layout.element.y).toBeGreaterThanOrEqual(0);
  });

  test('clamps the crop to the bottom-right image boundary', () => {
    const layout = calculateConfirmationPreviewLayout(
      1280,
      720,
      createElement({ x: 1190, y: 670, width: 70, height: 30 }),
      1,
    );

    expect(layout.crop.x + layout.crop.width).toBe(1280);
    expect(layout.crop.y + layout.crop.height).toBe(720);
    expect(layout.element.x + layout.element.width).toBeLessThanOrEqual(
      layout.crop.width,
    );
    expect(layout.element.y + layout.element.height).toBeLessThanOrEqual(
      layout.crop.height,
    );
  });
});
