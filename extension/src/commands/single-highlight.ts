/**
 * Single Element Highlight Module
 * Draws a single bounding box with confirmation label on a screenshot for 2PC flow.
 */

import type { InteractiveElement } from '../types';

// Visual style for single-element confirmation
const CONFIRMATION_COLOR = '#FF6600'; // Orange border
const CONFIRMATION_BG = 'rgba(255, 102, 0, 0.8)'; // Orange with transparency
const CONFIRMATION_LABEL = 'Is This The Element You Selected? Please Confirm';
const BASE_FONT_SIZE = 16;
const BASE_LABEL_PADDING = 4;
const BASE_BOX_PADDING = 2;
const BASE_LINE_WIDTH = 3;

/**
 * Draw a single highlighted element with confirmation label
 *
 * @param screenshotDataUrl - Base64 data URL of the screenshot
 * @param element - The element to highlight
 * @param options - Options including scale, viewportWidth, viewportHeight
 * @returns Promise resolving to base64 PNG data URL with highlight
 */
export async function highlightSingleElement(
  screenshotDataUrl: string,
  element: InteractiveElement,
  options?: { scale?: number; viewportWidth?: number; viewportHeight?: number },
): Promise<string> {
  console.log(
    `🎨 [SingleHighlight] Drawing highlight for element ${element.id}...`,
  );

  // Check OffscreenCanvas availability
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error(
      '[SingleHighlight] OffscreenCanvas is not available. ' +
        'Visual highlighting requires OffscreenCanvas support.',
    );
  }

  // Check createImageBitmap availability
  if (typeof createImageBitmap === 'undefined') {
    throw new Error(
      '[SingleHighlight] createImageBitmap is not available. ' +
        'Visual highlighting requires createImageBitmap support.',
    );
  }

  try {
    // ========================================
    // STEP 1: Validate screenshot data URL format
    // ========================================
    if (!screenshotDataUrl || typeof screenshotDataUrl !== 'string') {
      throw new Error(
        '[SingleHighlight] Invalid screenshot data: expected a data URL string, got ' +
          (screenshotDataUrl === null
            ? 'null'
            : screenshotDataUrl === undefined
              ? 'undefined'
              : typeof screenshotDataUrl),
      );
    }

    if (!screenshotDataUrl.startsWith('data:')) {
      throw new Error(
        '[SingleHighlight] Invalid screenshot data URL: must start with "data:" prefix. ' +
          `Got: "${screenshotDataUrl.substring(0, 50)}..."`,
      );
    }

    if (!screenshotDataUrl.includes(',')) {
      throw new Error(
        '[SingleHighlight] Invalid screenshot data URL: must contain comma separator between header and data. ' +
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
        '[SingleHighlight] Invalid screenshot data URL header: expected format "data:image/format;base64". ' +
          `Got: "${headerPart}"`,
      );
    }

    const mimeType = headerPart.substring(colonIndex + 1, semicolonIndex);
    const base64Data = dataUrlParts[1];

    if (!base64Data || base64Data.length === 0) {
      throw new Error(
        '[SingleHighlight] Screenshot data URL contains no image data after header',
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

    console.log(
      `🖼️ [SingleHighlight] Screenshot dimensions: ${imageBitmap.width}x${imageBitmap.height}`,
    );

    // Extract options before using them
    const viewportWidth = options?.viewportWidth ?? 0;
    const viewportHeight = options?.viewportHeight ?? 0;

    // Calculate actual scale from screenshot dimensions (more reliable than trusting DPR)
    const actualScaleX =
      viewportWidth > 0 ? imageBitmap.width / viewportWidth : 1;
    const actualScaleY =
      viewportHeight > 0 ? imageBitmap.height / viewportHeight : 1;
    const actualScale = (actualScaleX + actualScaleY) / 2; // Average in case of rounding

    console.log(
      `📐 [SingleHighlight] Calculated scale: ${actualScale.toFixed(3)} (from ${viewportWidth}x${viewportHeight} → ${imageBitmap.width}x${imageBitmap.height})`,
    );

    // Prefer calculated scale if it differs significantly from provided scale
    const providedScale = options?.scale ?? 1;
    const scale =
      Math.abs(actualScale - providedScale) > 0.1 ? actualScale : providedScale;
    console.log(
      `📐 [SingleHighlight] Using scale: ${scale.toFixed(3)} (provided: ${providedScale}, calculated: ${actualScale})`,
    );

    // Create OffscreenCanvas with same dimensions as screenshot
    const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      throw new Error(
        '[SingleHighlight] Failed to get 2d context from OffscreenCanvas',
      );
    }

    // Draw original screenshot onto canvas
    ctx.drawImage(imageBitmap, 0, 0);

    // Close the bitmap to free memory
    imageBitmap.close();

    // Draw the single element bounding box
    drawSingleBoundingBox(ctx, element, scale);

    const resultBlob = await canvas.convertToBlob({ type: 'image/png' });

    // Convert blob to data URL
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () =>
        reject(
          new Error('[SingleHighlight] Failed to convert result to data URL'),
        );
      reader.readAsDataURL(resultBlob);
    });

    console.log(
      `✅ [SingleHighlight] Highlight drawn successfully, size: ${dataUrl.length} bytes`,
    );
    return dataUrl;
  } catch (error) {
    const errorMsg = `[SingleHighlight] Error drawing highlight: ${error instanceof Error ? error.message : error}`;
    console.error(`❌ ${errorMsg}`);
    throw new Error(errorMsg);
  }
}

/**
 * Draw bounding box for single element
 */
function drawSingleBoundingBox(
  ctx: OffscreenCanvasRenderingContext2D,
  element: InteractiveElement,
  scale: number,
): void {
  const { x, y, width, height } = element.bbox;

  // Calculate device-pixel values from base CSS sizes
  const boxPadding = Math.round(BASE_BOX_PADDING * scale);
  const lineWidth = BASE_LINE_WIDTH * scale;

  // Apply scale to convert CSS pixels to device pixels, then apply padding
  const boxX = Math.round(x * scale) - boxPadding;
  const boxY = Math.round(y * scale) - boxPadding;
  const boxWidth = Math.round(width * scale) + boxPadding * 2;
  const boxHeight = Math.round(height * scale) + boxPadding * 2;

  console.log(
    `[SingleHighlight] Drawing bbox for ${element.id}: CSS(${x}, ${y}, ${width}, ${height}) → Device(${boxX}, ${boxY}, ${boxWidth}, ${boxHeight}) scale=${scale}`,
  );

  // Draw bounding box with orange color
  ctx.strokeStyle = CONFIRMATION_COLOR;
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);

  // Draw confirmation label above box
  drawConfirmationLabel(ctx, CONFIRMATION_LABEL, boxX, boxY, scale);
}

/**
 * Draw confirmation label
 */
function drawConfirmationLabel(
  ctx: OffscreenCanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  scale: number,
): void {
  // Calculate device-pixel values from base CSS sizes
  const fontSize = Math.round(BASE_FONT_SIZE * scale);
  const labelPadding = Math.round(BASE_LABEL_PADDING * scale);

  // Set font before measuring text
  ctx.font = `bold ${fontSize}px Arial`;

  // Measure text width
  const metrics = ctx.measureText(text);
  const textWidth = metrics.width;
  const textHeight = fontSize;

  // Calculate label dimensions
  const labelWidth = textWidth + labelPadding * 2;
  const labelHeight = textHeight + labelPadding * 2;

  // Position label above the box
  let labelX = x;
  let labelY = y - labelHeight;

  // If label would go above canvas, position it inside the box
  if (labelY < 0) {
    labelY = y;
  }

  // Draw label background with orange color
  ctx.fillStyle = CONFIRMATION_BG;
  ctx.fillRect(labelX, labelY, labelWidth, labelHeight);

  // Draw label text (white for contrast)
  ctx.fillStyle = '#FFFFFF';
  ctx.textBaseline = 'top';
  ctx.fillText(text, labelX + labelPadding, labelY + labelPadding);
}
