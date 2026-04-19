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

export type LabelPosition = 'above' | 'below' | 'left' | 'right';

const VISUAL_ROW_TOLERANCE_PX = 12;
// Keep label-to-label and label-to-bbox spacing visibly separated in the
// rendered screenshot, not just geometrically non-overlapping.
const VISUAL_LABEL_CLEARANCE_PX = 6;
// Corner-badge placement: labels are anchored to the top or bottom edge of
// their element's bbox only. Side placements ('left' / 'right') were removed
// because they break visual binding — a label to the left of element B sits
// between A and B and reads as belonging to A (session 444122cb: "UHT"
// between Fundamental and Technical looked like it labeled Fundamental).
// When neither 'above' nor 'below' fits, the element is deferred to a later
// highlight page rather than placed ambiguously. `total_pages` absorbs the
// overflow; the system prompt now tells the agent to sweep all pages.
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

function bboxesPartiallyOverlap(a: BBox, b: BBox): boolean {
  return bboxesIntersect(a, b) && !bboxContains(a, b) && !bboxContains(b, a);
}

/**
 * Get the bounding box of just the label (not including the element)
 * Used for label-label collision detection
 */
// Corner-badge placement: the label sits fully outside the element,
// touching one of its edges (typically the top-left corner, above edge).
// Element content is never occluded by the label. The "binding" between
// label and element comes from (a) the touching edge and (b) a darker
// opaque label fill that visually separates it from the bbox outline.
export function getLabelBBox(
  bbox: BBox,
  position: LabelPosition = 'above',
  text?: string,
): BBox {
  const { width: labelWidth, height: labelHeight } = getLabelDimensions(
    text,
    bbox.width,
  );

  switch (position) {
    case 'above':
      return {
        x: bbox.x,
        y: bbox.y - labelHeight,
        width: labelWidth,
        height: labelHeight,
      };
    case 'below':
      return {
        x: bbox.x,
        y: bbox.y + bbox.height,
        width: labelWidth,
        height: labelHeight,
      };
    case 'left':
      return {
        x: bbox.x - labelWidth,
        y: bbox.y,
        width: labelWidth,
        height: labelHeight,
      };
    case 'right':
      return {
        x: bbox.x + bbox.width,
        y: bbox.y,
        width: labelWidth,
        height: labelHeight,
      };
  }
}

/**
 * Expand bbox to include label area based on label position
 * This returns the combined bbox of element + label
 */
export function expandBBoxWithLabel(
  bbox: BBox,
  position: LabelPosition = 'above',
  text?: string,
): BBox {
  const { width: labelWidth, height: labelHeight } = getLabelDimensions(
    text,
    bbox.width,
  );

  switch (position) {
    case 'above':
      return {
        x: bbox.x,
        y: bbox.y - labelHeight,
        width: labelWidth,
        height: bbox.height + labelHeight,
      };
    case 'below':
      return {
        x: bbox.x,
        y: bbox.y,
        width: labelWidth,
        height: bbox.height + labelHeight,
      };
    case 'left':
      return {
        x: bbox.x - labelWidth,
        y: bbox.y,
        width: labelWidth + bbox.width,
        height: bbox.height,
      };
    case 'right':
      return {
        x: bbox.x,
        y: bbox.y,
        width: labelWidth + bbox.width,
        height: bbox.height,
      };
  }
}

/**
 * Check if two elements' labels collide
 * Uses each element's labelPosition if set, defaults to 'above'
 */
export function elementsCollide(
  a: InteractiveElement,
  b: InteractiveElement,
): boolean {
  const labelA = getLabelBBox(a.bbox, a.labelPosition ?? 'above', a.id);
  const labelB = getLabelBBox(b.bbox, b.labelPosition ?? 'above', b.id);
  return bboxesIntersect(labelA, labelB);
}

/**
 * Check if label would be within viewport bounds for given position
 */
export function isLabelWithinViewport(
  bbox: BBox,
  position: LabelPosition,
  viewportWidth: number,
  viewportHeight: number,
  text?: string,
): boolean {
  const labelBBox = getLabelBBox(bbox, position, text);

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

  const allAbovePage = tryBuildUniformPositionPage(
    elements,
    'above',
    viewportWidth,
    viewportHeight,
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
      );

      if (!nextSelection) {
        break;
      }

      const placed: InteractiveElement = {
        ...nextSelection.candidate.element,
        labelPosition: nextSelection.position,
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
): InteractiveElement[] | null {
  const selected: InteractiveElement[] = [];
  const index = new SelectedSpatialIndex();

  for (const element of elements) {
    const nearby = nearbySelectedFor(element, position, element.id, index);
    if (
      !isPlacementFeasible(
        element,
        element.id,
        position,
        nearby,
        viewportWidth,
        viewportHeight,
      )
    ) {
      return null;
    }

    const placed: InteractiveElement = {
      ...element,
      labelPosition: position,
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
): (PlacementEvaluation & { candidate: RemainingCandidate }) | null {
  let minFeasiblePositions = Number.POSITIVE_INFINITY;
  let constrainedCandidate: {
    candidate: RemainingCandidate;
    feasiblePositions: LabelPosition[];
  } | null = null;

  for (const candidate of remaining) {
    const feasiblePositions = getFeasiblePositions(
      candidate.element,
      candidate.element.id,
      selected,
      selectedIndex,
      viewportWidth,
      viewportHeight,
    );

    if (
      feasiblePositions.length > 0 &&
      feasiblePositions.length < minFeasiblePositions
    ) {
      minFeasiblePositions = feasiblePositions.length;
      constrainedCandidate = {
        candidate,
        feasiblePositions,
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
      constrainedCandidate.feasiblePositions,
      remaining,
      selected,
      selectedIndex,
      viewportWidth,
      viewportHeight,
    ),
  };
}

function chooseLeastBlockingPlacement(
  candidate: RemainingCandidate,
  feasiblePositions: LabelPosition[],
  remaining: RemainingCandidate[],
  selected: InteractiveElement[],
  selectedIndex: SelectedSpatialIndex,
  viewportWidth?: number,
  viewportHeight?: number,
): PlacementEvaluation {
  const futureCandidates = remaining.filter(
    (remainingCandidate) =>
      remainingCandidate.sourceIndex !== candidate.sourceIndex,
  );
  let bestPlacement: PlacementEvaluation | null = null;

  // Pre-compute each future candidate's baseline feasible positions against
  // the current `selected` set. When we test a hypothetical placement of
  // `candidate@position`, only future candidates whose bbox/label is
  // geometrically near that placement can have their feasibility change. The
  // rest keep their baseline feasibility — saving the O(|future|×4×|selected|)
  // recomputation per position.
  interface FutureBaseline {
    candidate: RemainingCandidate;
    elementUnion: BBox; // bbox ∪ all four label rects
    feasibleCount: number;
    totalLength: number;
  }
  const futureBaselines: FutureBaseline[] = futureCandidates.map((fc) => {
    const baseline = getFeasiblePositions(
      fc.element,
      fc.element.id,
      selected,
      selectedIndex,
      viewportWidth,
      viewportHeight,
    );
    let union = fc.element.bbox;
    for (const pos of POSITION_PRIORITY) {
      union = unionBBox(
        union,
        getLabelBBox(fc.element.bbox, pos, fc.element.id),
      );
    }
    return {
      candidate: fc,
      elementUnion: union,
      feasibleCount: baseline.length,
      totalLength: baseline.length,
    };
  });

  const baselineBlockedCount = futureBaselines.reduce(
    (acc, fb) => (fb.feasibleCount === 0 ? acc + 1 : acc),
    0,
  );
  const baselineTotalOptions = futureBaselines.reduce(
    (acc, fb) => acc + fb.totalLength,
    0,
  );

  for (const position of feasiblePositions) {
    const hypotheticalElement: InteractiveElement = {
      ...candidate.element,
      labelPosition: position,
    };
    const hypotheticalLabelBBox = getLabelBBox(
      candidate.element.bbox,
      position,
      candidate.element.id,
    );
    // Influence rect: anything whose elementUnion does NOT intersect this
    // (inflated by clearance) cannot be affected by adding the hypothetical
    // candidate. We only need to recompute for future candidates inside it.
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
      let updatedFeasibleLen = 0;
      for (const pos of POSITION_PRIORITY) {
        const nearby = nearbySelectedFor(
          fb.candidate.element,
          pos,
          fb.candidate.element.id,
          selectedIndex,
          [hypotheticalElement],
        );
        if (
          isPlacementFeasible(
            fb.candidate.element,
            fb.candidate.element.id,
            pos,
            nearby,
            viewportWidth,
            viewportHeight,
          )
        ) {
          updatedFeasibleLen++;
        }
      }

      // Adjust baseline aggregates for the delta on this single future.
      if (fb.feasibleCount === 0 && updatedFeasibleLen > 0) {
        blockedCandidateCount--;
      } else if (fb.feasibleCount > 0 && updatedFeasibleLen === 0) {
        blockedCandidateCount++;
      }
      totalFutureOptions += updatedFeasibleLen - fb.totalLength;
    }

    if (
      !bestPlacement ||
      blockedCandidateCount < bestPlacement.blockedCandidateCount ||
      (blockedCandidateCount === bestPlacement.blockedCandidateCount &&
        totalFutureOptions > bestPlacement.totalFutureOptions) ||
      (blockedCandidateCount === bestPlacement.blockedCandidateCount &&
        totalFutureOptions === bestPlacement.totalFutureOptions &&
        POSITION_PRIORITY.indexOf(position) <
          POSITION_PRIORITY.indexOf(bestPlacement.position))
    ) {
      bestPlacement = {
        position,
        blockedCandidateCount,
        totalFutureOptions,
      };
    }
  }

  return (
    bestPlacement ?? {
      position: POSITION_PRIORITY[0],
      blockedCandidateCount: Number.POSITIVE_INFINITY,
      totalFutureOptions: Number.NEGATIVE_INFINITY,
    }
  );
}

function getFeasiblePositions(
  element: InteractiveElement,
  labelText: string,
  selected: InteractiveElement[],
  selectedIndex: SelectedSpatialIndex | null,
  viewportWidth?: number,
  viewportHeight?: number,
): LabelPosition[] {
  const feasiblePositions: LabelPosition[] = [];

  for (const position of POSITION_PRIORITY) {
    const nearby = selectedIndex
      ? nearbySelectedFor(element, position, labelText, selectedIndex)
      : selected;
    if (
      isPlacementFeasible(
        element,
        labelText,
        position,
        nearby,
        viewportWidth,
        viewportHeight,
      )
    ) {
      feasiblePositions.push(position);
    }
  }

  return feasiblePositions;
}

// Returns the subset of `selected` that could plausibly collide with the
// candidate placement. The query rect is the union of the candidate's bbox
// and its label rect for the requested position, inflated by the visible
// clearance threshold. Optional `extras` are appended (e.g. a hypothetical
// candidate not yet inserted into the index).
function nearbySelectedFor(
  element: InteractiveElement,
  position: LabelPosition,
  labelText: string,
  index: SelectedSpatialIndex,
  extras: InteractiveElement[] = [],
): InteractiveElement[] {
  const labelBBox = getLabelBBox(element.bbox, position, labelText);
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
  selected: InteractiveElement[],
  viewportWidth?: number,
  viewportHeight?: number,
): boolean {
  const withinViewport =
    viewportWidth !== undefined && viewportHeight !== undefined
      ? isLabelWithinViewport(
          element.bbox,
          position,
          viewportWidth,
          viewportHeight,
          labelText,
        )
      : true;

  if (!withinViewport) {
    return false;
  }

  const labelBBox = getLabelBBox(element.bbox, position, labelText);

  for (const selectedElement of selected) {
    const selectedLabelBBox = getLabelBBox(
      selectedElement.bbox,
      selectedElement.labelPosition ?? 'above',
      selectedElement.id,
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

    if (
      !nested &&
      bboxesIntersectWithClearance(
        labelBBox,
        selectedElement.bbox,
        VISUAL_LABEL_CLEARANCE_PX,
      )
    ) {
      return false;
    }

    if (
      !nested &&
      bboxesIntersectWithClearance(
        element.bbox,
        selectedLabelBBox,
        VISUAL_LABEL_CLEARANCE_PX,
      )
    ) {
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
