import { calculateConfirmationBannerLayout } from '../commands/single-highlight';

type AnnotatableRecordingEventType =
  | 'click'
  | 'focus'
  | 'change'
  | 'submit'
  | 'drag_and_drop'
  | 'set_slider';

interface RecordingEventBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RecordingKeyframeAnnotationTarget {
  bbox: RecordingEventBBox;
  intendedAction: 'click' | 'keyboard_input' | 'drag_and_drop' | 'set_slider';
  message: string;
}

const RECORDING_ANNOTATION_BOX_COLOR = '#FFD400';
const RECORDING_ANNOTATION_TEXT_COLOR = '#111111';
const RECORDING_ANNOTATION_BANNER_COLOR = 'rgba(255, 212, 0, 0.56)';
const RECORDING_ANNOTATION_BANNER_BORDER_COLOR = 'rgba(17, 17, 17, 0.22)';
const RECORDING_ANNOTATION_SHADOW_COLOR = 'rgba(255, 212, 0, 0.62)';
const RECORDING_ANNOTATION_LINE_WIDTH = 4;
const RECORDING_ANNOTATION_PADDING = 2;
const RECORDING_ANNOTATION_FONT_FAMILY = 'sans-serif';

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function normalizeBBox(value: unknown): RecordingEventBBox | null {
  if (!isObjectRecord(value)) {
    return null;
  }

  const x = typeof value.x === 'number' ? value.x : NaN;
  const y = typeof value.y === 'number' ? value.y : NaN;
  const width = typeof value.width === 'number' ? value.width : NaN;
  const height = typeof value.height === 'number' ? value.height : NaN;

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }

  if (width <= 0 || height <= 0) {
    return null;
  }

  return { x, y, width, height };
}

function getEventTargetRecord(
  eventType: AnnotatableRecordingEventType,
  eventData: Record<string, unknown>,
): Record<string, unknown> | null {
  let candidate: unknown;
  if (eventType === 'submit') {
    candidate = eventData.form;
  } else if (eventType === 'drag_and_drop') {
    candidate = eventData.targetElement;
  } else {
    candidate = eventData.element;
  }

  return isObjectRecord(candidate) ? candidate : null;
}

export function getRecordingAnnotationMessage(
  eventType: AnnotatableRecordingEventType,
): string {
  if (eventType === 'submit') {
    return 'This is the form the user just submitted.';
  }

  if (eventType === 'click') {
    return 'This is the element the user just clicked.';
  }

  if (eventType === 'focus') {
    return 'This is the input the user just focused.';
  }

  if (eventType === 'drag_and_drop') {
    return 'This is where the user dropped the dragged element.';
  }

  if (eventType === 'set_slider') {
    return 'This is the slider the user adjusted.';
  }

  return 'This is the element the user just typed into.';
}

export function resolveRecordingKeyframeAnnotationTarget(
  eventType: string,
  eventData: Record<string, unknown>,
): RecordingKeyframeAnnotationTarget | null {
  if (
    eventType !== 'click' &&
    eventType !== 'focus' &&
    eventType !== 'change' &&
    eventType !== 'submit' &&
    eventType !== 'drag_and_drop' &&
    eventType !== 'set_slider'
  ) {
    return null;
  }

  const targetRecord = getEventTargetRecord(eventType, eventData);
  if (!targetRecord) {
    return null;
  }

  const bbox = normalizeBBox(targetRecord.bbox);
  if (!bbox) {
    return null;
  }

  let intendedAction: RecordingKeyframeAnnotationTarget['intendedAction'];
  if (eventType === 'click') {
    intendedAction = 'click';
  } else if (eventType === 'drag_and_drop') {
    intendedAction = 'drag_and_drop';
  } else if (eventType === 'set_slider') {
    intendedAction = 'set_slider';
  } else {
    intendedAction = 'keyboard_input';
  }

  return {
    bbox,
    intendedAction,
    message: getRecordingAnnotationMessage(eventType),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function inferMimeTypeFromDataUrl(dataUrl: string): string {
  const header = dataUrl.slice(0, dataUrl.indexOf(','));
  const match = /^data:([^;]+);base64$/i.exec(header);
  return match?.[1] || 'image/jpeg';
}

function toBinaryBytes(dataUrl: string): Uint8Array {
  const parts = dataUrl.split(',');
  const binaryString = atob(parts[1] || '');
  const bytes = new Uint8Array(binaryString.length);
  for (let index = 0; index < binaryString.length; index += 1) {
    bytes[index] = binaryString.charCodeAt(index);
  }
  return bytes;
}

function resolveViewportScale(options: {
  imageWidth: number;
  imageHeight: number;
  viewportWidth?: number | null;
  viewportHeight?: number | null;
}): number {
  const { imageWidth, imageHeight, viewportWidth, viewportHeight } = options;
  if (
    !viewportWidth ||
    !viewportHeight ||
    viewportWidth <= 0 ||
    viewportHeight <= 0
  ) {
    return 1;
  }

  const scaleX = imageWidth / viewportWidth;
  const scaleY = imageHeight / viewportHeight;
  return (scaleX + scaleY) / 2;
}

function drawRecordingBoundingBox(
  ctx: OffscreenCanvasRenderingContext2D,
  rect: RecordingEventBBox,
  scale: number,
): void {
  const padding = Math.max(2, Math.round(RECORDING_ANNOTATION_PADDING * scale));
  const x = rect.x - padding;
  const y = rect.y - padding;
  const width = rect.width + padding * 2;
  const height = rect.height + padding * 2;

  ctx.save();
  ctx.strokeStyle = RECORDING_ANNOTATION_BOX_COLOR;
  ctx.lineWidth = Math.max(2, RECORDING_ANNOTATION_LINE_WIDTH * scale);
  ctx.shadowColor = RECORDING_ANNOTATION_SHADOW_COLOR;
  ctx.shadowBlur = 12 * scale;
  ctx.strokeRect(x, y, width, height);
  ctx.restore();
}

export async function annotateRecordingKeyframe(options: {
  imageData: string;
  eventType: string;
  eventData: Record<string, unknown>;
  viewportWidth?: number | null;
  viewportHeight?: number | null;
}): Promise<{ imageData: string; annotationMessage: string } | null> {
  const target = resolveRecordingKeyframeAnnotationTarget(
    options.eventType,
    options.eventData,
  );
  if (!target) {
    return null;
  }

  if (
    typeof OffscreenCanvas === 'undefined' ||
    typeof createImageBitmap === 'undefined'
  ) {
    return null;
  }

  const mimeType = inferMimeTypeFromDataUrl(options.imageData);
  const blob = new Blob([toBinaryBytes(options.imageData)], { type: mimeType });
  const imageBitmap = await createImageBitmap(blob);

  try {
    const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return null;
    }

    ctx.drawImage(imageBitmap, 0, 0, imageBitmap.width, imageBitmap.height);

    const scale = resolveViewportScale({
      imageWidth: imageBitmap.width,
      imageHeight: imageBitmap.height,
      viewportWidth: options.viewportWidth,
      viewportHeight: options.viewportHeight,
    });

    const rect: RecordingEventBBox = {
      x: Math.round(target.bbox.x * scale),
      y: Math.round(target.bbox.y * scale),
      width: Math.round(target.bbox.width * scale),
      height: Math.round(target.bbox.height * scale),
    };

    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    rect.x = clamp(rect.x, 0, Math.max(0, canvas.width - rect.width));
    rect.y = clamp(rect.y, 0, Math.max(0, canvas.height - rect.height));

    drawRecordingBoundingBox(ctx, rect, scale);

    const fontSize = Math.max(16, Math.round(22 * scale));
    ctx.save();
    ctx.font = `700 ${fontSize}px ${RECORDING_ANNOTATION_FONT_FAMILY}`;
    ctx.textBaseline = 'middle';
    const measuredTextWidth = ctx.measureText(target.message).width;
    const bannerRect = calculateConfirmationBannerLayout({
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      elementRect: rect,
      message: target.message,
      scale,
      textWidth: measuredTextWidth,
    });

    ctx.fillStyle = RECORDING_ANNOTATION_BANNER_COLOR;
    ctx.fillRect(
      bannerRect.x,
      bannerRect.y,
      bannerRect.width,
      bannerRect.height,
    );
    ctx.strokeStyle = RECORDING_ANNOTATION_BANNER_BORDER_COLOR;
    ctx.lineWidth = Math.max(1, scale);
    ctx.strokeRect(
      bannerRect.x,
      bannerRect.y,
      bannerRect.width,
      bannerRect.height,
    );
    ctx.fillStyle = RECORDING_ANNOTATION_TEXT_COLOR;
    ctx.fillText(
      target.message,
      bannerRect.x + Math.max(12, Math.round(12 * scale)),
      bannerRect.y + bannerRect.height / 2,
      bannerRect.width - Math.max(24, Math.round(24 * scale)),
    );
    ctx.restore();

    const resultBlob = await canvas.convertToBlob({
      type: mimeType === 'image/png' ? 'image/png' : 'image/jpeg',
      quality: mimeType === 'image/png' ? undefined : 0.9,
    });

    const resultDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () =>
        reject(new Error('Failed to convert annotated recording keyframe'));
      reader.readAsDataURL(resultBlob);
    });

    return {
      imageData: resultDataUrl,
      annotationMessage: target.message,
    };
  } finally {
    imageBitmap.close();
  }
}
