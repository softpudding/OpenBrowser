/**
 * Computer Tool Implementation
 * Based on AIPex computer.ts
 * Handles mouse control, keyboard input, and screenshots
 */

import { CdpCommander } from './cdp-commander';
import { debuggerManager } from './debugger-manager';
import type { ScreenshotMetadata } from '../types';

// Cache for screenshot metadata per tab
const screenshotCache = new Map<number, ScreenshotMetadata>();

/**
 * Cache screenshot metadata for a tab
 */
export function cacheScreenshotMetadata(
  tabId: number,
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): void {
  const metadata: ScreenshotMetadata = {
    imageWidth,
    imageHeight,
    viewportWidth,
    viewportHeight,
    timestamp: Date.now(),
    tabId,
  };
  screenshotCache.set(tabId, metadata);
  console.log(
    `📸 [Computer] Screenshot metadata cached for tab ${tabId}: ${imageWidth}x${imageHeight} image, ${viewportWidth}x${viewportHeight} viewport`,
  );
}

// Preset coordinate system configuration
// Center at (0,0), 2K resolution (2560x1440) - standard coordinate system
const PRESET_WIDTH = 2560;
const PRESET_HEIGHT = 1440;
const PRESET_CENTER_X = 0;
const PRESET_CENTER_Y = 0;
const PRESET_MIN_X = -PRESET_WIDTH / 2;  // -1280
const PRESET_MAX_X = PRESET_WIDTH / 2;   // 1280
const PRESET_MIN_Y = -PRESET_HEIGHT / 2; // -720
const PRESET_MAX_Y = PRESET_HEIGHT / 2;  // 720

// Track mouse positions in PRESET coordinate system (center-based)
const mousePositions = new Map<number, {x: number, y: number}>();
// Cache viewport sizes per tab
const viewportSizes = new Map<number, {width: number, height: number}>();
// Cache timestamps for viewport sizes
const viewportCacheTimestamps = new Map<number, number>();

/**
 * Get viewport size from content script
 */
async function getViewportSize(tabId: number): Promise<{width: number, height: number}> {
  console.log(`🖥️ [Computer] Getting viewport size for tab ${tabId}`);
  
  try {
    // First, try to get viewport size from content script in MAIN FRAME (frameId: 0)
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'get_viewport'
    }, { frameId: 0 }); // Specify frameId: 0 for main frame only
    
    console.log(`🖥️ [Computer] Received response from content script:`, response);
    
    if (response?.success && response.data) {
      const { width, height } = response.data;
      console.log(`🖥️ [Computer] Viewport size from content script: width=${width}, height=${height}`);
      
      // Validate dimensions - also check for special failure value (-1)
      const isValid = typeof width === 'number' && typeof height === 'number' &&
                     width > 0 && height > 0 && isFinite(width) && isFinite(height);
      
      if (isValid) {
        const size = { width, height };
        viewportSizes.set(tabId, size);
        viewportCacheTimestamps.set(tabId, Date.now());
        console.log(`✅ [Computer] Valid viewport size obtained: ${width}x${height}`);
        return size;
      } else {
        console.warn(`⚠️ [Computer] Invalid dimensions received: width=${width} (type: ${typeof width}), height=${height} (type: ${typeof height})`);
        // Don't return, fall through to backup methods
      }
    } else {
      console.warn(`⚠️ [Computer] Invalid response from content script:`, response);
    }
  } catch (error) {
    console.error(`❌ [Computer] Failed to get viewport size from content script:`, error);
    console.error(`📝 Error details:`, error instanceof Error ? error.message : 'Unknown error');
  }
  
  // If content script fails, try to get window size directly via chrome.tabs API
  console.log(`🔄 [Computer] Trying to get window size via chrome.tabs API`);
  try {
    const tab = await chrome.tabs.get(tabId);
    const window = await chrome.windows.get(tab.windowId);
    
    // Note: window.width and window.height include browser chrome (toolbars, etc.)
    // This is not the same as window.innerWidth, but it's better than nothing
    if (window.width && window.height) {
      // Estimate viewport size (subtract approx browser chrome)
      const estimatedWidth = Math.max(100, window.width - 50);
      const estimatedHeight = Math.max(100, window.height - 150);
      
      console.log(`🖥️ [Computer] Window size from chrome API: ${window.width}x${window.height}, estimated viewport: ${estimatedWidth}x${estimatedHeight}`);
      
      const size = { width: estimatedWidth, height: estimatedHeight };
      viewportSizes.set(tabId, size);
      viewportCacheTimestamps.set(tabId, Date.now());
      console.log(`✅ [Computer] Using estimated viewport size: ${estimatedWidth}x${estimatedHeight}`);
      return size;
    }
  } catch (windowError) {
    console.error(`❌ [Computer] Failed to get window size:`, windowError);
  }
  
  // Fallback to cached value if available (from previous successful attempt)
  if (viewportSizes.has(tabId)) {
    const cached = viewportSizes.get(tabId)!;
    const cacheTime = viewportCacheTimestamps.get(tabId) || Date.now();
    const cacheAge = Date.now() - cacheTime;
    console.log(`🔄 [Computer] Using previously cached viewport size: ${cached.width}x${cached.height} (cached ${cacheAge}ms ago)`);
    return cached;
  }
  
  // Ultimate fallback to reasonable defaults
  console.warn(`⚠️ [Computer] All methods failed, using default viewport size`);
  const defaultSize = { width: 800, height: 600 }; // Smaller default since we saw 800x600
  viewportSizes.set(tabId, defaultSize);
  viewportCacheTimestamps.set(tabId, Date.now());
  return defaultSize;
}

/**
 * Convert preset coordinates (center-based) to actual screen coordinates
 * @param presetX X in preset coordinate system (center at 0)
 * @param presetY Y in preset coordinate system (center at 0)  
 * @param viewport Actual viewport size
 * @returns Actual screen coordinates (top-left based)
 */
function presetToActualCoords(
  presetX: number,
  presetY: number,
  viewport: {width: number, height: number}
): {actualX: number, actualY: number} {
  // Convert from center-based to top-left based
  const presetXTopLeft = presetX + PRESET_WIDTH / 2;
  const presetYTopLeft = presetY + PRESET_HEIGHT / 2;
  
  // Scale to actual viewport
  const actualX = (presetXTopLeft / PRESET_WIDTH) * viewport.width;
  const actualY = (presetYTopLeft / PRESET_HEIGHT) * viewport.height;
  
  // Clamp to viewport bounds
  return {
    actualX: Math.max(0, Math.min(actualX, viewport.width - 1)),
    actualY: Math.max(0, Math.min(actualY, viewport.height - 1))
  };
}

/**
 * Convert actual screen coordinates to preset coordinates
 * @param actualX X in actual screen coordinates (top-left based)
 * @param actualY Y in actual screen coordinates (top-left based)
 * @param viewport Actual viewport size
 * @returns Preset coordinates (center-based)
 */
function actualToPresetCoords(
  actualX: number,
  actualY: number,
  viewport: {width: number, height: number}
): {presetX: number, presetY: number} {
  // Scale to preset coordinate system
  const presetXTopLeft = (actualX / viewport.width) * PRESET_WIDTH;
  const presetYTopLeft = (actualY / viewport.height) * PRESET_HEIGHT;
  
  // Convert from top-left based to center-based
  return {
    presetX: presetXTopLeft - PRESET_WIDTH / 2,
    presetY: presetYTopLeft - PRESET_HEIGHT / 2
  };
}

/**
 * Initialize or get mouse position for a tab
 */
function getOrInitializeMousePosition(tabId: number): {x: number, y: number} {
  if (!mousePositions.has(tabId)) {
    // Default to center of preset coordinate system (0,0)
    mousePositions.set(tabId, { x: PRESET_CENTER_X, y: PRESET_CENTER_Y });
  }
  return mousePositions.get(tabId)!;
}

/**
 * Convert screenshot pixel coordinates to viewport CSS pixels
 * Handles both resized screenshots (2560×1440) and original screenshots
 */
function screenshotToCssPixels(
  x: number,
  y: number,
  metadata: ScreenshotMetadata,
): { xCss: number; yCss: number } {
  const { imageWidth, imageHeight, viewportWidth, viewportHeight } = metadata;
  
  // Check if screenshot is already resized to preset coordinate system dimensions
  const isResizedToPreset = imageWidth === PRESET_WIDTH && imageHeight === PRESET_HEIGHT;
  
  let screenshotX: number;
  let screenshotY: number;
  
  if (isResizedToPreset) {
    // Screenshot is already 2560×1440 - use direct mapping from simulated coordinates
    // Convert from simulated coordinates (center-based) to screenshot pixel coordinates (top-left based)
    // Simulated: (-1280, -720) to (1280, 720), center at (0, 0)
    // Screenshot pixels: (0, 0) to (2559, 1439), top-left at (0, 0)
    screenshotX = x + PRESET_WIDTH / 2;
    screenshotY = y + PRESET_HEIGHT / 2;
    
    console.log(`🖼️ [Computer] Screenshot is preset size (${PRESET_WIDTH}×${PRESET_HEIGHT}), using direct mapping`);
  } else {
    // Original screenshot with different dimensions - need to convert
    // First, convert simulated coordinates to preset coordinate system pixels
    const presetX = x + PRESET_WIDTH / 2;
    const presetY = y + PRESET_HEIGHT / 2;
    
    // Then scale from preset dimensions to actual screenshot dimensions
    screenshotX = Math.round((presetX / PRESET_WIDTH) * imageWidth);
    screenshotY = Math.round((presetY / PRESET_HEIGHT) * imageHeight);
    
    console.log(`🖼️ [Computer] Screenshot is ${imageWidth}×${imageHeight}, scaling from preset coordinates`);
  }
  
  // Now scale screenshot pixel coordinates to viewport CSS pixels
  const xCss = Math.round((screenshotX / imageWidth) * viewportWidth);
  const yCss = Math.round((screenshotY / imageHeight) * viewportHeight);

  // Clamp to viewport bounds
  return {
    xCss: Math.max(0, Math.min(xCss, viewportWidth - 1)),
    yCss: Math.max(0, Math.min(yCss, viewportHeight - 1)),
  };
}

/**
 * Perform a click action
 */
async function performClick(
  tabId: number,
  x: number,
  y: number,
  button: 'left' | 'right' | 'middle',
  clickCount: number = 1,
): Promise<any> {
  // If coordinates are (0,0), use our tracked mouse position
  let targetX = x;
  let targetY = y;
  
  if (x === 0 && y === 0) {
    // Use tracked mouse position
    const trackedPos = getOrInitializeMousePosition(tabId);
    targetX = trackedPos.x;
    targetY = trackedPos.y;
    console.log(`🖱️ [Computer] Using tracked mouse position: (${targetX}, ${targetY})`);
  } else {
    // Update our tracked position to the provided coordinates
    mousePositions.set(tabId, { x: targetX, y: targetY });
  }

  // Convert preset coordinates to actual screen coordinates (consistent with mouse_move and scroll)
  const viewport = await getViewportSize(tabId);
  const { actualX, actualY } = presetToActualCoords(targetX, targetY, viewport);
  const xCss = actualX;
  const yCss = actualY;
  console.log(
    `🖱️ [Computer] ${button}_click at preset (${targetX},${targetY}) -> actual (${xCss},${yCss}) viewport(${viewport.width}x${viewport.height})`,
  );

  const attached = await debuggerManager.safeAttachDebugger(tabId);
  if (!attached) {
    throw new Error('Failed to attach debugger');
  }

  const cdpCommander = new CdpCommander(tabId);
  const buttonType = button === 'right' ? 'right' : 'left';

  try {
    // First, move mouse to the target position (hover) before clicking
    console.log(`🖱️ [Computer] Moving mouse to (${xCss}, ${yCss}) before click`);
    try {
      await cdpCommander.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: xCss,
        y: yCss,
      });
      console.log(`✅ [Computer] Mouse move command successful`);
    } catch (moveError) {
      console.error(`❌ [Computer] Mouse move command failed:`, moveError);
      throw moveError;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Perform click sequence
    for (let i = 0; i < clickCount; i++) {
      console.log(`🖱️ [Computer] Sending mousePressed at (${xCss}, ${yCss}) with button: ${buttonType}`);
      try {
        await cdpCommander.sendCommand('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: xCss,
          y: yCss,
          button: buttonType,
          clickCount: 1,
        });
        console.log(`✅ [Computer] mousePressed command successful`);
      } catch (pressError) {
        console.error(`❌ [Computer] mousePressed command failed:`, pressError);
        throw pressError;
      }

      await new Promise((resolve) => setTimeout(resolve, 50));

      console.log(`🖱️ [Computer] Sending mouseReleased at (${xCss}, ${yCss}) with button: ${buttonType}`);
      try {
        await cdpCommander.sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: xCss,
          y: yCss,
          button: buttonType,
          clickCount: 1,
        });
        console.log(`✅ [Computer] mouseReleased command successful`);
      } catch (releaseError) {
        console.error(`❌ [Computer] mouseReleased command failed:`, releaseError);
        throw releaseError;
      }

      if (i < clickCount - 1) {
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
    }

    return {
      success: true,
      message: `Successfully performed ${button} click at preset (${targetX}, ${targetY}) -> actual (${xCss}, ${yCss})`,
      coordinates: { preset: { x: targetX, y: targetY }, actual: { x: xCss, y: yCss } },
    };
  } finally {
    await debuggerManager.safeDetachDebugger(tabId);
  }
}

/**
 * Perform mouse move (relative movement) with boundary checking
 * dx, dy are in preset coordinate system (center-based)
 */
async function performMouseMove(
  tabId: number,
  dx: number,
  dy: number,
): Promise<any> {
  // Get actual viewport size for coordinate mapping
  const viewport = await getViewportSize(tabId);
  
  // Update tracked mouse position in PRESET coordinate system
  const currentPos = getOrInitializeMousePosition(tabId);
  let newPresetX = currentPos.x + dx;
  let newPresetY = currentPos.y + dy;
  
  // Apply boundary checks in preset coordinate system
  newPresetX = Math.max(PRESET_MIN_X, Math.min(newPresetX, PRESET_MAX_X));
  newPresetY = Math.max(PRESET_MIN_Y, Math.min(newPresetY, PRESET_MAX_Y));
  
  // Save new position in preset coordinates
  mousePositions.set(tabId, { x: newPresetX, y: newPresetY });
  
  // Convert preset coordinates to actual screen coordinates
  const { actualX, actualY } = presetToActualCoords(newPresetX, newPresetY, viewport);
  
  console.log(`Mouse move: preset(${newPresetX.toFixed(1)}, ${newPresetY.toFixed(1)}) -> actual(${actualX.toFixed(0)}, ${actualY.toFixed(0)}) viewport(${viewport.width}x${viewport.height})`);
  
  // Now move the actual mouse via CDP using actual screen coordinates
  const attached = await debuggerManager.safeAttachDebugger(tabId);
  if (!attached) {
    // Even if debugger fails, we still updated our tracked position
    // for visual mouse purposes
    console.warn('Debugger attachment failed, but mouse position tracked for visual feedback');
    
    return {
      success: true,
      message: `Mouse position tracked to preset(${newPresetX.toFixed(1)}, ${newPresetY.toFixed(1)}) -> actual(${actualX.toFixed(0)}, ${actualY.toFixed(0)}). Actual movement may be limited.`,
      data: {
        trackedPosition: { x: newPresetX, y: newPresetY },
        actualPosition: { x: actualX, y: actualY },
        moved: { dx, dy },
        boundedInPreset: (newPresetX !== currentPos.x + dx || newPresetY !== currentPos.y + dy),
      },
    };
  }

  const cdpCommander = new CdpCommander(tabId);

  try {
    // Move mouse to new absolute position via CDP using actual screen coordinates
    await cdpCommander.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: actualX,
      y: actualY,
    });

    console.log(`🖱️ [Computer] Mouse moved to actual(${actualX.toFixed(0)}, ${actualY.toFixed(0)}) preset(${newPresetX.toFixed(1)}, ${newPresetY.toFixed(1)})`);
    
    const boundedInPreset = (newPresetX !== currentPos.x + dx || newPresetY !== currentPos.y + dy);
    let message = `Mouse moved to preset(${newPresetX.toFixed(1)}, ${newPresetY.toFixed(1)}) -> actual(${actualX.toFixed(0)}, ${actualY.toFixed(0)})`;
    if (boundedInPreset) {
      message += ` (position bounded in preset coordinate system)`;
    }
    
    return {
      success: true,
      message: message,
      data: {
        presetPosition: { x: newPresetX, y: newPresetY },
        actualPosition: { x: actualX, y: actualY },
        viewport: viewport,
        moved: { dx, dy },
        bounded: boundedInPreset,
      },
    };
  } catch (error) {
    console.error('Error moving mouse via CDP:', error);
    
    // Even if CDP fails, we still updated our tracked position
    return {
      success: false,
      message: `Failed to move mouse via CDP, but position tracked to preset(${newPresetX.toFixed(1)}, ${newPresetY.toFixed(1)})`,
      error: error instanceof Error ? error.message : 'Unknown error',
      data: {
        trackedPresetPosition: { x: newPresetX, y: newPresetY },
        actualPosition: { x: actualX, y: actualY },
      },
    };
  } finally {
    await debuggerManager.safeDetachDebugger(tabId);
  }
}

/**
 * Reset mouse position to screen center
 */
async function resetMousePosition(
  tabId: number,
): Promise<any> {
  // Reset to center of preset coordinate system (0,0)
  mousePositions.set(tabId, { x: PRESET_CENTER_X, y: PRESET_CENTER_Y });
  
  // Clear cached viewport size to force fresh retrieval from content script
  // This ensures we get the correct viewport size after window resize (e.g., exiting fullscreen)
  console.log(`🧹 [Computer] Clearing viewport cache for tab ${tabId} before reset`);
  viewportSizes.delete(tabId);
  viewportCacheTimestamps.delete(tabId);
  
  // Get actual viewport size for coordinate mapping and CDP movement
  const viewport = await getViewportSize(tabId);
  const { actualX, actualY } = presetToActualCoords(PRESET_CENTER_X, PRESET_CENTER_Y, viewport);
  
  // Round coordinates to nearest integer for CDP
  const roundedX = Math.round(actualX);
  const roundedY = Math.round(actualY);
  
  console.log(`Mouse reset: preset(0, 0) -> actual(${actualX.toFixed(0)}, ${actualY.toFixed(0)}) rounded(${roundedX}, ${roundedY}) viewport(${viewport.width}x${viewport.height})`);
  
  const attached = await debuggerManager.safeAttachDebugger(tabId);
  if (!attached) {
    console.warn('Debugger attachment failed, but mouse position reset tracked');
    
    return {
      success: true,
      message: `Mouse position reset tracked to preset(0, 0) -> actual(${actualX.toFixed(0)}, ${actualY.toFixed(0)}) [viewport: ${viewport.width}x${viewport.height}]. Actual movement may be limited.`,
      data: {
        presetPosition: { x: PRESET_CENTER_X, y: PRESET_CENTER_Y },
        actualPosition: { x: actualX, y: actualY },
        viewport: viewport,
        reset: true,
      },
    };
  }

  const cdpCommander = new CdpCommander(tabId);

  try {
    // Before moving mouse, ensure page is responsive by checking if we can send a simple command
    console.log(`🔍 [Computer] Ensuring page is responsive for tab ${tabId}...`);
    try {
      // Try to get page metrics to check responsiveness
      await cdpCommander.sendCommand('Page.getLayoutMetrics', {}, 5000, 1);
      console.log(`✅ [Computer] Page is responsive`);
    } catch (pageCheckError) {
      console.warn(`⚠️ [Computer] Page responsiveness check failed:`, pageCheckError);
      console.log(`ℹ️ [Computer] This may be a background tab, continuing with mouse reset anyway...`);
    }
    
    // Add a small delay to ensure any pending operations are complete
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Move mouse to actual screen center position
    await cdpCommander.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: roundedX,
      y: roundedY,
    });

    console.log(`🖱️ [Computer] Mouse reset to actual(${roundedX}, ${roundedY}) preset(0, 0)`);
    
    return {
      success: true,
      message: `Mouse reset to preset(0, 0) -> actual(${roundedX}, ${roundedY}) [viewport: ${viewport.width}x${viewport.height}]`,
      data: {
        presetPosition: { x: PRESET_CENTER_X, y: PRESET_CENTER_Y },
        actualPosition: { x: actualX, y: actualY },
        viewport: viewport,
        reset: true,
      },
    };
  } catch (error) {
    console.error('Error resetting mouse via CDP:', error);
    
    return {
      success: false,
      message: `Failed to reset mouse via CDP, but position tracked to preset(0, 0) -> actual(${actualX.toFixed(0)}, ${actualY.toFixed(0)}) [viewport: ${viewport.width}x${viewport.height}]`,
      error: error instanceof Error ? error.message : 'Unknown error',
      data: {
        trackedPresetPosition: { x: PRESET_CENTER_X, y: PRESET_CENTER_Y },
        actualPosition: { x: actualX, y: actualY },
        viewport: viewport,
      },
    };
  } finally {
    await debuggerManager.safeDetachDebugger(tabId);
  }
}

/**
 * Perform keyboard typing
 */
async function performType(
  tabId: number,
  text: string,
): Promise<any> {
  const attached = await debuggerManager.safeAttachDebugger(tabId);
  if (!attached) {
    throw new Error('Failed to attach debugger');
  }

  const cdpCommander = new CdpCommander(tabId);

  try {
    console.log(`⌨️ [Computer] Starting to type: "${text}" (${text.length} characters)`);
    
    // First, try to use Input.insertText which is more reliable for text input
    // This is especially important for non-ASCII characters like Chinese
    console.log(`⌨️ [Computer] Attempting to use Input.insertText for faster/better text input`);
    try {
      await cdpCommander.sendCommand('Input.insertText', {
        text: text,
      });
      console.log(`✅ [Computer] Input.insertText successful for entire text`);
      return {
        success: true,
        message: `Successfully typed: "${text}" (using Input.insertText)`,
      };
    } catch (insertTextError) {
      console.warn(`⚠️ [Computer] Input.insertText failed, falling back to key events:`, insertTextError);
      console.log(`⌨️ [Computer] Falling back to character-by-character typing`);
    }
    
    // Fallback to character-by-character typing if insertText fails
    // Type each character
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const charCode = char.charCodeAt(0);
      const isAscii = charCode < 128;
      
      console.log(`⌨️ [Computer] Typing character ${i+1}/${text.length}: "${char}" (code: ${charCode}, isAscii: ${isAscii})`);
      
      // For ASCII characters, we can use virtual key codes
      // For non-ASCII (like Chinese characters), we need to use Unicode approach
      const windowsVirtualKeyCode = isAscii ? char.toUpperCase().charCodeAt(0) : 0;
      const code = isAscii ? `Key${char.toUpperCase()}` : '';
      
      // Send keyDown event
      console.log(`⌨️ [Computer] Sending keyDown for "${char}"`);
      try {
        await cdpCommander.sendCommand('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: char,
          code: code,
          windowsVirtualKeyCode: windowsVirtualKeyCode,
        });
        console.log(`✅ [Computer] keyDown successful for "${char}"`);
      } catch (keyDownError) {
        console.error(`❌ [Computer] keyDown failed for "${char}":`, keyDownError);
        throw keyDownError;
      }

      await new Promise((resolve) => setTimeout(resolve, 20));
      
      // Send char event (important for text input, especially non-ASCII)
      console.log(`⌨️ [Computer] Sending char event for "${char}"`);
      try {
        await cdpCommander.sendCommand('Input.dispatchKeyEvent', {
          type: 'char',
          key: char,
          code: code,
          windowsVirtualKeyCode: windowsVirtualKeyCode,
          text: char,  // text field is important for char events
        });
        console.log(`✅ [Computer] char event successful for "${char}"`);
      } catch (charError) {
        console.error(`❌ [Computer] char event failed for "${char}":`, charError);
        // Continue anyway, some browsers might not support char event
      }

      await new Promise((resolve) => setTimeout(resolve, 20));
      
      // Send keyUp event
      console.log(`⌨️ [Computer] Sending keyUp for "${char}"`);
      try {
        await cdpCommander.sendCommand('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: char,
          code: code,
          windowsVirtualKeyCode: windowsVirtualKeyCode,
        });
        console.log(`✅ [Computer] keyUp successful for "${char}"`);
      } catch (keyUpError) {
        console.error(`❌ [Computer] keyUp failed for "${char}":`, keyUpError);
        throw keyUpError;
      }

      // Longer delay between characters for readability
      if (i < text.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
    }

    console.log(`✅ [Computer] Finished typing all ${text.length} characters`);
    return {
      success: true,
      message: `Successfully typed: "${text}" (using fallback key events)`,
    };
  } finally {
    await debuggerManager.safeDetachDebugger(tabId);
  }
}

/**
 * Perform special key press
 */
async function performKeyPress(
  tabId: number,
  key: string,
  modifiers: string[] = [],
): Promise<any> {
  const attached = await debuggerManager.safeAttachDebugger(tabId);
  if (!attached) {
    throw new Error('Failed to attach debugger');
  }

  const cdpCommander = new CdpCommander(tabId);
  
  // Map modifier keys to CDP modifier values
  const modifierMap: Record<string, number> = {
    'Control': 2,
    'Shift': 4,
    'Alt': 8,
    'Meta': 16, // Command on Mac, Windows key on Windows
  };
  
  let modifiersValue = 0;
  for (const mod of modifiers) {
    if (modifierMap[mod]) {
      modifiersValue |= modifierMap[mod];
    }
  }

  try {
    // Key down
    await cdpCommander.sendCommand('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      modifiers: modifiersValue,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Key up
    await cdpCommander.sendCommand('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      modifiers: 0,
    });

    return {
      success: true,
      message: `Successfully pressed key: ${key}`,
    };
  } finally {
    await debuggerManager.safeDetachDebugger(tabId);
  }
}

/**
 * Perform mouse scroll
 */
async function performScroll(
  tabId: number,
  x: number,
  y: number,
  direction: 'up' | 'down' | 'left' | 'right',
  amount: number = 100,
): Promise<any> {
  // If coordinates are (0,0), use our tracked mouse position (like performClick does)
  let targetX = x;
  let targetY = y;
  
  if (x === 0 && y === 0) {
    // Use tracked mouse position
    const trackedPos = getOrInitializeMousePosition(tabId);
    targetX = trackedPos.x;
    targetY = trackedPos.y;
    console.log(`🖱️ [Computer] Using tracked mouse position for scroll: (${targetX}, ${targetY})`);
  } else {
    // Update our tracked position to the provided coordinates
    mousePositions.set(tabId, { x: targetX, y: targetY });
  }
  
  // Get viewport size for coordinate mapping (like mouse_move does)
  const viewport = await getViewportSize(tabId);
  
  // Convert preset coordinates to actual screen coordinates
  const { actualX, actualY } = presetToActualCoords(targetX, targetY, viewport);
  
  // Round coordinates to integers for CDP
  const roundedX = Math.round(actualX);
  const roundedY = Math.round(actualY);
  
  console.log(`🖱️ [Computer] Scroll at preset(${targetX}, ${targetY}) -> actual(${roundedX}, ${roundedY}) viewport(${viewport.width}x${viewport.height}) direction:${direction} amount:${amount}`);

  const attached = await debuggerManager.safeAttachDebugger(tabId);
  if (!attached) {
    throw new Error('Failed to attach debugger');
  }

  const cdpCommander = new CdpCommander(tabId);

  try {
    // Move mouse to position first (optional but keeps behavior consistent)
    await cdpCommander.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: roundedX,
      y: roundedY,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Determine scroll deltas based on direction
    let deltaX = 0;
    let deltaY = 0;
    
    switch (direction) {
      case 'up':
        deltaY = -amount;
        break;
      case 'down':
        deltaY = amount;
        break;
      case 'left':
        deltaX = -amount;
        break;
      case 'right':
        deltaX = amount;
        break;
    }

    // Perform scroll
    await cdpCommander.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: roundedX,
      y: roundedY,
      deltaX,
      deltaY,
    });

    return {
      success: true,
      message: `Successfully scrolled ${direction} at preset(${targetX}, ${targetY}) -> actual(${roundedX}, ${roundedY})`,
      data: {
        presetPosition: { x: targetX, y: targetY },
        actualPosition: { x: roundedX, y: roundedY },
        viewport: viewport,
        direction: direction,
        amount: amount,
      },
    };
  } finally {
    await debuggerManager.safeDetachDebugger(tabId);
  }
}

/**
 * Clear screenshot cache for a tab
 */
export function clearScreenshotCache(tabId?: number): void {
  if (tabId !== undefined) {
    screenshotCache.delete(tabId);
  } else {
    screenshotCache.clear();
  }
}

/**
 * Get cached screenshot metadata for a tab
 */
export function getScreenshotMetadata(
  tabId: number,
): ScreenshotMetadata | undefined {
  return screenshotCache.get(tabId);
}

export const computer = {
  performClick,
  performMouseMove,
  performType,
  performKeyPress,
  performScroll,
  resetMousePosition,
  cacheScreenshotMetadata,
  clearScreenshotCache,
  getScreenshotMetadata,
};