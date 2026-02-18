/**
 * Visual Mouse Pointer
 * Creates and manages a visual mouse pointer overlay on web pages
 * Provides visual feedback for CDP mouse operations
 */

export class VisualMousePointer {
  private pointerElement: HTMLElement | null = null;
  private coordElement: HTMLElement | null = null; // Element to display coordinates
  private currentX: number = 0;
  private currentY: number = 0;
  private isVisible: boolean = true;
  private pointerSize: number = 48; // Size matching AIPex
  private pointerColor: string = '#3B82F6'; // Blue color matching AIPex
  private glowColor: string = '#3B82F6'; // Glow color matching AIPex
  private isDragging: boolean = false;

  constructor() {
    console.log('🖱️ [VisualMouse] Constructor called');
    console.log('🖱️ [VisualMouse] Document readyState:', document.readyState);
    console.log('🖱️ [VisualMouse] Window dimensions:', window.innerWidth, 'x', window.innerHeight);
    this.createPointer();
    this.initializeEventListeners();
    console.log('🖱️ [VisualMouse] Constructor completed');
  }

  /**
   * Create the visual mouse pointer element
   */
  private createPointer(): void {
    // Remove existing pointer if any
    const existing = document.getElementById('chrome-control-visual-mouse');
    if (existing) {
      existing.remove();
    }
    // Remove existing coordinate element if any
    const existingCoord = document.getElementById('chrome-control-coordinate-display');
    if (existingCoord) {
      existingCoord.remove();
    }

    // Create new pointer element
    this.pointerElement = document.createElement('div');
    this.pointerElement.id = 'chrome-control-visual-mouse';
    
    // Apply styles - AIPex style blue fluorescent cursor
    // Start hidden (opacity: 0) - will be shown when active tab
    Object.assign(this.pointerElement.style, {
      position: 'fixed',
      width: `${this.pointerSize}px`,
      height: `${this.pointerSize}px`,
      pointerEvents: 'none',
      zIndex: '2147483647', // Maximum z-index
      opacity: '0', // Start hidden
      transform: 'translate(-50%, -50%)', // Center the cursor
      transition: 'transform 0.1s ease-out, opacity 0.2s ease, filter 0.2s ease',
      filter: 'drop-shadow(0 4px 12px rgba(0, 0, 0, 0.3))',
    } as CSSStyleDeclaration);

    // Create the mouse pointer using AIPex-style blue fluorescent cursor
    const pointerSvg = `
      <svg width="${this.pointerSize}" height="${this.pointerSize}" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="chrome-control-cursor-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color: ${this.pointerColor}; stop-opacity: 1" />
            <stop offset="100%" style="stop-color: ${this.pointerColor}; stop-opacity: 0.8" />
          </linearGradient>
          <radialGradient id="chrome-control-pulse-gradient" cx="50%" cy="50%" r="50%">
            <stop offset="0%" style="stop-color: ${this.glowColor}; stop-opacity: 1" />
            <stop offset="100%" style="stop-color: ${this.glowColor}; stop-opacity: 0" />
          </radialGradient>
          <filter id="chrome-control-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        
        <!-- Outer glow ring -->
        <circle cx="24" cy="24" r="20" fill="url(#chrome-control-pulse-gradient)" opacity="0.4" />
        
        <!-- Middle glow ring -->
        <circle cx="24" cy="24" r="15" fill="${this.glowColor}" opacity="0.3" />
        
        <!-- Outer white border for visibility -->
        <path d="M10 6 L38 24 L24 26 L18 42 L10 6 Z" fill="white" stroke="white" stroke-width="1" />
        
        <!-- Main arrow with gradient -->
        <path d="M12 8 L36 24 L24 25.5 L19 40 L12 8 Z" 
              fill="url(#chrome-control-cursor-gradient)" 
              stroke="white" 
              stroke-width="2" 
              stroke-linejoin="round"
              filter="url(#chrome-control-glow)" />
        
        <!-- Inner highlight for 3D effect -->
        <path d="M14 10 L30 22 L24 23 L20 34 L14 10 Z" 
              fill="rgba(147, 197, 253, 0.5)" 
              stroke="none" />
              
        <!-- Pulsing animation -->
        <style>
          @keyframes pulse-glow {
            0%, 100% { opacity: 0.4; }
            50% { opacity: 0.7; }
          }
          #chrome-control-visual-mouse svg circle:first-child {
            animation: pulse-glow 2s ease-in-out infinite;
          }
        </style>
      </svg>
    `;
    
    this.pointerElement.innerHTML = pointerSvg;

    // Create coordinate display element
    this.coordElement = document.createElement('div');
    this.coordElement.id = 'chrome-control-coordinate-display';
    Object.assign(this.coordElement.style, {
      position: 'fixed',
      pointerEvents: 'none',
      zIndex: '2147483646', // Just below the pointer
      opacity: '0', // Start hidden
      fontFamily: 'monospace',
      fontSize: '12px',
      fontWeight: 'bold',
      color: '#ffffff',
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
      padding: '2px 6px',
      borderRadius: '4px',
      whiteSpace: 'nowrap',
      textShadow: '0 1px 2px rgba(0, 0, 0, 0.8)',
      // No transform - we'll calculate position directly in updateCoordinateDisplay
    } as CSSStyleDeclaration);

    // Add to document
    console.log('🖱️ [VisualMouse] Adding pointer and coordinate elements to document...');
    document.documentElement.appendChild(this.pointerElement);
    document.documentElement.appendChild(this.coordElement);
    console.log('🖱️ [VisualMouse] Pointer element added to document, checking parent:', this.pointerElement.parentElement?.tagName);
    
    // Initial position - use safe dimensions to avoid division by zero
    const safeWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 800);
    const safeHeight = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 600);
    console.log('🖱️ [VisualMouse] Safe dimensions:', safeWidth, 'x', safeHeight);
    this.setPosition(safeWidth / 2, safeHeight / 2);
    
    console.log(`🖱️ [VisualMouse] Realistic mouse pointer created at safe position: ${safeWidth / 2}, ${safeHeight / 2} (window: ${window.innerWidth}x${window.innerHeight}, document: ${document.documentElement.clientWidth}x${document.documentElement.clientHeight})`);
    console.log('🖱️ [VisualMouse] Pointer element styles:', {
      left: this.pointerElement.style.left,
      top: this.pointerElement.style.top,
      position: this.pointerElement.style.position,
      zIndex: this.pointerElement.style.zIndex,
      opacity: this.pointerElement.style.opacity,
    });
  }

  /**
   * Initialize event listeners for interaction
   */
  private initializeEventListeners(): void {
    // Listen for messages from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'visual_mouse_update') {
        this.handleMouseUpdate(message.data);
        sendResponse({ success: true });
        return true;
      }
      return false;
    });

    // Listen for clicks to simulate mouse events (for debugging)
    if (this.pointerElement) {
      this.pointerElement.addEventListener('click', (e) => {
        console.log('Visual mouse clicked at:', this.currentX, this.currentY);
        // Optionally send click event to background
        chrome.runtime.sendMessage({
          type: 'visual_mouse_click',
          data: {
            x: this.currentX,
            y: this.currentY,
            button: 'left',
          },
        });
      });
    }

    // Track window resize to keep pointer visible
    window.addEventListener('resize', () => {
      console.log(`🖥️ [VisualMouse] Window resized: ${window.innerWidth}x${window.innerHeight}`);
      
      if (this.pointerElement) {
        // Keep pointer within bounds
        const x = Math.min(Math.max(this.currentX, 0), window.innerWidth);
        const y = Math.min(Math.max(this.currentY, 0), window.innerHeight);
        this.setPosition(x, y);
      }
    });

    // Listen for keyboard shortcuts to toggle visibility
    document.addEventListener('keydown', (e) => {
      // Ctrl+Shift+M to toggle visual mouse
      if (e.ctrlKey && e.shiftKey && e.key === 'M') {
        e.preventDefault();
        this.toggleVisibility();
      }
    });
  }

  /**
   * Handle mouse update from background script
   */
  handleMouseUpdate(data: any): void {
    console.log('🖱️ [VisualMouse] handleMouseUpdate called with data:', data);
    console.log('🖱️ [VisualMouse] Current pointer element:', this.pointerElement ? 'exists' : 'null');
    
    // Ensure pointer exists and is visible (this is an active tab)
    if (!this.pointerElement) {
      console.log('🖱️ [VisualMouse] Pointer element does not exist, recreating...');
      this.createPointer();
    }
    
    // Show the pointer since we're receiving updates (tab is active)
    this.show();
    
    const { x, y, action, relative } = data;

    // Handle position updates (if x and y are provided)
    if (x !== undefined && y !== undefined) {
      if (relative) {
        // Relative movement
        this.currentX += x;
        this.currentY += y;
        console.log('🖱️ [VisualMouse] Relative move: from', this.currentX - x, this.currentY - y, 'to', this.currentX, this.currentY);
      } else {
        // Absolute position
        this.currentX = x;
        this.currentY = y;
        console.log('🖱️ [VisualMouse] Absolute move to:', x, y);
      }

      // Clamp to viewport bounds
      this.currentX = Math.max(0, Math.min(this.currentX, window.innerWidth));
      this.currentY = Math.max(0, Math.min(this.currentY, window.innerHeight));

      console.log('🖱️ [VisualMouse] Clamped to:', this.currentX, this.currentY, '(viewport:', window.innerWidth, 'x', window.innerHeight, ')');

      // Update visual position
      this.setPosition(this.currentX, this.currentY);
    }

    // Visual feedback for actions
    if (action === 'click') {
      this.simulateClick();
    } else if (action === 'drag_start') {
      this.startDrag();
    } else if (action === 'drag_end') {
      this.endDrag();
    } else if (action === 'scroll') {
      this.simulateScroll(data.direction, data.amount);
    } else if (action === 'move' && (x === undefined || y === undefined)) {
      // For move action without coordinates, just ensure pointer is visible
      this.setPosition(this.currentX, this.currentY);
    }
  }

  /**
   * Set visual pointer position
   */
  setPosition(x: number, y: number): void {
    console.log('🖱️ [VisualMouse] setPosition called:', x, y);
    
    this.currentX = x;
    this.currentY = y;

    if (this.pointerElement) {
      console.log('🖱️ [VisualMouse] Setting pointer element position:', x, y);
      this.pointerElement.style.left = `${x}px`;
      this.pointerElement.style.top = `${y}px`;

      // Update cursor style based on position
      this.updateCursorStyle();
    } else {
      console.error('🖱️ [VisualMouse] ERROR: pointerElement is null!');
      console.error('🖱️ [VisualMouse] Attempting to recreate pointer...');
      this.createPointer();
    }

    // Update coordinate display
    this.updateCoordinateDisplay();
  }

  /**
   * Update coordinate display text
   */
  private updateCoordinateDisplay(): void {
    if (!this.coordElement) {
      return;
    }
    
    // Format coordinates as integers (screen pixels)
    const formattedX = Math.round(this.currentX);
    const formattedY = Math.round(this.currentY);
    
    // Update coordinate display text
    this.coordElement.textContent = `(${formattedX}, ${formattedY})`;
    
    // Position coordinate display to the right of the pointer
    // Add offset to avoid overlapping with the mouse pointer
    const offsetX = 24; // pixels to the right of the pointer
    const offsetY = 0;  // Align vertically with pointer
    
    // Calculate position with offset
    let coordX = this.currentX + offsetX;
    let coordY = this.currentY + offsetY;
    
    // Get viewport dimensions for boundary checking
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 800;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 600;
    
    // Estimate coordinate element width (text width + padding)
    // Approximate based on typical text length: "(xxxx, yyyy)" ~ 12 characters * 8px = 96px
    const estimatedCoordWidth = 96; // pixels
    const estimatedCoordHeight = 20; // pixels
    
    // Ensure coordinate display stays within viewport bounds
    // If too close to right edge, show on left side instead
    if (coordX + estimatedCoordWidth > viewportWidth) {
      // Move to left side of pointer with some spacing
      const leftOffset = 10; // pixels spacing on left side
      coordX = this.currentX - estimatedCoordWidth - leftOffset;
    }
    
    // Ensure coordinate display doesn't go off left edge
    if (coordX < 0) {
      coordX = 0;
    }
    
    // Check vertical bounds
    if (coordY + estimatedCoordHeight > viewportHeight) {
      coordY = this.currentY - estimatedCoordHeight; // Move above pointer
    } else if (coordY < 0) {
      coordY = 0; // Ensure not above viewport
    }
    
    // Apply position
    this.coordElement.style.left = `${coordX}px`;
    this.coordElement.style.top = `${coordY}px`;
  }

  /**
   * Update pointer color in the SVG
   */
  private updatePointerColor(color: string): void {
    if (!this.pointerElement) return;
    
    // Find the main pointer path in the SVG and update its color
    const svg = this.pointerElement.querySelector('svg');
    if (svg) {
      const paths = svg.querySelectorAll('path');
      if (paths.length >= 2) {
        // The second path is the main pointer (index 1)
        const mainPointer = paths[1];
        mainPointer.setAttribute('fill', color);
      }
    }
  }

  /**
   * Update cursor style based on position and state
   */
  private updateCursorStyle(): void {
    if (!this.pointerElement) return;

    // Get element under pointer
    const element = document.elementFromPoint(this.currentX, this.currentY);
    
    let pointerColor = this.pointerColor; // Default color
    
    // Change pointer style based on element type
    if (element) {
      const computedStyle = window.getComputedStyle(element);
      const cursor = computedStyle.cursor;
      
      if (cursor && cursor !== 'auto') {
        // Match visual pointer to element cursor
        if (cursor.includes('pointer') || element.tagName === 'A' || element.tagName === 'BUTTON') {
          pointerColor = '#00a8ff'; // Blue for clickable elements
        } else if (cursor.includes('text') || element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
          pointerColor = '#00ff00'; // Green for text inputs
        }
      }
    }

    // Visual feedback for dragging
    if (this.isDragging) {
      this.pointerElement.style.transform = 'translate(-2px, -2px) scale(1.2)';
      pointerColor = '#ff9500'; // Orange for dragging
    } else {
      this.pointerElement.style.transform = 'translate(-2px, -2px)';
    }

    // Update the pointer color
    this.updatePointerColor(pointerColor);
  }

  /**
   * Simulate click animation
   */
  private simulateClick(): void {
    if (!this.pointerElement) return;

    // Click animation - shrink and change color to purple
    this.pointerElement.style.transform = 'translate(-2px, -2px) scale(0.8)';
    this.updatePointerColor('#ff00ff'); // Purple for click
    
    setTimeout(() => {
      if (this.pointerElement) {
        this.pointerElement.style.transform = 'translate(-2px, -2px) scale(1)';
        this.updateCursorStyle(); // Restore normal color
      }
    }, 100);
  }

  /**
   * Simulate scroll animation
   */
  private simulateScroll(direction: string, amount: number): void {
    if (!this.pointerElement) return;

    // Scroll direction indicators
    let transform = '';
    const color = '#00a8ff'; // Blue for scroll
    
    switch (direction) {
      case 'up':
        transform = 'translate(-2px, calc(-2px - 10px))'; // Move up 10px
        break;
      case 'down':
        transform = 'translate(-2px, calc(-2px + 10px))'; // Move down 10px
        break;
      case 'left':
        transform = 'translate(calc(-2px - 10px), -2px)'; // Move left 10px
        break;
      case 'right':
        transform = 'translate(calc(-2px + 10px), -2px)'; // Move right 10px
        break;
    }

    this.pointerElement.style.transform = transform;
    this.updatePointerColor(color);
    
    setTimeout(() => {
      if (this.pointerElement) {
        this.pointerElement.style.transform = 'translate(-2px, -2px)';
        this.updateCursorStyle(); // Restore normal color
      }
    }, 200);
  }

  /**
   * Start drag animation
   */
  private startDrag(): void {
    this.isDragging = true;
    this.updateCursorStyle(); // This will apply the dragging style
  }

  /**
   * End drag animation
   */
  private endDrag(): void {
    this.isDragging = false;
    this.updateCursorStyle(); // This will restore normal style
  }

  /**
   * Show the pointer (make it visible)
   */
  show(): void {
    this.isVisible = true;
    if (this.pointerElement) {
      this.pointerElement.style.opacity = '0.8';
      console.log('🖱️ [VisualMouse] Pointer shown');
    }
    // Also show coordinate display
    if (this.coordElement) {
      this.coordElement.style.opacity = '0.8';
    }
  }

  /**
   * Hide the pointer (make it invisible)
   */
  hide(): void {
    this.isVisible = false;
    if (this.pointerElement) {
      this.pointerElement.style.opacity = '0';
      console.log('🖱️ [VisualMouse] Pointer hidden');
    }
    // Also hide coordinate display
    if (this.coordElement) {
      this.coordElement.style.opacity = '0';
    }
  }

  /**
   * Toggle pointer visibility
   */
  toggleVisibility(): void {
    const wasVisible = this.isVisible;
    if (wasVisible) {
      this.hide();
    } else {
      this.show();
    }
    console.log(`🖱️ [VisualMouse] Pointer ${wasVisible ? 'hidden' : 'shown'} (toggled)`);
  }

  /**
   * Get current pointer position
   */
  getPosition(): { x: number; y: number } {
    return { x: this.currentX, y: this.currentY };
  }

  /**
   * Get current viewport information
   * This should return the actual browser window size, not affected by page rendering
   */
  getViewportInfo(): {
    width: number;
    height: number;
    devicePixelRatio: number;
    pointerX: number;
    pointerY: number;
    debugInfo?: string;
  } {
    const isInIframe = window.self !== window.top;
    const readyState = document.readyState;
    
    // Try to get dimensions from current window/frame
    let width = window.innerWidth;
    let height = window.innerHeight;
    let source = 'current-window';
    
    console.log(`🖥️ [VisualMouse] getViewportInfo called: current window=${width}x${height}, isInIframe=${isInIframe}, readyState=${readyState}`);
    
    // Check if current frame has valid dimensions
    const currentFrameValid = width > 0 && height > 0 && isFinite(width) && isFinite(height);
    
    if (!currentFrameValid && isInIframe) {
      // We're in an iframe with invalid dimensions, try to get dimensions from parent
      console.log(`🖥️ [VisualMouse] Current iframe has invalid dimensions, trying parent window`);
      
      try {
        // Check if we can access parent window (same-origin policy)
        if (window.parent && window.parent !== window) {
          const parentWidth = window.parent.innerWidth;
          const parentHeight = window.parent.innerHeight;
          
          if (parentWidth > 0 && parentHeight > 0 && isFinite(parentWidth) && isFinite(parentHeight)) {
            width = parentWidth;
            height = parentHeight;
            source = 'parent-window';
            console.log(`🖥️ [VisualMouse] Using parent window dimensions: ${width}x${height}`);
          } else {
            console.warn(`🖥️ [VisualMouse] Parent window also has invalid dimensions: ${parentWidth}x${parentHeight}`);
          }
        }
      } catch (error) {
        // Cross-origin error, cannot access parent window
        console.warn(`🖥️ [VisualMouse] Cannot access parent window due to cross-origin restrictions:`, error);
      }
    }
    
    // If still invalid, try document dimensions as last resort
    if (width <= 0 || height <= 0 || !isFinite(width) || !isFinite(height)) {
      console.warn(`🖥️ [VisualMouse] Invalid dimensions after all attempts: ${width}x${height}, trying document`);
      
      const docWidth = document.documentElement.clientWidth;
      const docHeight = document.documentElement.clientHeight;
      
      if (docWidth > 0 && docHeight > 0) {
        width = docWidth;
        height = docHeight;
        source = 'document';
        console.log(`🖥️ [VisualMouse] Using document dimensions: ${width}x${height}`);
      } else {
        // All methods failed
        console.error(`🖥️ [VisualMouse] ALL METHODS FAILED: current window=${window.innerWidth}x${window.innerHeight}, document=${docWidth}x${docHeight}, isInIframe=${isInIframe}`);
        
        // Return special values that signal "no valid viewport available"
        // The background script should handle this case
        width = -1;  // Special value to indicate failure
        height = -1;
        source = 'failed';
      }
    }
    
    // Ensure minimum values (unless they're the special failure values)
    const finalWidth = width < 0 ? width : Math.max(1, width);
    const finalHeight = height < 0 ? height : Math.max(1, height);
    
    console.log(`🖥️ [VisualMouse] Returning viewport: ${finalWidth}x${finalHeight}, source=${source}, devicePixelRatio=${window.devicePixelRatio || 1}`);
    
    return {
      width: finalWidth,
      height: finalHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
      pointerX: this.currentX,
      pointerY: this.currentY,
      debugInfo: `source=${source}, isInIframe=${isInIframe}, readyState=${readyState}`,
    };
  }

  /**
   * Clean up (remove pointer from DOM)
   */
  destroy(): void {
    if (this.pointerElement) {
      this.pointerElement.remove();
      this.pointerElement = null;
    }
    if (this.coordElement) {
      this.coordElement.remove();
      this.coordElement = null;
    }
  }

  /**
   * Hide pointer without removing from DOM (for tab switching)
   */
  hidePointer(): void {
    this.hide();
  }
}