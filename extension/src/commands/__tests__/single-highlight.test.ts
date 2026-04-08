import { describe, expect, test } from 'bun:test';

import type { InteractiveElement } from '../../types';
import {
  calculateConfirmationBannerLayout,
  calculateConfirmationPreviewLayout,
  getConfirmationPromptText,
} from '../single-highlight';

function createElement(bbox: InteractiveElement['bbox']): InteractiveElement {
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
  test('formats confirmation reminder text for click and keyboard input', () => {
    expect(getConfirmationPromptText('click')).toBe(
      'Is this the element you wanted to click?',
    );
    expect(getConfirmationPromptText('keyboard_input')).toBe(
      'Is this the element you wanted to type into?',
    );
    expect(getConfirmationPromptText('select')).toBe(
      'Is this the element you wanted to pick an option from?',
    );
  });

  test('places the confirmation reminder above the highlight when space is available', () => {
    const banner = calculateConfirmationBannerLayout({
      canvasWidth: 720,
      canvasHeight: 420,
      elementRect: { x: 220, y: 180, width: 120, height: 40 },
      message: getConfirmationPromptText('click'),
      scale: 1,
    });

    expect(banner.y + banner.height).toBeLessThanOrEqual(180 - 8);
    expect(banner.x).toBeGreaterThanOrEqual(10);
  });

  test('falls back below the highlight when there is no room above', () => {
    const banner = calculateConfirmationBannerLayout({
      canvasWidth: 720,
      canvasHeight: 420,
      elementRect: { x: 220, y: 18, width: 120, height: 40 },
      message: getConfirmationPromptText('click'),
      scale: 1,
    });

    expect(banner.y).toBeGreaterThanOrEqual(18 + 40 + 8);
  });

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
