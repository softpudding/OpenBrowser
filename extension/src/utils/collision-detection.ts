/**
 * Collision Detection Utilities for Element Highlighting
 *
 * This module contains pure functions for collision detection and pagination
 * that can be tested independently of Chrome APIs.
 */

import type { InteractiveElement } from '../types';
import {
  LABEL_FONT_SIZE,
  LABEL_PADDING,
  LABEL_HEIGHT,
  MAX_LABEL_WIDTH,
} from '../commands/label-constants';
import { getLabelDimensions } from './label-geometry';

export { LABEL_FONT_SIZE, LABEL_PADDING, LABEL_HEIGHT, MAX_LABEL_WIDTH };

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type LabelPosition = 'above' | 'below';

export interface Placement {
  position: LabelPosition;
  // Pixels shifted to the right from bbox.x. Always clamped to
  // [0, max(0, bbox.width - labelWidth)] so the label never drifts past
  // the element's x-range when the element is wide enough to contain it.
  // Narrow elements (labelWidth > bbox.width) always use xOffset=0 and
  // may extend past the element edges — unavoidable and unchanged from
  // pre-shift behavior.
  xOffset: number;
}

const VISUAL_ROW_TOLERANCE_PX = 12;
// Keep label-to-label and label-to-bbox spacing visibly separated in the
// rendered screenshot, not just geometrically non-overlapping.
const VISUAL_LABEL_CLEARANCE_PX = 6;
// Corner-badge placement: labels are anchored to the top or bottom edge of
// their element's bbox only. Side placements ('left' / 'right') were removed
// because they break visual binding — a label to the left of element B sits
// between A and B and reads as belonging to A (session 444122cb: "UHT"
// between Fundamental and Technical looked like it labeled Fundamental).
// Horizontal shift along the top/bottom edge is allowed (and searched by
// the planner) but the label's x-range must stay within the element's
// x-range, so the "directly above me" binding cue remains unambiguous.
// When no placement fits, the element is deferred to a later highlight
// page. `total_pages` absorbs the overflow; the system prompt tells the
// agent to sweep all pages.
const POSITION_PRIORITY: LabelPosition[] = ['above', 'below'];

interface RemainingCandidate {
  sourceIndex: number;
  element: InteractiveElement;
}

// Coarse spatial grid used to skip O(N) scans of `selected` and `remaining`
// when checking collisions. Cell size is a heuristic — large enough that most
// label rects touch only a couple of cells, small enough that a typical
// query returns far fewer than the full set.
const SPATIAL_INDEX_CELL_PX = 96;

class SelectedSpatialIndex {
  private cells = new Map<number, InteractiveElement[]>();

  add(element: InteractiveElement): void {
    const labelBBox = getLabelBBox(
      element.bbox,
      element.labelPosition ?? 'above',
      element.id,
      element.labelXOffset ?? 0,
    );
    const union = unionBBox(element.bbox, labelBBox);
    this.forEachCell(union, (key) => {
      let bucket = this.cells.get(key);
      if (!bucket) {
        bucket = [];
        this.cells.set(key, bucket);
      }
      // Avoid duplicate registration when a single element straddles cells we
      // visit out of order — the per-call dedup Set in queryNear handles dup
      // results across cells.
      if (bucket[bucket.length - 1] !== element) {
        bucket.push(element);
      }
    });
  }

  // Register an element by its bbox only (no label). Used to index ALL
  // input elements so label placement can check against non-selected
  // neighbors too — a label covering an element that will appear on a
  // later highlight page still looks like an occlusion to the viewer.
  addBBoxOnly(element: InteractiveElement): void {
    this.forEachCell(element.bbox, (key) => {
      let bucket = this.cells.get(key);
      if (!bucket) {
        bucket = [];
        this.cells.set(key, bucket);
      }
      if (bucket[bucket.length - 1] !== element) {
        bucket.push(element);
      }
    });
  }

  // Returns elements whose registered union-rect lies in any cell touched by
  // the query rect (inflated by clearance on each side). Includes elements
  // whose registration cells are *adjacent* to the query rect — see
  // `queryNear` callers, which already inflate the query rect with clearance.
  queryNear(query: BBox): InteractiveElement[] {
    const seen = new Set<InteractiveElement>();
    const out: InteractiveElement[] = [];
    this.forEachCell(query, (key) => {
      const bucket = this.cells.get(key);
      if (!bucket) return;
      for (const el of bucket) {
        if (!seen.has(el)) {
          seen.add(el);
          out.push(el);
        }
      }
    });
    return out;
  }

  private forEachCell(rect: BBox, fn: (key: number) => void): void {
    // Real bboxes from getBoundingClientRect are always finite, but synthetic
    // test inputs or future callers might pass NaN/Infinity. Without this
    // guard Math.floor would yield NaN, the loop would skip, and we'd
    // silently drop a registration — masking real collisions.
    if (
      !Number.isFinite(rect.x) ||
      !Number.isFinite(rect.y) ||
      !Number.isFinite(rect.width) ||
      !Number.isFinite(rect.height)
    ) {
      // Single sentinel cell so the registration is still discoverable.
      fn(Number.MIN_SAFE_INTEGER);
      return;
    }
    const minCx = Math.floor(rect.x / SPATIAL_INDEX_CELL_PX);
    const maxCx = Math.floor(
      (rect.x + Math.max(0, rect.width)) / SPATIAL_INDEX_CELL_PX,
    );
    const minCy = Math.floor(rect.y / SPATIAL_INDEX_CELL_PX);
    const maxCy = Math.floor(
      (rect.y + Math.max(0, rect.height)) / SPATIAL_INDEX_CELL_PX,
    );
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        // Cantor-pair-ish key: cy gets the high bits, cx the low bits.
        // Negative coords are uncommon for label rects but still encode safely
        // because Math.floor preserves order under shift.
        fn(cy * 100000 + cx);
      }
    }
  }
}

function unionBBox(a: BBox, b: BBox): BBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const xMax = Math.max(a.x + a.width, b.x + b.width);
  const yMax = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: xMax - x, height: yMax - y };
}

function inflateBBox(rect: BBox, padding: number): BBox {
  return {
    x: rect.x - padding,
    y: rect.y - padding,
    width: rect.width + 2 * padding,
    height: rect.height + 2 * padding,
  };
}

interface PlacementEvaluation {
  position: LabelPosition;
  xOffset: number;
  blockedCandidateCount: number;
  totalFutureOptions: number;
}

/**
 * Check if two bounding boxes intersect
 * Boxes that touch at the edge are NOT considered as intersecting
 */
export function bboxesIntersect(a: BBox, b: BBox): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

function bboxesIntersectWithClearance(
  a: BBox,
  b: BBox,
  minClearancePx: number = 0,
): boolean {
  return !(
    a.x + a.width + minClearancePx <= b.x ||
    b.x + b.width + minClearancePx <= a.x ||
    a.y + a.height + minClearancePx <= b.y ||
    b.y + b.height + minClearancePx <= a.y
  );
}

export function bboxContains(outer: BBox, inner: BBox): boolean {
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.width >= inner.x + inner.width &&
    outer.y + outer.height >= inner.y + inner.height
  );
}

// Pixels of overlap on BOTH axes that count as a "real" partial overlap.
// Adjacent UI elements frequently share a 1-2 pixel border at their edges
// (tab strips, button groups, segmented controls) which produces a
// single-pixel bbox intersection that is a rendering artifact, not an
// occlusion. Without tolerance, such neighbors are marked mutually
// exclusive per highlight page — e.g. on finviz, Fundamental (x=754..852)
// and Technical (x=851..928) share 1px at x=851..852 and the planner
// used to defer Fundamental across multiple pages purely because of that.
const PARTIAL_OVERLAP_TOLERANCE_PX = 3;

function bboxesPartiallyOverlap(a: BBox, b: BBox): boolean {
  if (!bboxesIntersect(a, b)) return false;
  if (bboxContains(a, b) || bboxContains(b, a)) return false;
  const overlapW = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const overlapH =
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return (
    overlapW >= PARTIAL_OVERLAP_TOLERANCE_PX &&
    overlapH >= PARTIAL_OVERLAP_TOLERANCE_PX
  );
}

/**
 * Get the bounding box of just the label (not including the element)
 * Used for label-label collision detection.
 *
 * Corner-badge placement: the label sits fully outside the element,
 * touching one of its edges (typically the top edge). Element content is
 * never occluded by the label. The "binding" between label and element
 * comes from (a) the touching edge, (b) horizontal containment (the
 * label's x-range stays within the element's x-range whenever the
 * element is wide enough), and (c) a darker opaque label fill that
 * visually separates it from the bbox outline.
 */
export function getLabelBBox(
  bbox: BBox,
  position: LabelPosition = 'above',
  text?: string,
  xOffset: number = 0,
): BBox {
  const { width: labelWidth, height: labelHeight } = getLabelDimensions(
    text,
    bbox.width,
  );
  const clampedXOffset = clampLabelXOffset(xOffset, bbox.width, labelWidth);
  const y = position === 'above' ? bbox.y - labelHeight : bbox.y + bbox.height;
  return {
    x: bbox.x + clampedXOffset,
    y,
    width: labelWidth,
    height: labelHeight,
  };
}

/**
 * Expand bbox to include label area based on label position + offset.
 * Returns the combined bbox of element + label. Width is the union of
 * the element's x-range and the label's (shifted) x-range.
 */
export function expandBBoxWithLabel(
  bbox: BBox,
  position: LabelPosition = 'above',
  text?: string,
  xOffset: number = 0,
): BBox {
  const labelBBox = getLabelBBox(bbox, position, text, xOffset);
  return unionBBox(bbox, labelBBox);
}

/**
 * Clamp a proposed horizontal offset to the element's x-range.
 * Label MUST stay within the element's x-range whenever the element is
 * wide enough (labelWidth <= bbox.width). Narrow elements
 * (labelWidth > bbox.width) are forced to xOffset=0 — the label
 * extends past the element edges, unavoidable, same as pre-shift behavior.
 */
function clampLabelXOffset(
  xOffset: number,
  bboxWidth: number,
  labelWidth: number,
): number {
  const slack = bboxWidth - labelWidth;
  if (slack <= 0) {
    return 0;
  }
  if (xOffset < 0) return 0;
  if (xOffset > slack) return slack;
  return xOffset;
}

/**
 * Candidate horizontal offsets to try when placing a label. Order matters:
 * the planner prefers earlier entries, so xOffset=0 (left-aligned,
 * historical default) is always tried first, and the right-aligned
 * fallback is only used when left-aligned is blocked.
 */
function getCandidateXOffsets(bboxWidth: number, labelWidth: number): number[] {
  const slack = bboxWidth - labelWidth;
  if (slack <= 0) {
    return [0];
  }
  // Two discrete offsets are sufficient for the target collision case
  // (adjacent-row neighbors whose left-aligned labels collide): sliding
  // to right-aligned moves the label away from the left neighbor.
  // Keeping the set small also keeps the planner O(positions × offsets)
  // per candidate, i.e. 2 × 2 = 4.
  return [0, slack];
}

/**
 * Check if two elements' labels collide.
 * Uses each element's labelPosition and labelXOffset if set, defaulting
 * to above + xOffset=0.
 */
export function elementsCollide(
  a: InteractiveElement,
  b: InteractiveElement,
): boolean {
  const labelA = getLabelBBox(
    a.bbox,
    a.labelPosition ?? 'above',
    a.id,
    a.labelXOffset ?? 0,
  );
  const labelB = getLabelBBox(
    b.bbox,
    b.labelPosition ?? 'above',
    b.id,
    b.labelXOffset ?? 0,
  );
  return bboxesIntersect(labelA, labelB);
}

/**
 * Check if label would be within viewport bounds for given position + offset.
 */
export function isLabelWithinViewport(
  bbox: BBox,
  position: LabelPosition,
  viewportWidth: number,
  viewportHeight: number,
  text?: string,
  xOffset: number = 0,
): boolean {
  const labelBBox = getLabelBBox(bbox, position, text, xOffset);

  return (
    labelBBox.x >= 0 &&
    labelBBox.y >= 0 &&
    labelBBox.x + labelBBox.width <= viewportWidth &&
    labelBBox.y + labelBBox.height <= viewportHeight
  );
}

/**
 * Build collision-free highlight pages using a constraint-aware greedy
 * algorithm. It places the most-constrained remaining element first, then
 * chooses the label position that blocks the fewest later elements.
 *
 * @param elements - All elements sorted by priority
 * @param page - 1-indexed page number
 * @param viewportWidth - Optional viewport width for boundary checks
 * @param viewportHeight - Optional viewport height for boundary checks
 * @returns All collision-free pages up to maxPages when provided
 */
export function paginateCollisionFreeElements(
  elements: InteractiveElement[],
  viewportWidth?: number,
  viewportHeight?: number,
  maxPages?: number,
): InteractiveElement[][] {
  return buildCollisionFreePages(
    elements,
    viewportWidth,
    viewportHeight,
    maxPages,
  );
}

/**
 * Select a collision-free page of elements using a constraint-aware greedy
 * algorithm. It places the most-constrained remaining element first, then
 * chooses the label position that blocks the fewest later elements.
 *
 * @param elements - All elements sorted by priority
 * @param page - 1-indexed page number
 * @param viewportWidth - Optional viewport width for boundary checks
 * @param viewportHeight - Optional viewport height for boundary checks
 * @returns Elements for the requested page (collision-free with labelPosition set)
 */
export function selectCollisionFreePage(
  elements: InteractiveElement[],
  page: number,
  viewportWidth?: number,
  viewportHeight?: number,
): InteractiveElement[] {
  if (elements.length === 0 || page < 1) {
    return [];
  }

  const pages = paginateCollisionFreeElements(
    elements,
    viewportWidth,
    viewportHeight,
    page,
  );
  return pages[page - 1] ?? [];
}

/**
 * Calculate total number of collision-free pages
 * This pre-computes the pagination to determine how many pages exist
 */
export function calculateTotalPages(
  elements: InteractiveElement[],
  viewportWidth?: number,
  viewportHeight?: number,
): number {
  return paginateCollisionFreeElements(elements, viewportWidth, viewportHeight)
    .length;
}

function buildCollisionFreePages(
  elements: InteractiveElement[],
  viewportWidth?: number,
  viewportHeight?: number,
  maxPages?: number,
): InteractiveElement[][] {
  if (elements.length === 0) {
    return [];
  }

  // Index of all input element bboxes (not labels). Used so label
  // placement can avoid occluding non-selected interactive elements —
  // e.g. on a dense table, row N's 'above' label would land on row N-1's
  // bbox; if row N-1 is deferred to a later page, it would still be
  // visible in the screenshot and the label would visibly cover it.
  const allElementsIndex = new SelectedSpatialIndex();
  for (const el of elements) {
    allElementsIndex.addBBoxOnly(el);
  }

  const allAbovePage = tryBuildUniformPositionPage(
    elements,
    'above',
    viewportWidth,
    viewportHeight,
    allElementsIndex,
  );
  if (allAbovePage) {
    return [allAbovePage];
  }

  let remaining = elements.map((element, sourceIndex) => ({
    sourceIndex,
    element: cloneInteractiveElement(element),
  }));
  const pages: InteractiveElement[][] = [];

  while (remaining.length > 0) {
    const selected: InteractiveElement[] = [];
    const selectedIndex = new SelectedSpatialIndex();
    let pageRemaining = remaining;

    while (pageRemaining.length > 0) {
      const nextSelection = chooseNextCandidate(
        pageRemaining,
        selected,
        selectedIndex,
        viewportWidth,
        viewportHeight,
        allElementsIndex,
      );

      if (!nextSelection) {
        break;
      }

      const placed: InteractiveElement = {
        ...nextSelection.candidate.element,
        labelPosition: nextSelection.position,
        labelXOffset: nextSelection.xOffset,
      };
      selected.push(placed);
      selectedIndex.add(placed);
      pageRemaining = pageRemaining.filter(
        (candidate) =>
          candidate.sourceIndex !== nextSelection.candidate.sourceIndex,
      );
    }

    if (selected.length === 0) {
      break;
    }

    pages.push(selected);
    if (maxPages !== undefined && pages.length >= maxPages) {
      break;
    }
    remaining = pageRemaining;
  }

  return pages;
}

function tryBuildUniformPositionPage(
  elements: InteractiveElement[],
  position: LabelPosition,
  viewportWidth?: number,
  viewportHeight?: number,
  allElementsIndex?: SelectedSpatialIndex,
): InteractiveElement[] | null {
  const selected: InteractiveElement[] = [];
  const index = new SelectedSpatialIndex();

  for (const element of elements) {
    const nearby = nearbySelectedFor(element, position, element.id, 0, index);
    if (
      !isPlacementFeasible(
        element,
        element.id,
        position,
        0,
        nearby,
        viewportWidth,
        viewportHeight,
        allElementsIndex,
      )
    ) {
      return null;
    }

    const placed: InteractiveElement = {
      ...element,
      labelPosition: position,
      labelXOffset: 0,
    };
    selected.push(placed);
    index.add(placed);
  }

  return selected;
}

function chooseNextCandidate(
  remaining: RemainingCandidate[],
  selected: InteractiveElement[],
  selectedIndex: SelectedSpatialIndex,
  viewportWidth?: number,
  viewportHeight?: number,
  allElementsIndex?: SelectedSpatialIndex,
): (PlacementEvaluation & { candidate: RemainingCandidate }) | null {
  let minFeasibleCount = Number.POSITIVE_INFINITY;
  let constrainedCandidate: {
    candidate: RemainingCandidate;
    feasiblePlacements: Placement[];
  } | null = null;

  for (const candidate of remaining) {
    const feasiblePlacements = getFeasiblePlacements(
      candidate.element,
      candidate.element.id,
      selected,
      selectedIndex,
      viewportWidth,
      viewportHeight,
      allElementsIndex,
    );

    if (
      feasiblePlacements.length > 0 &&
      feasiblePlacements.length < minFeasibleCount
    ) {
      minFeasibleCount = feasiblePlacements.length;
      constrainedCandidate = {
        candidate,
        feasiblePlacements,
      };
    }
  }

  if (!constrainedCandidate) {
    return null;
  }

  return {
    candidate: constrainedCandidate.candidate,
    ...chooseLeastBlockingPlacement(
      constrainedCandidate.candidate,
      constrainedCandidate.feasiblePlacements,
      remaining,
      selected,
      selectedIndex,
      viewportWidth,
      viewportHeight,
      allElementsIndex,
    ),
  };
}

function chooseLeastBlockingPlacement(
  candidate: RemainingCandidate,
  feasiblePlacements: Placement[],
  remaining: RemainingCandidate[],
  selected: InteractiveElement[],
  selectedIndex: SelectedSpatialIndex,
  viewportWidth?: number,
  viewportHeight?: number,
  allElementsIndex?: SelectedSpatialIndex,
): PlacementEvaluation {
  const futureCandidates = remaining.filter(
    (remainingCandidate) =>
      remainingCandidate.sourceIndex !== candidate.sourceIndex,
  );
  let bestPlacement: PlacementEvaluation | null = null;

  // Pre-compute each future candidate's baseline feasible placements against
  // the current `selected` set. When we test a hypothetical placement of
  // `candidate@{position,xOffset}`, only future candidates whose bbox/label
  // footprint is geometrically near that placement can have their
  // feasibility change. The rest keep their baseline feasibility.
  interface FutureBaseline {
    candidate: RemainingCandidate;
    elementUnion: BBox; // bbox ∪ all candidate placements' label rects
    feasibleCount: number;
  }
  const futureBaselines: FutureBaseline[] = futureCandidates.map((fc) => {
    const baseline = getFeasiblePlacements(
      fc.element,
      fc.element.id,
      selected,
      selectedIndex,
      viewportWidth,
      viewportHeight,
      allElementsIndex,
    );
    // Footprint = bbox ∪ every label rect this element could take across
    // positions and candidate offsets. The shifted label's x-range is
    // [bbox.x, bbox.x + max(bbox.width, labelWidth)], so a single
    // getLabelBBox at offset=0 plus offset=slack captures the full span.
    let union = fc.element.bbox;
    const offsets = getCandidateXOffsets(
      fc.element.bbox.width,
      getLabelDimensions(fc.element.id, fc.element.bbox.width).width,
    );
    for (const pos of POSITION_PRIORITY) {
      for (const off of offsets) {
        union = unionBBox(
          union,
          getLabelBBox(fc.element.bbox, pos, fc.element.id, off),
        );
      }
    }
    return {
      candidate: fc,
      elementUnion: union,
      feasibleCount: baseline.length,
    };
  });

  const baselineBlockedCount = futureBaselines.reduce(
    (acc, fb) => (fb.feasibleCount === 0 ? acc + 1 : acc),
    0,
  );
  const baselineTotalOptions = futureBaselines.reduce(
    (acc, fb) => acc + fb.feasibleCount,
    0,
  );

  for (const { position, xOffset } of feasiblePlacements) {
    const hypotheticalElement: InteractiveElement = {
      ...candidate.element,
      labelPosition: position,
      labelXOffset: xOffset,
    };
    const hypotheticalLabelBBox = getLabelBBox(
      candidate.element.bbox,
      position,
      candidate.element.id,
      xOffset,
    );
    const influenceRect = inflateBBox(
      unionBBox(candidate.element.bbox, hypotheticalLabelBBox),
      VISUAL_LABEL_CLEARANCE_PX,
    );

    let blockedCandidateCount = baselineBlockedCount;
    let totalFutureOptions = baselineTotalOptions;

    for (const fb of futureBaselines) {
      if (!bboxesIntersect(fb.elementUnion, influenceRect)) {
        continue;
      }
      // Feasibility can change for this future candidate. Re-test against
      // the spatially-near selected set plus the hypothetical candidate.
      const updatedFeasible = getFeasiblePlacements(
        fb.candidate.element,
        fb.candidate.element.id,
        selected,
        selectedIndex,
        viewportWidth,
        viewportHeight,
        allElementsIndex,
        [hypotheticalElement],
      );
      const updatedFeasibleLen = updatedFeasible.length;

      if (fb.feasibleCount === 0 && updatedFeasibleLen > 0) {
        blockedCandidateCount--;
      } else if (fb.feasibleCount > 0 && updatedFeasibleLen === 0) {
        blockedCandidateCount++;
      }
      totalFutureOptions += updatedFeasibleLen - fb.feasibleCount;
    }

    if (
      !bestPlacement ||
      blockedCandidateCount < bestPlacement.blockedCandidateCount ||
      (blockedCandidateCount === bestPlacement.blockedCandidateCount &&
        totalFutureOptions > bestPlacement.totalFutureOptions) ||
      (blockedCandidateCount === bestPlacement.blockedCandidateCount &&
        totalFutureOptions === bestPlacement.totalFutureOptions &&
        // Tie-break: prefer 'above' over 'below', then xOffset=0 over shifted.
        (POSITION_PRIORITY.indexOf(position) <
          POSITION_PRIORITY.indexOf(bestPlacement.position) ||
          (position === bestPlacement.position &&
            xOffset < bestPlacement.xOffset)))
    ) {
      bestPlacement = {
        position,
        xOffset,
        blockedCandidateCount,
        totalFutureOptions,
      };
    }
  }

  return (
    bestPlacement ?? {
      position: POSITION_PRIORITY[0],
      xOffset: 0,
      blockedCandidateCount: Number.POSITIVE_INFINITY,
      totalFutureOptions: Number.NEGATIVE_INFINITY,
    }
  );
}

function getFeasiblePlacements(
  element: InteractiveElement,
  labelText: string,
  selected: InteractiveElement[],
  selectedIndex: SelectedSpatialIndex | null,
  viewportWidth?: number,
  viewportHeight?: number,
  allElementsIndex?: SelectedSpatialIndex,
  extras: InteractiveElement[] = [],
): Placement[] {
  // Label binding rule: labels ALWAYS sit on the top edge of their
  // element's bbox (above), shifted horizontally within the element's
  // x-range if needed to avoid collision. The only exception is when the
  // element is so close to the top of the viewport that 'above' would be
  // clipped, in which case we fall back to 'below'. Collision with an
  // already-placed element is NOT a reason to fall back to 'below' — if
  // no horizontal offset on 'above' fits, the element is deferred to a
  // later highlight page, preserving the "directly above me" invariant.

  const labelWidth = getLabelDimensions(labelText, element.bbox.width).width;
  const offsets = getCandidateXOffsets(element.bbox.width, labelWidth);

  const tryPlacements = (position: LabelPosition): Placement[] => {
    const positionWithinViewport =
      viewportWidth !== undefined && viewportHeight !== undefined
        ? isLabelWithinViewport(
            element.bbox,
            position,
            viewportWidth,
            viewportHeight,
            labelText,
            0,
          )
        : true;
    if (!positionWithinViewport) {
      return [];
    }

    const results: Placement[] = [];
    for (const xOffset of offsets) {
      const nearby = selectedIndex
        ? nearbySelectedFor(
            element,
            position,
            labelText,
            xOffset,
            selectedIndex,
            extras,
          )
        : selected.concat(extras);
      if (
        isPlacementFeasible(
          element,
          labelText,
          position,
          xOffset,
          nearby,
          viewportWidth,
          viewportHeight,
          allElementsIndex,
        )
      ) {
        results.push({ position, xOffset });
      }
    }
    return results;
  };

  const abovePlacements = tryPlacements('above');
  if (abovePlacements.length > 0) {
    return abovePlacements;
  }

  // 'above' fits the viewport horizontally/vertically but is blocked at
  // every allowed xOffset. Only fall back to 'below' if 'above' would
  // leave the viewport vertically; otherwise defer to a later page.
  const aboveWithinViewport =
    viewportWidth !== undefined && viewportHeight !== undefined
      ? isLabelWithinViewport(
          element.bbox,
          'above',
          viewportWidth,
          viewportHeight,
          labelText,
          0,
        )
      : true;
  if (aboveWithinViewport) {
    return [];
  }

  return tryPlacements('below');
}

// Returns the subset of `selected` that could plausibly collide with the
// candidate placement. The query rect is the union of the candidate's bbox
// and its label rect for the requested position+offset, inflated by the
// visible clearance threshold. Optional `extras` are appended (e.g. a
// hypothetical candidate not yet inserted into the index).
function nearbySelectedFor(
  element: InteractiveElement,
  position: LabelPosition,
  labelText: string,
  xOffset: number,
  index: SelectedSpatialIndex,
  extras: InteractiveElement[] = [],
): InteractiveElement[] {
  const labelBBox = getLabelBBox(element.bbox, position, labelText, xOffset);
  const query = inflateBBox(
    unionBBox(element.bbox, labelBBox),
    VISUAL_LABEL_CLEARANCE_PX,
  );
  const near = index.queryNear(query);
  if (extras.length === 0) return near;
  return near.concat(extras);
}

function isPlacementFeasible(
  element: InteractiveElement,
  labelText: string,
  position: LabelPosition,
  xOffset: number,
  selected: InteractiveElement[],
  viewportWidth?: number,
  viewportHeight?: number,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _allElementsIndex?: SelectedSpatialIndex,
): boolean {
  const withinViewport =
    viewportWidth !== undefined && viewportHeight !== undefined
      ? isLabelWithinViewport(
          element.bbox,
          position,
          viewportWidth,
          viewportHeight,
          labelText,
          xOffset,
        )
      : true;

  if (!withinViewport) {
    return false;
  }

  const labelBBox = getLabelBBox(element.bbox, position, labelText, xOffset);

  for (const selectedElement of selected) {
    const selectedLabelBBox = getLabelBBox(
      selectedElement.bbox,
      selectedElement.labelPosition ?? 'above',
      selectedElement.id,
      selectedElement.labelXOffset ?? 0,
    );
    const nested =
      bboxContains(selectedElement.bbox, element.bbox) ||
      bboxContains(element.bbox, selectedElement.bbox);

    if (
      bboxesIntersectWithClearance(
        labelBBox,
        selectedLabelBBox,
        VISUAL_LABEL_CLEARANCE_PX,
      )
    ) {
      return false;
    }

    if (!nested && bboxesPartiallyOverlap(element.bbox, selectedElement.bbox)) {
      return false;
    }

    // Label-vs-neighbor-bbox and bbox-vs-neighbor-label: use strict
    // intersection (no clearance). Under the corner-badge model, a
    // label sits flush against its own element's edge, so the label
    // of a horizontally-adjacent element will physically touch the
    // element's bbox at the shared row edge. That touch is NOT a real
    // overlap — `bboxesIntersect` uses `<=`, treating shared-edge as
    // non-intersecting. A positive pixel intrusion (label actually
    // covering the neighbor's interior) still blocks placement.
    if (!nested && bboxesIntersect(labelBBox, selectedElement.bbox)) {
      return false;
    }

    if (!nested && bboxesIntersect(element.bbox, selectedLabelBBox)) {
      return false;
    }
  }

  return true;
}

function cloneInteractiveElement(
  element: InteractiveElement,
): InteractiveElement {
  return {
    ...element,
    bbox: { ...element.bbox },
  };
}

/**
 * Sort elements to match how they are read in the screenshot:
 * top-to-bottom, and left-to-right within the same visual row.
 */
export function sortElementsByVisualOrder(
  elements: InteractiveElement[],
): InteractiveElement[] {
  return elements
    .map((element, index) => ({ element, index }))
    .sort((a, b) => {
      const yDelta = a.element.bbox.y - b.element.bbox.y;
      if (Math.abs(yDelta) > VISUAL_ROW_TOLERANCE_PX) {
        return yDelta;
      }

      const xDelta = a.element.bbox.x - b.element.bbox.x;
      if (xDelta !== 0) {
        return xDelta;
      }

      if (yDelta !== 0) {
        return yDelta;
      }

      return a.index - b.index;
    })
    .map(({ element }) => element);
}
