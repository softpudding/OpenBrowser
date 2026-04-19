/**
 * Label dimensions for collision detection and visual highlighting.
 */

// Label visuals tuned so the badge is no taller than the page's own body
// text. A bold 11px label + 2px vertical padding renders at 15px — at or
// below the ~12–13px body text on most pages, so labels don't stand out
// more than the element content they annotate.
export const LABEL_FONT_SIZE = 11;
export const LABEL_PADDING = 2;
export const LABEL_HEIGHT = LABEL_FONT_SIZE + LABEL_PADDING * 2; // 15px
export const MAX_LABEL_WIDTH = 80; // Maximum label width for collision detection
export const LABEL_FONT_FAMILY = 'Arial';
