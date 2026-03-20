/**
 * Hash Utilities for Element ID Generation
 *
 * Generates short, collision-resistant hashes from CSS selectors.
 * Used for creating unique element IDs that persist across page changes.
 */

/**
 * Generate a short hash (max 6 characters) from a CSS path and optional HTML content
 *
 * Uses FNV-1a hash algorithm for good distribution and speed.
 * Encodes result in base36 for compact representation.
 *
 * @param cssPath - CSS selector path to hash
 * @param html - Optional HTML content to include in hash (for dynamic content detection)
 * @param salt - Optional salt for collision resolution (default: 0)
 * @returns 6-character hash string
 */
export function generateShortHash(
  cssPath: string,
  html?: string,
  salt: number = 0,
): string {
  // FNV-1a hash constants
  const FNV_PRIME = 0x01000193;
  const FNV_OFFSET = 0x811c9dc5;

  // Combine path + html + salt for collision resolution and content-aware hashing
  // Format: cssPath or cssPath:html:salt (if html or salt provided)
  let input = cssPath;
  if (html) {
    input = `${cssPath}:${html}`;
  }
  if (salt > 0) {
    input = `${input}:${salt}`;
  }

  // Compute FNV-1a hash
  let hash = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }

  // Convert to unsigned 32-bit integer
  hash = hash >>> 0;

  // Encode to base36 (0-9, a-z) for compact representation
  // 32-bit max in base36 is at most 6 characters (zzzzzz = 2176782335)
  const base36 = hash.toString(36);

  // Pad to 6 characters or truncate if needed
  return base36.padStart(6, '0').slice(-6);
}

/**
 * Generate a unique hash with collision detection
 *
 * If the generated hash collides with an existing one, increments salt
 * and rehashes until a unique hash is found.
 *
 * @param cssPath - CSS selector path to hash
 * @param existingHashes - Set of already-used hashes for collision detection
 * @param html - Optional HTML content to include in hash (for dynamic content detection)
 * @param maxAttempts - Maximum rehash attempts before giving up (default: 100)
 * @returns Object containing the unique hash and the salt used
 */
export function generateUniqueHash(
  cssPath: string,
  existingHashes: Set<string>,
  html?: string,
  maxAttempts: number = 100,
): { hash: string; salt: number } {
  let salt = 0;

  while (salt < maxAttempts) {
    const hash = generateShortHash(cssPath, html, salt);

    if (!existingHashes.has(hash)) {
      return { hash, salt };
    }

    salt++;
  }

  // Fallback: use timestamp-based salt if max attempts exceeded
  // This should be extremely rare
  const fallbackSalt = Date.now();
  return {
    hash: generateShortHash(cssPath, html, fallbackSalt),
    salt: fallbackSalt,
  };
}

/**
 * Generate element ID from CSS path and HTML content
 *
 * Returns a pure 6-character hash (e.g., "a3f2b1", "9z8x7c")
 *
 * @param _type - Element type prefix (unused, kept for API compatibility)
 * @param cssPath - CSS selector path to hash
 * @param existingHashes - Set of already-used hashes for collision detection
 * @param html - Optional HTML content to include in hash (for dynamic content detection)
 * @returns Object containing the element ID (pure hash) and the hash
 */
export function generateElementId(
  _type: string,
  cssPath: string,
  existingHashes: Set<string>,
  html?: string,
): { id: string; hash: string } {
  const { hash } = generateUniqueHash(cssPath, existingHashes, html);
  const id = hash;

  return { id, hash };
}
