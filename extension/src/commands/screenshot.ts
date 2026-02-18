/**
 * Screenshot Capture Tool
 * Based on AIPex screenshot.ts
 */

import { cacheScreenshotMetadata } from './computer';
import { CdpCommander } from './cdp-commander';
import { debuggerManager } from './debugger-manager';

/**
 * Resize image using content script (Canvas API)
 */
async function resizeImageInContentScript(
  tabId: number,
  dataUrl: string,
  targetWidth: number = 1280,
  targetHeight: number = 720,
): Promise<string> {
  try {
    console.log(`🖼️ [Screenshot] Requesting image resize in tab ${tabId} to ${targetWidth}×${targetHeight}`);
    
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'resize_image',
      data: {
        dataUrl,
        targetWidth,
        targetHeight,
      },
    });
    
    if (response?.success && response.resizedDataUrl) {
      console.log(`✅ [Screenshot] Image resized successfully: ${response.originalSize} → ${response.resizedSize} bytes`);
      return response.resizedDataUrl;
    } else {
      throw new Error(response?.error || 'Failed to resize image');
    }
  } catch (error) {
    console.error('❌ [Screenshot] Failed to resize image in content script:', error);
    throw error;
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
    
    // Try to get viewport size from content script first (more reliable)
    let viewportFromContentScript: {width: number, height: number, x?: number, y?: number} | null = null;
    try {
      const viewportResponse = await chrome.tabs.sendMessage(tabId, {
        type: 'get_viewport'
      });
      if (viewportResponse?.success && viewportResponse.data) {
        const { width, height } = viewportResponse.data;
        if (width > 0 && height > 0) {
          viewportFromContentScript = { width, height, x: 0, y: 0 };
          console.log(`👁️ [Screenshot] Got viewport from content script: ${width}x${height}`);
        }
      }
    } catch (e) {
      console.warn('⚠️ [Screenshot] Failed to get viewport from content script:', e);
    }
    
    // Get layout metrics to determine viewport size (fallback)
    const layoutMetrics = await cdpCommander.sendCommand<any>('Page.getLayoutMetrics', {});
    
    console.log(`📐 [Screenshot] Layout metrics:`, JSON.stringify(layoutMetrics, null, 2));
    
    // Calculate viewport dimensions
    const visualViewport = layoutMetrics.visualViewport;
    const contentSize = layoutMetrics.contentSize;
    
    // Get device pixel ratio from content script if possible
    let devicePixelRatio = 1;
    try {
      const dpResponse = await chrome.tabs.sendMessage(tabId, {
        type: 'get_device_pixel_ratio'
      });
      if (dpResponse?.success && dpResponse.devicePixelRatio) {
        devicePixelRatio = dpResponse.devicePixelRatio;
      }
    } catch (e) {
      console.warn('⚠️ [Screenshot] Failed to get device pixel ratio, using 1:', e);
    }
    
    console.log(`📱 [Screenshot] Device pixel ratio: ${devicePixelRatio}`);
    
    // Determine viewport dimensions - prefer content script, then CDP metrics
    let viewportWidth, viewportHeight, viewportX, viewportY;
    
    if (viewportFromContentScript) {
      // Use viewport size from content script (most reliable)
      viewportWidth = viewportFromContentScript.width;
      viewportHeight = viewportFromContentScript.height;
      viewportX = viewportFromContentScript.x || 0;
      viewportY = viewportFromContentScript.y || 0;
      console.log(`✅ [Screenshot] Using viewport from content script: ${viewportWidth}x${viewportHeight} at (${viewportX}, ${viewportY})`);
    } else if (visualViewport && visualViewport.clientWidth > 0 && visualViewport.clientHeight > 0) {
      // Visual viewport gives the currently visible area (accounts for zoom, scroll)
      viewportWidth = Math.floor(visualViewport.clientWidth);
      viewportHeight = Math.floor(visualViewport.clientHeight);
      viewportX = Math.floor(visualViewport.pageX);
      viewportY = Math.floor(visualViewport.pageY);
      console.log(`👁️ [Screenshot] Using visual viewport: ${viewportWidth}x${viewportHeight} at (${viewportX}, ${viewportY})`);
    } else if (layoutMetrics.layoutViewport && layoutMetrics.layoutViewport.clientWidth > 0) {
      // Use layout viewport (the viewport excluding scrollbars)
      const layoutViewport = layoutMetrics.layoutViewport;
      viewportWidth = Math.floor(layoutViewport.clientWidth);
      viewportHeight = Math.floor(layoutViewport.clientHeight);
      viewportX = 0;
      viewportY = 0;
      console.log(`📐 [Screenshot] Using layout viewport: ${viewportWidth}x${viewportHeight}`);
    } else {
      // Fall back to content size (entire page) - LAST RESORT
      viewportWidth = Math.floor(contentSize.width);
      viewportHeight = Math.floor(contentSize.height);
      viewportX = 0;
      viewportY = 0;
      console.log(`⚠️ [Screenshot] WARNING: Using content size (entire page): ${viewportWidth}x${viewportHeight}. This may be too large!`);
    }
    
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