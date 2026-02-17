/**
 * Content Script - Runs in web pages
 * Handles visual mouse pointer and viewport information
 */

import { VisualMousePointer } from './visual-mouse';

console.log('🖥️ Local Chrome Control content script loaded', {
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
      visualMouse.destroy();
      sendResponse({ success: true });
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

// Handle page unload
window.addEventListener('beforeunload', () => {
  // Clean up visual mouse
  visualMouse.destroy();
});

console.log('✅ Content script initialized with visual mouse pointer');