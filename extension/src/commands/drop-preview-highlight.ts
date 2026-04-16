/**
 * Drop Preview Highlight Module
 * Draws bounding boxes on inner elements within a cropped container screenshot
 * for the drag-and-drop 2PC confirmation flow.
 *
 * All drawing happens on a single OffscreenCanvas to avoid redundant
 * encode/decode round-trips.
 */

import type { InteractiveElement } from '../types';
import { calculateConfirmationPreviewLayout } from './single-highlight';
import { LABEL_PADDING, LABEL_FONT_SIZE } from './label-constants';
import { getLabelDimensions, getLabelFont } from '../utils/label-geometry';

// Colors for inner draggable elements.
const INNER_ELEMENT_COLOR = '#FF6600'; // draggable color
const INNER_ELEMENT_BG = 'rgba(255, 102, 0, 0.7)';
const BASE_BOX_PADDING = 1;
const BASE_LINE_WIDTH = 1.5;

const DROP_BANNER_COLOR = 'rgba(255, 102, 0, 0.5)';
const DROP_BANNER_BORDER_COLOR = 'rgba(17, 17, 17, 0.18)';
const DROP_BANNER_TEXT_COLOR = '#111111';
const BASE_BANNER_FONT_SIZE = 20;
const BASE_BANNER_PADDING_X = 12;
const BASE_BANNER_PADDING_Y = 10;
const BASE_BANNER_MARGIN = 10;

/**
 * Produce a cropped, highlighted preview of a drop container with its inner
 * draggable elements annotated.
 *
 * @param screenshotDataUrl - Full-page screenshot as a data URL
 * @param containerElement - The drop target container element (with fresh bbox)
 * @param innerElements - Draggable children inside the container (with IDs already assigned)
 * @param options - scale, viewportWidth, viewportHeight
 * @returns Promise resolving to base64 PNG data URL of the cropped preview
 */
export async function highlightDropPreview(
  screenshotDataUrl: string,
  containerElement: InteractiveElement,
  innerElements: InteractiveElement[],
  options?: {
    scale?: number;
    viewportWidth?: number;
    viewportHeight?: number;
  },
): Promise<string> {
  console.log(
    `🎯 [DropPreview] Drawing drop preview for container ${containerElement.id} with ${innerElements.length} inner elements`,
  );

  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('[DropPreview] OffscreenCanvas is not available.');
  }
  if (typeof createImageBitmap === 'undefined') {
    throw new Error('[DropPreview] createImageBitmap is not available.');
  }

  const scale = options?.scale ?? 1;

  // ========================================
  // STEP 1: Decode the full-page screenshot
  // ========================================
  const dataUrlParts = screenshotDataUrl.split(',');
  const headerPart = dataUrlParts[0];
  const colonIndex = headerPart.indexOf(':');
  const semicolonIndex = headerPart.indexOf(';');
  const mimeType = headerPart.substring(colonIndex + 1, semicolonIndex);
  const base64Data = dataUrlParts[1];
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType });
  const imageBitmap = await createImageBitmap(blob);

  console.log(
    `🖼️ [DropPreview] Screenshot dimensions: ${imageBitmap.width}x${imageBitmap.height}`,
  );

  // ========================================
  // STEP 2: Calculate crop region around container
  // ========================================
  const previewLayout = calculateConfirmationPreviewLayout(
    imageBitmap.width,
    imageBitmap.height,
    containerElement,
    scale,
  );

  console.log(
    `🪟 [DropPreview] Crop region:`,
    JSON.stringify(previewLayout.crop),
  );

  // ========================================
  // STEP 3: Crop screenshot → single canvas for all drawing
  // ========================================
  const canvas = new OffscreenCanvas(
    previewLayout.crop.width,
    previewLayout.crop.height,
  );
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('[DropPreview] Failed to get 2d context');
  }

  ctx.drawImage(
    imageBitmap,
    previewLayout.crop.x,
    previewLayout.crop.y,
    previewLayout.crop.width,
    previewLayout.crop.height,
    0,
    0,
    previewLayout.crop.width,
    previewLayout.crop.height,
  );
  imageBitmap.close();

  // ========================================
  // STEP 4: Draw bounding boxes + labels for inner elements
  // ========================================
  const cropOffsetX = previewLayout.crop.x / scale;
  const cropOffsetY = previewLayout.crop.y / scale;
  const boxPadding = Math.round(BASE_BOX_PADDING * scale);
  // Draw border as four fillRects per edge. fillRect on integer coords always
  // lands on whole rows; stroke() straddles the path and blurs unless the width
  // is an even integer.
  const edgeThickness = Math.max(2, Math.round(BASE_LINE_WIDTH * scale));

  if (innerElements.length > 0) {
    ctx.fillStyle = INNER_ELEMENT_COLOR;
    for (const el of innerElements) {
      const bx = Math.round((el.bbox.x - cropOffsetX) * scale) - boxPadding;
      const by = Math.round((el.bbox.y - cropOffsetY) * scale) - boxPadding;
      const bw = Math.round(el.bbox.width * scale) + boxPadding * 2;
      const bh = Math.round(el.bbox.height * scale) + boxPadding * 2;
      ctx.fillRect(bx, by, bw, edgeThickness);
      ctx.fillRect(bx, by + bh - edgeThickness, bw, edgeThickness);
      ctx.fillRect(bx, by + edgeThickness, edgeThickness, bh - edgeThickness * 2);
      ctx.fillRect(bx + bw - edgeThickness, by + edgeThickness, edgeThickness, bh - edgeThickness * 2);
    }

    // Draw labels
    const labelPadding = Math.round(LABEL_PADDING * scale);
    const fontSize = Math.round(LABEL_FONT_SIZE * scale);
    ctx.textBaseline = 'top';

    for (const el of innerElements) {
      const bx = Math.round((el.bbox.x - cropOffsetX) * scale) - boxPadding;
      const by = Math.round((el.bbox.y - cropOffsetY) * scale) - boxPadding;
      const bw = Math.round(el.bbox.width * scale) + boxPadding * 2;

      ctx.font = getLabelFont(fontSize);
      const dims = getLabelDimensions(el.id, bw, scale);

      // Position label above the box
      let labelX = bx;
      let labelY = by - dims.height;
      // Clamp to canvas bounds
      if (labelY < 0)
        labelY = by + Math.round(el.bbox.height * scale) + boxPadding * 2;
      if (labelX + dims.width > canvas.width)
        labelX = canvas.width - dims.width;
      if (labelX < 0) labelX = 0;

      ctx.fillStyle = INNER_ELEMENT_BG;
      ctx.fillRect(labelX, labelY, dims.width, dims.height);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(el.id, labelX + labelPadding, labelY + labelPadding);
    }
  }

  // ========================================
  // STEP 5: Draw the drop confirmation banner
  // ========================================
  drawDropBanner(ctx, scale);

  // ========================================
  // STEP 6: Encode final result (single encode)
  // ========================================
  const finalBlob = await canvas.convertToBlob({ type: 'image/png' });
  const finalDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () =>
      reject(new Error('[DropPreview] Failed to encode final result'));
    reader.readAsDataURL(finalBlob);
  });

  console.log(
    `✅ [DropPreview] Preview drawn, size: ${finalDataUrl.length} bytes`,
  );
  return finalDataUrl;
}

function drawDropBanner(
  ctx: OffscreenCanvasRenderingContext2D,
  scale: number,
): void {
  const message = 'Choose a drop position or confirm to drop at end';
  const fontSize = Math.max(14, Math.round(BASE_BANNER_FONT_SIZE * scale));
  const paddingX = Math.max(10, Math.round(BASE_BANNER_PADDING_X * scale));
  const paddingY = Math.max(6, Math.round(BASE_BANNER_PADDING_Y * scale));
  const margin = Math.max(8, Math.round(BASE_BANNER_MARGIN * scale));

  ctx.save();
  ctx.font = `700 ${fontSize}px sans-serif`;
  ctx.textBaseline = 'middle';
  const textWidth = ctx.measureText(message).width;
  const bannerWidth = Math.min(
    ctx.canvas.width - margin * 2,
    textWidth + paddingX * 2,
  );
  const bannerHeight = fontSize + paddingY * 2;

  // Place at top center
  const x = Math.max(margin, (ctx.canvas.width - bannerWidth) / 2);
  const y = margin;

  ctx.fillStyle = DROP_BANNER_COLOR;
  ctx.fillRect(x, y, bannerWidth, bannerHeight);
  ctx.strokeStyle = DROP_BANNER_BORDER_COLOR;
  ctx.lineWidth = Math.max(1, scale);
  ctx.strokeRect(x, y, bannerWidth, bannerHeight);

  ctx.fillStyle = DROP_BANNER_TEXT_COLOR;
  ctx.fillText(
    message,
    x + paddingX,
    y + bannerHeight / 2,
    bannerWidth - paddingX * 2,
  );
  ctx.restore();
}
