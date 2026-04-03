/**
 * Content Script - Runs in web pages
 * Provides viewport information and image resizing utilities
 *
 * Note: Visual mouse pointer has been removed. All browser automation
 * is now done via JavaScript execution (javascript_execute command).
 */

console.log('🖥️ OpenBrowser content script loaded', {
  location: window.location.href,
  readyState: document.readyState,
  timestamp: Date.now(),
});

let activeRecordingId: string | null = null;
let scrollTimeoutId: number | null = null;

function isOpenBrowserUiPage(): boolean {
  if (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') {
    return false;
  }

  return (
    window.location.port === '8765' &&
    (window.location.hostname === '127.0.0.1' ||
      window.location.hostname === 'localhost')
  );
}

function normalizeText(
  value: string | null | undefined,
  maxLength: number = 160,
): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, maxLength);
}

function isElement(target: EventTarget | null): target is Element {
  return target instanceof Element;
}

function buildSelector(element: Element): string {
  if (element.id) {
    return `#${CSS.escape(element.id)}`;
  }

  const parts: string[] = [];
  let current: Element | null = element;
  let depth = 0;

  while (current && depth < 4) {
    let part = current.tagName.toLowerCase();
    if (current.classList.length > 0) {
      const classNames = Array.from(current.classList)
        .slice(0, 2)
        .map((className) => `.${CSS.escape(className)}`)
        .join('');
      part += classNames;
    }

    const parent: Element | null = current.parentElement;
    if (parent) {
      const currentTagName = current.tagName;
      const siblings = Array.from(parent.children).filter(
        (child: Element) => child.tagName === currentTagName,
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        part += `:nth-of-type(${index})`;
      }
    }

    parts.unshift(part);
    current = parent;
    depth += 1;
  }

  return parts.join(' > ');
}

function getParentText(element: Element): string | null {
  let current = element.parentElement;
  let depth = 0;

  while (current && depth < 3) {
    const text = normalizeText(current.textContent, 200);
    if (text && text !== normalizeText(element.textContent, 200)) {
      return text;
    }
    current = current.parentElement;
    depth += 1;
  }

  return null;
}

function isSensitiveInputElement(
  element: HTMLInputElement | HTMLTextAreaElement,
): boolean {
  const inputType =
    element instanceof HTMLInputElement
      ? (element.type || '').toLowerCase()
      : '';
  const identity = [
    element.id,
    element.getAttribute('name'),
    element.getAttribute('autocomplete'),
    element.getAttribute('aria-label'),
    element.getAttribute('placeholder'),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return (
    inputType === 'password' ||
    /password|passcode|otp|token|secret|card|cvv|cvc|security/.test(identity)
  );
}

function serializeElement(element: Element): Record<string, unknown> {
  const rect = element.getBoundingClientRect();
  const htmlElement = element as HTMLElement;
  const payload: Record<string, unknown> = {
    tagName: element.tagName.toLowerCase(),
    selector: buildSelector(element),
    text: normalizeText(element.textContent, 160),
    parentText: getParentText(element),
    id: element.id || null,
    className:
      typeof htmlElement.className === 'string'
        ? normalizeText(htmlElement.className, 120)
        : null,
    role: element.getAttribute('role'),
    ariaLabel: element.getAttribute('aria-label'),
    title: element.getAttribute('title'),
    name: element.getAttribute('name'),
    placeholder: element.getAttribute('placeholder'),
    bbox: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
  };

  if (element instanceof HTMLAnchorElement) {
    payload.href = element.href || null;
  }

  if (element instanceof HTMLInputElement) {
    const sensitive = isSensitiveInputElement(element);
    payload.inputType = element.type || null;
    payload.valueLength = element.value.length;
    payload.value = sensitive ? null : normalizeText(element.value, 200);
    payload.isSensitive = sensitive;
    payload.checked = element.checked;
  }

  if (element instanceof HTMLTextAreaElement) {
    const sensitive = isSensitiveInputElement(element);
    payload.valueLength = element.value.length;
    payload.value = sensitive ? null : normalizeText(element.value, 200);
    payload.isSensitive = sensitive;
  }

  if (element instanceof HTMLSelectElement) {
    payload.value = element.value || null;
    payload.selectedText =
      element.options[element.selectedIndex]?.textContent?.trim() || null;
  }

  return payload;
}

function sendRecordingEvent(
  eventType: string,
  data: Record<string, unknown> = {},
): void {
  if (!activeRecordingId || isOpenBrowserUiPage()) {
    return;
  }

  void chrome.runtime
    .sendMessage({
      type: 'openbrowser:recording-event',
      event: {
        type: eventType,
        timestamp: Date.now(),
        data: {
          recordingId: activeRecordingId,
          page: {
            url: window.location.href,
            title: document.title,
          },
          ...data,
        },
      },
    })
    .catch((error) => {
      console.debug('Recorder event send failed:', error);
    });
}

function emitPageView(reason: string): void {
  sendRecordingEvent('page_view', {
    reason,
    url: window.location.href,
    title: document.title,
    readyState: document.readyState,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
    },
    scroll: {
      x: window.scrollX,
      y: window.scrollY,
    },
  });
}

function shouldRecordTrustedEvent(event: Event): boolean {
  return activeRecordingId !== null && event.isTrusted && !isOpenBrowserUiPage();
}

function installRecordingListeners(): void {
  document.addEventListener(
    'click',
    (event) => {
      if (!shouldRecordTrustedEvent(event) || !isElement(event.target)) {
        return;
      }

      const mouseEvent = event as MouseEvent;
      sendRecordingEvent('click', {
        element: serializeElement(event.target),
        clientX: mouseEvent.clientX,
        clientY: mouseEvent.clientY,
      });
    },
    true,
  );

  document.addEventListener(
    'input',
    (event) => {
      if (!shouldRecordTrustedEvent(event) || !isElement(event.target)) {
        return;
      }

      if (
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement)
      ) {
        return;
      }

      sendRecordingEvent('input', {
        element: serializeElement(event.target),
      });
    },
    true,
  );

  document.addEventListener(
    'change',
    (event) => {
      if (!shouldRecordTrustedEvent(event) || !isElement(event.target)) {
        return;
      }

      sendRecordingEvent('change', {
        element: serializeElement(event.target),
      });
    },
    true,
  );

  document.addEventListener(
    'submit',
    (event) => {
      if (!shouldRecordTrustedEvent(event)) {
        return;
      }

      const form =
        event.target instanceof HTMLFormElement ? event.target : null;
      sendRecordingEvent('submit', {
        form: form ? serializeElement(form) : null,
      });
    },
    true,
  );

  document.addEventListener(
    'focusin',
    (event) => {
      if (!shouldRecordTrustedEvent(event) || !isElement(event.target)) {
        return;
      }

      sendRecordingEvent('focus', {
        element: serializeElement(event.target),
      });
    },
    true,
  );

  document.addEventListener(
    'keydown',
    (event) => {
      if (!shouldRecordTrustedEvent(event) || !isElement(event.target)) {
        return;
      }

      const keyboardEvent = event as KeyboardEvent;
      if (keyboardEvent.key !== 'Enter' && keyboardEvent.key !== 'Tab') {
        return;
      }

      sendRecordingEvent('keydown', {
        key: keyboardEvent.key,
        code: keyboardEvent.code,
        element: serializeElement(event.target),
      });
    },
    true,
  );

  window.addEventListener(
    'scroll',
    () => {
      if (!activeRecordingId) {
        return;
      }

      if (scrollTimeoutId !== null) {
        clearTimeout(scrollTimeoutId);
      }

      scrollTimeoutId = window.setTimeout(() => {
        sendRecordingEvent('scroll', {
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          maxScrollX:
            document.documentElement.scrollWidth - window.innerWidth,
          maxScrollY:
            document.documentElement.scrollHeight - window.innerHeight,
        });
      }, 120);
    },
    {
      passive: true,
    },
  );

  window.addEventListener('popstate', () => {
    if (activeRecordingId) {
      emitPageView('popstate');
    }
  });

  window.addEventListener('hashchange', () => {
    if (activeRecordingId) {
      emitPageView('hashchange');
    }
  });
}

function syncRecordingStateFromBackground(): void {
  void chrome.runtime
    .sendMessage({ type: 'openbrowser:get-recording-state' })
    .then((response) => {
      if (response?.active && typeof response.recording_id === 'string') {
        activeRecordingId = response.recording_id;
        emitPageView('resume');
      }
    })
    .catch(() => {
      // Background may not be ready yet. Ignore.
    });
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('Content script received message:', message);

  // Handle different message types
  switch (message.type) {
    case 'openbrowser:start-recording':
      activeRecordingId =
        typeof message.recording_id === 'string' ? message.recording_id : null;
      emitPageView('start-recording');
      sendResponse({
        success: true,
        recordingId: activeRecordingId,
      });
      break;

    case 'openbrowser:stop-recording':
      activeRecordingId = null;
      sendResponse({ success: true });
      break;

    case 'ping':
      sendResponse({ pong: true, timestamp: Date.now() });
      break;

    case 'get_viewport':
      // Return viewport information
      const viewportInfo = {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      };
      sendResponse({
        success: true,
        data: viewportInfo,
      });
      break;

    case 'get_device_pixel_ratio':
      sendResponse({
        success: true,
        devicePixelRatio: window.devicePixelRatio || 1,
      });
      break;

    case 'resize_image':
      // Resize image to simulated coordinate system dimensions (1280x720)
      try {
        const {
          dataUrl,
          targetWidth = 1280,
          targetHeight = 720,
        } = message.data;
        console.log(`🖼️ Resizing image to ${targetWidth}×${targetHeight}...`);

        resizeImage(dataUrl, targetWidth, targetHeight)
          .then((resizedDataUrl) => {
            sendResponse({
              success: true,
              resizedDataUrl,
              originalSize: dataUrl.length,
              resizedSize: resizedDataUrl.length,
            });
          })
          .catch((error) => {
            sendResponse({
              success: false,
              error: error.message,
            });
          });

        return true; // Keep channel open for async response
      } catch (error) {
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
      break;

    default:
      console.log('Unknown message type:', message.type);
      sendResponse({ error: 'Unknown message type' });
  }

  return true; // Keep message channel open for async response
});

// Expose utility functions to background script
(window as any).chromeControl = {
  getViewport: () => ({
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  }),
};

/**
 * Resize image to target dimensions using Canvas API
 * @param dataUrl Original image data URL
 * @param targetWidth Target width in pixels
 * @param targetHeight Target height in pixels
 * @returns Resized image data URL
 */
async function resizeImage(
  dataUrl: string,
  targetWidth: number,
  targetHeight: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        console.log(`🖼️ Original image dimensions: ${img.width}x${img.height}`);
        console.log(`🖼️ Target dimensions: ${targetWidth}x${targetHeight}`);

        // Calculate scaling ratio to fit within target dimensions while maintaining aspect ratio
        const scale = Math.min(
          targetWidth / img.width,
          targetHeight / img.height,
        );

        // Calculate new dimensions
        const newWidth = Math.floor(img.width * scale);
        const newHeight = Math.floor(img.height * scale);

        // Calculate centering offset
        const offsetX = Math.floor((targetWidth - newWidth) / 2);
        const offsetY = Math.floor((targetHeight - newHeight) / 2);

        console.log(
          `🖼️ Scaling factor: ${scale}, new dimensions: ${newWidth}x${newHeight}, offset: (${offsetX}, ${offsetY})`,
        );

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        // Fill background with white (optional, for debugging)
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, targetWidth, targetHeight);

        // Draw image to canvas with scaling and centering
        ctx.drawImage(
          img,
          0,
          0,
          img.width,
          img.height,
          offsetX,
          offsetY,
          newWidth,
          newHeight,
        );

        // Convert to data URL (PNG format for lossless quality)
        const resizedDataUrl = canvas.toDataURL('image/png');
        console.log(
          `🖼️ Image resized successfully, data URL length: ${resizedDataUrl.length}`,
        );
        resolve(resizedDataUrl);
      } catch (error) {
        console.error('❌ Error in resizeImage:', error);
        reject(error);
      }
    };
    img.onerror = () => {
      console.error('❌ Failed to load image for resizing');
      reject(new Error('Failed to load image'));
    };
    img.src = dataUrl;
  });
}

console.log('✅ Content script initialized (JavaScript-only automation mode)');
installRecordingListeners();
syncRecordingStateFromBackground();
