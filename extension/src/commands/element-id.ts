import type { InteractiveElement } from '../types';

export const ELEMENT_ID_CHARSET = '123456789ACDEFHJKMNOPQRTUVWXY';
export const ELEMENT_ID_LENGTH = 3;
const ELEMENT_ID_SPACE = ELEMENT_ID_CHARSET.length ** ELEMENT_ID_LENGTH;
const NORMALIZABLE_ELEMENT_ID_PATTERN = /^[0-9A-Za-z]{3}$/;
const AMBIGUOUS_ELEMENT_ID_CHAR_MAP: Record<string, string> = {
  '0': 'O',
  o: 'O',
  O: 'O',
  i: '1',
  I: '1',
  l: '1',
  L: '1',
  z: '2',
  Z: '2',
  s: '5',
  S: '5',
  g: '6',
  G: '6',
  b: '8',
  B: '8',
};

function encodeFixedVisualId(value: number): string {
  let remaining = value;
  const chars = Array.from(
    { length: ELEMENT_ID_LENGTH },
    () => ELEMENT_ID_CHARSET[0],
  );

  for (let index = ELEMENT_ID_LENGTH - 1; index >= 0; index -= 1) {
    chars[index] = ELEMENT_ID_CHARSET[remaining % ELEMENT_ID_CHARSET.length];
    remaining = Math.floor(remaining / ELEMENT_ID_CHARSET.length);
  }

  return chars.join('');
}

/**
 * Derive the stable hash input for an element.
 *
 * Prefers the detection-time ``fingerprint`` (tag + semantic attrs + text;
 * see ``getElementFingerprint`` in highlight-detection.injected.js) because
 * it does not change when an element gains a runtime ``:focus``, when an
 * ``<input>``'s ``value`` attribute updates on each keystroke, when
 * ``aria-expanded`` flips, or when the app toggles state classes. Falls
 * back to the raw ``outerHTML`` for call sites or legacy tests that have
 * not populated ``fingerprint`` yet, then to the empty string for elements
 * with neither.
 *
 * Without this, ``<select>``, ``<details>``, and input-typing flows all
 * churn their element_id between highlight refreshes, breaking the agent's
 * expectation that a just-clicked element keeps its short label.
 */
export function getStableIdentityInput(element: InteractiveElement): string {
  if (typeof element.fingerprint === 'string' && element.fingerprint.length > 0) {
    return element.fingerprint;
  }
  return element.html ?? '';
}

/**
 * Generate a short stable hash from a selector and optional identity input.
 *
 * Uses FNV-1a for speed and reasonable distribution, then projects into the
 * fixed 3-character visual-safe ID space used by highlight labels. The
 * second positional argument is historically called ``html`` for backward
 * compatibility; callers with an ``InteractiveElement`` should pass
 * ``getStableIdentityInput(element)`` so the hash survives state changes.
 */
export function generateShortHash(
  cssPath: string,
  identity?: string,
  salt: number = 0,
): string {
  const FNV_PRIME = 0x01000193;
  const FNV_OFFSET = 0x811c9dc5;

  let input = identity ? `${cssPath}:${identity}` : cssPath;
  if (salt > 0) {
    input = `${input}:${salt}`;
  }

  let hash = FNV_OFFSET;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }

  return encodeFixedVisualId((hash >>> 0) % ELEMENT_ID_SPACE);
}

export function generateUniqueHash(
  cssPath: string,
  existingHashes: Set<string>,
  identity?: string,
  maxAttempts: number = 512,
): { hash: string; salt: number } {
  let salt = 0;

  while (salt < maxAttempts) {
    const hash = generateShortHash(cssPath, identity, salt);
    if (!existingHashes.has(hash)) {
      return { hash, salt };
    }
    salt += 1;
  }

  const fallbackSalt = Date.now();
  return {
    hash: generateShortHash(cssPath, identity, fallbackSalt),
    salt: fallbackSalt,
  };
}

export function normalizeVisualElementIdInput(value: string): string {
  const compact = value.trim().replace(/\s+/g, '');
  if (!compact) {
    return '';
  }

  if (!NORMALIZABLE_ELEMENT_ID_PATTERN.test(compact)) {
    return compact;
  }

  return compact
    .split('')
    .map((char) => {
      const mapped = AMBIGUOUS_ELEMENT_ID_CHAR_MAP[char];
      if (mapped) {
        return mapped;
      }

      return char.toUpperCase();
    })
    .join('');
}

export function buildElementIdentityKey(element: InteractiveElement): string {
  return `${element.selector}\u0000${getStableIdentityInput(element)}`;
}

/**
 * Assign short hash IDs that stay stable for the same selector/content.
 *
 * IDs are opaque references, not sequence numbers.
 */
export function assignHashedElementIds(
  elements: InteractiveElement[],
): InteractiveElement[] {
  const existingHashes = new Set<string>();
  const assignedIds = new Array<string>(elements.length);

  const elementsByStableKey = elements
    .map((element, index) => ({
      element,
      index,
      identityKey: buildElementIdentityKey(element),
    }))
    .sort((left, right) => {
      const keyOrder = left.identityKey.localeCompare(right.identityKey);
      if (keyOrder !== 0) {
        return keyOrder;
      }
      return left.index - right.index;
    });

  for (const { element, index } of elementsByStableKey) {
    const { hash } = generateUniqueHash(
      element.selector,
      existingHashes,
      getStableIdentityInput(element),
    );
    existingHashes.add(hash);
    assignedIds[index] = hash;
  }

  return elements.map((element, index) => {
    const assignedId = assignedIds[index];
    if (!assignedId) {
      throw new Error(
        `Failed to assign an element ID for selector "${element.selector}"`,
      );
    }

    return {
      ...element,
      bbox: { ...element.bbox },
      id: assignedId,
    };
  });
}
