import {
  LABEL_FONT_SIZE,
  LABEL_HEIGHT,
  LABEL_PADDING,
  MAX_LABEL_WIDTH,
} from '../commands/label-constants';

const DEFAULT_LABEL_TEXT = 'xxxxxx';
const LABEL_CHAR_WIDTH_FACTOR = 0.62;

export interface LabelDimensions {
  width: number;
  height: number;
  textWidth: number;
  fontSize: number;
  padding: number;
}

export function getLabelTextWidth(
  text: string = DEFAULT_LABEL_TEXT,
  scale: number = 1,
): number {
  const fontSize = Math.round(LABEL_FONT_SIZE * scale);
  return Math.ceil(text.length * fontSize * LABEL_CHAR_WIDTH_FACTOR);
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
