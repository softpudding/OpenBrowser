import { buildHighlightDetectionScript } from './highlight-detection';
import { executeJavaScript } from './javascript';
import type { InteractiveElement } from '../types';

export interface PixelTargetCandidate {
  selector: string;
  tagName: string;
  type: string;
  interactionHints?: string[];
  text?: string;
  searchText?: string;
  html?: string;
  bbox: { x: number; y: number; width: number; height: number };
  center: { x: number; y: number };
  distance: number;
  fingerprint?: string;
  descriptor?: unknown;
}

export interface PixelTargetAnalysis {
  viewport: { width: number; height: number };
  hit: PixelTargetCandidate | null;
  neighborhood: PixelTargetCandidate[];
  verdict: 'sparse' | 'dense';
  documentId?: string;
}

const DETECTION_TIMEOUT_MS = 12000;
const MIN_CANDIDATE_DIM = 6;

/**
 * Min Euclidean distance from `(x, y)` to the closest point on `bbox`.
 * Returns 0 when `(x, y)` is inside the rectangle. Used for the verdict
 * trigger ("are the interactables overlapping the click area?").
 */
function distanceToBbox(
  x: number,
  y: number,
  bbox: { x: number; y: number; width: number; height: number },
): number {
  const left = bbox.x;
  const top = bbox.y;
  const right = bbox.x + bbox.width;
  const bottom = bbox.y + bbox.height;
  const dx = x < left ? left - x : x > right ? x - right : 0;
  const dy = y < top ? top - y : y > bottom ? y - bottom : 0;
  return Math.hypot(dx, dy);
}

/**
 * Euclidean distance from `(x, y)` to the bbox center. Used to rank /
 * filter candidates for the agent's display: a wrapper container whose
 * edge happens to be 5 px away but whose center is hundreds of pixels
 * away is not visually adjacent to the click, so it shouldn't surface
 * as a "nearby candidate" alternative.
 */
function distanceToCenter(
  x: number,
  y: number,
  bbox: { x: number; y: number; width: number; height: number },
): number {
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;
  return Math.hypot(x - cx, y - cy);
}

function bboxArea(bbox: { width: number; height: number }): number {
  return Math.max(0, bbox.width) * Math.max(0, bbox.height);
}

function toCandidate(
  el: InteractiveElement,
  px: number,
  py: number,
): PixelTargetCandidate {
  const center = {
    x: Math.round(el.bbox.x + el.bbox.width / 2),
    y: Math.round(el.bbox.y + el.bbox.height / 2),
  };
  return {
    selector: el.selector,
    tagName: el.tagName,
    type: el.type,
    interactionHints: el.interactionHints,
    text: el.text,
    searchText: el.searchText,
    html: el.html,
    bbox: {
      x: Math.round(el.bbox.x),
      y: Math.round(el.bbox.y),
      width: Math.round(el.bbox.width),
      height: Math.round(el.bbox.height),
    },
    center,
    distance: Math.round(distanceToCenter(px, py, el.bbox)),
    fingerprint: el.fingerprint,
    descriptor: el.descriptor,
  };
}

export async function analyzePixelTargets(
  tabId: number,
  conversationId: string,
  x: number,
  y: number,
  radius: number,
  candidateLimit: number,
): Promise<PixelTargetAnalysis> {
  const detectionScript = buildHighlightDetectionScript({
    elementType: 'any',
  });

  const detection = await executeJavaScript(
    tabId,
    conversationId,
    detectionScript,
    true,
    true,
    DETECTION_TIMEOUT_MS,
  );

  if (!detection.success || !detection.result?.value) {
    throw new Error(
      detection.error || 'analyze_pixel_targets: failed to detect elements',
    );
  }

  const value = detection.result.value as {
    elements?: InteractiveElement[];
    viewport?: { width?: number; height?: number };
    documentId?: string;
  };

  const viewportWidth =
    typeof value.viewport?.width === 'number' ? value.viewport!.width : 0;
  const viewportHeight =
    typeof value.viewport?.height === 'number' ? value.viewport!.height : 0;
  const documentId =
    typeof value.documentId === 'string' ? value.documentId : undefined;

  const all = (value.elements || []).filter(
    (el) =>
      el &&
      el.bbox &&
      el.isVisible &&
      el.isInViewport &&
      (el.bbox.width >= MIN_CANDIDATE_DIM ||
        el.bbox.height >= MIN_CANDIDATE_DIM),
  );

  // Hit detection: smallest bbox containing the point, tiebreaking by smallest area.
  let hit: InteractiveElement | null = null;
  let hitArea = Number.POSITIVE_INFINITY;
  for (const el of all) {
    const inside =
      x >= el.bbox.x &&
      x <= el.bbox.x + el.bbox.width &&
      y >= el.bbox.y &&
      y <= el.bbox.y + el.bbox.height;
    if (!inside) continue;
    const area = bboxArea(el.bbox);
    if (area < hitArea) {
      hit = el;
      hitArea = area;
    }
  }

  // Neighborhood: only elements whose bbox sits NEAR but not AROUND the
  // click. A wrapper `<div>` whose bbox engulfs the click would otherwise
  // report distance=0 (point inside) and slide into the list even when its
  // center is hundreds of pixels away — useless guidance for course
  // correction. The hit element (smallest containing) is reported on its
  // own; everything else must be a true outside-but-close neighbor.
  const isOutside = (b: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => x < b.x || x > b.x + b.width || y < b.y || y > b.y + b.height;

  // Two distinct distance metrics, each with its own threshold:
  //
  //   - Verdict (edge distance, threshold `radius` ≈ 30 px): "is the
  //     click ambiguous?". Edge distance captures whether two
  //     interactables visually overlap the click area, which is exactly
  //     the case where the agent could have meant either. Center
  //     distance would miss this (two adjacent buttons can have centers
  //     80 px apart while their edges sit a few px from the click).
  //
  //   - Display (center distance, threshold `displayCenterRadius`
  //     ≈ 140 px): "what to surface as alternatives if we gate?". Center
  //     distance naturally drops bulky wrapper containers — their bbox
  //     edge may extend close to the click, but their center sits far
  //     away — while keeping genuinely adjacent toolbar controls.
  const displayCenterRadius = 140;

  const outsideNeighbors = all
    .filter((el) => isOutside(el.bbox))
    .map((el) => ({
      el,
      edgeDistance: distanceToBbox(x, y, el.bbox),
      centerDistance: distanceToCenter(x, y, el.bbox),
    }))
    .filter((row) => row.centerDistance <= displayCenterRadius)
    .sort((a, b) => a.centerDistance - b.centerDistance);

  const hitSelector = hit?.selector;
  const siblingCandidates = outsideNeighbors
    .filter((row) => !hitSelector || row.el.selector !== hitSelector)
    .slice(0, candidateLimit)
    .map((row) => toCandidate(row.el, x, y));

  // Density verdict uses edge distance against the strict `radius`. We
  // don't want a single isolated button to trip the gate just because
  // some unrelated control sits 70 px away.
  const closeByEdge = outsideNeighbors.filter(
    (row) => row.edgeDistance <= radius,
  );
  const totalNearby = closeByEdge.length + (hit ? 1 : 0);
  const verdict: 'sparse' | 'dense' = totalNearby >= 2 ? 'dense' : 'sparse';

  return {
    viewport: { width: viewportWidth, height: viewportHeight },
    hit: hit ? toCandidate(hit, x, y) : null,
    neighborhood: siblingCandidates,
    verdict,
    documentId,
  };
}
