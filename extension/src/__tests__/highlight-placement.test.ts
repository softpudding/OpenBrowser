import { describe, test, expect } from 'bun:test';

// Import constants and functions from the collision detection module
import {
  LABEL_HEIGHT,
  BBox,
  expandBBoxWithLabel,
  elementsCollide,
  getLabelBBox,
  selectCollisionFreePage,
} from '../utils/collision-detection';
import type { InteractiveElement } from '../types';
import { generateShortHash } from '../commands/element-id';
import { getLabelDimensions } from '../utils/label-geometry';

/**
 * Tests for corner-badge label placement.
 *
 * Invariants:
 *   - Labels are anchored to the top edge of the element (or bottom edge
 *     when 'above' would leave the viewport).
 *   - Labels may shift horizontally within the element's x-range to
 *     avoid collisions, but MUST stay inside [bbox.x, bbox.x+bbox.width
 *     - labelWidth] whenever the element is wide enough. Narrow
 *     elements (labelWidth > bbox.width) always use xOffset=0 and may
 *     extend past the element edges.
 *   - When no horizontal offset on 'above' fits, the element is
 *     deferred to a later highlight page rather than flipping sides.
 */

// Helper to create a minimal InteractiveElement
function createElement(
  selectorName: string,
  x: number,
  y: number,
  width: number,
  height: number,
  labelPosition?: 'above' | 'below',
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
      // Expanded footprint spans the union of bbox and label x-ranges.
      expect(expanded.width).toBe(Math.max(bbox.width, labelWidth));
      expect(expanded.height).toBe(30 + LABEL_HEIGHT);
    });

    test('should expand bbox downward by the full label height when "below"', () => {
      const bbox: BBox = { x: 100, y: 100, width: 50, height: 30 };
      const expanded = expandBBoxWithLabel(bbox, 'below');
      const labelWidth = getLabelDimensions('xxxxxx', bbox.width).width;

      expect(expanded.x).toBe(100);
      expect(expanded.y).toBe(100);
      expect(expanded.width).toBe(Math.max(bbox.width, labelWidth));
      expect(expanded.height).toBe(30 + LABEL_HEIGHT);
    });

    test('xOffset shifts the label horizontally within the element x-range', () => {
      // A wide element with slack between labelWidth and bbox.width can
      // take a non-zero xOffset. The shifted label's x-range must stay
      // within the element's x-range.
      const bbox: BBox = { x: 100, y: 100, width: 300, height: 30 };
      const labelWidth = getLabelDimensions('xxxxxx', bbox.width).width;
      const slack = bbox.width - labelWidth;
      const expanded = expandBBoxWithLabel(bbox, 'above', 'xxxxxx', slack);

      // Expanded footprint still starts at bbox.x (element x-range anchor)
      // and widths out to at most bbox.width.
      expect(expanded.x).toBe(bbox.x);
      expect(expanded.width).toBe(bbox.width);
    });

    test('label never drifts past element x-range when element is wide enough', () => {
      // Even if the caller asks for an xOffset past the slack, getLabelBBox
      // clamps so the label x-range stays inside [bbox.x, bbox.x+bbox.width].
      const bbox: BBox = { x: 100, y: 100, width: 300, height: 30 };
      const labelWidth = getLabelDimensions('xxxxxx', bbox.width).width;
      const overshot = getLabelBBox(bbox, 'above', 'xxxxxx', 9999);

      expect(overshot.x).toBe(bbox.x + (bbox.width - labelWidth));
      expect(overshot.x + overshot.width).toBe(bbox.x + bbox.width);
    });

    test('narrow element (label wider than bbox) forces xOffset=0', () => {
      // When labelWidth > bbox.width, the label unavoidably extends past
      // the element's edge; the clamp forces xOffset=0 regardless of
      // what the caller requests. This is the only scenario in which the
      // label is allowed outside the element x-range.
      const bbox: BBox = { x: 100, y: 100, width: 10, height: 14 };
      const attempted = getLabelBBox(bbox, 'above', 'xxxxxx', 500);

      expect(attempted.x).toBe(bbox.x);
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

    test('two horizontally-adjacent elements with room between labels do not collide', () => {
      // Place two elements far enough apart horizontally that their
      // 'above' labels (left-aligned, xOffset=0) do not touch.
      const labelWidth = getLabelDimensions('xxxxxx', 50).width;
      const gap = labelWidth + 20;
      const elemA = createElement('a', 0, 100, 50, 30, 'above');
      const elemB = createElement('b', labelWidth + gap, 100, 50, 30, 'above');

      expect(elementsCollide(elemA, elemB)).toBe(false);
    });
  });

  describe('Position priority - Greedy algorithm', () => {
    test('viewport-top element uses "below" while interior element uses "above"', () => {
      // Label binding invariant: labels ALWAYS sit at the top-left of
      // their element's bbox ('above'), except when the element is so
      // close to the viewport top that 'above' would be clipped. Only
      // that specific viewport-clip case may fall back to 'below'.
      const flexible = createElement('flexible', 100, 100, 50, 30);
      const constrained = createElement('constrained', 10, 10, 20, 14);

      const result = selectCollisionFreePage(
        [flexible, constrained],
        1,
        200,
        200,
      );

      expect(result).toHaveLength(2);
      // 'constrained' is at y=10 — 'above' clips the viewport top.
      expect(findBySelector(result, '#constrained')?.labelPosition).toBe(
        'below',
      );
      // 'flexible' has plenty of space above → 'above'.
      expect(findBySelector(result, '#flexible')?.labelPosition).toBe('above');
    });

    test('should place label above when space available (default)', () => {
      // Single element with plenty of space above
      const elements = [createElement('a', 100, 200, 50, 30)];
      const result = selectCollisionFreePage(elements, 1);

      expect(result).toHaveLength(1);
      expect(result[0].labelPosition).toBe('above');
    });

    test('colliding "above" labels defer one element to a later page (no side-flip)', () => {
      // Two elements at the same position both prefer 'above'. The
      // label binding invariant forbids side-flipping on collision —
      // only one element may take 'above' on this page; the other is
      // deferred rather than placed 'below'. This keeps the rule
      // "label is directly above the element it labels" universally
      // readable.
      const elemA = createElement('a', 100, 100, 50, 30);
      const elemB = createElement('b', 100, 100, 50, 30);
      const elements = [elemA, elemB];

      const page1 = selectCollisionFreePage(elements, 1);
      const page2 = selectCollisionFreePage(elements, 2);

      expect(page1).toHaveLength(1);
      expect(page1[0].labelPosition).toBe('above');
      expect(page2).toHaveLength(1);
      expect(page2[0].labelPosition).toBe('above');
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

    test('center element surrounded above and below eventually gets placed', () => {
      // Under the corner-badge model:
      //   - 'left' / 'right' sideways placements are disabled.
      //   - 'above' collides with the `above` element via bbox-vs-label check
      //     when the above element is already selected on the same page.
      //   - 'below' likewise collides with `below`.
      // Result: center is deferred to a later page where the vertical
      // neighbors no longer share the same page, letting it take one of
      // 'above' or 'below'.
      const center = createElement('center', 200, 100, 50, 30);
      const above = createElement('above', 200, 64, 50, 30);
      const below = createElement('below', 200, 140, 50, 30);
      const left = createElement('left', 80, 100, 50, 30);
      const right = createElement('right', 320, 100, 50, 30);

      const elements = [above, below, left, right, center];

      const page1 = selectCollisionFreePage(elements, 1);
      const page2 = selectCollisionFreePage(elements, 2);
      const page3 = selectCollisionFreePage(elements, 3);

      // Center lands on some page (not necessarily page 1).
      const centerPlaced =
        findBySelector(page1, '#center') ??
        findBySelector(page2, '#center') ??
        findBySelector(page3, '#center');
      expect(centerPlaced).toBeDefined();
      expect(['above', 'below']).toContain(centerPlaced?.labelPosition);

      // Every placed element uses a corner-badge (above/below) placement.
      for (const el of [...page1, ...page2, ...page3]) {
        expect(['above', 'below']).toContain(el.labelPosition);
      }
    });
  });

  describe('Viewport boundary checks', () => {
    test('should not place label above viewport (y < 0)', () => {
      // Element at y=10, label height=LABEL_HEIGHT.
      // Label above would be at y=10-LABEL_HEIGHT (outside viewport).
      // Should use 'below' instead.
      const elemA = createElement('a', 100, 10, 50, 30);

      const result = selectCollisionFreePage([elemA], 1, 1280, 720);

      expect(result[0]?.labelPosition).toBe('below');
    });
  });

  describe('Horizontal shift to clear collisions', () => {
    test('adjacent elements with tight label clearance both fit via xOffset shift', () => {
      // Adjacent bboxes (touching at a shared edge) where default
      // left-aligned labels would fail the VISUAL_LABEL_CLEARANCE_PX
      // check. Each element has just enough slack (bbox.width -
      // labelWidth) that shifting one label right along its top edge
      // opens the required clearance gap — so both fit on page 1
      // without deferring, and each label's x-range stays strictly
      // inside its own element's x-range.
      const longId = 'AAAAAAAAAAA'; // caps labelWidth at MAX_LABEL_WIDTH=80
      const labelWidth = getLabelDimensions(longId, 83).width;
      // Pick bbox.width = labelWidth + 3 so slack=3 is exactly enough
      // to clear the 3px clearance deficit at offset=0.
      const bboxWidth = labelWidth + 3;
      const elemA: InteractiveElement = {
        ...createElement('a', 0, 100, bboxWidth, 30),
        id: longId,
      };
      const elemB: InteractiveElement = {
        ...createElement('b', bboxWidth, 100, bboxWidth, 30),
        id: longId,
      };

      const page1 = selectCollisionFreePage([elemA, elemB], 1, 1280, 720);

      expect(page1).toHaveLength(2);
      for (const el of page1) {
        expect(el.labelPosition).toBe('above');
        // Label x-range must stay within the element's x-range.
        const lbl = getLabelBBox(el.bbox, 'above', el.id, el.labelXOffset ?? 0);
        expect(lbl.x).toBeGreaterThanOrEqual(el.bbox.x);
        expect(lbl.x + lbl.width).toBeLessThanOrEqual(
          el.bbox.x + el.bbox.width,
        );
      }
      // At least one label was shifted off the default left-aligned
      // origin; otherwise the clearance check would still fail.
      const shiftedCount = page1.filter(
        (el) => (el.labelXOffset ?? 0) > 0,
      ).length;
      expect(shiftedCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Edge cases', () => {
    test('should handle element at viewport corner (top-left)', () => {
      // Element near top-left. 'above' would leave the viewport, so
      // 'below' must be used.
      const elem = createElement('corner', 10, 10, 50, 30);

      const result = selectCollisionFreePage([elem], 1, 1280, 720);

      expect(result[0]?.labelPosition).toBe('below');
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
