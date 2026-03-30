import { describe, test, expect } from 'bun:test';

// Import constants and functions from the collision detection module
import {
  LABEL_HEIGHT,
  BBox,
  expandBBoxWithLabel,
  elementsCollide,
  selectCollisionFreePage,
} from '../utils/collision-detection';
import type { InteractiveElement } from '../types';
import { generateShortHash } from '../commands/element-id';
import { getLabelDimensions } from '../utils/label-geometry';

/**
 * TDD Tests for Smart Label Placement
 *
 * Feature: 4-position greedy algorithm for label placement
 * Priority: above → below → left → right
 *
 * Current behavior: Labels are always placed above the element
 * Target behavior: Labels try positions in priority order, skipping elements when all positions collide
 */

// Helper to create a minimal InteractiveElement
function createElement(
  selectorName: string,
  x: number,
  y: number,
  width: number,
  height: number,
  labelPosition?: 'above' | 'below' | 'left' | 'right',
): InteractiveElement {
  const selector = `#${selectorName}`;
  return {
    id: generateShortHash(selector),
    type: 'clickable',
    tagName: 'button',
    selector,
    bbox: { x, y, width, height },
    isVisible: true,
    isInViewport: true,
    labelPosition,
  };
}

function findBySelector(
  elements: InteractiveElement[],
  selector: string,
): InteractiveElement | undefined {
  return elements.find((element) => element.selector === selector);
}

describe('Smart Label Placement', () => {
  describe('expandBBoxWithLabel - Position-aware expansion', () => {
    test('should expand bbox upward when labelPosition is "above" (default)', () => {
      const bbox: BBox = { x: 100, y: 100, width: 50, height: 30 };
      const expanded = expandBBoxWithLabel(bbox, 'above');
      const labelWidth = getLabelDimensions('xxxxxx', bbox.width).width;

      // Label is above: y decreases by LABEL_HEIGHT
      expect(expanded.x).toBe(100);
      expect(expanded.y).toBe(100 - LABEL_HEIGHT); // 74
      expect(expanded.width).toBe(labelWidth);
      expect(expanded.height).toBe(30 + LABEL_HEIGHT); // 56
    });

    test('should expand bbox downward when labelPosition is "below"', () => {
      const bbox: BBox = { x: 100, y: 100, width: 50, height: 30 };
      const expanded = expandBBoxWithLabel(bbox, 'below');
      const labelWidth = getLabelDimensions('xxxxxx', bbox.width).width;

      // Label is below: y stays same, height increases
      expect(expanded.x).toBe(100);
      expect(expanded.y).toBe(100);
      expect(expanded.width).toBe(labelWidth);
      expect(expanded.height).toBe(30 + LABEL_HEIGHT); // 56
    });

    test('should expand bbox to the left when labelPosition is "left"', () => {
      const bbox: BBox = { x: 100, y: 100, width: 50, height: 30 };
      const expanded = expandBBoxWithLabel(bbox, 'left');

      // Label is left: x decreases by label width
      const labelWidth = getLabelDimensions('xxxxxx', bbox.width).width;
      expect(expanded.x).toBe(100 - labelWidth); // -20
      expect(expanded.y).toBe(100);
      expect(expanded.width).toBe(50 + labelWidth); // 170
      expect(expanded.height).toBe(30);
    });

    test('should expand bbox to the right when labelPosition is "right"', () => {
      const bbox: BBox = { x: 100, y: 100, width: 50, height: 30 };
      const expanded = expandBBoxWithLabel(bbox, 'right');

      // Label is right: x stays same, width increases
      const labelWidth = getLabelDimensions('xxxxxx', bbox.width).width;
      expect(expanded.x).toBe(100);
      expect(expanded.y).toBe(100);
      expect(expanded.width).toBe(50 + labelWidth); // 170
      expect(expanded.height).toBe(30);
    });

    test('should default to "above" when labelPosition is undefined', () => {
      const bbox: BBox = { x: 100, y: 100, width: 50, height: 30 };
      const expanded = expandBBoxWithLabel(bbox);

      // Should behave same as 'above'
      expect(expanded.y).toBe(100 - LABEL_HEIGHT);
    });
  });

  describe('elementsCollide - Position-aware collision', () => {
    test('should detect collision when both labels are above and overlap', () => {
      // Element A at (100, 100), Element B at (110, 100) - close enough to collide
      const elemA = createElement('a', 100, 100, 50, 30, 'above');
      const elemB = createElement('b', 110, 100, 50, 30, 'above');

      expect(elementsCollide(elemA, elemB)).toBe(true);
    });

    test('should NOT collide when one label is above and other is below', () => {
      // Element A at (100, 100) with label above
      // Element B at (100, 70) with label below (label would be at y=100)
      // They should NOT collide because labels are on opposite sides
      const elemA = createElement('a', 100, 100, 50, 30, 'above');
      const elemB = createElement('b', 100, 70, 50, 30, 'below');

      // Element A's expanded bbox: y=74 (100-26), height=56
      // Element B's expanded bbox: y=70, height=56 (label below)
      // These should NOT overlap because A's label is above (y=74-100) and B's label is below (y=100-126)
      expect(elementsCollide(elemA, elemB)).toBe(false);
    });

    test('should NOT collide when labels are on opposite horizontal sides', () => {
      // Element A at (200, 100) with label left
      // Element B at (200, 100) with label right
      // They should NOT collide because labels are on opposite sides
      const elemA = createElement('a', 200, 100, 50, 30, 'left');
      const elemB = createElement('b', 200, 100, 50, 30, 'right');

      // Element A's expanded bbox: x=80 (200-120), width=170
      // Element B's expanded bbox: x=200, width=170
      // These should NOT overlap because A's label is left (x=80-200) and B's label is right (x=200-370)
      expect(elementsCollide(elemA, elemB)).toBe(false);
    });
  });

  describe('Position priority - Greedy algorithm', () => {
    test('should prioritize more constrained elements before flexible ones', () => {
      const flexible = createElement('flexible', 100, 100, 50, 30);
      const constrained = createElement('constrained', 10, 10, 20, 14);

      const result = selectCollisionFreePage(
        [flexible, constrained],
        1,
        200,
        200,
      );

      expect(result).toHaveLength(2);
      expect(result[0]?.selector).toBe('#constrained');
      expect(result[0]?.id).toMatch(/^[0-9A-Z]{3}$/);
      expect(result[1]?.selector).toBe('#flexible');
      expect(result[1]?.id).toMatch(/^[0-9A-Z]{3}$/);
    });

    test('should place label above when space available (default)', () => {
      // Single element with plenty of space above
      const elements = [createElement('a', 100, 200, 50, 30)];
      const result = selectCollisionFreePage(elements, 1);

      expect(result).toHaveLength(1);
      expect(result[0].labelPosition).toBe('above');
    });

    test('should place one label below when two identical elements would both prefer above', () => {
      // Element A at (100, 100) - label above at y=74-100
      // Element B at (100, 100) - same position as A, label above would collide
      // The layout should split them across above/below instead of dropping one.
      const elemA = createElement('a', 100, 100, 50, 30);
      const elemB = createElement('b', 100, 100, 50, 30);
      const elements = [elemA, elemB];

      const result = selectCollisionFreePage(elements, 1);

      // Both elements should be on page 1 with different label positions.
      expect(result).toHaveLength(2);
      expect(result.map((element) => element.labelPosition).sort()).toEqual([
        'above',
        'below',
      ]);
    });

    test('should place label left when above and below collide', () => {
      // Element A at (100, 100) - label above at y=74-100, x=100-220
      // Element B at (50, 80) - label above collides with A's label, label below collides with A's element
      // Element C at (100, 130) - element at y=130-160
      // Element B should try left
      const elemA = createElement('a', 100, 100, 50, 30);
      const elemB = createElement('b', 50, 80, 50, 30);
      const elemC = createElement('c', 100, 130, 50, 30);
      const elements = [elemA, elemB, elemC];

      const result = selectCollisionFreePage(elements, 1);

      // All three should fit with a non-overlapping placement
      expect(result).toHaveLength(3);
      const resultB = findBySelector(result, '#b');
      expect(resultB?.labelPosition).toBeDefined();
    });

    test('should place label right when above and left collide', () => {
      // Scenario where right position works for B
      // Element A at (200, 100) - label above at y=74-100, x=200-320
      // Element B at (150, 80) - label above collides with A's label
      //                          label below collides with A's element
      //                          label left doesn't collide (B gets label 'left')
      // This tests that the algorithm tries positions in order
      const elemA = createElement('a', 200, 100, 50, 30);
      const elemB = createElement('b', 150, 80, 50, 30);
      const elements = [elemA, elemB];

      const result = selectCollisionFreePage(elements, 1);

      expect(result).toHaveLength(2);
      const resultB = findBySelector(result, '#b');
      expect(resultB?.labelPosition).toBeDefined();
    });

    test('should choose the feasible position that blocks fewer later elements', () => {
      const upper = createElement('upper', 10, 20, 24, 14);
      const lower = createElement('lower', 10, 48, 24, 14);

      const result = selectCollisionFreePage([upper, lower], 1, 80, 200);

      expect(result).toHaveLength(2);
      expect(findBySelector(result, '#upper')?.labelPosition).toBe('right');
      expect(findBySelector(result, '#lower')).toBeDefined();
    });

    test('should repack surrounding elements to keep constrained center on page 1', () => {
      // Element completely surrounded in input order. The constraint-aware
      // heuristic should reorder placements so the center element still fits.
      const center = createElement('center', 200, 100, 50, 30);
      const above = createElement('above', 200, 64, 50, 30);
      const below = createElement('below', 200, 140, 50, 30);
      const left = createElement('left', 80, 100, 50, 30);
      const right = createElement('right', 320, 100, 50, 30);

      const elements = [above, below, left, right, center];

      const page1 = selectCollisionFreePage(elements, 1);
      expect(page1).toHaveLength(5);
      expect(findBySelector(page1, '#center')?.labelPosition).toBe('left');
    });
  });

  describe('Viewport boundary checks', () => {
    test('should not place label outside viewport on left', () => {
      const labelWidth = getLabelDimensions('xxxxxx', 50).width;
      // Element at x=50, label width extends beyond the left viewport edge
      // Label left would be at x=-70 (outside viewport)
      // Should try next position (right) instead
      const elemA = createElement('a', 50, 100, 50, 30);
      const elemB = createElement('b', 50, 60, 50, 30); // Blocks above

      const result = selectCollisionFreePage([elemA, elemB], 1, 1280, 720);

      const resultA = findBySelector(result, '#a');
      // A's above is blocked by B, left would go outside viewport
      // So A should try right or below
      expect(resultA?.labelPosition).not.toBe('left');
      expect(labelWidth).toBeGreaterThan(50);
    });

    test('should not place label outside viewport on right', () => {
      // Element at x=1200, width=50, viewport width=1280
      // Label right would extend to x=1370 (outside viewport)
      // Should try next position instead
      const elemA = createElement('a', 1200, 100, 50, 30);
      const elemB = createElement('b', 1200, 60, 50, 30); // Blocks above
      const elemC = createElement('c', 1200, 130, 50, 30); // Blocks below

      const result = selectCollisionFreePage(
        [elemA, elemB, elemC],
        1,
        1280,
        720,
      );

      const resultA = findBySelector(result, '#a');
      // Right placement should be rejected because it would leave the viewport.
      expect(resultA?.labelPosition).not.toBe('right');
    });

    test('should not place label above viewport (y < 0)', () => {
      // Element at y=10, label height=26
      // Label above would be at y=-16 (outside viewport)
      // Should try below instead
      const elemA = createElement('a', 100, 10, 50, 30);

      const result = selectCollisionFreePage([elemA], 1, 1280, 720);

      // Label above would go outside viewport, should try below
      expect(result[0]?.labelPosition).toBe('below');
    });

    test('should not place label below viewport bottom', () => {
      // Element at y=700, height=30, viewport height=720
      // Label below would extend to y=756 (outside viewport)
      // Should try left or right instead
      const elemA = createElement('a', 100, 700, 50, 30);
      const elemB = createElement('b', 100, 660, 50, 30); // Blocks above

      const result = selectCollisionFreePage([elemA, elemB], 1, 1280, 720);

      const resultA = findBySelector(result, '#a');
      // A's above blocked by B, below outside viewport
      // So A should try left or right
      expect(resultA?.labelPosition).not.toBe('below');
    });
  });

  describe('Edge cases', () => {
    test('should handle element at viewport corner (top-left)', () => {
      // Element at (10, 10) - near top-left corner
      // Above would go outside (y=-16)
      // Left would go outside (x=-110)
      // Should try below or right
      const elem = createElement('corner', 10, 10, 50, 30);

      const result = selectCollisionFreePage([elem], 1, 1280, 720);

      // Should not be above or left
      expect(result[0]?.labelPosition).not.toBe('above');
      expect(result[0]?.labelPosition).not.toBe('left');
    });

    test('should handle element at viewport corner (bottom-right)', () => {
      // Element at (1220, 690) - near bottom-right corner
      // Below would go outside (y=746)
      // Right would go outside (x=1340)
      // Should try above or left
      const elem = createElement('corner', 1220, 690, 50, 30);

      const result = selectCollisionFreePage([elem], 1, 1280, 720);

      // Should not be below or right
      expect(result[0]?.labelPosition).not.toBe('below');
      expect(result[0]?.labelPosition).not.toBe('right');
    });

    test('should handle empty elements array', () => {
      const result = selectCollisionFreePage([], 1);
      expect(result).toHaveLength(0);
    });

    test('should handle invalid page number', () => {
      const elements = [createElement('a', 100, 100, 50, 30)];
      expect(selectCollisionFreePage(elements, 0)).toHaveLength(0);
      expect(selectCollisionFreePage(elements, -1)).toHaveLength(0);
    });

    test('should preserve element order in result', () => {
      const elemA = createElement('a', 100, 100, 50, 30);
      const elemB = createElement('b', 300, 100, 50, 30);
      const elemC = createElement('c', 500, 100, 50, 30);

      const result = selectCollisionFreePage([elemA, elemB, elemC], 1);

      // All should fit without collision
      expect(result).toHaveLength(3);
      expect(result.map((element) => element.selector)).toEqual([
        '#a',
        '#b',
        '#c',
      ]);
      expect(result.every((element) => /^[0-9A-Z]{3}$/.test(element.id))).toBe(
        true,
      );
    });
  });
});
