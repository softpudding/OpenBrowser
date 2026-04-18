/**
 * Single Element Highlight Module
 * Draws a single bounding box on a cropped confirmation screenshot for 2PC flow.
 */

import type { InteractiveElement } from '../types';

// Visual style for single-element confirmation
const CONFIRMATION_COLOR = '#FFD400'; // Yellow border
const CONFIRMATION_TEXT_COLOR = '#111111';
const CONFIRMATION_BANNER_COLOR = 'rgba(255, 212, 0, 0.5)';
const CONFIRMATION_BANNER_BORDER_COLOR = 'rgba(17, 17, 17, 0.18)';
const BASE_BOX_PADDING = 2;
const BASE_LINE_WIDTH = 4;
const BASE_CONTEXT_PADDING_X = 96;
const BASE_CONTEXT_PADDING_Y = 112;
const BASE_MIN_CROP_WIDTH = 520;
const BASE_MIN_CROP_HEIGHT = 320;
const MIN_CROP_WIDTH_RATIO = 0.58;
const MIN_CROP_HEIGHT_RATIO = 0.58;
const BASE_BANNER_FONT_SIZE = 22;
const BASE_BANNER_PADDING_X = 12;
const BASE_BANNER_PADDING_Y = 12;
const BASE_BANNER_MARGIN = 14;
const BASE_BANNER_GAP = 12;

interface DeviceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ConfirmationPreviewLayout {
  crop: DeviceRect;
  element: DeviceRect;
}

/**
 * Crop a screenshot to a zoomed window around the target element, without
 * drawing any annotations on top. Used when the yellow border + confirmation
 * label are already baked into the screenshot via in-page DOM injection.
 */
export async function cropScreenshotAroundElement(
  screenshotDataUrl: string,
  element: InteractiveElement,
  options?: {
    scale?: number;
    viewportWidth?: number;
    viewportHeight?: number;
  },
): Promise<string> {
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error(
      '[SingleHighlight] OffscreenCanvas is not available for cropping.',
    );
  }
  if (typeof createImageBitmap === 'undefined') {
    throw new Error(
      '[SingleHighlight] createImageBitmap is not available for cropping.',
    );
  }
  if (!screenshotDataUrl || !screenshotDataUrl.startsWith('data:')) {
    throw new Error(
      '[SingleHighlight] Invalid screenshot data URL for cropping.',
    );
  }

  const [header, base64Data] = screenshotDataUrl.split(',');
  const mimeType = header.substring(header.indexOf(':') + 1, header.indexOf(';'));
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  const imageBitmap = await createImageBitmap(new Blob([bytes], { type: mimeType }));

  const viewportWidth = options?.viewportWidth ?? 0;
  const viewportHeight = options?.viewportHeight ?? 0;
  const actualScaleX = viewportWidth > 0 ? imageBitmap.width / viewportWidth : 1;
  const actualScaleY = viewportHeight > 0 ? imageBitmap.height / viewportHeight : 1;
  const actualScale = (actualScaleX + actualScaleY) / 2;
  const providedScale = options?.scale ?? 1;
  const scale =
    Math.abs(actualScale - providedScale) > 0.1 ? actualScale : providedScale;

  const layout = calculateConfirmationPreviewLayout(
    imageBitmap.width,
    imageBitmap.height,
    element,
    scale,
  );

  const canvas = new OffscreenCanvas(layout.crop.width, layout.crop.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('[SingleHighlight] Failed to get 2d context for cropping.');
  }
  ctx.drawImage(
    imageBitmap,
    layout.crop.x,
    layout.crop.y,
    layout.crop.width,
    layout.crop.height,
    0,
    0,
    layout.crop.width,
    layout.crop.height,
  );
  imageBitmap.close();

  const resultBlob = await canvas.convertToBlob({ type: 'image/png' });
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () =>
      reject(new Error('[SingleHighlight] Failed to read cropped blob.'));
    reader.readAsDataURL(resultBlob);
  });
}

/**
 * Draw a single highlighted element on a focused confirmation preview.
 *
 * @param screenshotDataUrl - Base64 data URL of the screenshot
 * @param element - The element to highlight
 * @param options - Options including scale, viewportWidth, viewportHeight
 * @returns Promise resolving to base64 PNG data URL with highlight
 */
export async function highlightSingleElement(
  screenshotDataUrl: string,
  element: InteractiveElement,
  options?: {
    intendedAction?: 'click' | 'keyboard_input' | 'select';
    scale?: number;
    viewportWidth?: number;
    viewportHeight?: number;
  },
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

    const previewLayout = calculateConfirmationPreviewLayout(
      imageBitmap.width,
      imageBitmap.height,
      element,
      scale,
    );

    console.log(
      `🪟 [SingleHighlight] Confirmation crop for ${element.id}:`,
      JSON.stringify(previewLayout),
    );

    // Create OffscreenCanvas with cropped preview dimensions
    const canvas = new OffscreenCanvas(
      previewLayout.crop.width,
      previewLayout.crop.height,
    );
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      throw new Error(
        '[SingleHighlight] Failed to get 2d context from OffscreenCanvas',
      );
    }

    // Draw a focused crop around the target element for clearer confirmation.
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

    // Close the bitmap to free memory
    imageBitmap.close();

    // Draw the single element bounding box
    drawSingleBoundingBox(ctx, previewLayout.element, scale);
    drawConfirmationBanner(
      ctx,
      previewLayout.element,
      options?.intendedAction,
      scale,
    );

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

export function formatConfirmationOperationLabel(
  intendedAction?: 'click' | 'keyboard_input' | 'select',
): string {
  switch (intendedAction) {
    case 'click':
      return 'click';
    case 'keyboard_input':
      return 'type into';
    case 'select':
      return 'pick an option from';
    default:
      return 'interact with';
  }
}

export function getConfirmationPromptText(
  intendedAction?: 'click' | 'keyboard_input' | 'select',
): string {
  return `Is this the element you wanted to ${formatConfirmationOperationLabel(intendedAction)}?`;
}

export function calculateConfirmationBannerLayout(options: {
  canvasWidth: number;
  canvasHeight: number;
  elementRect: DeviceRect;
  message: string;
  scale: number;
  textWidth?: number;
}): DeviceRect {
  const { canvasWidth, canvasHeight, elementRect, message, scale, textWidth } =
    options;
  const fontSize = Math.max(16, Math.round(BASE_BANNER_FONT_SIZE * scale));
  const paddingX = Math.max(12, Math.round(BASE_BANNER_PADDING_X * scale));
  const paddingY = Math.max(8, Math.round(BASE_BANNER_PADDING_Y * scale));
  const margin = Math.max(10, Math.round(BASE_BANNER_MARGIN * scale));
  const gap = Math.max(8, Math.round(BASE_BANNER_GAP * scale));
  const estimatedTextWidth = Math.ceil(message.length * fontSize * 0.6);
  const resolvedTextWidth = Math.ceil(textWidth ?? estimatedTextWidth);
  const width = Math.min(
    canvasWidth - margin * 2,
    resolvedTextWidth + paddingX * 2,
  );
  const height = fontSize + paddingY * 2;

  const clampX = (value: number): number =>
    clamp(value, margin, Math.max(margin, canvasWidth - width - margin));
  const clampY = (value: number): number =>
    clamp(value, margin, Math.max(margin, canvasHeight - height - margin));
  const centeredX = clampX(elementRect.x + elementRect.width / 2 - width / 2);
  const centeredY = clampY(elementRect.y + elementRect.height / 2 - height / 2);

  if (elementRect.y - gap - height >= margin) {
    return {
      x: centeredX,
      y: elementRect.y - gap - height,
      width,
      height,
    };
  }

  if (
    elementRect.y + elementRect.height + gap + height <=
    canvasHeight - margin
  ) {
    return {
      x: centeredX,
      y: elementRect.y + elementRect.height + gap,
      width,
      height,
    };
  }

  if (elementRect.x + elementRect.width + gap + width <= canvasWidth - margin) {
    return {
      x: elementRect.x + elementRect.width + gap,
      y: centeredY,
      width,
      height,
    };
  }

  if (elementRect.x - gap - width >= margin) {
    return {
      x: elementRect.x - gap - width,
      y: centeredY,
      width,
      height,
    };
  }

  return {
    x: centeredX,
    y: clampY(elementRect.y + elementRect.height + gap),
    width,
    height,
  };
}

/**
 * Calculate a focused preview crop around the target element.
 */
export function calculateConfirmationPreviewLayout(
  imageWidth: number,
  imageHeight: number,
  element: InteractiveElement,
  scale: number,
): ConfirmationPreviewLayout {
  const { x, y, width, height } = element.bbox;

  const boxPadding = Math.round(BASE_BOX_PADDING * scale);
  const contextPaddingX = Math.round(BASE_CONTEXT_PADDING_X * scale);
  const contextPaddingY = Math.round(BASE_CONTEXT_PADDING_Y * scale);
  const minCropWidth = Math.min(
    imageWidth,
    Math.max(
      Math.round(BASE_MIN_CROP_WIDTH * scale),
      Math.round(imageWidth * MIN_CROP_WIDTH_RATIO),
    ),
  );
  const minCropHeight = Math.min(
    imageHeight,
    Math.max(
      Math.round(BASE_MIN_CROP_HEIGHT * scale),
      Math.round(imageHeight * MIN_CROP_HEIGHT_RATIO),
    ),
  );

  const elementRect: DeviceRect = {
    x: Math.round(x * scale) - boxPadding,
    y: Math.round(y * scale) - boxPadding,
    width: Math.round(width * scale) + boxPadding * 2,
    height: Math.round(height * scale) + boxPadding * 2,
  };

  const desiredWidth = Math.max(
    minCropWidth,
    elementRect.width + contextPaddingX * 2,
  );
  const desiredHeight = Math.max(
    minCropHeight,
    elementRect.height + contextPaddingY * 2,
  );

  const cropWidth = Math.min(imageWidth, desiredWidth);
  const cropHeight = Math.min(imageHeight, desiredHeight);
  const elementCenterX = elementRect.x + elementRect.width / 2;
  const elementCenterY = elementRect.y + elementRect.height / 2;

  let cropX = Math.round(elementCenterX - cropWidth / 2);
  let cropY = Math.round(elementCenterY - cropHeight / 2);

  cropX = clamp(cropX, 0, Math.max(0, imageWidth - cropWidth));
  cropY = clamp(cropY, 0, Math.max(0, imageHeight - cropHeight));

  return {
    crop: {
      x: cropX,
      y: cropY,
      width: cropWidth,
      height: cropHeight,
    },
    element: {
      x: elementRect.x - cropX,
      y: elementRect.y - cropY,
      width: elementRect.width,
      height: elementRect.height,
    },
  };
}

/**
 * Draw bounding box for single element.
 */
function drawSingleBoundingBox(
  ctx: OffscreenCanvasRenderingContext2D,
  elementRect: DeviceRect,
  scale: number,
): void {
  const lineWidth = BASE_LINE_WIDTH * scale;
  const { x, y, width, height } = elementRect;

  console.log(
    `[SingleHighlight] Drawing confirmation bbox at (${x}, ${y}, ${width}, ${height}) scale=${scale}`,
  );

  // Draw bounding box with a bright yellow confirmation color.
  ctx.save();
  ctx.strokeStyle = CONFIRMATION_COLOR;
  ctx.lineWidth = lineWidth;
  ctx.shadowColor = 'rgba(255, 212, 0, 0.7)';
  ctx.shadowBlur = 12 * scale;
  ctx.strokeRect(x, y, width, height);
  ctx.restore();
}

function drawConfirmationBanner(
  ctx: OffscreenCanvasRenderingContext2D,
  elementRect: DeviceRect,
  intendedAction: 'click' | 'keyboard_input' | 'select' | undefined,
  scale: number,
): void {
  const message = getConfirmationPromptText(intendedAction);
  const fontSize = Math.max(16, Math.round(BASE_BANNER_FONT_SIZE * scale));
  const paddingX = Math.max(12, Math.round(BASE_BANNER_PADDING_X * scale));

  ctx.save();
  ctx.font = `700 ${fontSize}px sans-serif`;
  ctx.textBaseline = 'middle';
  const measuredTextWidth = ctx.measureText(message).width;
  const bannerRect = calculateConfirmationBannerLayout({
    canvasWidth: ctx.canvas.width,
    canvasHeight: ctx.canvas.height,
    elementRect,
    message,
    scale,
    textWidth: measuredTextWidth,
  });

  ctx.fillStyle = CONFIRMATION_BANNER_COLOR;
  ctx.fillRect(bannerRect.x, bannerRect.y, bannerRect.width, bannerRect.height);
  ctx.strokeStyle = CONFIRMATION_BANNER_BORDER_COLOR;
  ctx.lineWidth = Math.max(1, scale);
  ctx.strokeRect(
    bannerRect.x,
    bannerRect.y,
    bannerRect.width,
    bannerRect.height,
  );

  ctx.fillStyle = CONFIRMATION_TEXT_COLOR;
  ctx.fillText(
    message,
    bannerRect.x + paddingX,
    bannerRect.y + bannerRect.height / 2,
    bannerRect.width - paddingX * 2,
  );
  ctx.restore();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
