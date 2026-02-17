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

/**
 * Get viewport size from content script
 */
async function getViewportSize(tabId: number): Promise<{width: number, height: number}> {
  // Return cached value if available
  if (viewportSizes.has(tabId)) {
    return viewportSizes.get(tabId)!;
  }
  
  try {
    // Request viewport info from content script
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'get_viewport'
    });
    
    if (response?.success && response.data) {
      const { width, height } = response.data;
      const size = { width: width || 1920, height: height || 1080 };
      viewportSizes.set(tabId, size);
      return size;
    }
  } catch (error) {
    console.warn(`Failed to get viewport size for tab ${tabId}:`, error);
  }
  
  // Fallback to reasonable defaults
  const defaultSize = { width: 1920, height: 1080 };
  viewportSizes.set(tabId, defaultSize);
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
 */
function screenshotToCssPixels(
  x: number,
  y: number,
  metadata: ScreenshotMetadata,
): { xCss: number; yCss: number } {
  const { imageWidth, imageHeight, viewportWidth, viewportHeight } = metadata;

  // Map from screenshot pixels to viewport CSS pixels
  const xCss = Math.round((x / imageWidth) * viewportWidth);
  const yCss = Math.round((y / imageHeight) * viewportHeight);

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
  button: 'left' | 'right',
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

  // Try to use screenshot metadata if available, otherwise use raw coordinates
  let xCss = targetX;
  let yCss = targetY;
  const metadata = screenshotCache.get(tabId);
  
  if (metadata) {
    // Convert screenshot coordinates to CSS pixels
    const converted = screenshotToCssPixels(targetX, targetY, metadata);
    xCss = converted.xCss;
    yCss = converted.yCss;
    console.log(
      `🖱️ [Computer] ${button}_click at screenshot (${targetX},${targetY}) -> CSS (${xCss},${yCss})`,
    );
  } else {
    console.log(
      `🖱️ [Computer] ${button}_click at (${xCss},${yCss}) (no screenshot metadata)`,
    );
  }

  const attached = await debuggerManager.safeAttachDebugger(tabId);
  if (!attached) {
    throw new Error('Failed to attach debugger');
  }

  const cdpCommander = new CdpCommander(tabId);
  const buttonType = button === 'right' ? 'right' : 'left';

  try {
    // First, move mouse to the target position (hover) before clicking
    await cdpCommander.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: xCss,
      y: yCss,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Perform click sequence
    for (let i = 0; i < clickCount; i++) {
      await cdpCommander.sendCommand('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: xCss,
        y: yCss,
        button: buttonType,
        clickCount: 1,
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      await cdpCommander.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: xCss,
        y: yCss,
        button: buttonType,
        clickCount: 1,
      });

      if (i < clickCount - 1) {
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
    }

    // Update tracked position (in case it changed slightly)
    mousePositions.set(tabId, { x: xCss, y: yCss });

    return {
      success: true,
      message: `Successfully performed ${button} click at (${xCss}, ${yCss})`,
      coordinates: { xCss, yCss },
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
  
  // Get actual viewport size for coordinate mapping and CDP movement
  const viewport = await getViewportSize(tabId);
  const { actualX, actualY } = presetToActualCoords(PRESET_CENTER_X, PRESET_CENTER_Y, viewport);
  
  console.log(`Mouse reset: preset(0, 0) -> actual(${actualX.toFixed(0)}, ${actualY.toFixed(0)}) viewport(${viewport.width}x${viewport.height})`);
  
  const attached = await debuggerManager.safeAttachDebugger(tabId);
  if (!attached) {
    console.warn('Debugger attachment failed, but mouse position reset tracked');
    
    return {
      success: true,
      message: `Mouse position reset tracked to preset(0, 0) -> actual(${actualX.toFixed(0)}, ${actualY.toFixed(0)}). Actual movement may be limited.`,
      data: {
        presetPosition: { x: PRESET_CENTER_X, y: PRESET_CENTER_Y },
        actualPosition: { x: actualX, y: actualY },
        reset: true,
      },
    };
  }

  const cdpCommander = new CdpCommander(tabId);

  try {
    // Move mouse to actual screen center position
    await cdpCommander.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: actualX,
      y: actualY,
    });

    console.log(`🖱️ [Computer] Mouse reset to actual(${actualX.toFixed(0)}, ${actualY.toFixed(0)}) preset(0, 0)`);
    
    return {
      success: true,
      message: `Mouse reset to preset(0, 0) -> actual(${actualX.toFixed(0)}, ${actualY.toFixed(0)})`,
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
      message: `Failed to reset mouse via CDP, but position tracked to preset(0, 0) -> actual(${actualX.toFixed(0)}, ${actualY.toFixed(0)})`,
      error: error instanceof Error ? error.message : 'Unknown error',
      data: {
        trackedPresetPosition: { x: PRESET_CENTER_X, y: PRESET_CENTER_Y },
        actualPosition: { x: actualX, y: actualY },
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
    // Type each character
    for (const char of text) {
      await cdpCommander.sendCommand('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: char,
        code: `Key${char.toUpperCase()}`,
        windowsVirtualKeyCode: char.toUpperCase().charCodeAt(0),
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      await cdpCommander.sendCommand('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: char,
        code: `Key${char.toUpperCase()}`,
        windowsVirtualKeyCode: char.toUpperCase().charCodeAt(0),
      });

      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    return {
      success: true,
      message: `Successfully typed: "${text}"`,
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
  const metadata = screenshotCache.get(tabId);
  if (!metadata) {
    throw new Error(
      'No screenshot metadata found. Please take a screenshot first.',
    );
  }

  const { xCss, yCss } = screenshotToCssPixels(x, y, metadata);

  const attached = await debuggerManager.safeAttachDebugger(tabId);
  if (!attached) {
    throw new Error('Failed to attach debugger');
  }

  const cdpCommander = new CdpCommander(tabId);

  try {
    // Move mouse to position first
    await cdpCommander.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: xCss,
      y: yCss,
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
      x: xCss,
      y: yCss,
      deltaX,
      deltaY,
    });

    return {
      success: true,
      message: `Successfully scrolled ${direction} at (${xCss}, ${yCss})`,
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