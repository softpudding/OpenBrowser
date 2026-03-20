/**
 * Screenshot Capture Tool
 * Uses session-based long connection debugger management
 */

import { cacheScreenshotMetadata } from './computer';
import { CdpCommander } from './cdp-commander';
import { debuggerSessionManager } from './debugger-manager';
import { workerManager } from '../workers/worker-manager';
import { dialogManager, DialogType, type DialogInfo } from './dialog';

/**
 * Error thrown when screenshot capture is blocked by an open dialog
 */
export class DialogBlockedError extends Error {
  public autoAcceptedDialogs?: DialogInfo[];

  constructor(
    public tabId: number,
    public dialogType: DialogType,
    public dialogMessage: string,
    public needsDecision: boolean,
    autoAcceptedDialogs?: DialogInfo[],
  ) {
    super(
      `Cannot capture screenshot: A ${dialogType} dialog is open ("${dialogMessage}"). Use handle_dialog to respond first.`,
    );
    this.name = 'DialogBlockedError';
    this.autoAcceptedDialogs = autoAcceptedDialogs;
  }
}

/**
 * Resize image using OffscreenCanvas and createImageBitmap
 *
 * This is the only resize method we use because it works in Service Worker context
 * (Manifest V3 background script) and doesn't require tab activation or content script messaging.
 *
 * IMPORTANT: If OffscreenCanvas or createImageBitmap is not available, the function will
 * throw an error instead of falling back to content script (which could cause tab activation).
 *
 * Uses "cover" mode: scales image to cover target dimensions while maintaining aspect ratio,
 * then crops the overflow. This ensures no white borders and maximizes image information.
 */
async function resizeImage(
  dataUrl: string,
  targetWidth: number = 1280,
  targetHeight: number = 720,
): Promise<{ dataUrl: string; cropOffsetX: number; cropOffsetY: number }> {
  console.log(
    `🖼️ [Screenshot] Resizing image to ${targetWidth}x${targetHeight} (cover mode)...`,
  );

  // Check if OffscreenCanvas is available
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error(
      '[Screenshot] OffscreenCanvas is not available in this environment. ' +
        'Image resizing requires OffscreenCanvas support. ' +
        'Browser may be outdated or running in an unsupported context.',
    );
  }

  // Check if createImageBitmap is available (alternative to Image in Service Worker)
  if (typeof createImageBitmap === 'undefined') {
    throw new Error(
      '[Screenshot] createImageBitmap is not available in this environment. ' +
        'Image resizing requires createImageBitmap support in Service Worker context.',
    );
  }

  try {
    // Convert data URL to Blob
    const response = await fetch(dataUrl);
    const blob = await response.blob();

    // Create ImageBitmap from Blob (works in Service Worker)
    const imageBitmap = await createImageBitmap(blob);

    console.log(
      `🖼️ [Screenshot] Original image dimensions: ${imageBitmap.width}x${imageBitmap.height}`,
    );

    if (imageBitmap.width <= 0 || imageBitmap.height <= 0) {
      throw new Error(
        `[Screenshot] Invalid original image dimensions: ${imageBitmap.width}x${imageBitmap.height}`,
      );
    }

    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      throw new Error(
        '[Screenshot] Failed to get 2d context from OffscreenCanvas',
      );
    }

    // Fill background with white (to avoid transparency issues)
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, targetWidth, targetHeight);

    // Calculate scaling to COVER target dimensions while maintaining aspect ratio
    // Use Math.max instead of Math.min to ensure image covers the entire canvas
    const scaleX = targetWidth / imageBitmap.width;
    const scaleY = targetHeight / imageBitmap.height;
    const scale = Math.max(scaleX, scaleY); // Changed from Math.min to Math.max (cover mode)

    const scaledWidth = Math.floor(imageBitmap.width * scale);
    const scaledHeight = Math.floor(imageBitmap.height * scale);

    if (scaledWidth <= 0 || scaledHeight <= 0) {
      throw new Error(
        `[Screenshot] Invalid scaled dimensions: ${scaledWidth}x${scaledHeight}`,
      );
    }

    // Calculate crop offset to center the image
    // This will be negative when the scaled image is larger than target
    const cropOffsetX = Math.floor((targetWidth - scaledWidth) / 2);
    const cropOffsetY = Math.floor((targetHeight - scaledHeight) / 2);

    console.log(
      `🖼️ [Screenshot] Scaling: scale=${scale.toFixed(3)}, scaled dimensions: ${scaledWidth}x${scaledHeight}, crop offset: (${cropOffsetX}, ${cropOffsetY})`,
    );

    // Draw ImageBitmap to canvas with scaling and centering
    // Negative offsets will crop the overflow
    ctx.drawImage(
      imageBitmap,
      cropOffsetX,
      cropOffsetY,
      scaledWidth,
      scaledHeight,
    );

    // Convert to data URL (PNG format for lossless quality)
    const resizedBlob = await canvas.convertToBlob({ type: 'image/png' });

    // Convert Blob to data URL using FileReader
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const resizedDataUrl = reader.result as string;
        console.log(
          `✅ [Screenshot] Image resized successfully (cover mode): ${imageBitmap.width}x${imageBitmap.height} → ${targetWidth}x${targetHeight}`,
        );
        resolve({
          dataUrl: resizedDataUrl,
          cropOffsetX: cropOffsetX, // Negative value indicates crop from left/top
          cropOffsetY: cropOffsetY,
        });
      };
      reader.onerror = () =>
        reject(new Error('[Screenshot] Failed to read resized blob'));
      reader.readAsDataURL(resizedBlob);
    });
  } catch (error) {
    const errorMsg = `[Screenshot] Error during image resize: ${error instanceof Error ? error.message : error}`;
    console.error(`❌ ${errorMsg}`);
    throw new Error(errorMsg);
  }
}

/**
 * Resize image using Web Worker to prevent main thread blocking
 * Falls back to main thread resize if worker is unavailable
 */
export async function resizeImageWithWorker(
  dataUrl: string,
  targetWidth: number = 1280,
  targetHeight: number = 720,
): Promise<{ dataUrl: string; cropOffsetX: number; cropOffsetY: number }> {
  console.log(
    `🖼️ [Screenshot] Resizing image using worker to ${targetWidth}x${targetHeight}...`,
  );

  try {
    // Try to use worker first
    const result = await workerManager.resizeImage(
      dataUrl,
      targetWidth,
      targetHeight,
    );
    console.log(`✅ [Screenshot] Image resized successfully using worker`);
    return result;
  } catch (workerError) {
    console.warn(
      `⚠️ [Screenshot] Worker resize failed: ${workerError instanceof Error ? workerError.message : workerError}`,
    );
    console.log(`🖼️ [Screenshot] Falling back to main thread resize...`);

    // Fallback to main thread resize
    return resizeImage(dataUrl, targetWidth, targetHeight);
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
  conversationId: string,
  _includeCursor: boolean = true,
  quality: number = 90,
  _resizeToPreset: boolean = true, // 已忽略，不再进行缩放
  waitForRender: number = 500,
): Promise<any> {
  console.log(
    `📸 [Screenshot] Capturing screenshot via CDP for tab ${tabId} in session ${conversationId}`,
  );

  // 使用会话级长连接 attach
  const attached = await debuggerSessionManager.attachDebugger(
    tabId,
    conversationId,
  );
  if (!attached) {
    throw new Error(
      '[Screenshot] Failed to attach debugger for screenshot - cannot proceed',
    );
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
      const dprResult = await cdpCommander.sendCommand<any>(
        'Runtime.evaluate',
        {
          expression: 'window.devicePixelRatio',
          returnByValue: true,
        },
      );

      if (
        !dprResult?.result?.value ||
        typeof dprResult.result.value !== 'number'
      ) {
        throw new Error(
          '[Screenshot] Runtime.evaluate returned invalid devicePixelRatio',
        );
      }

      devicePixelRatio = dprResult.result.value;

      // Validate DPR is reasonable (typically 1, 2, or 3 for standard and Retina displays)
      if (devicePixelRatio < 1 || devicePixelRatio > 4) {
        throw new Error(
          `[Screenshot] Invalid devicePixelRatio: ${devicePixelRatio} (expected 1-4)`,
        );
      }

      console.log(
        `✅ [Screenshot] Got device pixel ratio from Runtime.evaluate: ${devicePixelRatio}`,
      );
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
      const viewportResult = await cdpCommander.sendCommand<any>(
        'Runtime.evaluate',
        {
          expression:
            '({width: window.innerWidth, height: window.innerHeight})',
          returnByValue: true,
        },
      );

      if (
        !viewportResult?.result?.value?.width ||
        !viewportResult?.result?.value?.height
      ) {
        throw new Error(
          '[Screenshot] Runtime.evaluate returned invalid viewport dimensions',
        );
      }

      viewportWidth = Math.floor(viewportResult.result.value.width);
      viewportHeight = Math.floor(viewportResult.result.value.height);

      // Validate viewport dimensions are reasonable
      if (viewportWidth < 100 || viewportWidth > 10000) {
        throw new Error(
          `[Screenshot] Invalid viewport width: ${viewportWidth} (expected 100-10000)`,
        );
      }
      if (viewportHeight < 100 || viewportHeight > 10000) {
        throw new Error(
          `[Screenshot] Invalid viewport height: ${viewportHeight} (expected 100-10000)`,
        );
      }

      console.log(
        `✅ [Screenshot] Got viewport dimensions from Runtime.evaluate: ${viewportWidth}x${viewportHeight}`,
      );
    } catch (viewportError) {
      const errorMsg = `[Screenshot] Failed to get viewport dimensions: ${viewportError instanceof Error ? viewportError.message : viewportError}`;
      console.error(`❌ ${errorMsg}`);
      throw new Error(errorMsg);
    }

    // ========================================
    // STEP 3: Get scroll position and set up CDP screenshot parameters
    // ========================================
    // Get current scroll position to capture the current viewport
    let scrollX = 0;
    let scrollY = 0;
    try {
      const scrollResult = await cdpCommander.sendCommand<any>(
        'Runtime.evaluate',
        {
          expression: '({scrollX: window.scrollX, scrollY: window.scrollY})',
          returnByValue: true,
        },
      );

      if (scrollResult?.result?.value) {
        scrollX = scrollResult.result.value.scrollX || 0;
        scrollY = scrollResult.result.value.scrollY || 0;
        console.log(
          `📜 [Screenshot] Current scroll position: (${scrollX}, ${scrollY})`,
        );
      }
    } catch (scrollError) {
      console.warn(
        `⚠️ [Screenshot] Failed to get scroll position, using (0, 0): ${scrollError instanceof Error ? scrollError.message : scrollError}`,
      );
      // Continue with default (0, 0) if scroll position cannot be determined
    }

    const cssViewportX = scrollX;
    const cssViewportY = scrollY;
    const cssViewportWidth = viewportWidth;
    const cssViewportHeight = viewportHeight;

    console.log(
      `🖥️ [Screenshot] Viewport size (CSS pixels): ${cssViewportWidth}x${cssViewportHeight} at (${cssViewportX}, ${cssViewportY})`,
    );
    console.log(
      `📸 [Screenshot] Expected device pixels: ${cssViewportWidth * devicePixelRatio}x${cssViewportHeight * devicePixelRatio}`,
    );

    // ========================================
    // STEP 4: Wait for rendering if requested
    // ========================================
    if (waitForRender > 0) {
      console.log(
        `⏳ Waiting ${waitForRender}ms for page rendering before screenshot...`,
      );
      await new Promise((resolve) => setTimeout(resolve, waitForRender));
    }

    // ========================================
    // STEP 5: Capture screenshot - "所见即所得"方案
    // ========================================
    // CDP captureScreenshot parameters:
    // - clip.x, clip.y: starting position in CSS pixels
    // - clip.width, clip.height: dimensions in CSS pixels
    // - clip.scale: device pixel ratio (e.g., 2 for Retina displays)
    // The returned image will be in device pixels (width * scale, height * scale)

    // 使用实际设备像素比，不限制
    const clipScale = devicePixelRatio;

    console.log(
      `🎯 [Screenshot] Capturing with clip: (${cssViewportX}, ${cssViewportY}) ${cssViewportWidth}x${cssViewportHeight} CSS pixels, scale=${clipScale} (实际DPI)`,
    );

    // 最大允许的base64数据大小：10MB
    const MAX_BASE64_SIZE = 10 * 1024 * 1024; // 10MB in bytes

    // 先尝试PNG格式（无损）
    let screenshot: any;
    let format = 'png';
    let finalQuality = quality;
    let attempts = 0;
    const maxAttempts = 5; // PNG + JPEG质量递减尝试

    while (attempts < maxAttempts) {
      attempts++;

      try {
        console.log(
          `🎯 [Screenshot] Attempt ${attempts}: capturing with format=${format}, quality=${finalQuality}`,
        );

        screenshot = await cdpCommander.sendCommand<any>(
          'Page.captureScreenshot',
          {
            format: format as 'png' | 'jpeg',
            quality: format === 'jpeg' ? finalQuality : undefined, // PNG忽略quality参数
            fromSurface: true,
            clip: {
              x: cssViewportX,
              y: cssViewportY,
              width: cssViewportWidth,
              height: cssViewportHeight,
              scale: clipScale,
            },
          },
        );

        if (!screenshot?.data) {
          throw new Error(
            '[Screenshot] Page.captureScreenshot returned no data',
          );
        }

        // 检查数据大小
        console.log(
          `📊 [Screenshot] Captured ${format.toUpperCase()} data size: ${screenshot.data.length} bytes`,
        );

        // 如果数据大小在限制内，使用此截图
        if (screenshot.data.length <= MAX_BASE64_SIZE) {
          console.log(
            `✅ [Screenshot] Screenshot size within limit (${screenshot.data.length} bytes <= ${MAX_BASE64_SIZE} bytes)`,
          );
          break;
        }

        // 数据太大，需要调整
        console.warn(
          `⚠️ [Screenshot] Screenshot too large (${screenshot.data.length} bytes > ${MAX_BASE64_SIZE} bytes)`,
        );

        // 如果当前是PNG，切换到JPEG格式（使用传入的质量）
        if (format === 'png') {
          format = 'jpeg';
          finalQuality = quality; // 使用用户指定的质量
          console.log(
            `🔄 [Screenshot] Switching from PNG to JPEG, starting with quality=${finalQuality}`,
          );
          continue;
        }

        // 如果已经是JPEG但太大，降低质量
        if (format === 'jpeg') {
          if (finalQuality > 50) {
            finalQuality = Math.max(50, finalQuality - 10); // 每次降低10%，最低50%
            console.log(
              `🔄 [Screenshot] Reducing JPEG quality to ${finalQuality}`,
            );
            continue;
          } else {
            // 质量已经降到最低，但仍然太大
            console.warn(
              `⚠️ [Screenshot] JPEG quality at minimum (50%) but still too large, using anyway`,
            );
            break;
          }
        }
      } catch (captureError) {
        const errorMsg = `[Screenshot] Page.captureScreenshot failed: ${captureError instanceof Error ? captureError.message : captureError}`;
        console.error(`❌ ${errorMsg}`);

        // 如果是第一次尝试PNG失败，尝试JPEG
        if (attempts === 1 && format === 'png') {
          format = 'jpeg';
          finalQuality = quality; // 使用用户指定的质量
          console.log(
            `🔄 [Screenshot] PNG capture failed, trying JPEG with quality=${finalQuality}`,
          );
          continue;
        }

        throw new Error(errorMsg);
      }
    }

    if (!screenshot?.data) {
      throw new Error(
        '[Screenshot] Failed to capture screenshot after all attempts',
      );
    }

    const dataUrl = `data:image/${format};base64,${screenshot.data}`;

    if (!dataUrl.startsWith('data:image/')) {
      throw new Error('[Screenshot] Invalid image data format from CDP');
    }

    // ========================================
    // STEP 6: Validate screenshot data
    // ========================================
    // The screenshot should be in device pixels
    const expectedDeviceWidth = cssViewportWidth * devicePixelRatio;
    const expectedDeviceHeight = cssViewportHeight * devicePixelRatio;

    console.log(
      `📊 [Screenshot] Final image: ${format.toUpperCase()} ${expectedDeviceWidth}x${expectedDeviceHeight}, quality=${finalQuality}, size=${screenshot.data.length} bytes`,
    );

    // Basic validation: screenshot data should exist and be reasonably sized
    if (!screenshot.data || screenshot.data.length < 1000) {
      throw new Error(
        `[Screenshot] Screenshot data too small or missing (${screenshot.data?.length || 0} bytes)`,
      );
    }

    console.log(
      `✅ [Screenshot] Screenshot captured successfully, format=${format}, quality=${finalQuality}, size=${screenshot.data.length} bytes`,
    );

    // ========================================
    // STEP 7: 验证最终图像数据并返回结果
    // ========================================
    // 不再进行缩放，直接使用原始截图
    const finalImageData = dataUrl;
    const finalImageWidth = expectedDeviceWidth;
    const finalImageHeight = expectedDeviceHeight;

    // 基本验证：图像数据应合理大小
    // 对于大尺寸截图，最小值应更高
    const minFinalSize = 10000; // 至少10KB
    if (finalImageData.length < minFinalSize) {
      throw new Error(
        `[Screenshot] Final image data too small (${finalImageData.length} bytes), likely blank or corrupted`,
      );
    }

    // ========================================
    // STEP 8: 缓存元数据并返回结果
    // ========================================
    cacheScreenshotMetadata(
      tabId,
      finalImageWidth,
      finalImageHeight,
      cssViewportWidth, // CSS viewport width
      cssViewportHeight, // CSS viewport height
    );

    const tab = await chrome.tabs.get(tabId);

    console.log(
      `✅ [Screenshot] Screenshot complete: ${finalImageWidth}x${finalImageHeight}, format=${format}, quality=${finalQuality}, size=${screenshot.data.length} bytes`,
    );

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
        format: format, // 图像格式 (png/jpeg)
        quality: finalQuality, // 图像质量 (JPEG only)
        captureMethod: 'cdp',
        devicePixelRatio: devicePixelRatio,
        // 不再有裁剪偏移，因为不进行缩放
        cropOffsetX: 0,
        cropOffsetY: 0,
      },
    };
  } catch (error) {
    // Catch any errors and re-throw with context
    const errorMsg = `[Screenshot] CDP screenshot failed: ${error instanceof Error ? error.message : error}`;
    console.error(`❌ ${errorMsg}`);
    throw new Error(errorMsg);
  }
  // 长连接模式：不再在 finally 中 detach，由会话管理器处理生命周期
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
 * @param conversationId Session ID for debugger lifecycle management (REQUIRED)
 * @param includeCursor Whether to include cursor (not supported by CDP)
 * @param quality Image quality (1-100)
 * @param resizeToPreset Whether to resize to 1280x720
 * @param waitForRender Time to wait for rendering in ms
 * @returns Screenshot data with metadata
 */
export async function captureScreenshot(
  tabId?: number,
  conversationId?: string,
  includeCursor: boolean = true,
  quality: number = 90,
  resizeToPreset: boolean = false,
  waitForRender: number = 500,
): Promise<any> {
  // Resolve tab ID if not provided
  let targetTabId = tabId;
  if (!targetTabId) {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id) {
      throw new Error('[Screenshot] No active tab found');
    }
    targetTabId = tab.id;
  }

  // Track all auto-accepted dialogs for metadata
  const autoAcceptedDialogs: DialogInfo[] = [];

  // ⚠️ DIALOG BLOCKING CHECK: Cannot take screenshot while dialog is open
  // Process all dialogs in a loop: auto-accept alerts, throw for decisions needed
  while (dialogManager.hasActiveDialog(targetTabId)) {
    const dialog = dialogManager.getActiveDialog(targetTabId)!;

    if (!dialog.needsDecision) {
      // Alert dialogs are auto-accepted by the system (no AI decision needed)
      console.log(
        `💬 [Screenshot] Auto-accepting alert dialog: "${dialog.message}"`,
      );

      try {
        // Store dialog info before auto-accepting
        autoAcceptedDialogs.push({ ...dialog });

        await dialogManager.autoAcceptDialog(targetTabId);

        // Wait a bit for dialog to close and page to settle
        await new Promise((resolve) => setTimeout(resolve, 100));

        console.log(`✅ [Screenshot] Alert dialog auto-accepted`);

        // Continue loop to check for cascading dialogs
        continue;
      } catch (autoAcceptError) {
        console.error(
          `❌ [Screenshot] Failed to auto-accept alert dialog:`,
          autoAcceptError,
        );
        // If auto-accept fails, still throw DialogBlockedError so AI can handle it
        throw new DialogBlockedError(
          targetTabId,
          dialog.dialogType,
          dialog.message,
          dialog.needsDecision,
          autoAcceptedDialogs.length > 0 ? autoAcceptedDialogs : undefined,
        );
      }
    } else {
      // For dialogs that need AI decision (confirm, prompt, beforeunload)
      // Throw DialogBlockedError with information about auto-accepted dialogs if any
      throw new DialogBlockedError(
        targetTabId,
        dialog.dialogType,
        dialog.message,
        dialog.needsDecision,
        autoAcceptedDialogs.length > 0 ? autoAcceptedDialogs : undefined,
      );
    }
  }

  // 会话 ID 是必需的
  if (!conversationId) {
    throw new Error(
      '[Screenshot] conversationId is required for debugger lifecycle management',
    );
  }

  console.log(
    `📸 [Screenshot] Starting screenshot capture for tab ${targetTabId} in session ${conversationId}`,
  );
  console.log(
    `📸 [Screenshot] Parameters: quality=${quality}, resizeToPreset=${resizeToPreset} (已忽略), waitForRender=${waitForRender}`,
  );

  // ⏱️ Always wait 500ms before capturing to ensure page is fully rendered
  console.log(`⏳ [Screenshot] Waiting 500ms before capture...`);
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Validate parameters
  if (quality < 1 || quality > 100) {
    throw new Error(
      `[Screenshot] Invalid quality value: ${quality} (expected 1-100)`,
    );
  }

  if (waitForRender < 0) {
    throw new Error(
      `[Screenshot] Invalid waitForRender value: ${waitForRender} (expected >= 0)`,
    );
  }

  // Verify tab exists and is accessible
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(targetTabId);
  } catch (tabError) {
    throw new Error(
      `[Screenshot] Cannot access tab ${targetTabId}: ${tabError instanceof Error ? tabError.message : tabError}`,
    );
  }

  // Check if tab URL is accessible
  const url = tab.url || '';
  if (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('edge://')
  ) {
    throw new Error(
      `[Screenshot] Cannot capture screenshot of restricted URL: ${url}`,
    );
  }

  // Use CDP method with session-based debugger management
  const result = await captureScreenshotWithCDP(
    targetTabId,
    conversationId,
    includeCursor,
    quality,
    resizeToPreset,
    waitForRender,
  );

  // Add auto-accepted dialog info to metadata if applicable
  if (autoAcceptedDialogs.length > 0) {
    console.log(
      `💬 [Screenshot] Adding ${autoAcceptedDialogs.length} auto-accepted dialog(s) to metadata`,
    );

    // Create simplified dialog info objects for metadata
    const dialogInfos = autoAcceptedDialogs.map((dialog) => ({
      type: dialog.dialogType,
      message: dialog.message,
      url: dialog.url,
      timestamp: dialog.timestamp,
    }));

    // Add to metadata
    result.metadata = {
      ...result.metadata,
      dialog_auto_accepted: dialogInfos.length > 0 ? dialogInfos[0] : null, // First dialog for backward compatibility
      dialog_auto_accepted_list: dialogInfos, // All dialogs
    };

    // Also add as top-level property for easy access
    result.dialog_auto_accepted =
      dialogInfos.length > 0 ? dialogInfos[0] : null; // First dialog for backward compatibility
    result.dialog_auto_accepted_list = dialogInfos; // All dialogs
  }
  console.log(
    `✅ [Screenshot] Screenshot captured successfully for tab ${targetTabId}`,
  );

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

/**
 * Compress screenshot if it exceeds size threshold
 *
 * Uses iterative resizing with OffscreenCanvas to reduce image size below threshold.
 * Falls back gracefully if compression fails.
 *
 * @param imageData - Image data as data URL (base64) or object with imageData property
 * @param thresholdBytes - Maximum allowed size in bytes (default: 1MB for base64 data)
 * @param minQuality - Minimum JPEG quality to try (default: 50)
 * @returns Compressed image data in same format as input
 */
export async function compressIfNeeded(
  imageData: string | { imageData?: string } | null | undefined,
  thresholdBytes: number = 1024 * 1024, // 1MB default
  minQuality: number = 50,
): Promise<string | { imageData?: string } | null | undefined> {
  // Handle null/undefined
  if (!imageData) {
    return imageData;
  }

  // Extract the actual image data URL
  let dataUrl: string;
  let isObject = false;

  if (typeof imageData === 'string') {
    dataUrl = imageData;
  } else if (
    imageData &&
    typeof imageData === 'object' &&
    'imageData' in imageData
  ) {
    dataUrl = imageData.imageData || '';
    isObject = true;
  } else {
    return imageData;
  }

  // Check if compression is needed
  if (!dataUrl || dataUrl.length <= thresholdBytes) {
    console.log(
      `📊 [CompressIfNeeded] Image size ${dataUrl?.length || 0} bytes <= threshold ${thresholdBytes} bytes, no compression needed`,
    );
    return imageData;
  }

  console.log(
    `🗜️ [CompressIfNeeded] Compressing image: ${dataUrl.length} bytes > ${thresholdBytes} bytes threshold`,
  );

  // Check if OffscreenCanvas is available
  if (
    typeof OffscreenCanvas === 'undefined' ||
    typeof createImageBitmap === 'undefined'
  ) {
    console.warn(
      '⚠️ [CompressIfNeeded] OffscreenCanvas not available, returning original image',
    );
    return imageData;
  }

  try {
    // Convert data URL to Blob
    const response = await fetch(dataUrl);
    const blob = await response.blob();

    // Create ImageBitmap
    const imageBitmap = await createImageBitmap(blob);
    const originalWidth = imageBitmap.width;
    const originalHeight = imageBitmap.height;

    console.log(
      `🖼️ [CompressIfNeeded] Original dimensions: ${originalWidth}x${originalHeight}`,
    );

    // Try progressively smaller sizes until under threshold
    const scaleSteps = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3];
    const qualitySteps = [80, 70, 60, minQuality];

    for (const scale of scaleSteps) {
      for (const quality of qualitySteps) {
        const targetWidth = Math.floor(originalWidth * scale);
        const targetHeight = Math.floor(originalHeight * scale);

        if (targetWidth < 200 || targetHeight < 150) {
          console.warn(
            `⚠️ [CompressIfNeeded] Reached minimum dimensions, stopping compression`,
          );
          break;
        }

        try {
          const canvas = new OffscreenCanvas(targetWidth, targetHeight);
          const ctx = canvas.getContext('2d');

          if (!ctx) {
            continue;
          }

          // Fill with white background
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, targetWidth, targetHeight);

          // Draw scaled image
          ctx.drawImage(imageBitmap, 0, 0, targetWidth, targetHeight);

          // Convert to JPEG with quality
          const compressedBlob = await canvas.convertToBlob({
            type: 'image/jpeg',
            quality: quality / 100,
          });

          // Read as data URL
          const compressedDataUrl = await new Promise<string>(
            (resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.onerror = () =>
                reject(new Error('Failed to read compressed blob'));
              reader.readAsDataURL(compressedBlob);
            },
          );

          console.log(
            `📊 [CompressIfNeeded] Tried scale=${scale.toFixed(1)}, quality=${quality}%: ${compressedDataUrl.length} bytes`,
          );

          if (compressedDataUrl.length <= thresholdBytes) {
            console.log(
              `✅ [CompressIfNeeded] Compressed successfully: ${dataUrl.length} → ${compressedDataUrl.length} bytes (${((1 - compressedDataUrl.length / dataUrl.length) * 100).toFixed(1)}% reduction)`,
            );

            // Return in same format as input
            if (isObject) {
              return { ...(imageData as object), imageData: compressedDataUrl };
            }
            return compressedDataUrl;
          }
        } catch (scaleError) {
          console.warn(
            `⚠️ [CompressIfNeeded] Scale attempt failed:`,
            scaleError,
          );
          continue;
        }
      }
    }

    console.warn(
      `⚠️ [CompressIfNeeded] Could not compress below threshold, returning best effort`,
    );
    return imageData;
  } catch (error) {
    console.error(`❌ [CompressIfNeeded] Compression failed:`, error);
    return imageData;
  }
}

/**
 * Get the default compression threshold from config or environment
 * Can be overridden by setting SCREENSHOT_COMPRESSION_THRESHOLD in global scope
 */
export function getCompressionThreshold(): number {
  // Check for global config (can be set by server)
  if (
    typeof globalThis !== 'undefined' &&
    (globalThis as any).SCREENSHOT_COMPRESSION_THRESHOLD
  ) {
    return (globalThis as any).SCREENSHOT_COMPRESSION_THRESHOLD;
  }
  // Default: 1MB (reasonable for network transmission)
  return 1024 * 1024;
}
