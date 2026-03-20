/**
 * Worker Manager for background image processing
 * Manages Web Worker lifecycle and provides fallback mechanisms
 */

import type {
  ResizeImageRequest,
  WorkerStatusResponse,
  WorkerResponse,
} from './image-processor.worker';

export interface WorkerManagerOptions {
  maxWorkerInstances?: number;
  workerTimeout?: number;
  enableFallback?: boolean;
}

export class WorkerManager {
  private worker: Worker | null = null;
  private workerUrl: string;
  private isInitialized = false;
  private isServiceWorkerEnvironment = false; // True when running in Chrome extension Service Worker
  private pendingRequests = new Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timeoutId: ReturnType<typeof setTimeout>;
    }
  >();
  private requestCounter = 0;

  private readonly options: Required<WorkerManagerOptions>;
  private readonly defaultOptions: Required<WorkerManagerOptions> = {
    maxWorkerInstances: 1,
    workerTimeout: 30000, // 30 seconds
    enableFallback: true,
  };

  constructor(options: WorkerManagerOptions = {}) {
    this.options = { ...this.defaultOptions, ...options };

    // Create worker URL from inline worker code
    // Note: In Chrome extension context, we need to load worker as a separate file
    this.workerUrl = this.getWorkerUrl();
  }

  /**
   * Get worker URL - uses blob URL for inline worker in extension context
   */
  private getWorkerUrl(): string {
    // In Chrome extension, workers need to be separate files
    // We'll use a relative path that will be resolved by the build system
    // With the current build config, the worker will be at:
    // - Development: ./workers/image-processor.worker.js (relative to background.js)
    // - Production: chrome.runtime.getURL('workers/image-processor.worker.js')
    try {
      if (
        typeof chrome !== 'undefined' &&
        chrome.runtime &&
        chrome.runtime.getURL
      ) {
        return chrome.runtime.getURL('workers/image-processor.worker.js');
      }
    } catch (error) {
      console.warn(
        '⚠️ [WorkerManager] Failed to get chrome.runtime URL, using relative path:',
        error,
      );
    }
    // Relative path from background.js to worker file
    return 'workers/image-processor.worker.js';
  }

  /**
   * Initialize the worker
   * In Service Worker environment (Chrome extension), Web Workers are not available.
   * We'll detect this and fall back to main thread processing with chunked operations.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    // Check if Worker API is available in this environment
    // In Chrome extension Service Worker, Worker is not defined
    const isWorkerAvailable = typeof Worker !== 'undefined';

    if (!isWorkerAvailable) {
      console.warn(
        '⚠️ [WorkerManager] Web Workers not available in Service Worker environment. Using main thread with chunked processing.',
      );
      this.isInitialized = true;
      this.isServiceWorkerEnvironment = true;
      return;
    }

    try {
      console.log('🚀 [WorkerManager] Initializing image processor worker...');

      // Create worker from URL
      this.worker = new Worker(this.workerUrl, { type: 'module' });

      // Set up message handler
      this.worker.onmessage = this.handleWorkerMessage.bind(this);
      this.worker.onerror = this.handleWorkerError.bind(this);

      // Wait for worker to initialize
      await new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('Worker initialization timeout'));
        }, 5000);

        const messageHandler = (event: MessageEvent) => {
          if (event.data && event.data.type === 'status') {
            clearTimeout(timeoutId);
            this.worker?.removeEventListener('message', messageHandler);
            resolve();
          }
        };

        this.worker?.addEventListener('message', messageHandler);

        // Send status request to check if worker is alive
        setTimeout(() => {
          if (this.worker) {
            this.worker.postMessage({ type: 'status' });
          }
        }, 100);
      });

      this.isInitialized = true;
      console.log('✅ [WorkerManager] Worker initialized successfully');
    } catch (error) {
      console.error('❌ [WorkerManager] Failed to initialize worker:', error);
      this.cleanup();

      // Even if worker fails, we can still use fallback
      this.isInitialized = true;
      this.isServiceWorkerEnvironment = true;
      console.warn(
        '⚠️ [WorkerManager] Worker failed, falling back to main thread processing',
      );
    }
  }

  /**
   * Handle messages from worker
   */
  private handleWorkerMessage(event: MessageEvent<WorkerResponse>): void {
    const response = event.data;

    // Handle status responses (not tied to specific requests)
    if ('type' in response && response.type === 'status') {
      console.log('📊 [WorkerManager] Worker status:', response);
      return;
    }

    // Handle resize image responses
    if ('id' in response) {
      const requestId = response.id;
      const pendingRequest = this.pendingRequests.get(requestId);

      if (pendingRequest) {
        clearTimeout(pendingRequest.timeoutId);
        this.pendingRequests.delete(requestId);

        if (response.error) {
          pendingRequest.reject(new Error(response.error));
        } else {
          pendingRequest.resolve(response);
        }
      }
    }
  }

  /**
   * Handle worker errors
   */
  private handleWorkerError(error: ErrorEvent): void {
    console.error('❌ [WorkerManager] Worker error:', error);

    // Reject all pending requests
    for (const [_requestId, pendingRequest] of this.pendingRequests.entries()) {
      clearTimeout(pendingRequest.timeoutId);
      pendingRequest.reject(new Error(`Worker error: ${error.message}`));
    }
    this.pendingRequests.clear();

    // Clean up failed worker
    this.cleanup();
  }

  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${++this.requestCounter}`;
  }

  /**
   * Resize image using worker or fallback
   */
  async resizeImage(
    dataUrl: string,
    targetWidth: number = 1280,
    targetHeight: number = 720,
  ): Promise<{ dataUrl: string; cropOffsetX: number; cropOffsetY: number }> {
    // In Service Worker environment, use fallback immediately
    if (this.isServiceWorkerEnvironment) {
      console.log(
        '🖼️ [WorkerManager] Service Worker environment detected, using fallback processing',
      );
      return this.fallbackResizeImage(dataUrl, targetWidth, targetHeight);
    }

    // Ensure worker is initialized
    if (!this.isInitialized || !this.worker) {
      try {
        await this.initialize();

        // After initialization, check if we're in Service Worker environment
        if (this.isServiceWorkerEnvironment) {
          console.log(
            '🖼️ [WorkerManager] Service Worker environment detected after initialization, using fallback',
          );
          return this.fallbackResizeImage(dataUrl, targetWidth, targetHeight);
        }
      } catch (error) {
        if (this.options.enableFallback) {
          console.warn(
            '⚠️ [WorkerManager] Worker initialization failed, using fallback',
          );
          return this.fallbackResizeImage(dataUrl, targetWidth, targetHeight);
        }
        throw error;
      }
    }

    // If we have a worker, use it
    if (this.worker && !this.isServiceWorkerEnvironment) {
      return this.sendRequestToWorker(dataUrl, targetWidth, targetHeight);
    }

    // Otherwise use fallback
    console.log('🖼️ [WorkerManager] No worker available, using fallback');
    return this.fallbackResizeImage(dataUrl, targetWidth, targetHeight);
  }

  /**
   * Send resize request to worker
   */
  private sendRequestToWorker(
    dataUrl: string,
    targetWidth: number,
    targetHeight: number,
  ): Promise<{ dataUrl: string; cropOffsetX: number; cropOffsetY: number }> {
    const requestId = this.generateRequestId();
    const request: ResizeImageRequest = {
      type: 'resizeImage',
      id: requestId,
      dataUrl,
      targetWidth,
      targetHeight,
    };

    return new Promise((resolve, reject) => {
      // Set timeout for worker response
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        const error = new Error(
          `Worker timeout after ${this.options.workerTimeout}ms`,
        );

        if (this.options.enableFallback) {
          console.warn('⚠️ [WorkerManager] Worker timeout, using fallback');
          this.fallbackResizeImage(dataUrl, targetWidth, targetHeight)
            .then(resolve)
            .catch(reject);
        } else {
          reject(error);
        }
      }, this.options.workerTimeout);

      // Store pending request
      this.pendingRequests.set(requestId, {
        resolve: (response: any) => {
          resolve({
            dataUrl: response.dataUrl,
            cropOffsetX: response.cropOffsetX,
            cropOffsetY: response.cropOffsetY,
          });
        },
        reject,
        timeoutId,
      });

      // Send request to worker
      try {
        this.worker!.postMessage(request);
      } catch (error) {
        clearTimeout(timeoutId);
        this.pendingRequests.delete(requestId);

        if (this.options.enableFallback) {
          console.warn(
            '⚠️ [WorkerManager] Worker postMessage failed, using fallback',
          );
          this.fallbackResizeImage(dataUrl, targetWidth, targetHeight)
            .then(resolve)
            .catch(reject);
        } else {
          reject(error);
        }
      }
    });
  }

  /**
   * Fallback resize function (runs in main thread)
   * Used when worker fails or is unavailable
   */
  private async fallbackResizeImage(
    dataUrl: string,
    targetWidth: number = 1280,
    targetHeight: number = 720,
  ): Promise<{ dataUrl: string; cropOffsetX: number; cropOffsetY: number }> {
    console.warn('⚠️ [WorkerManager] Using fallback resize in main thread');

    // Use the simple resize implementation
    return this.simpleResizeImage(dataUrl, targetWidth, targetHeight);
  }

  /**
   * Simple resize implementation for fallback with async yields to prevent blocking
   * Includes multi-stage downscaling for very large images to prevent main thread freezing
   */
  private async simpleResizeImage(
    dataUrl: string,
    targetWidth: number,
    targetHeight: number,
  ): Promise<{ dataUrl: string; cropOffsetX: number; cropOffsetY: number }> {
    console.log(
      '🖼️ [WorkerManager] Using main thread resize fallback with async yields',
    );

    // Emergency timeout: if processing takes too long, return original image
    const processingStartTime = Date.now();
    const PROCESSING_TIMEOUT = 10000; // 10 seconds max

    const checkTimeout = (): void => {
      const elapsed = Date.now() - processingStartTime;
      if (elapsed > PROCESSING_TIMEOUT) {
        throw new Error(`Image processing timeout after ${elapsed}ms`);
      }
    };

    // Check if required APIs are available
    if (typeof OffscreenCanvas === 'undefined') {
      console.warn(
        '⚠️ [WorkerManager] OffscreenCanvas not available, returning original image',
      );
      return {
        dataUrl,
        cropOffsetX: 0,
        cropOffsetY: 0,
      };
    }

    if (typeof createImageBitmap === 'undefined') {
      console.warn(
        '⚠️ [WorkerManager] createImageBitmap not available, returning original image',
      );
      return {
        dataUrl,
        cropOffsetX: 0,
        cropOffsetY: 0,
      };
    }

    try {
      // Step 1: Convert data URL to Blob (potential blocking)
      console.log(`🖼️ [WorkerManager] Step 1: Converting data URL to blob...`);
      checkTimeout();
      const response = await fetch(dataUrl);
      const blob = await response.blob();

      // Yield to prevent blocking
      await this.yieldToEventLoop();
      checkTimeout();

      // Step 2: Create ImageBitmap from Blob (potential blocking)
      console.log(`🖼️ [WorkerManager] Step 2: Creating ImageBitmap...`);
      checkTimeout();
      const imageBitmap = await createImageBitmap(blob);

      // Validate image dimensions
      if (imageBitmap.width <= 0 || imageBitmap.height <= 0) {
        console.warn(
          `⚠️ [WorkerManager] Invalid image dimensions: ${imageBitmap.width}x${imageBitmap.height}, returning original`,
        );
        imageBitmap.close();
        return {
          dataUrl,
          cropOffsetX: 0,
          cropOffsetY: 0,
        };
      }

      // Save dimensions before closing ImageBitmap
      const originalWidth = imageBitmap.width;
      const originalHeight = imageBitmap.height;

      console.log(
        `🖼️ [WorkerManager] Original image: ${originalWidth}x${originalHeight}, target: ${targetWidth}x${targetHeight}`,
      );

      // For very large images, use multi-stage downscaling to prevent freezing
      const MAX_SINGLE_STEP_SCALE = 0.5; // Don't scale more than 50% in one step
      const MAX_INITIAL_SIZE = 2000; // First downscale to this max dimension

      // Yield to prevent blocking
      await this.yieldToEventLoop();
      checkTimeout();

      // Step 3: Create canvas and context
      console.log(`🖼️ [WorkerManager] Step 3: Creating canvas...`);
      checkTimeout();
      const canvas = new OffscreenCanvas(targetWidth, targetHeight);
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        throw new Error('Failed to get 2d context');
      }

      // Step 4: Calculate scaling with multi-stage downscaling for large images
      console.log(`🖼️ [WorkerManager] Step 4: Calculating scaling...`);
      checkTimeout();

      // For very large images, we need to scale in multiple steps to prevent blocking
      let currentImageBitmap = imageBitmap;
      let currentWidth = originalWidth;
      let currentHeight = originalHeight;
      let intermediateCanvas: OffscreenCanvas | null = null;

      // Calculate final scale
      const finalScaleX = targetWidth / currentWidth;
      const finalScaleY = targetHeight / currentHeight;
      const finalScale = Math.max(finalScaleX, finalScaleY); // Cover mode

      // If image is very large and needs significant downscaling, do it in steps
      if (
        currentWidth > MAX_INITIAL_SIZE ||
        currentHeight > MAX_INITIAL_SIZE ||
        finalScale < MAX_SINGLE_STEP_SCALE
      ) {
        console.log(
          `🖼️ [WorkerManager] Large image detected (${currentWidth}x${currentHeight}), using multi-stage downscaling`,
        );

        // First, scale down to a reasonable intermediate size
        const intermediateWidth = Math.min(currentWidth, MAX_INITIAL_SIZE);
        const intermediateHeight = Math.min(currentHeight, MAX_INITIAL_SIZE);
        const intermediateScaleX = intermediateWidth / currentWidth;
        const intermediateScaleY = intermediateHeight / currentHeight;
        const intermediateScale = Math.min(
          intermediateScaleX,
          intermediateScaleY,
        ); // Fit mode

        const scaledIntermediateWidth = Math.floor(
          currentWidth * intermediateScale,
        );
        const scaledIntermediateHeight = Math.floor(
          currentHeight * intermediateScale,
        );

        console.log(
          `🖼️ [WorkerManager] First stage: ${currentWidth}x${currentHeight} → ${scaledIntermediateWidth}x${scaledIntermediateHeight} (scale: ${intermediateScale.toFixed(3)})`,
        );

        // Create intermediate canvas
        intermediateCanvas = new OffscreenCanvas(
          scaledIntermediateWidth,
          scaledIntermediateHeight,
        );
        const intermediateCtx = intermediateCanvas.getContext('2d');
        if (!intermediateCtx) {
          throw new Error('Failed to get intermediate 2d context');
        }

        // Draw to intermediate canvas (this is the most expensive operation)
        intermediateCtx.drawImage(
          currentImageBitmap,
          0,
          0,
          scaledIntermediateWidth,
          scaledIntermediateHeight,
        );

        // Close original ImageBitmap
        currentImageBitmap.close();

        // Create new ImageBitmap from intermediate canvas for second stage
        checkTimeout();
        await this.yieldToEventLoop();
        currentImageBitmap = await createImageBitmap(intermediateCanvas);
        currentWidth = scaledIntermediateWidth;
        currentHeight = scaledIntermediateHeight;

        console.log(
          `🖼️ [WorkerManager] First stage complete, intermediate: ${currentWidth}x${currentHeight}`,
        );
      }

      // Calculate final crop offset
      const finalScaledWidth = Math.floor(currentWidth * finalScale);
      const finalScaledHeight = Math.floor(currentHeight * finalScale);
      const cropOffsetX = Math.floor((targetWidth - finalScaledWidth) / 2);
      const cropOffsetY = Math.floor((targetHeight - finalScaledHeight) / 2);

      console.log(
        `🖼️ [WorkerManager] Final scaling: ${finalScale.toFixed(3)}, scaled: ${finalScaledWidth}x${finalScaledHeight}, crop: (${cropOffsetX}, ${cropOffsetY})`,
      );

      // Yield to prevent blocking
      await this.yieldToEventLoop();
      checkTimeout();

      // Step 5: Draw final image (potential blocking)
      console.log(`🖼️ [WorkerManager] Step 5: Drawing final image...`);

      // Fill background with white (avoids transparency issues)
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, targetWidth, targetHeight);

      // Draw the image
      ctx.drawImage(
        currentImageBitmap,
        cropOffsetX,
        cropOffsetY,
        finalScaledWidth,
        finalScaledHeight,
      );

      // IMPORTANT: Close ImageBitmap to free memory
      currentImageBitmap.close();
      if (intermediateCanvas) {
        // Clean up intermediate canvas
        intermediateCanvas = null;
      }

      // Yield to prevent blocking
      await this.yieldToEventLoop();
      checkTimeout();

      // Step 6: Convert to blob (potential blocking)
      console.log(`🖼️ [WorkerManager] Step 6: Converting to blob...`);

      // Use PNG for compatibility with frontend rendering
      // JPEG would be faster but may cause frontend compatibility issues
      const resizedBlob = await canvas.convertToBlob({
        type: 'image/png', // PNG for frontend compatibility
        // PNG format doesn't support quality parameter
      });

      // Yield to prevent blocking
      await this.yieldToEventLoop();
      checkTimeout();

      // Step 7: Convert blob to data URL
      console.log(`🖼️ [WorkerManager] Step 7: Converting to data URL...`);
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const resizedDataUrl = reader.result as string;
          console.log(
            `✅ [WorkerManager] Fallback resize completed: ${originalWidth}x${originalHeight} → ${targetWidth}x${targetHeight}`,
          );
          resolve({
            dataUrl: resizedDataUrl,
            cropOffsetX,
            cropOffsetY,
          });
        };
        reader.onerror = () => {
          console.error('❌ [WorkerManager] Failed to read resized blob');
          reject(new Error('Failed to read resized blob'));
        };
        reader.readAsDataURL(resizedBlob);
      });
    } catch (error) {
      console.error('❌ [WorkerManager] Fallback resize failed:', error);

      // Even if resize fails, return original image to avoid breaking the flow
      console.warn(
        '⚠️ [WorkerManager] Returning original image due to resize failure',
      );
      return {
        dataUrl,
        cropOffsetX: 0,
        cropOffsetY: 0,
      };
    }
  }

  /**
   * Yield to event loop to prevent blocking
   * Allows heartbeat and other async tasks to run
   */
  private async yieldToEventLoop(): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }

  /**
   * Check worker status
   */
  async getStatus(): Promise<WorkerStatusResponse> {
    if (!this.isInitialized) {
      return {
        type: 'status',
        memory: {},
        isAlive: false,
      };
    }

    // In Service Worker environment, we don't have a worker
    if (this.isServiceWorkerEnvironment) {
      return {
        type: 'status',
        memory: {},
        isAlive: true,
      };
    }

    if (!this.worker) {
      return {
        type: 'status',
        memory: {},
        isAlive: false,
      };
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Worker status request timeout'));
      }, 5000);

      const messageHandler = (event: MessageEvent) => {
        if (event.data && event.data.type === 'status') {
          clearTimeout(timeoutId);
          this.worker?.removeEventListener('message', messageHandler);
          resolve(event.data);
        }
      };

      this.worker?.addEventListener('message', messageHandler);
      this.worker?.postMessage({ type: 'status' });
    });
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    // Clear all pending requests
    for (const [_requestId, pendingRequest] of this.pendingRequests.entries()) {
      clearTimeout(pendingRequest.timeoutId);
      pendingRequest.reject(new Error('Worker manager cleaned up'));
    }
    this.pendingRequests.clear();

    // Terminate worker
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    this.isInitialized = false;
    console.log('🧹 [WorkerManager] Cleaned up');
  }

  /**
   * Check if worker is available
   * In Service Worker environment, we consider it "available" because we have fallback
   */
  isAvailable(): boolean {
    if (this.isServiceWorkerEnvironment) {
      return true; // Fallback is available
    }
    return this.isInitialized && this.worker !== null;
  }
}

// Singleton instance
export const workerManager = new WorkerManager({
  maxWorkerInstances: 1,
  workerTimeout: 15000, // 15 seconds
  enableFallback: true,
});
