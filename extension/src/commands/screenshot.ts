/**
 * Screenshot Capture Tool
 * Based on AIPex screenshot.ts
 */

import { cacheScreenshotMetadata } from './computer';

/**
 * Capture screenshot of visible tab
 */
export async function captureScreenshot(
  tabId?: number,
  includeCursor: boolean = true,
  quality: number = 90,
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

  // Activate tab for screenshot
  await chrome.tabs.update(targetTabId, { active: true });
  await new Promise((resolve) => setTimeout(resolve, 100));

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

  // Get image dimensions
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = dataUrl;
  });

  const imageWidth = img.width;
  const imageHeight = img.height;

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
    imageData: dataUrl,
    metadata: {
      tabId: targetTabId,
      width: imageWidth,
      height: imageHeight,
      viewportWidth: viewport?.width ?? 0,
      viewportHeight: viewport?.height ?? 0,
      url: tab.url,
      title: tab.title,
    },
  };
}

/**
 * Compress image for transmission
 */
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