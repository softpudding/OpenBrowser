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

// Track mouse positions per tab
const mousePositions = new Map<number, {x: number, y: number}>();

/**
 * Initialize or get mouse position for a tab
 */
function getOrInitializeMousePosition(tabId: number): {x: number, y: number} {
  if (!mousePositions.has(tabId)) {
    // Default to center of screen (will be updated when we know viewport size)
    mousePositions.set(tabId, { x: 100, y: 100 });
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
 */
async function performMouseMove(
  tabId: number,
  dx: number,
  dy: number,
): Promise<any> {
  // Update our tracked mouse position
  const currentPos = getOrInitializeMousePosition(tabId);
  let newX = currentPos.x + dx;
  let newY = currentPos.y + dy;
  
  // Apply boundary checks - use reasonable screen bounds
  // TODO: Get actual viewport size from content script
  const MAX_X = 3840;  // Reasonable max screen width
  const MAX_Y = 2160;  // Reasonable max screen height
  const MIN_X = 0;
  const MIN_Y = 0;
  
  newX = Math.max(MIN_X, Math.min(newX, MAX_X));
  newY = Math.max(MIN_Y, Math.min(newY, MAX_Y));
  
  mousePositions.set(tabId, { x: newX, y: newY });
  
  // Now move the actual mouse via CDP
  const attached = await debuggerManager.safeAttachDebugger(tabId);
  if (!attached) {
    // Even if debugger fails, we still updated our tracked position
    // for visual mouse purposes
    console.warn('Debugger attachment failed, but mouse position tracked for visual feedback');
    
    return {
      success: true,
      message: `Mouse position tracked to (${newX}, ${newY}). Actual movement may be limited.`,
      data: {
        trackedPosition: { x: newX, y: newY },
        moved: { dx, dy },
        bounded: (newX !== currentPos.x + dx || newY !== currentPos.y + dy),
      },
    };
  }

  const cdpCommander = new CdpCommander(tabId);

  try {
    // Move mouse to new absolute position via CDP
    // CDP requires absolute coordinates, so we use our tracked position
    await cdpCommander.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: newX,
      y: newY,
    });

    console.log(`🖱️ [Computer] Mouse moved to (${newX}, ${newY})`);
    
    const bounded = (newX !== currentPos.x + dx || newY !== currentPos.y + dy);
    let message = `Mouse moved to (${newX}, ${newY})`;
    if (bounded) {
      message += ` (position bounded to screen)`;
    }
    
    return {
      success: true,
      message: message,
      data: {
        position: { x: newX, y: newY },
        moved: { dx, dy },
        bounded: bounded,
      },
    };
  } catch (error) {
    console.error('Error moving mouse via CDP:', error);
    
    // Even if CDP fails, we still updated our tracked position
    return {
      success: false,
      message: `Failed to move mouse via CDP, but position tracked to (${newX}, ${newY})`,
      error: error instanceof Error ? error.message : 'Unknown error',
      data: {
        trackedPosition: { x: newX, y: newY },
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
  // Use reasonable default screen center
  const centerX = 960;   // Half of 1920
  const centerY = 540;   // Half of 1080
  
  mousePositions.set(tabId, { x: centerX, y: centerY });
  
  const attached = await debuggerManager.safeAttachDebugger(tabId);
  if (!attached) {
    console.warn('Debugger attachment failed, but mouse position reset tracked');
    
    return {
      success: true,
      message: `Mouse position reset tracked to (${centerX}, ${centerY}). Actual movement may be limited.`,
      data: {
        position: { x: centerX, y: centerY },
        reset: true,
      },
    };
  }

  const cdpCommander = new CdpCommander(tabId);

  try {
    // Move mouse to center position
    await cdpCommander.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: centerX,
      y: centerY,
    });

    console.log(`🖱️ [Computer] Mouse reset to center (${centerX}, ${centerY})`);
    
    return {
      success: true,
      message: `Mouse reset to screen center (${centerX}, ${centerY})`,
      data: {
        position: { x: centerX, y: centerY },
        reset: true,
      },
    };
  } catch (error) {
    console.error('Error resetting mouse via CDP:', error);
    
    return {
      success: false,
      message: `Failed to reset mouse via CDP, but position tracked to (${centerX}, ${centerY})`,
      error: error instanceof Error ? error.message : 'Unknown error',
      data: {
        trackedPosition: { x: centerX, y: centerY },
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