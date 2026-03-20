/**
 * Image Processing Web Worker
 * Handles CPU-intensive image processing operations in a separate thread
 * to prevent main thread blocking and heartbeat issues.
 */

export interface ResizeImageRequest {
  type: 'resizeImage';
  id: string;
  dataUrl: string;
  targetWidth: number;
  targetHeight: number;
}

export interface ResizeImageResponse {
  id: string;
  dataUrl: string;
  cropOffsetX: number;
  cropOffsetY: number;
  error?: string;
}

export interface WorkerStatusRequest {
  type: 'status';
}

export interface WorkerStatusResponse {
  type: 'status';
  memory: {
    usedJSHeapSize?: number;
    totalJSHeapSize?: number;
  };
  isAlive: boolean;
}

export type WorkerRequest = ResizeImageRequest | WorkerStatusRequest;
export type WorkerResponse = ResizeImageResponse | WorkerStatusResponse;

/**
 * Resize image using OffscreenCanvas and createImageBitmap
 * Uses "cover" mode: scales image to cover target dimensions while maintaining aspect ratio,
 * then crops the overflow.
 */
async function resizeImage(
  dataUrl: string,
  targetWidth: number = 1280,
  targetHeight: number = 720,
): Promise<{ dataUrl: string; cropOffsetX: number; cropOffsetY: number }> {
  console.log(
    `🖼️ [Worker] Resizing image to ${targetWidth}x${targetHeight} (cover mode)...`,
  );

  // Check if OffscreenCanvas is available
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error(
      '[Worker] OffscreenCanvas is not available in this environment. ' +
        'Image resizing requires OffscreenCanvas support.',
    );
  }

  // Check if createImageBitmap is available
  if (typeof createImageBitmap === 'undefined') {
    throw new Error(
      '[Worker] createImageBitmap is not available in this environment. ' +
        'Image resizing requires createImageBitmap support.',
    );
  }

  try {
    // Convert data URL to Blob
    const response = await fetch(dataUrl);
    const blob = await response.blob();

    // Create ImageBitmap from Blob
    const imageBitmap = await createImageBitmap(blob);

    console.log(
      `🖼️ [Worker] Original image dimensions: ${imageBitmap.width}x${imageBitmap.height}`,
    );

    if (imageBitmap.width <= 0 || imageBitmap.height <= 0) {
      throw new Error(
        `[Worker] Invalid original image dimensions: ${imageBitmap.width}x${imageBitmap.height}`,
      );
    }

    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      throw new Error('[Worker] Failed to get 2d context from OffscreenCanvas');
    }

    // Fill background with white (to avoid transparency issues)
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, targetWidth, targetHeight);

    // Calculate scaling to COVER target dimensions while maintaining aspect ratio
    const scaleX = targetWidth / imageBitmap.width;
    const scaleY = targetHeight / imageBitmap.height;
    const scale = Math.max(scaleX, scaleY); // Cover mode

    const scaledWidth = Math.floor(imageBitmap.width * scale);
    const scaledHeight = Math.floor(imageBitmap.height * scale);

    if (scaledWidth <= 0 || scaledHeight <= 0) {
      throw new Error(
        `[Worker] Invalid scaled dimensions: ${scaledWidth}x${scaledHeight}`,
      );
    }

    // Calculate crop offset to center the image
    // This will be negative when the scaled image is larger than target
    const cropOffsetX = Math.floor((targetWidth - scaledWidth) / 2);
    const cropOffsetY = Math.floor((targetHeight - scaledHeight) / 2);

    console.log(
      `🖼️ [Worker] Scaling: scale=${scale.toFixed(3)}, scaled dimensions: ${scaledWidth}x${scaledHeight}, crop offset: (${cropOffsetX}, ${cropOffsetY})`,
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

    // IMPORTANT: Close ImageBitmap to free memory
    imageBitmap.close();

    // Convert to data URL (PNG format for lossless quality)
    const resizedBlob = await canvas.convertToBlob({ type: 'image/png' });

    // Convert Blob to data URL using FileReader
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const resizedDataUrl = reader.result as string;
        console.log(
          `✅ [Worker] Image resized successfully (cover mode): ${imageBitmap.width}x${imageBitmap.height} → ${targetWidth}x${targetHeight}`,
        );
        resolve({
          dataUrl: resizedDataUrl,
          cropOffsetX: cropOffsetX, // Negative value indicates crop from left/top
          cropOffsetY: cropOffsetY,
        });
      };
      reader.onerror = () =>
        reject(new Error('[Worker] Failed to read resized blob'));
      reader.readAsDataURL(resizedBlob);
    });
  } catch (error) {
    const errorMsg = `[Worker] Error during image resize: ${error instanceof Error ? error.message : error}`;
    console.error(`❌ ${errorMsg}`);
    throw new Error(errorMsg);
  }
}

/**
 * Get memory usage information
 */
function getMemoryInfo() {
  if ('memory' in performance && performance.memory) {
    const mem = (performance as any).memory;
    return {
      usedJSHeapSize: mem.usedJSHeapSize,
      totalJSHeapSize: mem.totalJSHeapSize,
    };
  }
  return {};
}

// Worker message handler
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  try {
    switch (request.type) {
      case 'resizeImage': {
        try {
          const result = await resizeImage(
            request.dataUrl,
            request.targetWidth,
            request.targetHeight,
          );

          const response: ResizeImageResponse = {
            id: request.id,
            dataUrl: result.dataUrl,
            cropOffsetX: result.cropOffsetX,
            cropOffsetY: result.cropOffsetY,
          };

          self.postMessage(response);
        } catch (error) {
          const response: ResizeImageResponse = {
            id: request.id,
            dataUrl: '',
            cropOffsetX: 0,
            cropOffsetY: 0,
            error: error instanceof Error ? error.message : String(error),
          };
          self.postMessage(response);
        }
        break;
      }

      case 'status': {
        const response: WorkerStatusResponse = {
          type: 'status',
          memory: getMemoryInfo(),
          isAlive: true,
        };
        self.postMessage(response);
        break;
      }

      default: {
        console.warn(`[Worker] Unknown request type: ${(request as any).type}`);
      }
    }
  } catch (error) {
    console.error(`[Worker] Unhandled error processing request:`, error);
  }
};

// Log worker initialization
console.log('🚀 Image Processor Worker initialized');
