/**
 * Screenshot Capture Tool
 * Based on AIPex screenshot.ts
 */

import { cacheScreenshotMetadata } from './computer';

/**
 * Resize image using content script (Canvas API)
 */
async function resizeImageInContentScript(
  tabId: number,
  dataUrl: string,
  targetWidth: number = 2560,
  targetHeight: number = 1440,
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
 * Capture screenshot of visible tab
 */
export async function captureScreenshot(
  tabId?: number,
  includeCursor: boolean = true,
  quality: number = 90,
  resizeToPreset: boolean = true,  // Whether to resize to preset coordinate system dimensions (2560×1440)
  waitForRender: number = 100,     // Wait time after tab activation to ensure rendering (in ms)
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

  // Capture screenshot
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
      const PRESET_WIDTH = 2560;
      const PRESET_HEIGHT = 1440;
      
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
    },
  };
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