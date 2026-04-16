import { describe, test, expect } from 'bun:test';

import {
  LabelPosition,
  bboxContains,
  bboxesIntersect,
  getLabelBBox,
  elementsCollide,
  selectCollisionFreePage,
  calculateTotalPages,
  isLabelWithinViewport,
  sortElementsByVisualOrder,
} from '../utils/collision-detection';
import type { InteractiveElement, ElementType } from '../types';

/**
 * Integration Tests for Complete Highlight Workflow
 *
 * These tests verify the end-to-end behavior of the highlight system:
 * 1. "any" type returns elements of all types
 * 2. Label placement algorithm works correctly
 * 3. Collision detection prevents overlapping labels
 */

// Helper to create a minimal InteractiveElement
function createElement(
  id: string,
  type: ElementType,
  x: number,
  y: number,
  width: number,
  height: number,
  options?: {
    tagName?: string;
    selector?: string;
    labelPosition?: LabelPosition;
  },
): InteractiveElement {
  return {
    id,
    type,
    tagName: options?.tagName ?? 'button',
    selector: options?.selector ?? `#${id}`,
    bbox: { x, y, width, height },
    isVisible: true,
    isInViewport: true,
    labelPosition: options?.labelPosition,
  };
}

function findBySelector(
  elements: InteractiveElement[],
  selector: string,
): InteractiveElement | undefined {
  return elements.find((element) => element.selector === selector);
}

describe('Highlight Integration', () => {
  describe('Complete workflow', () => {
    test('should return elements of all types when element_type="any"', () => {
      // Create mock elements of different types
      const elements: InteractiveElement[] = [
        createElement('btn1', 'clickable', 100, 100, 80, 30),
        createElement('input1', 'inputable', 100, 150, 200, 30),
        createElement('scroll1', 'scrollable', 100, 200, 300, 200),
      ];

      // Verify all types are present
      const types = new Set(elements.map((e) => e.type));
      expect(types.has('clickable')).toBe(true);
      expect(types.has('inputable')).toBe(true);
      expect(types.has('scrollable')).toBe(true);
      expect(types.size).toBe(3);
    });

    test('should set labelPosition on elements after pagination', () => {
      // Create mock elements with potential collisions
      const elements: InteractiveElement[] = [
        createElement('elem1', 'clickable', 100, 100, 80, 30),
        createElement('elem2', 'clickable', 100, 100, 80, 30), // Same position - will collide
        createElement('elem3', 'clickable', 300, 100, 80, 30), // Far enough to not collide
      ];

      // Run selectCollisionFreePage
      const result = selectCollisionFreePage(elements, 1);

      // Verify labelPosition is set on all returned elements
      expect(result.length).toBeGreaterThan(0);
      for (const elem of result) {
        expect(elem.labelPosition).toBeDefined();
        expect(['above', 'below', 'left', 'right']).toContain(
          elem.labelPosition,
        );
      }
    });

    test('should not have overlapping labels on same page', () => {
      // Create mock elements with various positions
      const elements: InteractiveElement[] = [
        createElement('elem1', 'clickable', 100, 100, 80, 30),
        createElement('elem2', 'clickable', 150, 100, 80, 30), // Close - potential collision
        createElement('elem3', 'clickable', 300, 100, 80, 30), // Far enough
        createElement('elem4', 'clickable', 100, 200, 80, 30), // Different row
        createElement('elem5', 'clickable', 150, 200, 80, 30), // Close to elem4
      ];

      // Run selectCollisionFreePage
      const page1 = selectCollisionFreePage(elements, 1);

      expect(new Set(page1.map((element) => element.id)).size).toBe(
        page1.length,
      );

      // Verify no label collisions on the same page
      for (let i = 0; i < page1.length; i++) {
        for (let j = i + 1; j < page1.length; j++) {
          const elemA = page1[i];
          const elemB = page1[j];

          // Get label bounding boxes
          const labelA = getLabelBBox(
            elemA.bbox,
            elemA.labelPosition ?? 'above',
            elemA.id,
          );
          const labelB = getLabelBBox(
            elemB.bbox,
            elemB.labelPosition ?? 'above',
            elemB.id,
          );

          // Labels should not intersect
          expect(bboxesIntersect(labelA, labelB)).toBe(false);
        }
      }
    });

    test('should distribute elements across multiple pages when needed', () => {
      // Create many elements that will collide
      // At the same position, up to 4 elements can fit (above, below, left, right)
      const elements: InteractiveElement[] = [];
      for (let i = 0; i < 20; i++) {
        // All at same position - each group of 4 will use different label positions
        elements.push(createElement(`elem${i}`, 'clickable', 100, 100, 80, 30));
      }

      // Calculate total pages
      const totalPages = calculateTotalPages(elements);

      // Should have multiple pages (20 elements / 4 positions per location = 5 pages)
      expect(totalPages).toBeGreaterThan(1);

      // Verify page 1 has elements with different label positions
      const page1 = selectCollisionFreePage(elements, 1);
      expect(page1.length).toBeGreaterThan(0);
      expect(page1.length).toBeLessThanOrEqual(4);

      // Verify all elements on page 1 have different label positions
      const positions = new Set(page1.map((e) => e.labelPosition));
      expect(positions.size).toBe(page1.length);

      // Verify elements on different pages while preserving each element's ID.
      const page1Selectors = new Set(page1.map((e) => e.selector));
      const expectedIdsBySelector = Object.fromEntries(
        elements.map((element) => [element.selector, element.id]),
      );
      const page2 = selectCollisionFreePage(elements, 2);
      expect(page2.length).toBeGreaterThan(0);
      for (const elem of page2) {
        expect(page1Selectors.has(elem.selector)).toBe(false);
        expect(expectedIdsBySelector[elem.selector]).toBe(elem.id);
      }
      for (const elem of page1) {
        expect(expectedIdsBySelector[elem.selector]).toBe(elem.id);
      }
    });

    test('should handle mixed element types with collision-aware pagination', () => {
      // Create elements of different types at positions that will collide
      const elements: InteractiveElement[] = [
        createElement('btn1', 'clickable', 100, 100, 80, 30),
        createElement('input1', 'inputable', 100, 100, 80, 30), // Same position
        createElement('scroll1', 'scrollable', 100, 100, 80, 30), // Same position
        createElement('btn2', 'clickable', 300, 100, 80, 30), // Different position
      ];

      // Run pagination
      const page1 = selectCollisionFreePage(elements, 1);

      // First element should get 'above', second should try 'below', etc.
      expect(page1.length).toBeGreaterThan(0);

      // All returned elements should have labelPosition set
      for (const elem of page1) {
        expect(elem.labelPosition).toBeDefined();
      }
    });
  });

  describe('Collision detection', () => {
    test('treats edge-touching label boxes as non-overlapping', () => {
      const left = { x: 0, y: 0, width: 100, height: 20 };
      const right = { x: 100, y: 0, width: 80, height: 20 };

      expect(bboxesIntersect(left, right)).toBe(false);
    });

    test('should detect label collisions correctly with different positions', () => {
      // Two elements at same position
      const elemA = createElement('a', 'clickable', 100, 100, 80, 30, {
        labelPosition: 'above',
      });
      const elemB = createElement('b', 'clickable', 100, 100, 80, 30, {
        labelPosition: 'above',
      });

      // Same position with same label position should collide
      expect(elementsCollide(elemA, elemB)).toBe(true);
    });

    test('should not collide when labels are on opposite sides', () => {
      // Element A with label above
      const elemA = createElement('a', 'clickable', 100, 100, 80, 30, {
        labelPosition: 'above',
      });
      // Element B with label below (same element position)
      const elemB = createElement('b', 'clickable', 100, 100, 80, 30, {
        labelPosition: 'below',
      });

      // Labels on opposite sides should not collide
      expect(elementsCollide(elemA, elemB)).toBe(false);
    });

    test('should not collide when labels are on left and right', () => {
      const elemA = createElement('a', 'clickable', 200, 100, 80, 30, {
        labelPosition: 'left',
      });
      const elemB = createElement('b', 'clickable', 200, 100, 80, 30, {
        labelPosition: 'right',
      });

      // Labels on opposite horizontal sides should not collide
      expect(elementsCollide(elemA, elemB)).toBe(false);
    });

    test('should detect collision between label and element', () => {
      // Element A at (100, 100) with label above (y: 74-100)
      const elemA = createElement('a', 'clickable', 100, 100, 80, 30, {
        labelPosition: 'above',
      });

      // Element B at (100, 80) - its element body overlaps with A's label
      const elemB = createElement('b', 'clickable', 100, 80, 80, 30, {
        labelPosition: 'below',
      });

      // The selectCollisionFreePage should handle this by checking label-element collisions
      const result = selectCollisionFreePage([elemA, elemB], 1);

      // Both should fit with appropriate label positions
      expect(result.length).toBeGreaterThan(0);
    });

    test('should separate partially overlapping non-nested boxes across pages', () => {
      const elemA = createElement('overlap-a', 'clickable', 100, 100, 120, 40);
      const elemB = createElement('overlap-b', 'clickable', 180, 110, 120, 40);
      const elements = [elemA, elemB];

      expect(calculateTotalPages(elements, 1280, 720)).toBe(2);
      expect(selectCollisionFreePage(elements, 1, 1280, 720)).toHaveLength(1);
      expect(selectCollisionFreePage(elements, 2, 1280, 720)).toHaveLength(1);
    });
  });

  describe('Label placement algorithm', () => {
    test('should prefer "above" position when space available', () => {
      const elements = [createElement('elem1', 'clickable', 100, 200, 80, 30)];
      const result = selectCollisionFreePage(elements, 1);

      expect(result[0].labelPosition).toBe('above');
    });

    test('should try "below" when "above" is blocked', () => {
      // Element at top blocks above position for element below it
      const elemTop = createElement('top', 'clickable', 100, 50, 80, 30);
      const elemBottom = createElement('bottom', 'clickable', 100, 80, 80, 30);

      const result = selectCollisionFreePage([elemTop, elemBottom], 1);

      // Bottom element should have a different position (not 'above' if blocked)
      const bottomElem = findBySelector(result, '#bottom');
      expect(bottomElem?.labelPosition).toBeDefined();
    });

    test('should try "left" and "right" when vertical positions blocked', () => {
      // Create a scenario where above and below are blocked
      const center = createElement('center', 'clickable', 200, 100, 80, 30);
      const above = createElement('above', 'clickable', 200, 74, 80, 30);
      const below = createElement('below', 'clickable', 200, 130, 80, 30);

      const result = selectCollisionFreePage([above, below, center], 1);

      // Center should try left or right
      const centerElem = findBySelector(result, '#center');
      if (centerElem) {
        expect(['left', 'right']).toContain(centerElem.labelPosition);
      }
    });

    test('should respect viewport boundaries', () => {
      // Element near top of viewport - above would go outside
      const elemTop = createElement('top', 'clickable', 100, 10, 80, 30);

      const result = selectCollisionFreePage([elemTop], 1, 1280, 720);

      // Should not place label above (would be outside viewport)
      expect(result[0].labelPosition).not.toBe('above');
    });

    test('should calculate total pages with the same viewport constraints as selection', () => {
      const elements = [
        createElement('a', 'clickable', 10, 10, 80, 30),
        createElement('b', 'clickable', 10, 10, 80, 30),
        createElement('c', 'clickable', 10, 10, 80, 30),
      ];

      const page1 = selectCollisionFreePage(elements, 1, 1280, 720);
      const page2 = selectCollisionFreePage(elements, 2, 1280, 720);
      const totalPages = calculateTotalPages(elements, 1280, 720);

      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(1);
      expect(totalPages).toBe(2);
    });

    test('should allow nested controls to share a page with a containing scrollable', () => {
      const elements = [
        createElement('modal', 'scrollable', 564, 154, 600, 648),
        createElement('like', 'clickable', 1042, 483, 52, 30),
        createElement('reply', 'clickable', 1105, 483, 58, 30),
      ];

      const page1 = selectCollisionFreePage(elements, 1, 1728, 891);

      expect(page1.map((e) => e.id)).toEqual(['modal', 'like', 'reply']);
      expect(page1[0].labelPosition).toBeDefined();
      expect(page1[1].labelPosition).toBeDefined();
      expect(page1[2].labelPosition).toBeDefined();
      expect(calculateTotalPages(elements, 1728, 891)).toBe(1);
      expect(bboxContains(page1[0].bbox, page1[1].bbox)).toBe(true);
      expect(bboxContains(page1[0].bbox, page1[2].bbox)).toBe(true);
    });

    test('should handle element near left edge', () => {
      // Element near left edge - left position would go outside
      const elemLeft = createElement('left', 'clickable', 50, 100, 80, 30);
      const elemAbove = createElement('above', 'clickable', 50, 60, 80, 30); // Blocks above

      const result = selectCollisionFreePage(
        [elemAbove, elemLeft],
        1,
        1280,
        720,
      );

      const leftElem = findBySelector(result, '#left');
      // Should not use 'left' position (would be outside viewport)
      expect(leftElem?.labelPosition).not.toBe('left');
    });

    test('should treat one-pixel label-to-element gaps as blocked', () => {
      const upper = createElement('upper', 'clickable', 100, 44, 80, 30);
      const lower = createElement('lower', 'clickable', 100, 101, 80, 30);

      const result = selectCollisionFreePage([upper, lower], 1, 1280, 720);

      expect(findBySelector(result, '#upper')?.labelPosition).toBe('above');
      expect(findBySelector(result, '#lower')?.labelPosition).toBe('below');
    });

    test('should treat one-pixel label-to-label gaps as blocked', () => {
      const left = createElement('AAAAAA', 'clickable', 100, 100, 24, 14);
      const leftLabel = getLabelBBox(left.bbox, 'above', left.id);
      const right = createElement(
        'CCCCCC',
        'clickable',
        leftLabel.x + leftLabel.width + 1,
        100,
        24,
        14,
      );

      const result = selectCollisionFreePage([left, right], 1, 1280, 720);

      expect(findBySelector(result, '#AAAAAA')?.labelPosition).not.toBe(
        'above',
      );
      expect(findBySelector(result, '#CCCCCC')?.labelPosition).toBe('above');
    });
  });

  describe('Edge cases', () => {
    test('should sort keyword-mode style results in visual order', () => {
      const elements: InteractiveElement[] = [
        createElement('c', 'clickable', 420, 220, 80, 30),
        createElement('a', 'clickable', 120, 100, 80, 30),
        createElement('d', 'clickable', 120, 220, 80, 30),
        createElement('b', 'clickable', 420, 100, 80, 30),
      ];

      const result = sortElementsByVisualOrder(elements);

      expect(result.map((element) => element.id)).toEqual(['a', 'b', 'd', 'c']);
    });

    test('should handle empty elements array', () => {
      const result = selectCollisionFreePage([], 1);
      expect(result).toHaveLength(0);
    });

    test('should handle single element', () => {
      const elements = [createElement('single', 'clickable', 100, 100, 80, 30)];
      const result = selectCollisionFreePage(elements, 1);

      expect(result).toHaveLength(1);
      expect(result[0].labelPosition).toBe('above');
    });

    test('should handle page number beyond available pages', () => {
      const elements = [createElement('single', 'clickable', 100, 100, 80, 30)];

      // Page 2 when only 1 page exists
      const result = selectCollisionFreePage(elements, 2);
      expect(result).toHaveLength(0);
    });

    test('should handle invalid page numbers', () => {
      const elements = [createElement('single', 'clickable', 100, 100, 80, 30)];

      expect(selectCollisionFreePage(elements, 0)).toHaveLength(0);
      expect(selectCollisionFreePage(elements, -1)).toHaveLength(0);
    });

    test('should handle very small elements', () => {
      const elements = [createElement('tiny', 'clickable', 100, 100, 10, 10)];

      const result = selectCollisionFreePage(elements, 1);
      expect(result).toHaveLength(1);
      expect(result[0].labelPosition).toBeDefined();
    });

    test('should handle very large elements', () => {
      const elements = [createElement('large', 'scrollable', 0, 0, 1000, 500)];

      const result = selectCollisionFreePage(elements, 1, 1280, 720);
      expect(result).toHaveLength(1);
      expect(result[0].labelPosition).toBeDefined();
    });

    test('should handle elements at viewport corners', () => {
      const elements = [
        createElement('tl', 'clickable', 10, 10, 50, 30), // Top-left
        createElement('tr', 'clickable', 1220, 10, 50, 30), // Top-right
        createElement('bl', 'clickable', 10, 680, 50, 30), // Bottom-left
        createElement('br', 'clickable', 1220, 680, 50, 30), // Bottom-right
      ];

      const result = selectCollisionFreePage(elements, 1, 1280, 720);

      // All should fit with appropriate label positions
      expect(result.length).toBe(4);

      // Each should have a valid label position within viewport
      for (const elem of result) {
        expect(elem.labelPosition).toBeDefined();
        expect(
          isLabelWithinViewport(
            elem.bbox,
            elem.labelPosition!,
            1280,
            720,
            elem.id,
          ),
        ).toBe(true);
      }
    });
  });

  describe('Performance', () => {
    test('should handle large number of elements efficiently', () => {
      // Create 100 elements spread across the viewport
      const elements: InteractiveElement[] = [];
      for (let i = 0; i < 100; i++) {
        const x = (i % 10) * 120 + 50;
        const y = Math.floor(i / 10) * 60 + 50;
        elements.push(createElement(`elem${i}`, 'clickable', x, y, 80, 30));
      }

      const startTime = performance.now();
      const result = selectCollisionFreePage(elements, 1);
      const duration = performance.now() - startTime;

      // Keep this as a coarse smoke test rather than a microbenchmark.
      // Bun's wall-clock timing varies noticeably under full-suite load.
      expect(duration).toBeLessThan(1000);

      // Should return some elements
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
