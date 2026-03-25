import type { InteractiveElement } from '../types';

/**
 * Reassign element IDs to page-local sequential numbers.
 *
 * IDs are intentionally page-local: each highlight snapshot page starts at 1
 * again, and the page-local IDs must be paired with highlight_snapshot_id.
 */
export function assignSequentialElementIds(
  elements: InteractiveElement[],
): InteractiveElement[] {
  return elements.map((element, index) => ({
    ...element,
    bbox: { ...element.bbox },
    id: String(index + 1),
  }));
}
