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
const POSITION_PRIORITY: LabelPosition[] = ['above', 'below', 'left', 'right'];

interface RemainingCandidate {
  sourceIndex: number;
  element: InteractiveElement;
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

  const pages = buildCollisionFreePages(
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
  return buildCollisionFreePages(elements, viewportWidth, viewportHeight)
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
    let pageRemaining = remaining;

    while (pageRemaining.length > 0) {
      const nextSelection = chooseNextCandidate(
        pageRemaining,
        selected,
        viewportWidth,
        viewportHeight,
      );

      if (!nextSelection) {
        break;
      }

      selected.push({
        ...nextSelection.candidate.element,
        labelPosition: nextSelection.position,
      });
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

  for (const element of elements) {
    if (
      !isPlacementFeasible(
        element,
        element.id,
        position,
        selected,
        viewportWidth,
        viewportHeight,
      )
    ) {
      return null;
    }

    selected.push({
      ...element,
      labelPosition: position,
    });
  }

  return selected;
}

function chooseNextCandidate(
  remaining: RemainingCandidate[],
  selected: InteractiveElement[],
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
  viewportWidth?: number,
  viewportHeight?: number,
): PlacementEvaluation {
  const futureCandidates = remaining.filter(
    (remainingCandidate) =>
      remainingCandidate.sourceIndex !== candidate.sourceIndex,
  );
  let bestPlacement: PlacementEvaluation | null = null;

  for (const position of feasiblePositions) {
    const hypotheticalSelected = [
      ...selected,
      {
        ...candidate.element,
        labelPosition: position,
      },
    ];
    let blockedCandidateCount = 0;
    let totalFutureOptions = 0;

    futureCandidates.forEach((candidate) => {
      const futureOptions = getFeasiblePositions(
        candidate.element,
        candidate.element.id,
        hypotheticalSelected,
        viewportWidth,
        viewportHeight,
      );

      if (futureOptions.length === 0) {
        blockedCandidateCount++;
      }
      totalFutureOptions += futureOptions.length;
    });

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
  viewportWidth?: number,
  viewportHeight?: number,
): LabelPosition[] {
  const feasiblePositions: LabelPosition[] = [];

  for (const position of POSITION_PRIORITY) {
    if (
      isPlacementFeasible(
        element,
        labelText,
        position,
        selected,
        viewportWidth,
        viewportHeight,
      )
    ) {
      feasiblePositions.push(position);
    }
  }

  return feasiblePositions;
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
