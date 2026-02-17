/**
 * Visual Mouse Pointer
 * Creates and manages a visual mouse pointer overlay on web pages
 * Provides visual feedback for CDP mouse operations
 */

export class VisualMousePointer {
  private pointerElement: HTMLElement | null = null;
  private currentX: number = 0;
  private currentY: number = 0;
  private isVisible: boolean = true;
  private pointerSize: number = 20; // Not used for SVG pointer, kept for compatibility
  private pointerColor: string = '#333333'; // Dark gray for more traditional mouse pointer
  private pointerBorderColor: string = '#ffffff';
  private isDragging: boolean = false;

  constructor() {
    this.createPointer();
    this.initializeEventListeners();
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

    // Create new pointer element
    this.pointerElement = document.createElement('div');
    this.pointerElement.id = 'chrome-control-visual-mouse';
    
    // Apply styles - now a realistic mouse pointer
    Object.assign(this.pointerElement.style, {
      position: 'fixed',
      width: '32px',
      height: '32px',
      pointerEvents: 'none',
      zIndex: '2147483647', // Maximum z-index
      opacity: '0.9',
      transform: 'translate(-2px, -2px)', // Offset to match pointer tip
      transition: 'transform 0.1s ease-out, opacity 0.2s ease, filter 0.2s ease',
      filter: 'drop-shadow(2px 2px 2px rgba(0, 0, 0, 0.5))',
    } as CSSStyleDeclaration);

    // Create the mouse pointer using CSS (arrow shape)
    const pointerSvg = `
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <!-- Pointer outline for visibility -->
        <path d="M2 2 L28 2 L10 28 L8 24 L2 2 Z" fill="black" fill-opacity="0.3"/>
        <!-- Main pointer -->
        <path d="M1 1 L27 1 L9 27 L7 23 L1 1 Z" fill="${this.pointerColor}"/>
        <!-- Pointer tip highlight -->
        <path d="M1 1 L5 1 L1 5 Z" fill="white" fill-opacity="0.8"/>
      </svg>
    `;
    
    this.pointerElement.innerHTML = pointerSvg;

    // Add to document
    document.documentElement.appendChild(this.pointerElement);
    
    // Initial position
    this.setPosition(window.innerWidth / 2, window.innerHeight / 2);
    
    console.log('🖱️ Realistic mouse pointer created');
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
    const { x, y, action, relative } = data;

    // Handle position updates (if x and y are provided)
    if (x !== undefined && y !== undefined) {
      if (relative) {
        // Relative movement
        this.currentX += x;
        this.currentY += y;
      } else {
        // Absolute position
        this.currentX = x;
        this.currentY = y;
      }

      // Clamp to viewport bounds
      this.currentX = Math.max(0, Math.min(this.currentX, window.innerWidth));
      this.currentY = Math.max(0, Math.min(this.currentY, window.innerHeight));

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
    this.currentX = x;
    this.currentY = y;

    if (this.pointerElement) {
      this.pointerElement.style.left = `${x}px`;
      this.pointerElement.style.top = `${y}px`;

      // Update cursor style based on position
      this.updateCursorStyle();
    }
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
   * Toggle pointer visibility
   */
  toggleVisibility(): void {
    this.isVisible = !this.isVisible;
    if (this.pointerElement) {
      this.pointerElement.style.opacity = this.isVisible ? '0.8' : '0';
      console.log(`Visual mouse ${this.isVisible ? 'shown' : 'hidden'}`);
    }
  }

  /**
   * Get current pointer position
   */
  getPosition(): { x: number; y: number } {
    return { x: this.currentX, y: this.currentY };
  }

  /**
   * Get viewport information
   */
  getViewportInfo(): {
    width: number;
    height: number;
    devicePixelRatio: number;
    pointerX: number;
    pointerY: number;
  } {
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      pointerX: this.currentX,
      pointerY: this.currentY,
    };
  }

  /**
   * Clean up
   */
  destroy(): void {
    if (this.pointerElement) {
      this.pointerElement.remove();
      this.pointerElement = null;
    }
  }
}