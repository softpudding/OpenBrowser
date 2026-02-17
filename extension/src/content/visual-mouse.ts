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
  private pointerSize: number = 48; // Size matching AIPex
  private pointerColor: string = '#3B82F6'; // Blue color matching AIPex
  private glowColor: string = '#3B82F6'; // Glow color matching AIPex
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
    
    // Apply styles - AIPex style blue fluorescent cursor
    Object.assign(this.pointerElement.style, {
      position: 'fixed',
      width: `${this.pointerSize}px`,
      height: `${this.pointerSize}px`,
      pointerEvents: 'none',
      zIndex: '2147483647', // Maximum z-index
      opacity: '0.9',
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

    // Add to document
    document.documentElement.appendChild(this.pointerElement);
    
    // Initial position - use safe dimensions to avoid division by zero
    const safeWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 800);
    const safeHeight = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 600);
    this.setPosition(safeWidth / 2, safeHeight / 2);
    
    console.log(`🖱️ Realistic mouse pointer created at safe position: ${safeWidth / 2}, ${safeHeight / 2} (window: ${window.innerWidth}x${window.innerHeight}, document: ${document.documentElement.clientWidth}x${document.documentElement.clientHeight})`);
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
   * Get viewport information with retry logic for loading pages
   */
  getViewportInfo(): {
    width: number;
    height: number;
    devicePixelRatio: number;
    pointerX: number;
    pointerY: number;
    debugInfo?: string;
  } {
    // 尝试最多3次获取有效视口尺寸，每次等待100ms
    const maxAttempts = 3;
    const retryDelay = 100; // ms
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // 优先使用window.innerWidth/Height，这是浏览器窗口的内部尺寸
      // 如果window尺寸为0（页面加载中），则使用document尺寸
      let width = window.innerWidth;
      let height = window.innerHeight;
      let source = 'window';
      let debugInfo = '';
      
      // 检查是否在iframe中
      const isInIframe = window.self !== window.top;
      if (isInIframe) {
        debugInfo += `In iframe, `;
      }
      
      // 检查页面加载状态
      const readyState = document.readyState;
      const isPageLoaded = readyState === 'complete' || readyState === 'interactive';
      debugInfo += `readyState=${readyState}, `;
      
      console.log(`🖥️ [VisualMouse] Attempt ${attempt}/${maxAttempts}: window=${width}x${height}, document=${document.documentElement.clientWidth}x${document.documentElement.clientHeight}, readyState=${readyState}`);
      
      // 如果window尺寸无效（<=0），尝试使用document尺寸
      if (width <= 0 || height <= 0) {
        const docWidth = document.documentElement.clientWidth;
        const docHeight = document.documentElement.clientHeight;
        
        // 只有当document尺寸比window尺寸更好时才使用
        if (docWidth > 0 || docHeight > 0) {
          width = docWidth > 0 ? docWidth : width;
          height = docHeight > 0 ? docHeight : height;
          source = 'document';
          debugInfo += `window was invalid, using document, `;
          console.log(`🖥️ [VisualMouse] Using document dimensions: ${width}x${height}`);
        }
      }
      
      // 如果尺寸有效，立即返回
      if (width > 0 && height > 0) {
        const finalWidth = Math.max(1, width);
        const finalHeight = Math.max(1, height);
        
        console.log(`🖥️ [VisualMouse] Valid dimensions found on attempt ${attempt}: ${finalWidth}x${finalHeight}, source=${source}`);
        
        return {
          width: finalWidth,
          height: finalHeight,
          devicePixelRatio: window.devicePixelRatio || 1,
          pointerX: this.currentX,
          pointerY: this.currentY,
          debugInfo: debugInfo.trim(),
        };
      }
      
      // 如果这是最后一次尝试，使用屏幕估计或默认值
      if (attempt === maxAttempts) {
        console.warn(`🖥️ [VisualMouse] All ${maxAttempts} attempts failed to get valid dimensions`);
        debugInfo += `all attempts failed, `;
        
        // 尝试获取屏幕可用尺寸
        const screenWidth = window.screen?.availWidth || window.screen?.width || 0;
        const screenHeight = window.screen?.availHeight || window.screen?.height || 0;
        
        // 如果屏幕尺寸可用，使用合理的估计
        if (screenWidth > 0 && screenHeight > 0) {
          // 使用屏幕可用尺寸的90%作为保守估计
          width = Math.floor(screenWidth * 0.9);
          height = Math.floor(screenHeight * 0.9);
          source = 'screen-estimate';
          console.log(`🖥️ [VisualMouse] Using screen estimate: ${width}x${height} (screen: ${screenWidth}x${screenHeight})`);
          debugInfo += `using screen estimate ${width}x${height}, `;
        } else {
          // 返回合理的默认值
          width = 1920;
          height = 1080;
          source = 'default';
          console.warn(`🖥️ [VisualMouse] No valid dimensions found, using default: ${width}x${height}`);
          debugInfo += `using default ${width}x${height}, `;
        }
        
        const finalWidth = Math.max(1, width);
        const finalHeight = Math.max(1, height);
        
        console.log(`🖥️ [VisualMouse] getViewportInfo final: returning=${finalWidth}x${finalHeight}, source=${source}, isInIframe=${isInIframe}`);
        
        return {
          width: finalWidth,
          height: finalHeight,
          devicePixelRatio: window.devicePixelRatio || 1,
          pointerX: this.currentX,
          pointerY: this.currentY,
          debugInfo: debugInfo.trim(),
        };
      }
      
      // 等待一段时间后重试
      console.log(`🖥️ [VisualMouse] Waiting ${retryDelay}ms before retry (attempt ${attempt}/${maxAttempts})`);
      // 注意：这里不能使用异步等待，因为此方法是同步的
      // 我们可以使用同步等待（不推荐）或者期望调用方处理重试
      // 由于Chrome扩展消息传递是异步的，我们可以依赖后台脚本的重试机制
      break; // 先退出循环，让后台脚本处理重试
    }
    
    // 如果循环提前退出（比如因为不能异步等待），返回当前最佳估计
    const width = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 800);
    const height = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 600);
    
    console.log(`🖥️ [VisualMouse] Returning fallback dimensions: ${width}x${height}`);
    
    return {
      width: width,
      height: height,
      devicePixelRatio: window.devicePixelRatio || 1,
      pointerX: this.currentX,
      pointerY: this.currentY,
      debugInfo: 'fallback after attempt',
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