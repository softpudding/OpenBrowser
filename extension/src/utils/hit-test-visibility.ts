export interface HitTestPoint {
  x: number;
  y: number;
}

export interface TopLayerCandidate {
  zIndex: number;
  domOrder: number;
}

const TOP_LAYER_SELECTORS = [
  'dialog[open]',
  '[aria-modal="true"]',
  '.modal-overlay',
  '[role="dialog"]',
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function getHitTestSamplePoints(
  rect: { x: number; y: number; width: number; height: number },
  viewportWidth: number,
  viewportHeight: number,
): HitTestPoint[] {
  if (rect.width <= 0 || rect.height <= 0) {
    return [];
  }

  const insetX = Math.min(Math.max(rect.width * 0.2, 2), rect.width / 2);
  const insetY = Math.min(Math.max(rect.height * 0.2, 2), rect.height / 2);

  const rawPoints = [
    { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
    { x: rect.x + insetX, y: rect.y + insetY },
    { x: rect.x + rect.width - insetX, y: rect.y + insetY },
    { x: rect.x + insetX, y: rect.y + rect.height - insetY },
    {
      x: rect.x + rect.width - insetX,
      y: rect.y + rect.height - insetY,
    },
  ];

  const seen = new Set<string>();
  const points: HitTestPoint[] = [];

  for (const point of rawPoints) {
    const clamped = {
      x: clamp(point.x, 0, Math.max(0, viewportWidth - 1)),
      y: clamp(point.y, 0, Math.max(0, viewportHeight - 1)),
    };
    const key = `${Math.round(clamped.x)}:${Math.round(clamped.y)}`;
    if (!seen.has(key)) {
      seen.add(key);
      points.push(clamped);
    }
  }

  return points;
}

export function pickTopLayerCandidate<T extends TopLayerCandidate>(
  candidates: T[],
): T | null {
  if (candidates.length === 0) {
    return null;
  }

  return candidates.reduce((best, current) => {
    if (current.zIndex !== best.zIndex) {
      return current.zIndex > best.zIndex ? current : best;
    }
    return current.domOrder > best.domOrder ? current : best;
  });
}

export function buildHitTestVisibilityHelpersScript(): string {
  return `
    const TOP_LAYER_SELECTORS = ${JSON.stringify(TOP_LAYER_SELECTORS)};

    function normalizeHitTestElement(node) {
      return node instanceof Element ? node : null;
    }

    function getNumericZIndex(el) {
      const raw = window.getComputedStyle(el).zIndex;
      const parsed = Number.parseInt(raw, 10);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    function describeElement(el) {
      if (!el) {
        return 'unknown element';
      }

      const tag = el.tagName ? el.tagName.toLowerCase() : 'element';
      const id = el.id ? '#' + el.id : '';
      const className =
        typeof el.className === 'string' && el.className.trim()
          ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.')
          : '';
      return tag + id + className;
    }

    function isElementStyleVisible(el) {
      if (!(el instanceof Element)) {
        return false;
      }
      const style = window.getComputedStyle(el);
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0'
      );
    }

    function hasVisibleBox(el) {
      if (!(el instanceof HTMLElement)) {
        return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function resolveTopLayerRoot(node) {
      if (!(node instanceof HTMLElement)) {
        return null;
      }

      if (!node.matches('.modal-overlay')) {
        return node;
      }

      let current = node.parentElement;
      while (current && current !== document.body) {
        const hasVisibleSiblingContent = Array.from(current.children).some(
          (child) =>
            child !== node &&
            child instanceof HTMLElement &&
            isElementStyleVisible(child) &&
            hasVisibleBox(child),
        );

        if (hasVisibleSiblingContent) {
          return current;
        }

        current = current.parentElement;
      }

      return node.parentElement instanceof HTMLElement ? node.parentElement : node;
    }

    function getActiveTopLayerRoot() {
      const candidates = [];
      let domOrder = 0;

      for (const selector of TOP_LAYER_SELECTORS) {
        const nodes = document.querySelectorAll(selector);
        for (const node of nodes) {
          if (!(node instanceof HTMLElement)) {
            continue;
          }
          if (!isElementStyleVisible(node)) {
            continue;
          }
          if (!hasVisibleBox(node)) {
            continue;
          }
          const root = resolveTopLayerRoot(node);
          if (!(root instanceof HTMLElement)) {
            continue;
          }
          if (!isElementStyleVisible(root) || !hasVisibleBox(root)) {
            continue;
          }
          candidates.push({
            node: root,
            zIndex: getNumericZIndex(node),
            domOrder: domOrder++,
          });
        }
      }

      if (candidates.length === 0) {
        return null;
      }

      return candidates.reduce((best, current) => {
        if (current.zIndex !== best.zIndex) {
          return current.zIndex > best.zIndex ? current : best;
        }
        return current.domOrder > best.domOrder ? current : best;
      }).node;
    }

    function isElementInActiveTopLayer(el, activeRoot) {
      return !activeRoot || activeRoot === el || activeRoot.contains(el);
    }

    function isRelatedHitTarget(hit, target) {
      if (!(hit instanceof Element) || !(target instanceof Element)) {
        return false;
      }
      return hit === target || hit.contains(target) || target.contains(hit);
    }

    function getHitTestSamplePoints(rect) {
      if (rect.width <= 0 || rect.height <= 0) {
        return [];
      }

      const insetX = Math.min(Math.max(rect.width * 0.2, 2), rect.width / 2);
      const insetY = Math.min(Math.max(rect.height * 0.2, 2), rect.height / 2);
      const rawPoints = [
        { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
        { x: rect.x + insetX, y: rect.y + insetY },
        { x: rect.x + rect.width - insetX, y: rect.y + insetY },
        { x: rect.x + insetX, y: rect.y + rect.height - insetY },
        { x: rect.x + rect.width - insetX, y: rect.y + rect.height - insetY },
      ];

      const seen = new Set();
      const points = [];

      for (const point of rawPoints) {
        const clamped = {
          x: Math.min(Math.max(point.x, 0), Math.max(0, window.innerWidth - 1)),
          y: Math.min(Math.max(point.y, 0), Math.max(0, window.innerHeight - 1)),
        };
        const key = Math.round(clamped.x) + ':' + Math.round(clamped.y);
        if (!seen.has(key)) {
          seen.add(key);
          points.push(clamped);
        }
      }

      return points;
    }

    function getElementHitTestVisibility(el) {
      const rect = el.getBoundingClientRect();
      const samplePoints = getHitTestSamplePoints(rect);

      if (samplePoints.length === 0) {
        return { visible: false, occludedBy: null };
      }

      for (const point of samplePoints) {
        const stack = document.elementsFromPoint(point.x, point.y);
        const top = normalizeHitTestElement(stack[0]);
        if (isRelatedHitTarget(top, el)) {
          return { visible: true, occludedBy: null };
        }
      }

      const fallbackStack = document.elementsFromPoint(
        samplePoints[0].x,
        samplePoints[0].y,
      );
      const fallbackTop = normalizeHitTestElement(fallbackStack[0]);
      return {
        visible: false,
        occludedBy: describeElement(fallbackTop),
      };
    }
  `;
}
