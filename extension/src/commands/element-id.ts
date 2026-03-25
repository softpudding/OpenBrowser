import type { InteractiveElement } from '../types';

/**
 * Reassign element IDs to page-local sequential numbers.
 *
 * IDs are intentionally ephemeral: each highlight response starts at 1 again
 * and only the most recent highlight snapshot remains valid in the cache.
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
