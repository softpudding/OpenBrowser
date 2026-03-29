import {
  LABEL_FONT_FAMILY,
  LABEL_FONT_SIZE,
  LABEL_HEIGHT,
  LABEL_PADDING,
  MAX_LABEL_WIDTH,
} from '../commands/label-constants';

const DEFAULT_LABEL_TEXT = 'xxxxxx';
const LABEL_CHAR_WIDTH_FACTOR = 0.62;
const NARROW_CHAR_WIDTH_FACTOR = 0.42;
const MEDIUM_NARROW_CHAR_WIDTH_FACTOR = 0.54;
const WIDE_CHAR_WIDTH_FACTOR = 0.72;
const EXTRA_WIDE_CHAR_WIDTH_FACTOR = 0.78;

const NARROW_CHARACTERS = new Set(['1', 'I', 'J', 'L', 'T', 'Y', 'i', 'l']);
const MEDIUM_NARROW_CHARACTERS = new Set([
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '9',
  'A',
  'C',
  'E',
  'F',
  'K',
  'P',
  'S',
  'V',
  'X',
  'Z',
]);
const WIDE_CHARACTERS = new Set(['0', '8', 'B', 'D', 'G', 'H', 'N', 'O', 'Q', 'R', 'U']);
const EXTRA_WIDE_CHARACTERS = new Set(['M', 'W']);

let measurementContext: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null =
  null;
const measuredWidthCache = new Map<string, number>();

export interface LabelDimensions {
  width: number;
  height: number;
  textWidth: number;
  fontSize: number;
  padding: number;
}

export function getLabelFont(fontSize: number): string {
  return `bold ${fontSize}px ${LABEL_FONT_FAMILY}`;
}

function getFallbackCharWidthFactor(char: string): number {
  if (EXTRA_WIDE_CHARACTERS.has(char)) {
    return EXTRA_WIDE_CHAR_WIDTH_FACTOR;
  }

  if (WIDE_CHARACTERS.has(char)) {
    return WIDE_CHAR_WIDTH_FACTOR;
  }

  if (MEDIUM_NARROW_CHARACTERS.has(char)) {
    return MEDIUM_NARROW_CHAR_WIDTH_FACTOR;
  }

  if (NARROW_CHARACTERS.has(char)) {
    return NARROW_CHAR_WIDTH_FACTOR;
  }

  return LABEL_CHAR_WIDTH_FACTOR;
}

function estimateLabelTextWidth(text: string, fontSize: number): number {
  const normalizedText = text || DEFAULT_LABEL_TEXT;
  return Math.ceil(
    [...normalizedText].reduce(
      (total, char) => total + fontSize * getFallbackCharWidthFactor(char),
      0,
    ),
  );
}

function getMeasurementContext():
  | OffscreenCanvasRenderingContext2D
  | CanvasRenderingContext2D
  | null {
  if (measurementContext) {
    return measurementContext;
  }

  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(1, 1);
    measurementContext = canvas.getContext('2d');
    if (measurementContext) {
      return measurementContext;
    }
  }

  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    measurementContext = canvas.getContext('2d');
    if (measurementContext) {
      return measurementContext;
    }
  }

  return null;
}

function measureLabelTextWidth(text: string, fontSize: number): number | null {
  const normalizedText = text || DEFAULT_LABEL_TEXT;
  const cacheKey = `${fontSize}:${normalizedText}`;
  const cachedWidth = measuredWidthCache.get(cacheKey);
  if (cachedWidth !== undefined) {
    return cachedWidth;
  }

  const ctx = getMeasurementContext();
  if (!ctx) {
    return null;
  }

  ctx.font = getLabelFont(fontSize);
  const measuredWidth = ctx.measureText(normalizedText).width;
  if (!Number.isFinite(measuredWidth) || measuredWidth <= 0) {
    return null;
  }

  const roundedWidth = Math.ceil(measuredWidth);
  measuredWidthCache.set(cacheKey, roundedWidth);
  return roundedWidth;
}

export function getLabelTextWidth(
  text: string = DEFAULT_LABEL_TEXT,
  scale: number = 1,
): number {
  const fontSize = Math.round(LABEL_FONT_SIZE * scale);
  return (
    measureLabelTextWidth(text, fontSize) ??
    estimateLabelTextWidth(text, fontSize)
  );
}

export function getLabelDimensions(
  text: string = DEFAULT_LABEL_TEXT,
  elementWidth: number = 0,
  scale: number = 1,
): LabelDimensions {
  void elementWidth;
  const padding = Math.round(LABEL_PADDING * scale);
  const textWidth = getLabelTextWidth(text, scale);
  const minWidth = textWidth + padding * 2;
  const maxWidth = Math.round(MAX_LABEL_WIDTH * scale);

  return {
    width: Math.min(minWidth, maxWidth),
    height: Math.round(LABEL_HEIGHT * scale),
    textWidth,
    fontSize: Math.round(LABEL_FONT_SIZE * scale),
    padding,
  };
}
