/**
 * Collision Detection Utilities for Element Highlighting
 *
 * This module contains pure functions for collision detection and pagination
 * that can be tested independently of Chrome APIs.
 */

import type { InteractiveElement } from '../types';
import { getLabelDimensions } from './label-geometry';

export const LABEL_FONT_SIZE = 16;
export const LABEL_PADDING = 5;
export const LABEL_HEIGHT = LABEL_FONT_SIZE + LABEL_PADDING * 2; // 26px total
export const MAX_LABEL_WIDTH = 120; // Maximum label width for collision detection

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type LabelPosition = 'above' | 'below' | 'left' | 'right';

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
 * Select a collision-free page of elements using greedy algorithm
 * Tries label positions in priority order: above → below → left → right
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
): InteractiveElement[][] {
  if (elements.length === 0) {
    return [];
  }

  const positions: LabelPosition[] = ['above', 'below', 'left', 'right'];
  let remaining = elements.map(cloneInteractiveElement);
  const pages: InteractiveElement[][] = [];

  while (remaining.length > 0) {
    const selected: InteractiveElement[] = [];

    for (const elem of remaining) {
      for (const pos of positions) {
        const withinViewport =
          viewportWidth !== undefined && viewportHeight !== undefined
            ? isLabelWithinViewport(
                elem.bbox,
                pos,
                viewportWidth,
                viewportHeight,
                elem.id,
              )
            : true;

        if (!withinViewport) {
          continue;
        }

        const labelBBox = getLabelBBox(elem.bbox, pos, elem.id);

        let hasCollision = false;

        for (const s of selected) {
          const sLabelBBox = getLabelBBox(
            s.bbox,
            s.labelPosition ?? 'above',
            s.id,
          );

          if (bboxesIntersect(labelBBox, sLabelBBox)) {
            hasCollision = true;
            break;
          }

          if (bboxesIntersect(labelBBox, s.bbox)) {
            hasCollision = true;
            break;
          }

          if (bboxesIntersect(elem.bbox, sLabelBBox)) {
            hasCollision = true;
            break;
          }
        }

        if (!hasCollision) {
          selected.push({ ...elem, labelPosition: pos });
          break;
        }
      }
    }

    if (selected.length === 0) {
      break;
    }

    pages.push(selected);
    const selectedIds = new Set(selected.map((e) => e.id));
    remaining = remaining.filter((e) => !selectedIds.has(e.id));
  }

  return pages;
}

function cloneInteractiveElement(
  element: InteractiveElement,
): InteractiveElement {
  return {
    ...element,
    bbox: { ...element.bbox },
  };
}
