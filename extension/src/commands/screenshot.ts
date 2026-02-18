/**
 * Screenshot Capture Tool
 * Based on AIPex screenshot.ts
 */

import { cacheScreenshotMetadata } from './computer';
import { CdpCommander } from './cdp-commander';
import { debuggerManager } from './debugger-manager';

/**
 * Resize image using OffscreenCanvas (preferred, avoids tab activation)
 */
async function resizeImageWithOffscreenCanvas(
  dataUrl: string,
  targetWidth: number = 1280,
  targetHeight: number = 720,
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Check if OffscreenCanvas is available
    if (typeof OffscreenCanvas === 'undefined') {
      reject(new Error('OffscreenCanvas not available'));
      return;
    }
    
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = new OffscreenCanvas(targetWidth, targetHeight);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get 2d context'));
          return;
        }
        
        // Draw image resized to target dimensions
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
        
        // Convert to data URL (PNG format)
        canvas.convertToBlob({ type: 'image/png' }).then(blob => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const resizedDataUrl = reader.result as string;
            console.log(`✅ [Screenshot] Image resized with OffscreenCanvas: ${img.width}x${img.height} → ${targetWidth}x${targetHeight}`);
            resolve(resizedDataUrl);
          };
          reader.onerror = () => reject(new Error('Failed to read blob'));
          reader.readAsDataURL(blob);
        }).catch(reject);
      } catch (error) {
        reject(error);
      }
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}

/**
 * Resize image using content script (Canvas API) as fallback
 */
async function resizeImageInContentScript(
  tabId: number,
  dataUrl: string,
  targetWidth: number = 1280,
  targetHeight: number = 720,
): Promise<string> {
  console.log(`🖼️ [Screenshot] Attempting to resize image for tab ${tabId} to ${targetWidth}×${targetHeight}`);
  
  // First try OffscreenCanvas (avoids tab activation)
  try {
    const result = await resizeImageWithOffscreenCanvas(dataUrl, targetWidth, targetHeight);
    console.log(`✅ [Screenshot] Image resized successfully using OffscreenCanvas`);
    return result;
  } catch (offscreenError) {
    console.warn('⚠️ [Screenshot] OffscreenCanvas resize failed, falling back to content script:', offscreenError);
    
    // Fallback to content script (may cause tab activation)
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        type: 'resize_image',
        data: {
          dataUrl,
          targetWidth,
          targetHeight,
        },
      });
      
      if (response?.success && response.resizedDataUrl) {
        console.log(`✅ [Screenshot] Image resized via content script: ${response.originalSize} → ${response.resizedSize} bytes`);
        return response.resizedDataUrl;
      } else {
        throw new Error(response?.error || 'Failed to resize image');
      }
    } catch (error) {
      console.error('❌ [Screenshot] Failed to resize image in content script:', error);
      throw error;
    }
  }
}

/**
 * Capture screenshot using CDP (Chrome DevTools Protocol)
 * This captures the specified tab even if it's in the background
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
    throw new Error('Failed to attach debugger for screenshot');
  }
  
  const cdpCommander = new CdpCommander(tabId);
  
  try {
    // Enable Page domain if not already enabled
    try {
      await cdpCommander.sendCommand('Page.enable', {});
    } catch (e) {
      console.warn('Page.enable may already be enabled:', e);
    }
    
    // Get layout metrics to determine viewport size (avoid content script messages)
    const layoutMetrics = await cdpCommander.sendCommand<any>('Page.getLayoutMetrics', {});
    
    console.log(`📐 [Screenshot] Layout metrics:`, JSON.stringify(layoutMetrics, null, 2));
    
    // Calculate viewport dimensions
    const visualViewport = layoutMetrics.visualViewport;
    const layoutViewport = layoutMetrics.layoutViewport;
    const contentSize = layoutMetrics.contentSize;
    const cssVisualViewport = layoutMetrics.cssVisualViewport;
    const cssLayoutViewport = layoutMetrics.cssLayoutViewport;
    const cssContentSize = layoutMetrics.cssContentSize;
    
    console.log(`📊 [Screenshot] CDP Metrics - CSS Visual: ${JSON.stringify(cssVisualViewport)}, CSS Layout: ${JSON.stringify(cssLayoutViewport)}, Visual: ${JSON.stringify(visualViewport)}, Layout: ${JSON.stringify(layoutViewport)}, Content: ${JSON.stringify(contentSize)}`);
    
    // Device pixel ratio estimation - we need a better approach
    // visualViewport.scale might give us the zoom level, not device pixel ratio
    // For now, use default of 1 and rely on CDP's scaling
    let devicePixelRatio = 1;
    
    // Try to get device pixel ratio from visualViewport.scale if available
    if (visualViewport && typeof visualViewport.scale === 'number' && visualViewport.scale > 0) {
      // visualViewport.scale is zoom level (e.g., 1.0 = 100%, 2.0 = 200%)
      // This is NOT device pixel ratio, but might help with scaling
      console.log(`📱 [Screenshot] Visual viewport scale: ${visualViewport.scale}`);
    }
    
    // Calculate device pixel ratio from CSS vs device viewport dimensions if available
    if (cssVisualViewport && cssVisualViewport.clientWidth > 0 && visualViewport && visualViewport.clientWidth > 0) {
      const calculatedRatio = visualViewport.clientWidth / cssVisualViewport.clientWidth;
      if (calculatedRatio > 0 && Math.abs(calculatedRatio - Math.round(calculatedRatio)) < 0.1) {
        devicePixelRatio = Math.round(calculatedRatio);
        console.log(`✅ [Screenshot] Calculated device pixel ratio from CSS vs device viewport: ${devicePixelRatio}`);
      }
    }
    
    // If not calculated, try alternative: use window.devicePixelRatio from CDP Runtime.evaluate
    if (devicePixelRatio === 1) {
      try {
        const devicePixelRatioResult = await cdpCommander.sendCommand<any>('Runtime.evaluate', {
          expression: 'window.devicePixelRatio',
          returnByValue: true,
        });
        if (devicePixelRatioResult && devicePixelRatioResult.result && devicePixelRatioResult.result.value) {
          devicePixelRatio = devicePixelRatioResult.result.value;
          console.log(`✅ [Screenshot] Got device pixel ratio from CDP Runtime.evaluate: ${devicePixelRatio}`);
        }
      } catch (e) {
        console.warn('⚠️ [Screenshot] Failed to get device pixel ratio from Runtime.evaluate:', e);
      }
    }
    
    console.log(`📱 [Screenshot] Using device pixel ratio: ${devicePixelRatio}`);
    
    // Determine viewport dimensions from CDP metrics (avoid content script messages)
    // Prefer CSS viewport dimensions for clip parameters (CDP expects CSS pixels)
    let viewportWidth, viewportHeight, viewportX, viewportY;
    
    // For screenshot, we want the currently visible area (visual viewport)
    // But we need to capture from the top-left of the visible area, not current scroll position
    if (cssVisualViewport && cssVisualViewport.clientWidth > 0 && cssVisualViewport.clientHeight > 0) {
      // Use CSS visual viewport (CSS pixels)
      viewportWidth = Math.floor(cssVisualViewport.clientWidth);
      viewportHeight = Math.floor(cssVisualViewport.clientHeight);
      // Always capture from top-left of visible area, not from scroll position
      viewportX = 0;
      viewportY = 0;
      console.log(`👁️ [Screenshot] Using CSS visual viewport: ${viewportWidth}x${viewportHeight} (scroll was at ${cssVisualViewport.pageX}, ${cssVisualViewport.pageY})`);
      
      // Compare with layout viewport for debugging
      if (cssLayoutViewport) {
        console.log(`📊 [Screenshot] CSS Layout viewport: ${cssLayoutViewport.clientWidth}x${cssLayoutViewport.clientHeight}, ratio: ${cssVisualViewport.clientWidth / cssLayoutViewport.clientWidth}`);
      }
    } else if (cssLayoutViewport && cssLayoutViewport.clientWidth > 0 && cssLayoutViewport.clientHeight > 0) {
      // Fallback to CSS layout viewport if CSS visual viewport not available
      viewportWidth = Math.floor(cssLayoutViewport.clientWidth);
      viewportHeight = Math.floor(cssLayoutViewport.clientHeight);
      viewportX = 0;
      viewportY = 0;
      console.log(`📐 [Screenshot] Using CSS layout viewport: ${viewportWidth}x${viewportHeight}`);
    } else if (visualViewport && visualViewport.clientWidth > 0 && visualViewport.clientHeight > 0) {
      // Fallback to device pixel visual viewport (convert to CSS pixels using devicePixelRatio)
      viewportWidth = Math.floor(visualViewport.clientWidth / devicePixelRatio);
      viewportHeight = Math.floor(visualViewport.clientHeight / devicePixelRatio);
      viewportX = 0;
      viewportY = 0;
      console.log(`👁️ [Screenshot] Using device visual viewport (converted to CSS): ${viewportWidth}x${viewportHeight} (device: ${visualViewport.clientWidth}x${visualViewport.clientHeight}, scroll was at ${visualViewport.pageX}, ${visualViewport.pageY})`);
    } else if (layoutViewport && layoutViewport.clientWidth > 0 && layoutViewport.clientHeight > 0) {
      // Fallback to device pixel layout viewport (convert to CSS pixels)
      viewportWidth = Math.floor(layoutViewport.clientWidth / devicePixelRatio);
      viewportHeight = Math.floor(layoutViewport.clientHeight / devicePixelRatio);
      viewportX = 0;
      viewportY = 0;
      console.log(`📐 [Screenshot] Using device layout viewport (converted to CSS): ${viewportWidth}x${viewportHeight}`);
    } else {
      // Fall back to content size (entire page) - LAST RESORT
      // Use CSS content size if available, otherwise device content size
      if (cssContentSize && cssContentSize.width > 0 && cssContentSize.height > 0) {
        viewportWidth = Math.floor(cssContentSize.width);
        viewportHeight = Math.floor(cssContentSize.height);
      } else {
        viewportWidth = Math.floor(contentSize.width / devicePixelRatio);
        viewportHeight = Math.floor(contentSize.height / devicePixelRatio);
      }
      viewportX = 0;
      viewportY = 0;
      console.log(`⚠️ [Screenshot] WARNING: Using content size (entire page): ${viewportWidth}x${viewportHeight}. This may be too large!`);
    }
    
    // Safety check: ensure viewport dimensions are reasonable
    if (viewportWidth <= 0 || viewportHeight <= 0) {
      console.error(`❌ [Screenshot] Invalid viewport dimensions: ${viewportWidth}x${viewportHeight}. Using fallback 1280x720.`);
      viewportWidth = 1280;
      viewportHeight = 720;
      viewportX = 0;
      viewportY = 0;
    }
    
    // Additional check: if dimensions seem too small (less than 640x360), warn
    if (viewportWidth < 640 || viewportHeight < 360) {
      console.warn(`⚠️ [Screenshot] Viewport dimensions very small: ${viewportWidth}x${viewportHeight}. Page might be zoomed or CDP metrics incorrect.`);
    }
    
    console.log(`🎯 [Screenshot] Final viewport for capture: ${viewportWidth}x${viewportHeight} at (${viewportX}, ${viewportY})`);
    
    // For screenshot, we need to consider device pixel ratio
    // CDP captureScreenshot expects CSS pixels, but returns device pixels
    const cssViewportWidth = viewportWidth;
    const cssViewportHeight = viewportHeight;
    const cssViewportX = viewportX;
    const cssViewportY = viewportY;
    
    console.log(`🖥️ [Screenshot] Viewport size (CSS pixels): ${cssViewportWidth}x${cssViewportHeight} at (${cssViewportX}, ${cssViewportY})`);
    console.log(`📸 [Screenshot] Expected device pixels: ${cssViewportWidth * devicePixelRatio}x${cssViewportHeight * devicePixelRatio}`);
    
    // Wait for rendering if requested
    if (waitForRender > 0) {
      console.log(`⏳ Waiting ${waitForRender}ms for page rendering before screenshot...`);
      await new Promise((resolve) => setTimeout(resolve, waitForRender));
    }
    
    // Capture screenshot of the viewport
    // Note: CDP captureScreenshot does not include cursor
    // clip parameters: x,y,width,height are in CSS pixels, scale converts to device pixels
    // If devicePixelRatio=2, scale=2 means 2 device pixels per CSS pixel
    const clipScale = devicePixelRatio;
    
    console.log(`🎯 [Screenshot] Capturing with clip: (${cssViewportX}, ${cssViewportY}) ${cssViewportWidth}x${cssViewportHeight} CSS pixels, scale=${clipScale}`);
    
    const screenshot = await cdpCommander.sendCommand<any>('Page.captureScreenshot', {
      format: quality < 90 ? 'jpeg' : 'png', // Use JPEG for lower quality to reduce size
      quality: quality < 90 ? quality / 100 : undefined, // CDP quality is 0-1 for JPEG
      fromSurface: true,
      clip: {
        x: cssViewportX,
        y: cssViewportY,
        width: cssViewportWidth,
        height: cssViewportHeight,
        scale: clipScale,
      },
    });
    
    const dataUrl = `data:image/${quality < 90 ? 'jpeg' : 'png'};base64,${screenshot.data}`;
    
    if (!dataUrl || !dataUrl.startsWith('data:image/')) {
      throw new Error('Invalid image data captured via CDP');
    }
    
    // Image dimensions in device pixels (considering device pixel ratio)
    // The screenshot data is in device pixels, not CSS pixels
    let imageWidth = cssViewportWidth * devicePixelRatio;
    let imageHeight = cssViewportHeight * devicePixelRatio;
    let finalImageData = dataUrl;
    
    console.log(`📊 [Screenshot] Image dimensions (device pixels): ${imageWidth}x${imageHeight}`);
    
    // Resize image to preset coordinate system dimensions if requested
    if (resizeToPreset) {
      try {
        const PRESET_WIDTH = 1280;
        const PRESET_HEIGHT = 720;
        
        console.log(`🖼️ [Screenshot] Resizing image from ${imageWidth}×${imageHeight} to ${PRESET_WIDTH}×${PRESET_HEIGHT}`);
        
        finalImageData = await resizeImageInContentScript(
          tabId,
          dataUrl,
          PRESET_WIDTH,
          PRESET_HEIGHT
        );
        
        // Update image dimensions to preset size
        imageWidth = PRESET_WIDTH;
        imageHeight = PRESET_HEIGHT;
        
        console.log(`✅ [Screenshot] Image resized to preset coordinate system dimensions`);
      } catch (resizeError) {
        console.warn('⚠️ [Screenshot] Failed to resize image, using original:', resizeError);
        // Continue with original image
      }
    }
    
    // Cache screenshot metadata for computer tool
    // Store both CSS viewport size and image dimensions
    cacheScreenshotMetadata(
      tabId,
      imageWidth,
      imageHeight,
      cssViewportWidth,  // CSS viewport width
      cssViewportHeight, // CSS viewport height
    );
    
    // Check if image data is suspiciously small (likely blank)
    if (finalImageData.length < 30000) {
      console.warn('⚠️ [Screenshot] Image data too small, likely blank. Falling back to legacy method.');
      throw new Error('Image data too small');
    }
    
    const tab = await chrome.tabs.get(tabId);
    
    return {
      success: true,
      imageData: finalImageData,
      metadata: {
        tabId: tabId,
        width: imageWidth,
        height: imageHeight,
        viewportWidth: viewportWidth,
        viewportHeight: viewportHeight,
        url: tab?.url || '',
        title: tab?.title || '',
        resizedToPreset: resizeToPreset,
        captureMethod: 'cdp',
      },
    };
  } finally {
    // Don't detach debugger immediately, let it auto-detach after timeout
    // This allows subsequent commands to reuse the debugger session
  }
}

/**
 * Capture screenshot of visible tab (legacy method using captureVisibleTab)
 * This captures the currently visible tab in the window, not necessarily the target tab
 */
async function captureScreenshotLegacy(
  tabId?: number,
  _includeCursor: boolean = true,
  quality: number = 90,
  resizeToPreset: boolean = true,
  waitForRender: number = 100,
): Promise<any> {
  // Resolve tab ID if not provided
  let targetTabId = tabId;
  if (!targetTabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error('No active tab found');
    }
    targetTabId = tab.id;
  }

  const tab = await chrome.tabs.get(targetTabId);
  if (!tab || !tab.windowId) {
    throw new Error('Tab not found');
  }

  // Note: Tab activation should be handled by the caller (activateTabForAutomation)
  // We only wait for rendering if requested
  if (waitForRender > 0) {
    console.log(`⏳ Waiting ${waitForRender}ms for page rendering before screenshot...`);
    await new Promise((resolve) => setTimeout(resolve, waitForRender));
  }

  // Capture screenshot of the currently visible tab in the window
  // WARNING: This captures whatever tab is currently visible, not necessarily the target tab!
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: 'png',
    quality: quality,
  });

  if (!dataUrl || !dataUrl.startsWith('data:image/')) {
    throw new Error('Invalid image data captured');
  }

  // Get viewport dimensions
  let viewport: { width: number; height: number } | undefined;
  try {
    const viewportDimensions = await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: () => ({
        width: window.innerWidth,
        height: window.innerHeight,
      }),
    });
    viewport = viewportDimensions[0]?.result ?? undefined;
  } catch (e) {
    console.warn('[Screenshot] Failed to get viewport dimensions:', e);
  }

  // Get image dimensions - we can't use Image in background script
  // Instead, we'll extract dimensions from data URL or use reasonable defaults
  let imageWidth = 1920;
  let imageHeight = 1080;
  let finalImageData = dataUrl;
  
  try {
    // Try to extract dimensions from data URL (base64 encoded)
    // For PNG format, we could parse the IHDR chunk, but it's complex
    // For now, use viewport dimensions if available
    if (viewport) {
      imageWidth = viewport.width;
      imageHeight = viewport.height;
    }
  } catch (e) {
    console.warn('[Screenshot] Failed to get image dimensions:', e);
  }
  
  // Resize image to preset coordinate system dimensions if requested
  if (resizeToPreset && viewport) {
    try {
      const PRESET_WIDTH = 1280;
      const PRESET_HEIGHT = 720;
      
      console.log(`🖼️ [Screenshot] Resizing image from ${imageWidth}×${imageHeight} to ${PRESET_WIDTH}×${PRESET_HEIGHT}`);
      
      finalImageData = await resizeImageInContentScript(
        targetTabId,
        dataUrl,
        PRESET_WIDTH,
        PRESET_HEIGHT
      );
      
      // Update image dimensions to preset size
      imageWidth = PRESET_WIDTH;
      imageHeight = PRESET_HEIGHT;
      
      console.log(`✅ [Screenshot] Image resized to preset coordinate system dimensions`);
    } catch (resizeError) {
      console.warn('⚠️ [Screenshot] Failed to resize image, using original:', resizeError);
      // Continue with original image
    }
  }
  
  // Cache screenshot metadata for computer tool
  if (viewport) {
    cacheScreenshotMetadata(
      targetTabId,
      imageWidth,
      imageHeight,
      viewport.width,
      viewport.height,
    );
  }

  return {
    success: true,
    imageData: finalImageData,
    metadata: {
      tabId: targetTabId,
      width: imageWidth,
      height: imageHeight,
      viewportWidth: viewport?.width ?? 0,
      viewportHeight: viewport?.height ?? 0,
      url: tab.url,
      title: tab.title,
      resizedToPreset: resizeToPreset && viewport !== undefined,
      captureMethod: 'visible_tab',
      warning: 'Screenshot captured from currently visible tab, not necessarily the target tab',
    },
  };
}

/**
 * Capture screenshot of a tab
 * Primary method uses CDP to capture the specified tab even if it's in the background
 * Falls back to legacy method if CDP fails
 */
export async function captureScreenshot(
  tabId?: number,
  includeCursor: boolean = true,
  quality: number = 90,
  resizeToPreset: boolean = true,  // Whether to resize to preset coordinate system dimensions (1280x720)
  waitForRender: number = 500,     // Wait time after tab activation to ensure rendering (in ms)
): Promise<any> {
  // Resolve tab ID if not provided
  let targetTabId = tabId;
  if (!targetTabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error('No active tab found');
    }
    targetTabId = tab.id;
  }
  
  console.log(`📸 [Screenshot] Capturing screenshot for tab ${targetTabId}, method: CDP preferred`);
  
  try {
    // First try CDP method (captures the actual tab, even in background)
    return await captureScreenshotWithCDP(
      targetTabId,
      includeCursor,
      quality,
      resizeToPreset,
      waitForRender
    );
  } catch (cdpError) {
    console.error(`❌ [Screenshot] CDP screenshot failed:`, cdpError);
    console.log(`🔄 [Screenshot] Falling back to legacy captureVisibleTab method`);
    
    // Fall back to legacy method
    // Note: This will capture the currently visible tab, which may not be the target tab!
    const result = await captureScreenshotLegacy(
      targetTabId,
      includeCursor,
      quality,
      resizeToPreset,
      waitForRender
    );
    
    // Add warning about potential mismatch
    result.metadata.warning = 'Screenshot captured from currently visible tab (legacy fallback). CDP failed: ' + 
      (cdpError instanceof Error ? cdpError.message : String(cdpError));
    
    return result;
  }
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