/**
 * Visual Highlight Drawing Module
 * Draws bounding boxes on screenshots to highlight interactive elements.
 * Uses OffscreenCanvas for Service Worker compatibility (Manifest V3).
 */

import type {
  InteractiveElement,
  ElementType,
  HighlightOptions,
} from '../types';
import { LABEL_FONT_SIZE, LABEL_PADDING } from './label-constants';
import { getLabelDimensions, getLabelFont } from '../utils/label-geometry';

/**
 * Color mapping for different element types (with transparency for label backgrounds)
 */
const COLORS: Record<ElementType, string> = {
  clickable: '#0066FF',
  scrollable: '#00CC66',
  inputable: '#FF9900',
  selectable: '#FF6B6B',
  draggable: '#FF6600',
  droppable: '#339966',
  any: '#00CCCC',
};

/**
 * Label background colors with transparency (RGBA)
 */
const LABEL_BG_COLORS: Record<ElementType, string> = {
  clickable: 'rgba(0, 102, 255, 0.7)',
  scrollable: 'rgba(0, 204, 102, 0.7)',
  inputable: 'rgba(255, 153, 0, 0.7)',
  selectable: 'rgba(255, 107, 107, 0.7)',
  draggable: 'rgba(255, 102, 0, 0.7)',
  droppable: 'rgba(51, 153, 102, 0.7)',
  any: 'rgba(0, 204, 204, 0.7)',
};

const DRAW_YIELD_EVERY = 12;
const MAX_ENCODED_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB limit for the final data URL

/**
 * Base sizes in CSS pixels (will be multiplied by scale for device pixels)
 */
const BASE_BOX_PADDING = 1; // Box padding at scale=1 (minimal to avoid covering content)
const BASE_LINE_WIDTH = 1.5; // Box border width at scale=1 (thinner to reduce overlap)

interface PreparedBoundingBox {
  element: InteractiveElement;
  boxX: number;
  boxY: number;
  boxWidth: number;
  boxHeight: number;
  color: string;
  bgColor: string;
}

/**
 * Draw highlights (bounding boxes with labels) on a screenshot
 *
 * @param screenshotDataUrl - Base64 data URL of the screenshot
 * @param elements - Array of interactive elements to highlight
 * @param options - Highlight options (limit, offset, elementTypes filter, scale)
 * @returns Promise resolving to a base64 data URL with highlights drawn
 */
export async function drawHighlights(
  screenshotDataUrl: string,
  elements: InteractiveElement[],
  options?: HighlightOptions & {
    scale?: number;
    viewportWidth?: number;
    viewportHeight?: number;
  },
): Promise<string> {
  console.log(
    `🎨 [VisualHighlight] Drawing highlights for ${elements.length} elements...`,
  );

  // Check OffscreenCanvas availability
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error(
      '[VisualHighlight] OffscreenCanvas is not available. ' +
        'Visual highlighting requires OffscreenCanvas support.',
    );
  }

  // Check createImageBitmap availability
  if (typeof createImageBitmap === 'undefined') {
    throw new Error(
      '[VisualHighlight] createImageBitmap is not available. ' +
        'Visual highlighting requires createImageBitmap support.',
    );
  }

  try {
    // ========================================
    // STEP 1: Validate screenshot data URL format
    // ========================================
    if (!screenshotDataUrl || typeof screenshotDataUrl !== 'string') {
      throw new Error(
        '[VisualHighlight] Invalid screenshot data: expected a data URL string, got ' +
          (screenshotDataUrl === null
            ? 'null'
            : screenshotDataUrl === undefined
              ? 'undefined'
              : typeof screenshotDataUrl),
      );
    }

    if (!screenshotDataUrl.startsWith('data:')) {
      throw new Error(
        '[VisualHighlight] Invalid screenshot data URL: must start with "data:" prefix. ' +
          `Got: "${screenshotDataUrl.substring(0, 50)}..."`,
      );
    }

    if (!screenshotDataUrl.includes(',')) {
      throw new Error(
        '[VisualHighlight] Invalid screenshot data URL: must contain comma separator between header and data. ' +
          `Got: "${screenshotDataUrl.substring(0, 100)}..."`,
      );
    }

    // ========================================
    // STEP 2: Parse data URL into components
    // ========================================
    const dataUrlParts = screenshotDataUrl.split(',');
    const headerPart = dataUrlParts[0];
    const colonIndex = headerPart.indexOf(':');
    const semicolonIndex = headerPart.indexOf(';');

    if (colonIndex === -1 || semicolonIndex === -1) {
      throw new Error(
        '[VisualHighlight] Invalid screenshot data URL header: expected format "data:image/format;base64". ' +
          `Got: "${headerPart}"`,
      );
    }

    const mimeType = headerPart.substring(colonIndex + 1, semicolonIndex);
    const base64Data = dataUrlParts[1];

    if (!base64Data || base64Data.length === 0) {
      throw new Error(
        '[VisualHighlight] Screenshot data URL contains no image data after header',
      );
    }

    // ========================================
    // STEP 3: Decode base64 to binary
    // ========================================
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // ========================================
    // STEP 4: Create Blob and ImageBitmap
    // ========================================
    const blob = new Blob([bytes], { type: mimeType });
    const imageBitmap = await createImageBitmap(blob);

    // Extract options before using them
    const viewportWidth = options?.viewportWidth ?? 0;
    const viewportHeight = options?.viewportHeight ?? 0;

    console.log(
      `🖼️ [VisualHighlight] Screenshot dimensions: ${imageBitmap.width}x${imageBitmap.height}`,
    );

    // Calculate actual scale from screenshot dimensions (more reliable than trusting DPR)
    const actualScaleX =
      viewportWidth > 0 ? imageBitmap.width / viewportWidth : 1;
    const actualScaleY =
      viewportHeight > 0 ? imageBitmap.height / viewportHeight : 1;
    const actualScale = (actualScaleX + actualScaleY) / 2; // Average in case of rounding

    console.log(
      `📐 [VisualHighlight] Calculated scale: ${actualScale.toFixed(3)} (from ${viewportWidth}x${viewportHeight} → ${imageBitmap.width}x${imageBitmap.height})`,
    );

    // Prefer calculated scale if it differs significantly from provided scale
    const providedScale = options?.scale ?? 1;
    const scale =
      Math.abs(actualScale - providedScale) > 0.1 ? actualScale : providedScale;
    console.log(
      `📐 [VisualHighlight] Using scale: ${scale.toFixed(3)} (provided: ${providedScale}, calculated: ${actualScale})`,
    );

    // Create OffscreenCanvas with same dimensions as screenshot
    const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      throw new Error(
        '[VisualHighlight] Failed to get 2d context from OffscreenCanvas',
      );
    }

    // Draw original screenshot onto canvas
    ctx.drawImage(imageBitmap, 0, 0);

    // Close the bitmap to free memory
    imageBitmap.close();

    console.log(
      `🎨 [VisualHighlight] Drawing ${elements.length} elements (type: ${elements[0]?.type || 'none'}, scale=${scale})`,
    );

    const preparedBoxes = await prepareBoundingBoxes(elements, scale);
    await drawBoundingBoxes(ctx, preparedBoxes, scale);
    await drawLabels(ctx, preparedBoxes, scale);
    const encodedResult = await encodeCanvasWithCompression(
      canvas,
      MAX_ENCODED_IMAGE_SIZE,
    );

    console.log(
      `✅ [VisualHighlight] Highlights drawn successfully, size: ${encodedResult.byteLength} bytes`,
    );
    return encodedResult.dataUrl;
  } catch (error) {
    const errorMsg = `[VisualHighlight] Error drawing highlights: ${error instanceof Error ? error.message : error}`;
    console.error(`❌ ${errorMsg}`);
    throw new Error(errorMsg);
  }
}

async function prepareBoundingBoxes(
  elements: InteractiveElement[],
  scale: number,
): Promise<PreparedBoundingBox[]> {
  const preparedBoxes: PreparedBoundingBox[] = [];

  for (let index = 0; index < elements.length; index++) {
    preparedBoxes.push(buildPreparedBoundingBox(elements[index], scale));

    if ((index + 1) % DRAW_YIELD_EVERY === 0) {
      await yieldToMainThread();
    }
  }

  return preparedBoxes;
}

function buildPreparedBoundingBox(
  element: InteractiveElement,
  scale: number,
): PreparedBoundingBox {
  const { x, y, width, height } = element.bbox;
  const boxPadding = Math.round(BASE_BOX_PADDING * scale);
  const boxX = Math.round(x * scale) - boxPadding;
  const boxY = Math.round(y * scale) - boxPadding;
  const boxWidth = Math.round(width * scale) + boxPadding * 2;
  const boxHeight = Math.round(height * scale) + boxPadding * 2;

  return {
    element,
    boxX,
    boxY,
    boxWidth,
    boxHeight,
    color: COLORS[element.type] || '#CCCCCC',
    bgColor: LABEL_BG_COLORS[element.type] || 'rgba(200, 200, 200, 0.7)',
  };
}

async function drawBoundingBoxes(
  ctx: OffscreenCanvasRenderingContext2D,
  preparedBoxes: PreparedBoundingBox[],
  scale: number,
): Promise<void> {
  if (preparedBoxes.length === 0) {
    return;
  }

  const groupedBoxes = new Map<string, PreparedBoundingBox[]>();
  for (const preparedBox of preparedBoxes) {
    const boxes = groupedBoxes.get(preparedBox.color) ?? [];
    boxes.push(preparedBox);
    groupedBoxes.set(preparedBox.color, boxes);
  }

  ctx.lineWidth = BASE_LINE_WIDTH * scale;

  for (const [color, boxes] of groupedBoxes) {
    ctx.strokeStyle = color;
    ctx.beginPath();

    for (let index = 0; index < boxes.length; index++) {
      const box = boxes[index];
      ctx.rect(box.boxX, box.boxY, box.boxWidth, box.boxHeight);

      if ((index + 1) % DRAW_YIELD_EVERY === 0 && index + 1 < boxes.length) {
        ctx.stroke();
        ctx.beginPath();
        await yieldToMainThread();
      }
    }

    ctx.stroke();
  }
}

async function drawLabels(
  ctx: OffscreenCanvasRenderingContext2D,
  preparedBoxes: PreparedBoundingBox[],
  scale: number,
): Promise<void> {
  if (preparedBoxes.length === 0) {
    return;
  }

  ctx.textBaseline = 'top';

  for (let index = 0; index < preparedBoxes.length; index++) {
    const preparedBox = preparedBoxes[index];
    drawLabel(
      ctx,
      preparedBox.element.id,
      preparedBox.boxX,
      preparedBox.boxY,
      preparedBox.boxWidth,
      preparedBox.boxHeight,
      preparedBox.bgColor,
      scale,
      preparedBox.element.labelPosition || 'above',
    );

    if ((index + 1) % DRAW_YIELD_EVERY === 0) {
      await yieldToMainThread();
    }
  }
}

async function encodeCanvasWithCompression(
  canvas: OffscreenCanvas,
  maxSize: number,
): Promise<{ dataUrl: string; byteLength: number }> {
  const pngBlob = await canvas.convertToBlob({ type: 'image/png' });
  const pngEstimatedSize = estimateDataUrlLength(pngBlob);

  if (pngEstimatedSize <= maxSize) {
    console.log(
      `🖼️ [Compress] Image size ${pngEstimatedSize} bytes is within limit ${maxSize} bytes`,
    );
    return buildEncodedResult(pngBlob);
  }

  console.log(
    `⚠️ [Compress] Image size ${pngEstimatedSize} bytes exceeds limit ${maxSize} bytes, compressing...`,
  );

  const qualities = [0.8, 0.7, 0.6, 0.5, 0.4];
  for (const quality of qualities) {
    const compressedBlob = await canvas.convertToBlob({
      type: 'image/jpeg',
      quality,
    });
    const estimatedSize = estimateDataUrlLength(compressedBlob);

    console.log(
      `🖼️ [Compress] JPEG quality=${quality}: ${estimatedSize} bytes`,
    );

    if (estimatedSize <= maxSize) {
      console.log(
        `✅ [Compress] Compressed to ${estimatedSize} bytes with quality=${quality}`,
      );
      return buildEncodedResult(compressedBlob);
    }
  }

  console.log(
    '⚠️ [Compress] Quality reduction not enough, trying to reduce dimensions...',
  );

  const scales = [0.75, 0.5, 0.4];
  for (const scale of scales) {
    const scaledCanvas = createScaledCanvas(canvas, scale);
    const compressedBlob = await scaledCanvas.convertToBlob({
      type: 'image/jpeg',
      quality: 0.6,
    });
    const estimatedSize = estimateDataUrlLength(compressedBlob);

    console.log(
      `🖼️ [Compress] Scale=${scale} (${scaledCanvas.width}x${scaledCanvas.height}): ${estimatedSize} bytes`,
    );

    if (estimatedSize <= maxSize) {
      console.log(
        `✅ [Compress] Compressed to ${estimatedSize} bytes with scale=${scale}`,
      );
      return buildEncodedResult(compressedBlob);
    }
  }

  console.warn(
    `⚠️ [Compress] Could not compress below ${maxSize} bytes, returning smallest version`,
  );

  const fallbackCanvas = createScaledCanvas(canvas, 0.5);
  const fallbackBlob = await fallbackCanvas.convertToBlob({
    type: 'image/jpeg',
    quality: 0.4,
  });
  return buildEncodedResult(fallbackBlob);
}

async function buildEncodedResult(
  blob: Blob,
): Promise<{ dataUrl: string; byteLength: number }> {
  const dataUrl = await blobToDataUrl(blob);
  return {
    dataUrl,
    byteLength: dataUrl.length,
  };
}

function estimateDataUrlLength(blob: Blob): number {
  const headerLength = `data:${blob.type || 'application/octet-stream'};base64,`
    .length;
  return headerLength + Math.ceil(blob.size / 3) * 4;
}

function createScaledCanvas(
  sourceCanvas: OffscreenCanvas,
  scale: number,
): OffscreenCanvas {
  const scaledWidth = Math.max(1, Math.round(sourceCanvas.width * scale));
  const scaledHeight = Math.max(1, Math.round(sourceCanvas.height * scale));
  const scaledCanvas = new OffscreenCanvas(scaledWidth, scaledHeight);
  const scaledCtx = scaledCanvas.getContext('2d');

  if (!scaledCtx) {
    throw new Error('[Compress] Failed to get 2d context');
  }

  scaledCtx.fillStyle = '#FFFFFF';
  scaledCtx.fillRect(0, 0, scaledWidth, scaledHeight);
  scaledCtx.drawImage(sourceCanvas, 0, 0, scaledWidth, scaledHeight);
  return scaledCanvas;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () =>
      reject(
        new Error('[VisualHighlight] Failed to convert result to data URL'),
      );
    reader.readAsDataURL(blob);
  });
}

async function yieldToMainThread(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Draw a label with background at the specified position
 *
 * @param ctx - Canvas 2D rendering context
 * @param text - Label text (element ID)
 * @param x - X position (top-left of bounding box)
 * @param y - Y position (top-left of bounding box)
 * @param bgColor - Background color for the label
 * @param scale - Scale factor for device pixels
 */
function drawLabel(
  ctx: OffscreenCanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  bgColor: string,
  scale: number,
  position: 'above' | 'below' | 'left' | 'right' = 'above',
): void {
  const { width: labelWidth, height: labelHeight } = getLabelDimensions(
    text,
    width,
    scale,
  );
  const fontSize = Math.round(LABEL_FONT_SIZE * scale);
  const labelPadding = Math.round(LABEL_PADDING * scale);

  ctx.font = getLabelFont(fontSize);

  // Measure text width
  let labelX: number;
  let labelY: number;

  switch (position) {
    case 'above':
      labelX = x;
      labelY = y - labelHeight;
      // If label would go above canvas, position it inside the box
      if (labelY < 0) {
        labelY = y;
      }
      break;
    case 'below':
      labelX = x;
      labelY = y + height;
      break;
    case 'left':
      labelX = x - labelWidth;
      labelY = y;
      break;
    case 'right':
      labelX = x + width;
      labelY = y;
      break;
    default:
      labelX = x;
      labelY = y - labelHeight;
      if (labelY < 0) {
        labelY = y;
      }
  }

  // Draw label background
  const canvasWidth = ctx.canvas.width;
  const canvasHeight = ctx.canvas.height;
  labelX = Math.max(0, Math.min(labelX, canvasWidth - labelWidth));
  labelY = Math.max(0, Math.min(labelY, canvasHeight - labelHeight));

  ctx.fillStyle = bgColor;
  ctx.fillRect(labelX, labelY, labelWidth, labelHeight);

  // Draw label text (white for contrast)
  ctx.fillStyle = '#FFFFFF';
  ctx.textBaseline = 'top';
  ctx.fillText(text, labelX + labelPadding, labelY + labelPadding);
}

/**
 * Get the color for a specific element type
 *
 * @param type - Element type
 * @returns Hex color string
 */
export function getElementColor(type: ElementType): string {
  return COLORS[type] || '#CCCCCC';
}

// Re-export constants for testing
export {
  LABEL_FONT_SIZE as BASE_FONT_SIZE,
  LABEL_PADDING as BASE_LABEL_PADDING,
};
