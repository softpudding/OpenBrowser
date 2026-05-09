/**
 * Pixel-Confirmation Render Module
 *
 * Produces a confirmation screenshot for a pending pixel mouse action
 * (click or drag) at the page's original viewport size, so the agent's
 * coordinate system matches what it sees in every other screenshot. Two
 * visual modes:
 *
 *   - 'pixel_hit'  → YELLOW box around the hit element.
 *   - 'pixel_miss' → orange dashed outlines on nearby candidate elements;
 *                    no crosshair (the candidates already tell the agent
 *                    where to re-aim).
 *
 * Both modes capture a fresh viewport screenshot (no virtual cursor) and
 * return a base64 PNG data URL keyed under `screenshot_data_url` to match
 * the shape used by other 2PC previews.
 */

import { captureScreenshot, compressIfNeeded } from './screenshot';
import { executeJavaScript } from './javascript';

const PIXEL_OVERLAY_ID = '__ob_pixel_confirm_overlay__';
const OVERLAY_INJECTION_TIMEOUT_MS = 5000;

const HIT_BORDER_COLOR = '#FFD400';
const HIT_GLOW_COLOR = 'rgba(255, 212, 0, 0.7)';
const HIT_LINE_WIDTH = 4;
const HIT_BOX_PADDING = 2;

const CANDIDATE_BORDER_COLOR = '#FF6B00';
const CANDIDATE_GLOW_COLOR = 'rgba(255, 107, 0, 0.55)';
const CANDIDATE_LINE_WIDTH = 3;

const DRAG_LINE_COLOR = 'rgba(255, 212, 0, 0.85)';
const DRAG_LINE_WIDTH = 3;
const DRAG_ARROW_HEAD = 14;

interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PointXY {
  x: number;
  y: number;
}

export interface PixelConfirmRenderRequest {
  mode: 'pixel_hit' | 'pixel_miss';
  x: number; // CSS px
  y: number; // CSS px
  target_bbox?: BBox; // CSS px (required for pixel_hit)
  candidate_bboxes?: BBox[]; // CSS px
  target_selector?: string; // CSS selector for the hit element (DOM overlay)
  candidate_selectors?: string[]; // CSS selectors for candidates (DOM overlay)
  banner_kind?: 'click' | 'drag'; // banner phrasing for the in-page prompt
  drag_end?: PointXY; // CSS px (optional second point for drag previews)
}

export interface PixelConfirmRenderResult {
  screenshot_data_url: string;
  viewport: { width: number; height: number };
  scale: number;
}

function expandBbox(b: BBox, padding: number): BBox {
  return {
    x: b.x - padding,
    y: b.y - padding,
    width: b.width + padding * 2,
    height: b.height + padding * 2,
  };
}

function drawCandidateOutline(
  ctx: OffscreenCanvasRenderingContext2D,
  rect: BBox,
  scale: number,
): void {
  ctx.save();
  ctx.strokeStyle = CANDIDATE_BORDER_COLOR;
  ctx.lineWidth = CANDIDATE_LINE_WIDTH * scale;
  ctx.shadowColor = CANDIDATE_GLOW_COLOR;
  ctx.shadowBlur = 8 * scale;
  ctx.setLineDash([6 * scale, 4 * scale]);
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
}

function drawHitBox(
  ctx: OffscreenCanvasRenderingContext2D,
  rect: BBox,
  scale: number,
): void {
  ctx.save();
  ctx.strokeStyle = HIT_BORDER_COLOR;
  ctx.lineWidth = HIT_LINE_WIDTH * scale;
  ctx.shadowColor = HIT_GLOW_COLOR;
  ctx.shadowBlur = 12 * scale;
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
}

function drawDragArrow(
  ctx: OffscreenCanvasRenderingContext2D,
  start: PointXY,
  end: PointXY,
  scale: number,
): void {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const ux = dx / len;
  const uy = dy / len;
  const head = DRAG_ARROW_HEAD * scale;

  ctx.save();
  ctx.strokeStyle = DRAG_LINE_COLOR;
  ctx.fillStyle = DRAG_LINE_COLOR;
  ctx.lineWidth = DRAG_LINE_WIDTH * scale;
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();

  // Arrowhead.
  const baseX = end.x - ux * head;
  const baseY = end.y - uy * head;
  const perpX = -uy;
  const perpY = ux;
  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(baseX + perpX * head * 0.5, baseY + perpY * head * 0.5);
  ctx.lineTo(baseX - perpX * head * 0.5, baseY - perpY * head * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function buildPixelOverlayScript(request: PixelConfirmRenderRequest): string {
  // No banner div — a floating banner overlaps neighboring candidates
  // (which are exactly the alternatives the agent might want to re-aim
  // at). The yellow + orange outlines are enough; the verification
  // language lives in the system / tool prompts.
  const payload = {
    overlayId: PIXEL_OVERLAY_ID,
    targetSelector: request.target_selector || null,
    targetBbox: request.target_bbox || null,
    candidateSelectors: request.candidate_selectors || [],
    candidateBboxes: request.candidate_bboxes || [],
    drag: request.drag_end
      ? { from: { x: request.x, y: request.y }, to: request.drag_end }
      : null,
  };

  return `
    (() => {
      const cfg = ${JSON.stringify(payload)};
      const OVERLAY_ID = cfg.overlayId;

      // Wipe any previous overlay container — every box we draw lives
      // inside it, so removing the container is the entire cleanup.
      const prev = document.getElementById(OVERLAY_ID);
      if (prev) prev.remove();

      const overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      overlay.style.cssText =
        'position:absolute;top:0;left:0;pointer-events:none;z-index:2147483647;';
      document.documentElement.appendChild(overlay);

      const sx = window.scrollX || window.pageXOffset || 0;
      const sy = window.scrollY || window.pageYOffset || 0;

      const resolveBbox = (selector, fallbackBbox) => {
        if (selector) {
          try {
            const el = document.querySelector(selector);
            if (el) {
              const rect = el.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                return {
                  x: rect.left,
                  y: rect.top,
                  width: rect.width,
                  height: rect.height,
                };
              }
            }
          } catch (_) {}
        }
        return fallbackBbox || null;
      };

      const drawBox = (bbox, color, dashed, role) => {
        if (!bbox || bbox.width <= 0 || bbox.height <= 0) return;
        const div = document.createElement('div');
        const borderWidth = dashed ? 2 : 3;
        div.setAttribute('data-ob-role', role);
        div.style.cssText =
          'position:absolute;pointer-events:none;box-sizing:border-box;'
          + 'left:' + (bbox.x + sx - borderWidth) + 'px;'
          + 'top:' + (bbox.y + sy - borderWidth) + 'px;'
          + 'width:' + (bbox.width + borderWidth * 2) + 'px;'
          + 'height:' + (bbox.height + borderWidth * 2) + 'px;'
          + 'border:' + borderWidth + 'px '
          + (dashed ? 'dashed' : 'solid') + ' ' + color + ';'
          + 'border-radius:3px;'
          + 'background:transparent;';
        overlay.appendChild(div);
      };

      // Candidates first so the hit box paints on top.
      const candidateColor = '#FF6B00';
      for (let i = 0; i < cfg.candidateSelectors.length; i++) {
        const bbox = resolveBbox(
          cfg.candidateSelectors[i],
          cfg.candidateBboxes[i],
        );
        drawBox(bbox, candidateColor, true, 'candidate');
      }

      const hitColor = '#FFD400';
      const hitBbox = resolveBbox(cfg.targetSelector, cfg.targetBbox);
      if (hitBbox) drawBox(hitBbox, hitColor, false, 'hit');

      if (cfg.drag && cfg.drag.from && cfg.drag.to) {
        // Simple line + arrowhead between the two endpoints.
        const arrow = document.createElement('div');
        const dx = cfg.drag.to.x - cfg.drag.from.x;
        const dy = cfg.drag.to.y - cfg.drag.from.y;
        const len = Math.hypot(dx, dy);
        const angle = Math.atan2(dy, dx);
        arrow.style.cssText =
          'position:absolute;pointer-events:none;'
          + 'left:' + (cfg.drag.from.x + sx) + 'px;'
          + 'top:' + (cfg.drag.from.y + sy - 1) + 'px;'
          + 'width:' + Math.max(1, len) + 'px;'
          + 'height:3px;'
          + 'background:rgba(255,212,0,0.9);'
          + 'transform-origin:0 50%;'
          + 'transform:rotate(' + angle + 'rad);';
        overlay.appendChild(arrow);
      }

      return { overlay: true };
    })();
  `;
}

function buildPixelOverlayCleanupScript(): string {
  return `
    (() => {
      const OVERLAY_ID = ${JSON.stringify(PIXEL_OVERLAY_ID)};
      const prev = document.getElementById(OVERLAY_ID);
      if (prev) prev.remove();
      return { cleared: true };
    })();
  `;
}

export async function clearPixelConfirmOverlay(
  tabId: number,
  conversationId: string,
): Promise<void> {
  try {
    await executeJavaScript(
      tabId,
      conversationId,
      buildPixelOverlayCleanupScript(),
      true,
      true,
      OVERLAY_INJECTION_TIMEOUT_MS,
    );
  } catch (e) {
    console.warn('[PixelConfirmRender] cleanup failed', e);
  }
}

export async function renderPixelConfirm(
  tabId: number,
  conversationId: string,
  request: PixelConfirmRenderRequest,
): Promise<PixelConfirmRenderResult> {
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('[PixelConfirmRender] OffscreenCanvas is not available');
  }
  if (typeof createImageBitmap === 'undefined') {
    throw new Error('[PixelConfirmRender] createImageBitmap is not available');
  }

  // Inject the same yellow / orange overlay onto the live page DOM so a
  // human watching the browser sees what the agent sees. The screenshot
  // captured below picks up these overlays naturally; canvas-side
  // drawing further down is a fail-safe in case injection is blocked.
  if (
    request.target_selector ||
    (request.candidate_selectors && request.candidate_selectors.length > 0) ||
    request.banner_kind
  ) {
    try {
      await executeJavaScript(
        tabId,
        conversationId,
        buildPixelOverlayScript(request),
        true,
        true,
        OVERLAY_INJECTION_TIMEOUT_MS,
      );
    } catch (e) {
      console.warn('[PixelConfirmRender] DOM overlay injection failed', e);
    }
  }

  // Capture a clean shot — no cursor (we draw our own crosshair / box).
  const shot = await captureScreenshot(
    tabId,
    conversationId,
    /* includeCursor */ false,
    /* quality */ 90,
    /* resizeToPreset */ false,
    /* waitForRender */ 0,
    /* options */ undefined,
    /* preCaptureScript */ undefined,
  );
  const screenshotDataUrl: string | undefined = shot?.imageData;
  if (!screenshotDataUrl || !screenshotDataUrl.startsWith('data:')) {
    throw new Error(
      '[PixelConfirmRender] captureScreenshot returned no data URL',
    );
  }
  const viewportWidth: number =
    typeof shot?.metadata?.viewportWidth === 'number'
      ? shot.metadata.viewportWidth
      : 0;
  const viewportHeight: number =
    typeof shot?.metadata?.viewportHeight === 'number'
      ? shot.metadata.viewportHeight
      : 0;

  const [, base64] = screenshotDataUrl.split(',');
  const header = screenshotDataUrl.slice(0, screenshotDataUrl.indexOf(','));
  const mimeType = header.substring(
    header.indexOf(':') + 1,
    header.indexOf(';'),
  );
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType }));

  const actualScaleX = viewportWidth > 0 ? bitmap.width / viewportWidth : 1;
  const actualScaleY = viewportHeight > 0 ? bitmap.height / viewportHeight : 1;
  const scale = (actualScaleX + actualScaleY) / 2 || 1;

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('[PixelConfirmRender] Failed to acquire 2d context');
  }

  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const toDeviceRect = (b: BBox): BBox => ({
    x: Math.round(b.x * scale),
    y: Math.round(b.y * scale),
    width: Math.max(1, Math.round(b.width * scale)),
    height: Math.max(1, Math.round(b.height * scale)),
  });

  const toDevicePoint = (p: PointXY): PointXY => ({
    x: Math.round(p.x * scale),
    y: Math.round(p.y * scale),
  });

  // Candidate outlines first (so the hit box / crosshair sits on top).
  if (request.candidate_bboxes && request.candidate_bboxes.length > 0) {
    for (const bbox of request.candidate_bboxes) {
      drawCandidateOutline(ctx, toDeviceRect(bbox), scale);
    }
  }

  // Hit case: draw a yellow box around the element the click would
  // commit to. Miss case: draw nothing for the click point — the orange
  // candidate outlines plus the message body tell the agent everything
  // it needs to re-aim, without a distracting crosshair on top of the
  // page content.
  if (request.mode === 'pixel_hit' && request.target_bbox) {
    const padded = expandBbox(request.target_bbox, HIT_BOX_PADDING / scale);
    drawHitBox(ctx, toDeviceRect(padded), scale);
  }

  if (request.drag_end) {
    const start = toDevicePoint({ x: request.x, y: request.y });
    const end = toDevicePoint(request.drag_end);
    drawDragArrow(ctx, start, end, scale);
  }

  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () =>
      reject(new Error('[PixelConfirmRender] Failed to read result blob'));
    reader.readAsDataURL(blob);
  });

  const compressedRaw = await compressIfNeeded(dataUrl).catch(() => dataUrl);
  const compressed =
    typeof compressedRaw === 'string'
      ? compressedRaw
      : compressedRaw &&
          typeof compressedRaw === 'object' &&
          'imageData' in compressedRaw &&
          typeof compressedRaw.imageData === 'string'
        ? compressedRaw.imageData
        : dataUrl;

  return {
    screenshot_data_url: compressed,
    viewport: { width: viewportWidth, height: viewportHeight },
    scale,
  };
}
