/**
 * Content Script - Runs in web pages
 * Handles visual mouse pointer and viewport information
 */

import { VisualMousePointer } from './visual-mouse';

console.log('🖥️ OpenBrowser content script loaded', {
  location: window.location.href,
  readyState: document.readyState,
  timestamp: Date.now()
});

// Initialize visual mouse pointer
console.log('🖥️ Creating VisualMousePointer instance...');
const visualMouse = new VisualMousePointer();
console.log('🖥️ VisualMousePointer instance created');

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Content script received message:', message);
  
  // Handle different message types
  switch (message.type) {
    case 'ping':
      sendResponse({ pong: true, timestamp: Date.now() });
      break;
      
    case 'get_viewport':
      const viewportInfo = visualMouse.getViewportInfo();
      sendResponse({
        success: true,
        data: viewportInfo,
      });
      break;
      
    case 'visual_mouse_update':
      visualMouse.handleMouseUpdate(message.data);
      sendResponse({ success: true });
      break;
      
    case 'visual_mouse_toggle':
      visualMouse.toggleVisibility();
      sendResponse({ success: true, visible: visualMouse['isVisible'] });
      break;
      
    case 'visual_mouse_position':
      sendResponse({
        success: true,
        data: visualMouse.getPosition(),
      });
      break;
      
    case 'visual_mouse_destroy':
      visualMouse.hidePointer();
      sendResponse({ success: true });
      break;
      
    case 'resize_image':
      // Resize image to simulated coordinate system dimensions (2560×1440)
      try {
        const { dataUrl, targetWidth = 2560, targetHeight = 1440 } = message.data;
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

// Expose functions to background script
(window as any).chromeControl = {
  getViewport: () => visualMouse.getViewportInfo(),
  
  getVisualMousePosition: () => visualMouse.getPosition(),
  
  updateVisualMouse: (data: any) => visualMouse.handleMouseUpdate(data),
  
  toggleVisualMouse: () => visualMouse.toggleVisibility(),
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
        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }
        
        // Draw image to canvas with scaling
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
        
        // Convert to data URL (PNG format for lossless quality)
        const resizedDataUrl = canvas.toDataURL('image/png');
        resolve(resizedDataUrl);
      } catch (error) {
        reject(error);
      }
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}

// Handle page unload
window.addEventListener('beforeunload', () => {
  // Clean up visual mouse
  visualMouse.destroy();
});

console.log('✅ Content script initialized with visual mouse pointer');