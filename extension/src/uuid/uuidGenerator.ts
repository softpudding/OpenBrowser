/**
 * UUID Generator for Browser Identification
 * 
 * Generates and persists a unique identifier for this browser instance.
 * Uses Chrome's crypto.randomUUID() API (available in Chrome 92+).
 */

const STORAGE_KEY = 'openbrowser_browser_uuid';

/**
 * Generate a UUID4 using the Web Crypto API
 * 
 * Uses crypto.randomUUID() which is available in Chrome 92+ and
 * generates cryptographically secure random UUIDs.
 * 
 * @returns A UUID4 string (e.g., "550e8400-e29b-41d4-a716-446655440000")
 */
export function generateUUID(): string {
  return crypto.randomUUID();
}

/**
 * Get existing UUID from storage or create a new one
 * 
 * This is the main entry point for obtaining a browser UUID.
 * If a UUID already exists in chrome.storage.local, it returns that.
 * Otherwise, it generates a new UUID, stores it, and returns it.
 * 
 * @returns Promise resolving to the browser's UUID
 */
export async function getOrCreateUUID(): Promise<string> {
  try {
    // Try to get existing UUID from storage
    const result = await chrome.storage.local.get(STORAGE_KEY);
    
    if (result[STORAGE_KEY]) {
      console.log(`[UUID] Retrieved existing UUID: ${result[STORAGE_KEY]}`);
      return result[STORAGE_KEY] as string;
    }
    
    // No existing UUID, generate and store a new one
    const newUUID = generateUUID();
    await storeUUID(newUUID);
    console.log(`[UUID] Generated and stored new UUID: ${newUUID}`);
    return newUUID;
  } catch (error) {
    console.error('[UUID] Error getting/creating UUID:', error);
    // Fallback: generate a UUID without storage (will be regenerated on next load)
    return generateUUID();
  }
}

/**
 * Store a UUID in chrome.storage.local
 * 
 * @param uuid - The UUID string to store
 * @returns Promise that resolves when storage is complete
 */
export async function storeUUID(uuid: string): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: uuid });
    console.log(`[UUID] Stored UUID: ${uuid}`);
  } catch (error) {
    console.error('[UUID] Error storing UUID:', error);
    throw error;
  }
}

/**
 * Clear the stored UUID from chrome.storage.local
 * 
 * This is useful for testing or when a user wants to reset their browser identity.
 * 
 * @returns Promise that resolves when storage is cleared
 */
export async function clearUUID(): Promise<void> {
  try {
    await chrome.storage.local.remove(STORAGE_KEY);
    console.log('[UUID] Cleared stored UUID');
  } catch (error) {
    console.error('[UUID] Error clearing UUID:', error);
    throw error;
  }
}