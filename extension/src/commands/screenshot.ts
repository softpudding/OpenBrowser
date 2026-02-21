/**
 * Screenshot Capture Tool
 * Based on AIPex screenshot.ts
 */

import { cacheScreenshotMetadata } from './computer';
import { CdpCommander } from './cdp-commander';
import { debuggerManager } from './debugger-manager';

/**
 * Resize image using OffscreenCanvas and createImageBitmap
 * 
 * This is the only resize method we use because it works in Service Worker context
 * (Manifest V3 background script) and doesn't require tab activation or content script messaging.
 * 
 * IMPORTANT: If OffscreenCanvas or createImageBitmap is not available, the function will 
 * throw an error instead of falling back to content script (which could cause tab activation).
 */
async function resizeImage(
  dataUrl: string,
  targetWidth: number = 1280,
  targetHeight: number = 720,
): Promise<string> {
  console.log(`🖼️ [Screenshot] Resizing image to ${targetWidth}x${targetHeight}...`);
  
  // Check if OffscreenCanvas is available
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error(
      '[Screenshot] OffscreenCanvas is not available in this environment. ' +
      'Image resizing requires OffscreenCanvas support. ' +
      'Browser may be outdated or running in an unsupported context.'
    );
  }
  
  // Check if createImageBitmap is available (alternative to Image in Service Worker)
  if (typeof createImageBitmap === 'undefined') {
    throw new Error(
      '[Screenshot] createImageBitmap is not available in this environment. ' +
      'Image resizing requires createImageBitmap support in Service Worker context.'
    );
  }
  
  try {
    // Convert data URL to Blob
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    
    // Create ImageBitmap from Blob (works in Service Worker)
    const imageBitmap = await createImageBitmap(blob);
    
    console.log(`🖼️ [Screenshot] Original image dimensions: ${imageBitmap.width}x${imageBitmap.height}`);
    
    if (imageBitmap.width <= 0 || imageBitmap.height <= 0) {
      throw new Error(`[Screenshot] Invalid original image dimensions: ${imageBitmap.width}x${imageBitmap.height}`);
    }
    
    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext('2d');
    
    if (!ctx) {
      throw new Error('[Screenshot] Failed to get 2d context from OffscreenCanvas');
    }
    
    // Fill background with white (to avoid transparency issues)
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    
    // Calculate scaling to fit image in target dimensions while maintaining aspect ratio
    const scaleX = targetWidth / imageBitmap.width;
    const scaleY = targetHeight / imageBitmap.height;
    const scale = Math.min(scaleX, scaleY);
    
    const newWidth = Math.floor(imageBitmap.width * scale);
    const newHeight = Math.floor(imageBitmap.height * scale);
    
    if (newWidth <= 0 || newHeight <= 0) {
      throw new Error(`[Screenshot] Invalid scaled dimensions: ${newWidth}x${newHeight}`);
    }
    
    // Center the image in the canvas
    const offsetX = Math.floor((targetWidth - newWidth) / 2);
    const offsetY = Math.floor((targetHeight - newHeight) / 2);
    
    console.log(`🖼️ [Screenshot] Scaling: scale=${scale.toFixed(3)}, new dimensions: ${newWidth}x${newHeight}, offset: (${offsetX}, ${offsetY})`);
    
    // Draw ImageBitmap to canvas with scaling and centering
    ctx.drawImage(imageBitmap, offsetX, offsetY, newWidth, newHeight);
    
    // Convert to data URL (PNG format for lossless quality)
    const resizedBlob = await canvas.convertToBlob({ type: 'image/png' });
    
    // Convert Blob to data URL using FileReader
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const resizedDataUrl = reader.result as string;
        console.log(`✅ [Screenshot] Image resized successfully: ${imageBitmap.width}x${imageBitmap.height} → ${targetWidth}x${targetHeight}`);
        resolve(resizedDataUrl);
      };
      reader.onerror = () => reject(new Error('[Screenshot] Failed to read resized blob'));
      reader.readAsDataURL(resizedBlob);
    });
  } catch (error) {
    const errorMsg = `[Screenshot] Error during image resize: ${error instanceof Error ? error.message : error}`;
    console.error(`❌ ${errorMsg}`);
    throw new Error(errorMsg);
  }
}

/**
 * Capture screenshot using CDP (Chrome DevTools Protocol)
 * This captures the specified tab even if it's in the background
 * 
 * IMPORTANT: This function follows "fail fast" principle - any error will be thrown
 * instead of silently falling back to potentially incorrect values.
 */
async function captureScreenshotWithCDP(
  tabId: number,
  _includeCursor: boolean = true,
  quality: number = 90,
  resizeToPreset: boolean = true,
  waitForRender: number = 500,
): Promise<any> {
  console.log(`📸 [Screenshot] Capturing screenshot via CDP for tab ${tabId}`);
  
  // Ensure debugger is attached
  const attached = await debuggerManager.safeAttachDebugger(tabId);
  if (!attached) {
    throw new Error('[Screenshot] Failed to attach debugger for screenshot - cannot proceed');
  }
  
  const cdpCommander = new CdpCommander(tabId);
  
  try {
    // Enable Page domain if not already enabled
    try {
      await cdpCommander.sendCommand('Page.enable', {});
    } catch (e) {
      // Page.enable may already be enabled, which is fine
      console.warn('[Screenshot] Page.enable may already be enabled:', e);
    }
    
    // ========================================
    // STEP 1: Get device pixel ratio (CRITICAL - must be accurate)
    // ========================================
    let devicePixelRatio: number;
    
    try {
      const dprResult = await cdpCommander.sendCommand<any>('Runtime.evaluate', {
        expression: 'window.devicePixelRatio',
        returnByValue: true,
      });
      
      if (!dprResult?.result?.value || typeof dprResult.result.value !== 'number') {
        throw new Error('[Screenshot] Runtime.evaluate returned invalid devicePixelRatio');
      }
      
      devicePixelRatio = dprResult.result.value;
      
      // Validate DPR is reasonable (typically 1, 2, or 3 for standard and Retina displays)
      if (devicePixelRatio < 1 || devicePixelRatio > 4) {
        throw new Error(`[Screenshot] Invalid devicePixelRatio: ${devicePixelRatio} (expected 1-4)`);
      }
      
      console.log(`✅ [Screenshot] Got device pixel ratio from Runtime.evaluate: ${devicePixelRatio}`);
    } catch (dprError) {
      const errorMsg = `[Screenshot] Failed to get device pixel ratio: ${dprError instanceof Error ? dprError.message : dprError}`;
      console.error(`❌ ${errorMsg}`);
      throw new Error(errorMsg);
    }
    
    // ========================================
    // STEP 2: Get viewport dimensions (CRITICAL - must be accurate)
    // ========================================
    let viewportWidth: number;
    let viewportHeight: number;
    
    try {
      const viewportResult = await cdpCommander.sendCommand<any>('Runtime.evaluate', {
        expression: '({width: window.innerWidth, height: window.innerHeight})',
        returnByValue: true,
      });
      
      if (!viewportResult?.result?.value?.width || !viewportResult?.result?.value?.height) {
        throw new Error('[Screenshot] Runtime.evaluate returned invalid viewport dimensions');
      }
      
      viewportWidth = Math.floor(viewportResult.result.value.width);
      viewportHeight = Math.floor(viewportResult.result.value.height);
      
      // Validate viewport dimensions are reasonable
      if (viewportWidth < 100 || viewportWidth > 10000) {
        throw new Error(`[Screenshot] Invalid viewport width: ${viewportWidth} (expected 100-10000)`);
      }
      if (viewportHeight < 100 || viewportHeight > 10000) {
        throw new Error(`[Screenshot] Invalid viewport height: ${viewportHeight} (expected 100-10000)`);
      }
      
      console.log(`✅ [Screenshot] Got viewport dimensions from Runtime.evaluate: ${viewportWidth}x${viewportHeight}`);
    } catch (viewportError) {
      const errorMsg = `[Screenshot] Failed to get viewport dimensions: ${viewportError instanceof Error ? viewportError.message : viewportError}`;
      console.error(`❌ ${errorMsg}`);
      throw new Error(errorMsg);
    }
    
    // ========================================
    // STEP 3: Set up CDP screenshot parameters
    // ========================================
    const cssViewportX = 0;
    const cssViewportY = 0;
    const cssViewportWidth = viewportWidth;
    const cssViewportHeight = viewportHeight;
    
    console.log(`🖥️ [Screenshot] Viewport size (CSS pixels): ${cssViewportWidth}x${cssViewportHeight} at (${cssViewportX}, ${cssViewportY})`);
    console.log(`📸 [Screenshot] Expected device pixels: ${cssViewportWidth * devicePixelRatio}x${cssViewportHeight * devicePixelRatio}`);
    
    // ========================================
    // STEP 4: Wait for rendering if requested
    // ========================================
    if (waitForRender > 0) {
      console.log(`⏳ Waiting ${waitForRender}ms for page rendering before screenshot...`);
      await new Promise((resolve) => setTimeout(resolve, waitForRender));
    }
    
    // ========================================
    // STEP 5: Capture screenshot
    // ========================================
    // CDP captureScreenshot parameters:
    // - clip.x, clip.y: starting position in CSS pixels
    // - clip.width, clip.height: dimensions in CSS pixels
    // - clip.scale: device pixel ratio (e.g., 2 for Retina displays)
    // The returned image will be in device pixels (width * scale, height * scale)
    
    const clipScale = devicePixelRatio;
    
    console.log(`🎯 [Screenshot] Capturing with clip: (${cssViewportX}, ${cssViewportY}) ${cssViewportWidth}x${cssViewportHeight} CSS pixels, scale=${clipScale}`);
    
    let screenshot: any;
    try {
      screenshot = await cdpCommander.sendCommand<any>('Page.captureScreenshot', {
        format: quality < 90 ? 'jpeg' : 'png',
        quality: quality < 90 ? quality / 100 : undefined,
        fromSurface: true,
        clip: {
          x: cssViewportX,
          y: cssViewportY,
          width: cssViewportWidth,
          height: cssViewportHeight,
          scale: clipScale,
        },
      });
    } catch (captureError) {
      const errorMsg = `[Screenshot] Page.captureScreenshot failed: ${captureError instanceof Error ? captureError.message : captureError}`;
      console.error(`❌ ${errorMsg}`);
      throw new Error(errorMsg);
    }
    
    if (!screenshot?.data) {
      throw new Error('[Screenshot] Page.captureScreenshot returned no data');
    }
    
    const dataUrl = `data:image/${quality < 90 ? 'jpeg' : 'png'};base64,${screenshot.data}`;
    
    if (!dataUrl.startsWith('data:image/')) {
      throw new Error('[Screenshot] Invalid image data format from CDP');
    }
    
    // ========================================
    // STEP 6: Validate screenshot data
    // ========================================
    // The screenshot should be in device pixels
    const expectedDeviceWidth = cssViewportWidth * devicePixelRatio;
    const expectedDeviceHeight = cssViewportHeight * devicePixelRatio;
    
    console.log(`📊 [Screenshot] Expected image dimensions (device pixels): ${expectedDeviceWidth}x${expectedDeviceHeight}`);
    
    // Basic validation: screenshot data should exist and be reasonably sized
    // PNG compression is very effective, so don't validate based on expected size
    // Just ensure we got some data back
    if (!screenshot.data || screenshot.data.length < 1000) {
      throw new Error(`[Screenshot] Screenshot data too small or missing (${screenshot.data?.length || 0} bytes)`);
    }
    
    console.log(`✅ [Screenshot] Screenshot captured successfully, data size: ${screenshot.data.length} bytes`);
    
    // ========================================
    // STEP 7: Resize image (optional)
    // ========================================
    let finalImageData = dataUrl;
    let finalImageWidth = expectedDeviceWidth;
    let finalImageHeight = expectedDeviceHeight;
    
    if (resizeToPreset) {
      const PRESET_WIDTH = 1280;
      const PRESET_HEIGHT = 720;
      
      console.log(`🖼️ [Screenshot] Resizing image from ${expectedDeviceWidth}×${expectedDeviceHeight} to ${PRESET_WIDTH}×${PRESET_HEIGHT}`);
      
      try {
        finalImageData = await resizeImage(
          dataUrl,
          PRESET_WIDTH,
          PRESET_HEIGHT
        );
        finalImageWidth = PRESET_WIDTH;
        finalImageHeight = PRESET_HEIGHT;
        console.log(`✅ [Screenshot] Image resized to preset coordinate system dimensions`);
      } catch (resizeError) {
        const errorMsg = `[Screenshot] Failed to resize image: ${resizeError instanceof Error ? resizeError.message : resizeError}`;
        console.error(`❌ ${errorMsg}`);
        throw new Error(errorMsg);
      }
    }
    
    // ========================================
    // STEP 8: Verify final image data
    // ========================================
    // After resize, the image should be at least 10KB for a 1280x720 image
    const minFinalSize = resizeToPreset ? 10000 : 30000;
    if (finalImageData.length < minFinalSize) {
      throw new Error(`[Screenshot] Final image data too small (${finalImageData.length} bytes), likely blank or corrupted`);
    }
    
    // ========================================
    // STEP 9: Cache metadata and return result
    // ========================================
    cacheScreenshotMetadata(
      tabId,
      finalImageWidth,
      finalImageHeight,
      cssViewportWidth,  // CSS viewport width
      cssViewportHeight, // CSS viewport height
    );
    
    const tab = await chrome.tabs.get(tabId);
    
    console.log(`✅ [Screenshot] Screenshot complete: ${finalImageWidth}x${finalImageHeight} (${resizeToPreset ? 'resized' : 'original'})`);
    
    return {
      success: true,
      imageData: finalImageData,
      metadata: {
        tabId: tabId,
        width: finalImageWidth,
        height: finalImageHeight,
        viewportWidth: viewportWidth,
        viewportHeight: viewportHeight,
        url: tab?.url || '',
        title: tab?.title || '',
        resizedToPreset: resizeToPreset,
        captureMethod: 'cdp',
        devicePixelRatio: devicePixelRatio,
      },
    };
  } catch (error) {
    // Catch any errors and re-throw with context
    const errorMsg = `[Screenshot] CDP screenshot failed: ${error instanceof Error ? error.message : error}`;
    console.error(`❌ ${errorMsg}`);
    throw new Error(errorMsg);
  } finally {
    // Don't detach debugger immediately, let it auto-detach after timeout
    // This allows subsequent commands to reuse the debugger session
  }
}

/**
 * DEPRECATED: Legacy screenshot method using captureVisibleTab
 * 
 * This method is DEPRECATED and should NOT be used because:
 * 1. It captures the currently visible tab, not the target tab
 * 2. It may cause tab switching/flashing
 * 3. It does not work for background tabs
 * 
 * This function is kept for reference only and will throw an error if called.
 * 
 * @deprecated Use CDP method instead
 */
function _captureScreenshotLegacy(): never {
  throw new Error(
    '[Screenshot] Legacy screenshot method is DEPRECATED and should not be used. ' +
    'Use CDP method instead. If CDP method fails, the error should be investigated and fixed, ' +
    'not silently ignored with a fallback.'
  );
}

/**
 * Capture screenshot of a tab
 * 
 * Uses CDP (Chrome DevTools Protocol) to capture screenshots of any tab,
 * even if it's in the background. This ensures no disruption to the user's
 * active tab.
 * 
 * IMPORTANT: This function follows "fail fast" principle.
 * - Any errors will be thrown immediately with detailed error messages
 * - No silent fallback to legacy methods that might cause tab flashing
 * - All validation errors are reported clearly for debugging
 * 
 * @param tabId Target tab ID (optional, defaults to active tab)
 * @param includeCursor Whether to include cursor (not supported by CDP)
 * @param quality Image quality (1-100)
 * @param resizeToPreset Whether to resize to 1280x720
 * @param waitForRender Time to wait for rendering in ms
 * @returns Screenshot data with metadata
 */
export async function captureScreenshot(
  tabId?: number,
  includeCursor: boolean = true,
  quality: number = 90,
  resizeToPreset: boolean = true,
  waitForRender: number = 500,
): Promise<any> {
  // Resolve tab ID if not provided
  let targetTabId = tabId;
  if (!targetTabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error('[Screenshot] No active tab found');
    }
    targetTabId = tab.id;
  }
  
  console.log(`📸 [Screenshot] Starting screenshot capture for tab ${targetTabId}`);
  console.log(`📸 [Screenshot] Parameters: quality=${quality}, resizeToPreset=${resizeToPreset}, waitForRender=${waitForRender}`);
  
  // Validate parameters
  if (quality < 1 || quality > 100) {
    throw new Error(`[Screenshot] Invalid quality value: ${quality} (expected 1-100)`);
  }
  
  if (waitForRender < 0) {
    throw new Error(`[Screenshot] Invalid waitForRender value: ${waitForRender} (expected >= 0)`);
  }
  
  // Verify tab exists and is accessible
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(targetTabId);
  } catch (tabError) {
    throw new Error(`[Screenshot] Cannot access tab ${targetTabId}: ${tabError instanceof Error ? tabError.message : tabError}`);
  }
  
  // Check if tab URL is accessible
  const url = tab.url || '';
  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('edge://')) {
    throw new Error(`[Screenshot] Cannot capture screenshot of restricted URL: ${url}`);
  }
  
  // Use CDP method - no fallback to legacy method
  // If CDP fails, the error should be investigated and fixed
  const result = await captureScreenshotWithCDP(
    targetTabId,
    includeCursor,
    quality,
    resizeToPreset,
    waitForRender
  );
  
  console.log(`✅ [Screenshot] Screenshot captured successfully for tab ${targetTabId}`);
  
  return result;
}

/**
 * Compress image for transmission
 * NOTE: This function is disabled because it uses DOM APIs (Image, canvas)
 * which are not available in background script context.
 */
/*
async function compressImage(
  dataUrl: string,
  quality: number = 0.6,
  maxWidth: number = 1024,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      let width = img.width;
      let height = img.height;

      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }

      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);

      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}
*/