/* eslint-disable */
// Plain-JS helper that runs inside the page world to produce a compact,
// structured descriptor of an interactive element. Inlined into both the
// highlight detection script and the drag-and-drop inner-element probe.

/* global Node */

function openbrowserCollapseWhitespace(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

function openbrowserTruncate(value, limit) {
  if (typeof value !== 'string') return undefined;
  const collapsed = openbrowserCollapseWhitespace(value);
  if (!collapsed) return undefined;
  if (collapsed.length <= limit) return collapsed;
  return collapsed.slice(0, limit - 1) + '…';
}

function openbrowserVisibleText(element) {
  if (!element) return undefined;
  // Prefer accessible name sources for empty-text controls later; here just
  // pull visible text content from the subtree.
  const raw = element.textContent || '';
  return openbrowserTruncate(raw, 120);
}

function openbrowserAccessibleName(element) {
  if (!element) return undefined;
  const ariaLabel = element.getAttribute && element.getAttribute('aria-label');
  if (ariaLabel) return openbrowserTruncate(ariaLabel, 120);
  const labelledBy =
    element.getAttribute && element.getAttribute('aria-labelledby');
  if (labelledBy) {
    try {
      const ids = labelledBy.split(/\s+/).filter(Boolean);
      const parts = [];
      for (const id of ids) {
        const ref = element.ownerDocument.getElementById(id);
        if (ref && ref.textContent) parts.push(ref.textContent);
      }
      const joined = parts.join(' ');
      if (joined) return openbrowserTruncate(joined, 120);
    } catch (_err) {
      /* ignore */
    }
  }
  const title = element.getAttribute && element.getAttribute('title');
  if (title) return openbrowserTruncate(title, 120);
  const alt = element.getAttribute && element.getAttribute('alt');
  if (alt) return openbrowserTruncate(alt, 120);
  return undefined;
}

function openbrowserExplicitRole(element) {
  if (!element || !element.getAttribute) return undefined;
  const role = element.getAttribute('role');
  if (!role) return undefined;
  const tag = element.tagName ? element.tagName.toLowerCase() : '';
  // Hide role when it's already redundant with the tag (e.g. <button role=button>)
  if (
    (tag === 'button' && role === 'button') ||
    (tag === 'a' && role === 'link') ||
    (tag === 'select' && role === 'listbox')
  ) {
    return undefined;
  }
  return role.trim() || undefined;
}

function openbrowserShortenHref(href) {
  if (typeof href !== 'string') return undefined;
  const trimmed = href.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= 120) return trimmed;
  // Try to collapse query strings while keeping path.
  try {
    const url = new URL(
      trimmed,
      (typeof location !== 'undefined' && location.href) ||
        'http://localhost/',
    );
    const base = (url.origin || '') + url.pathname;
    if (url.search) {
      return openbrowserTruncate(base + '?…', 120);
    }
    return openbrowserTruncate(base, 120);
  } catch (_err) {
    return trimmed.slice(0, 119) + '…';
  }
}

function openbrowserClosestLabel(element) {
  if (!element || !element.closest) return undefined;
  try {
    // A wrapping <label>'s text (e.g. `<label>Name <input/></label>`).
    const label = element.closest('label');
    if (label) {
      const clone = label.cloneNode(true);
      // Remove nested form controls so we capture just the label text.
      const controls = clone.querySelectorAll('input, select, textarea');
      controls.forEach((node) => node.remove());
      const text = openbrowserTruncate(clone.textContent || '', 120);
      if (text) return text;
    }
    const id = element.id;
    if (id) {
      const external = element.ownerDocument.querySelector(
        'label[for="' + (window.CSS ? CSS.escape(id) : id) + '"]',
      );
      if (external) {
        const text = openbrowserTruncate(external.textContent || '', 120);
        if (text) return text;
      }
    }
  } catch (_err) {
    /* ignore */
  }
  return undefined;
}

const OPENBROWSER_GENERIC_CLASS_TOKENS = new Set([
  'wrapper',
  'container',
  'inner',
  'outer',
  'content',
  'body',
  'row',
  'col',
  'column',
  'btn',
  'button',
  'item',
  'block',
  'box',
  'flex',
  'grid',
  'hidden',
  'visible',
  'left',
  'right',
  'center',
  'top',
  'bottom',
  'main',
  'panel',
  'section',
  'header',
  'footer',
  'nav',
  'card',
  'group',
  'svg',
  'icon',
  'image',
  'img',
  'text',
  'label',
  'list',
]);

function openbrowserIsNoiseClassToken(token) {
  if (!token) return true;
  if (token.length <= 1 || token.length > 40) return true;
  // Vue scope hashes like data-v-abc123.
  if (/^data-/.test(token)) return true;
  // Framework utility patterns: pure digits, single-letter prefixes, Tailwind-y.
  if (/^[a-z]+-\d+$/.test(token)) return true;
  if (/^[0-9]+$/.test(token)) return true;
  // Emotion/styled-component generated hashes.
  if (/^(css|sc|emotion)-[a-z0-9]{4,}$/i.test(token)) return true;
  // Long opaque hash-looking tokens (no dashes, no obvious word shape).
  if (token.length >= 8 && !token.includes('-') && !/[aeiou]/i.test(token))
    return true;
  return false;
}

function openbrowserCollectClassTokens(element) {
  if (!element || !element.classList) return [];
  const out = [];
  const seen = new Set();
  const addFrom = (node) => {
    if (!node || !node.classList) return;
    for (const raw of node.classList) {
      const token = (raw || '').trim();
      if (!token) continue;
      if (seen.has(token)) continue;
      if (openbrowserIsNoiseClassToken(token)) continue;
      const isCompound = token.includes('-');
      const isGeneric = OPENBROWSER_GENERIC_CLASS_TOKENS.has(token);
      // Generic tokens only count when compound (e.g. `search-icon` keeps `icon`).
      if (isGeneric && !isCompound) continue;
      seen.add(token);
      out.push(token);
      if (out.length >= 3) return;
    }
  };
  addFrom(element);
  if (out.length < 3) {
    const child = element.firstElementChild;
    if (child) addFrom(child);
  }
  return out;
}

function openbrowserIconHint(element) {
  if (!element || !element.querySelector) return undefined;
  try {
    const use = element.querySelector('use');
    if (use) {
      const href =
        use.getAttribute('xlink:href') ||
        use.getAttribute('href') ||
        '';
      const trimmed = href.trim();
      if (trimmed) {
        return openbrowserTruncate(trimmed.replace(/^#/, ''), 40);
      }
    }
    const img = element.querySelector('img[alt], [aria-label]');
    if (img) {
      const alt =
        (img.getAttribute && img.getAttribute('alt')) ||
        (img.getAttribute && img.getAttribute('aria-label')) ||
        '';
      const cleaned = openbrowserTruncate(alt, 40);
      if (cleaned) return cleaned;
    }
  } catch (_err) {
    /* ignore */
  }
  return undefined;
}

function openbrowserPrecedingHeading(element) {
  if (!element || !element.ownerDocument) return undefined;
  try {
    const root = element.ownerDocument.body || element.ownerDocument;
    const headings = root.querySelectorAll('h1,h2,h3,h4,h5,h6');
    const elementRect = element.getBoundingClientRect();
    let best;
    let bestDelta = Infinity;
    for (const heading of headings) {
      const rect = heading.getBoundingClientRect();
      if (rect.bottom > elementRect.top) continue; // must precede visually
      const delta = elementRect.top - rect.bottom;
      if (delta >= 0 && delta < bestDelta && delta < 240) {
        bestDelta = delta;
        best = heading;
      }
    }
    if (best) return openbrowserTruncate(best.textContent || '', 80);
  } catch (_err) {
    /* ignore */
  }
  return undefined;
}

function openbrowserCollectOptions(selectEl) {
  if (!selectEl || !selectEl.tagName || selectEl.tagName.toLowerCase() !== 'select')
    return undefined;
  const options = [];
  try {
    const optionNodes = selectEl.querySelectorAll('option');
    optionNodes.forEach((opt) => {
      const entry = {
        value: typeof opt.value === 'string' ? opt.value : '',
        label: openbrowserCollapseWhitespace(
          opt.label || opt.textContent || '',
        ),
      };
      if (opt.selected) entry.selected = true;
      if (opt.disabled) entry.disabled = true;
      const parent = opt.parentElement;
      if (parent && parent.tagName && parent.tagName.toLowerCase() === 'optgroup') {
        const groupLabel = parent.getAttribute('label');
        if (groupLabel) entry.group = openbrowserCollapseWhitespace(groupLabel);
      }
      options.push(entry);
    });
  } catch (_err) {
    /* ignore */
  }
  return options;
}

function openbrowserBuildElementDescriptor(element) {
  if (!element || element.nodeType !== 1) {
    return { tag: 'unknown' };
  }
  const tagName = element.tagName ? element.tagName.toLowerCase() : 'unknown';
  const descriptor = { tag: tagName };

  const role = openbrowserExplicitRole(element);
  if (role) descriptor.role = role;

  const text = openbrowserVisibleText(element);
  const name = openbrowserAccessibleName(element);

  if (text) descriptor.text = text;
  if (name && name !== text) descriptor.name = name;

  // Fall back to surrounding context and class/icon signals only when the
  // element has no text or accessible name. These extra hints balloon the
  // line for verbose-CSS pages when applied unconditionally, so gate them.
  if (!text && !name) {
    const label = openbrowserClosestLabel(element);
    if (label) {
      descriptor.context = label;
    } else {
      const heading = openbrowserPrecedingHeading(element);
      if (heading) descriptor.context = heading;
    }
    const classTokens = openbrowserCollectClassTokens(element);
    if (classTokens.length > 0) descriptor.classHint = classTokens;
    const icon = openbrowserIconHint(element);
    if (icon) descriptor.icon = icon;
  }

  const getAttr = (name) =>
    element.getAttribute ? element.getAttribute(name) : null;

  if (tagName === 'input') {
    const inputType = (getAttr('type') || 'text').toLowerCase();
    descriptor.inputType = inputType;
    const placeholder = getAttr('placeholder');
    if (placeholder) descriptor.placeholder = openbrowserTruncate(placeholder, 80);
    if (inputType === 'checkbox' || inputType === 'radio') {
      descriptor.checked = Boolean(element.checked);
    } else if (inputType === 'password') {
      const raw = typeof element.value === 'string' ? element.value : '';
      if (raw) descriptor.value = '•••';
    } else if (inputType !== 'file') {
      const raw = typeof element.value === 'string' ? element.value : '';
      const truncated = openbrowserTruncate(raw, 80);
      if (truncated) descriptor.value = truncated;
    }
  } else if (tagName === 'textarea') {
    const placeholder = getAttr('placeholder');
    if (placeholder) descriptor.placeholder = openbrowserTruncate(placeholder, 80);
    const raw = typeof element.value === 'string' ? element.value : '';
    const truncated = openbrowserTruncate(raw, 120);
    if (truncated) descriptor.value = truncated;
  } else if (tagName === 'select') {
    const isMultiple = Boolean(element.multiple);
    if (isMultiple) descriptor.multiple = true;
    const options = openbrowserCollectOptions(element);
    if (options && options.length > 0) descriptor.options = options;
    if (isMultiple) {
      const values = [];
      for (const opt of element.selectedOptions || []) {
        if (typeof opt.value === 'string') values.push(opt.value);
      }
      if (values.length) descriptor.value = values.join(',');
    } else if (typeof element.value === 'string' && element.value.length > 0) {
      descriptor.value = openbrowserTruncate(element.value, 80);
    }
  } else if (tagName === 'a') {
    const href = getAttr('href');
    const shortened = openbrowserShortenHref(href);
    if (shortened) descriptor.href = shortened;
  } else if (tagName === 'button') {
    const buttonType = getAttr('type');
    if (buttonType) descriptor.inputType = buttonType.toLowerCase();
  }

  const nameAttr = getAttr('name');
  if (nameAttr && !descriptor.name) {
    // Only expose `name` attribute for form controls where it's semantic.
    if (
      tagName === 'input' ||
      tagName === 'select' ||
      tagName === 'textarea' ||
      tagName === 'button'
    ) {
      descriptor.name = openbrowserTruncate(nameAttr, 80);
    }
  }

  if (
    element.disabled === true ||
    getAttr('aria-disabled') === 'true' ||
    (getAttr('disabled') !== null && getAttr('disabled') !== 'false')
  ) {
    descriptor.disabled = true;
  }
  const expanded = getAttr('aria-expanded');
  if (expanded === 'true') descriptor.expanded = true;
  else if (expanded === 'false') descriptor.expanded = false;
  const selectedAttr = getAttr('aria-selected');
  if (selectedAttr === 'true') descriptor.selected = true;

  return descriptor;
}

// Legacy page-world globals so the inlined script can reach the helpers
// from both highlight detection and drop detection.
if (typeof window !== 'undefined') {
  window.__openbrowserBuildElementDescriptor = openbrowserBuildElementDescriptor;
}

// Also expose via globalThis so the helper is reachable from unit tests that
// load this file directly (Bun test / Node) without a DOM.
if (typeof globalThis !== 'undefined') {
  globalThis.__openbrowserBuildElementDescriptor =
    openbrowserBuildElementDescriptor;
}

// CommonJS export for test files that `require` / import this module.
// eslint-disable-next-line no-undef
if (typeof module !== 'undefined' && module.exports) {
  // eslint-disable-next-line no-undef
  module.exports = {
    buildElementDescriptor: openbrowserBuildElementDescriptor,
  };
}
