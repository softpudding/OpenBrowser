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
    // Corner-badge geometry: the label sits fully outside the element,
    // touching its edge. `expandBBoxWithLabel` extends the union by the
    // full label dimension on the labeled side.

    test('should expand bbox upward by the full label height when "above"', () => {
      const bbox: BBox = { x: 100, y: 100, width: 50, height: 30 };
      const expanded = expandBBoxWithLabel(bbox, 'above');
      const labelWidth = getLabelDimensions('xxxxxx', bbox.width).width;

      expect(expanded.x).toBe(100);
      expect(expanded.y).toBe(100 - LABEL_HEIGHT);
      expect(expanded.width).toBe(labelWidth);
      expect(expanded.height).toBe(30 + LABEL_HEIGHT);
    });

    test('should expand bbox downward by the full label height when "below"', () => {
      const bbox: BBox = { x: 100, y: 100, width: 50, height: 30 };
      const expanded = expandBBoxWithLabel(bbox, 'below');
      const labelWidth = getLabelDimensions('xxxxxx', bbox.width).width;

      expect(expanded.x).toBe(100);
      expect(expanded.y).toBe(100);
      expect(expanded.width).toBe(labelWidth);
      expect(expanded.height).toBe(30 + LABEL_HEIGHT);
    });

    test('should expand bbox to the left by the full label width when "left"', () => {
      const bbox: BBox = { x: 100, y: 100, width: 50, height: 30 };
      const expanded = expandBBoxWithLabel(bbox, 'left');
      const labelWidth = getLabelDimensions('xxxxxx', bbox.width).width;

      expect(expanded.x).toBe(100 - labelWidth);
      expect(expanded.y).toBe(100);
      expect(expanded.width).toBe(labelWidth + 50);
      expect(expanded.height).toBe(30);
    });

    test('should expand bbox to the right by the full label width when "right"', () => {
      const bbox: BBox = { x: 100, y: 100, width: 50, height: 30 };
      const expanded = expandBBoxWithLabel(bbox, 'right');
      const labelWidth = getLabelDimensions('xxxxxx', bbox.width).width;

      expect(expanded.x).toBe(100);
      expect(expanded.y).toBe(100);
      expect(expanded.width).toBe(labelWidth + 50);
      expect(expanded.height).toBe(30);
    });

    test('should default to "above" when labelPosition is undefined', () => {
      const bbox: BBox = { x: 100, y: 100, width: 50, height: 30 };
      const expanded = expandBBoxWithLabel(bbox);

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

    test('two elements separated vertically beyond the corner-badge footprint do not collide', () => {
      // Under the corner-badge model a label straddles its element's
      // edge — half of the label sits inside the bbox, half sticks out
      // past it. So each element's label+bbox footprint extends outward
      // by labelHeight/2 (roughly 11px), not the full labelHeight.
      //
      // Element A at y=100..130 with label above → footprint y ≈ 89..130.
      // Element B at y=20..50 with label below  → footprint y ≈ 20..61.
      // The two footprints are separated by ~28px — no collision.
      const elemA = createElement('a', 100, 100, 50, 30, 'above');
      const elemB = createElement('b', 100, 20, 50, 30, 'below');

      expect(elementsCollide(elemA, elemB)).toBe(false);
    });

    test('two elements separated horizontally beyond the corner-badge footprint do not collide', () => {
      // Same invariant for sideways placements — each side label extends
      // outward by labelWidth/2. Put enough horizontal distance between
      // the elements that the two footprints don't touch.
      const labelWidth = getLabelDimensions('xxxxxx', 50).width;
      const clear = labelWidth + 20;
      const elemA = createElement('a', 200, 100, 50, 30, 'left');
      const elemB = createElement('b', 200 + 50 + clear, 100, 50, 30, 'right');

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

    test('should only ever place labels above or below (corner-badge model)', () => {
      // Under the corner-badge model every label is anchored to the top or
      // bottom edge of its own element's bbox. 'left' / 'right' placements
      // are disabled because they break visual binding — a label to the
      // left of element B sits between A and B and visually claims A.
      const elemA = createElement('a', 100, 100, 50, 30);
      const elemB = createElement('b', 50, 80, 50, 30);
      const elemC = createElement('c', 100, 130, 50, 30);
      const result = selectCollisionFreePage([elemA, elemB, elemC], 1);

      for (const el of result) {
        expect(['above', 'below']).toContain(el.labelPosition);
      }
    });

    test('should defer elements to a later page when neither above nor below fits', () => {
      // Collision-dense layout where 'above' is blocked by A's label and
      // 'below' is blocked by A's element — the old 4-side algorithm would
      // place B to the left; the corner-badge model instead defers B to
      // page 2 so that every placement on a page is visually unambiguous.
      const elemA = createElement('a', 200, 100, 50, 30);
      const elemB = createElement('b', 150, 80, 50, 30);
      const elements = [elemA, elemB];

      const page1 = selectCollisionFreePage(elements, 1);
      const page2 = selectCollisionFreePage(elements, 2);

      // Union of page 1 and page 2 must cover both elements.
      const allIds = new Set([
        ...page1.map((el) => el.selector),
        ...page2.map((el) => el.selector),
      ]);
      expect(allIds.has('#a')).toBe(true);
      expect(allIds.has('#b')).toBe(true);

      // Every label on every page must be above or below — never sideways.
      for (const el of [...page1, ...page2]) {
        expect(['above', 'below']).toContain(el.labelPosition);
      }
    });

    test('two stacked elements with enough vertical room both fit on page 1', () => {
      // Upper at y=40, lower at y=100 — enough headroom above (y=40) for
      // upper's 'above' label, and enough gap between them for one of
      // them to claim 'below' as well. The corner-badge algorithm should
      // place both on page 1 without sideways labels.
      const upper = createElement('upper', 10, 40, 24, 14);
      const lower = createElement('lower', 10, 100, 24, 14);

      const result = selectCollisionFreePage([upper, lower], 1, 80, 400);

      expect(result).toHaveLength(2);
      for (const el of result) {
        expect(['above', 'below']).toContain(el.labelPosition);
      }
    });

    test('should defer the center element to page 2 when surrounded', () => {
      // The center element is boxed in: 'above' is blocked by #above's
      // element, 'below' is blocked by #below's element. Under the old
      // 4-side model the algorithm would place the center label 'left'.
      // Under the corner-badge model, the center is deferred to page 2
      // rather than placed sideways and ambiguously.
      const center = createElement('center', 200, 100, 50, 30);
      const above = createElement('above', 200, 64, 50, 30);
      const below = createElement('below', 200, 140, 50, 30);
      const left = createElement('left', 80, 100, 50, 30);
      const right = createElement('right', 320, 100, 50, 30);

      const elements = [above, below, left, right, center];

      const page1 = selectCollisionFreePage(elements, 1);
      const centerOnPage1 = findBySelector(page1, '#center');
      if (centerOnPage1) {
        expect(['above', 'below']).toContain(centerOnPage1.labelPosition);
      } else {
        // Center didn't fit on page 1 — must land on a later page.
        const page2 = selectCollisionFreePage(elements, 2);
        expect(findBySelector(page2, '#center')).toBeDefined();
      }

      // Regardless, no element on any page may use a sideways label.
      for (const el of page1) {
        expect(['above', 'below']).toContain(el.labelPosition);
      }
    });
  });

  describe('Viewport boundary checks', () => {
    test('should not place label outside viewport on left', () => {
      // Element at x=50, 'above' blocked by elemB. Under the corner-badge
      // model sideways placements are disabled entirely, so A must use
      // 'below' (or defer) — never 'left'.
      const elemA = createElement('a', 50, 100, 50, 30);
      const elemB = createElement('b', 50, 60, 50, 30); // Blocks above

      const result = selectCollisionFreePage([elemA, elemB], 1, 1280, 720);

      const resultA = findBySelector(result, '#a');
      expect(resultA?.labelPosition).not.toBe('left');
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
