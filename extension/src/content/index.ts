/**
 * Content Script - Runs in web pages
 * Provides viewport information and image resizing utilities
 *
 * Note: Visual mouse pointer has been removed. All browser automation
 * is now done via JavaScript execution (javascript_execute command).
 */

console.log('🖥️ OpenBrowser content script loaded', {
  location: window.location.href,
  readyState: document.readyState,
  timestamp: Date.now(),
});

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('Content script received message:', message);

  // Handle different message types
  switch (message.type) {
    case 'ping':
      sendResponse({ pong: true, timestamp: Date.now() });
      break;

    case 'get_viewport':
      // Return viewport information
      const viewportInfo = {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      };
      sendResponse({
        success: true,
        data: viewportInfo,
      });
      break;

    case 'get_device_pixel_ratio':
      sendResponse({
        success: true,
        devicePixelRatio: window.devicePixelRatio || 1,
      });
      break;

    case 'resize_image':
      // Resize image to simulated coordinate system dimensions (1280x720)
      try {
        const {
          dataUrl,
          targetWidth = 1280,
          targetHeight = 720,
        } = message.data;
        console.log(`🖼️ Resizing image to ${targetWidth}×${targetHeight}...`);

        resizeImage(dataUrl, targetWidth, targetHeight)
          .then((resizedDataUrl) => {
            sendResponse({
              success: true,
              resizedDataUrl,
              originalSize: dataUrl.length,
              resizedSize: resizedDataUrl.length,
            });
          })
          .catch((error) => {
            sendResponse({
              success: false,
              error: error.message,
            });
          });

        return true; // Keep channel open for async response
      } catch (error) {
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
      break;

    default:
      console.log('Unknown message type:', message.type);
      sendResponse({ error: 'Unknown message type' });
  }

  return true; // Keep message channel open for async response
});

// Expose utility functions to background script
(window as any).chromeControl = {
  getViewport: () => ({
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  }),
};

/**
 * Resize image to target dimensions using Canvas API
 * @param dataUrl Original image data URL
 * @param targetWidth Target width in pixels
 * @param targetHeight Target height in pixels
 * @returns Resized image data URL
 */
async function resizeImage(
  dataUrl: string,
  targetWidth: number,
  targetHeight: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        console.log(`🖼️ Original image dimensions: ${img.width}x${img.height}`);
        console.log(`🖼️ Target dimensions: ${targetWidth}x${targetHeight}`);

        // Calculate scaling ratio to fit within target dimensions while maintaining aspect ratio
        const scale = Math.min(
          targetWidth / img.width,
          targetHeight / img.height,
        );

        // Calculate new dimensions
        const newWidth = Math.floor(img.width * scale);
        const newHeight = Math.floor(img.height * scale);

        // Calculate centering offset
        const offsetX = Math.floor((targetWidth - newWidth) / 2);
        const offsetY = Math.floor((targetHeight - newHeight) / 2);

        console.log(
          `🖼️ Scaling factor: ${scale}, new dimensions: ${newWidth}x${newHeight}, offset: (${offsetX}, ${offsetY})`,
        );

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        // Fill background with white (optional, for debugging)
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, targetWidth, targetHeight);

        // Draw image to canvas with scaling and centering
        ctx.drawImage(
          img,
          0,
          0,
          img.width,
          img.height,
          offsetX,
          offsetY,
          newWidth,
          newHeight,
        );

        // Convert to data URL (PNG format for lossless quality)
        const resizedDataUrl = canvas.toDataURL('image/png');
        console.log(
          `🖼️ Image resized successfully, data URL length: ${resizedDataUrl.length}`,
        );
        resolve(resizedDataUrl);
      } catch (error) {
        console.error('❌ Error in resizeImage:', error);
        reject(error);
      }
    };
    img.onerror = () => {
      console.error('❌ Failed to load image for resizing');
      reject(new Error('Failed to load image'));
    };
    img.src = dataUrl;
  });
}

console.log('✅ Content script initialized (JavaScript-only automation mode)');
