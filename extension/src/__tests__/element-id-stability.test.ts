import { describe, test, expect } from 'bun:test';

import {
  assignHashedElementIds,
  buildElementIdentityKey,
  getStableIdentityInput,
} from '../commands/element-id';
import type { InteractiveElement } from '../types';

// Factory that mimics what highlight-detection.injected.js produces. The
// important field for identity is `fingerprint` — it is built from
// tag + semantic attrs (role, type, name, id, aria-label, title,
// placeholder, data-testid) + text, which do NOT change when the
// element gains focus, when `value` updates per keystroke, or when
// `aria-expanded` flips on a disclosure.
function makeElement(
  overrides: Partial<InteractiveElement>,
): InteractiveElement {
  return {
    id: '',
    type: 'clickable',
    tagName: 'button',
    selector: 'button.search-submit',
    bbox: { x: 0, y: 0, width: 10, height: 10 },
    isVisible: true,
    isInViewport: true,
    fingerprint: 'button | button | search | submit',
    html: '<button class="search-submit">Submit</button>',
    ...overrides,
  };
}

describe('element-id stability across volatile outerHTML mutations', () => {
  test('id stays the same when <input> gains `class="focused"` on click', () => {
    // Before click: real DOM on page.
    const before = makeElement({
      type: 'inputable',
      tagName: 'input',
      selector: 'input#file-filter-input',
      fingerprint: 'input | text | file-filter-input | filter changed files',
      html: '<input id="file-filter-input" type="text" placeholder="Filter changed files">',
    });
    // After click: app adds `class="focused"`. outerHTML changed but the
    // fingerprint is derived from stable semantic attrs only.
    const after = makeElement({
      type: 'inputable',
      tagName: 'input',
      selector: 'input#file-filter-input',
      fingerprint: 'input | text | file-filter-input | filter changed files',
      html: '<input id="file-filter-input" class="focused" type="text" placeholder="Filter changed files">',
    });

    expect(buildElementIdentityKey(before)).toBe(
      buildElementIdentityKey(after),
    );

    const [assignedBefore] = assignHashedElementIds([before]);
    const [assignedAfter] = assignHashedElementIds([after]);
    expect(assignedBefore.id).toBe(assignedAfter.id);
  });

  test('id stays the same when typing into an <input> updates its `value` attr', () => {
    const empty = makeElement({
      type: 'inputable',
      tagName: 'input',
      selector: 'input#search-input',
      fingerprint: 'input | text | search-input | search',
      html: '<input id="search-input" type="text" value="" placeholder="search">',
    });
    const typed = makeElement({
      type: 'inputable',
      tagName: 'input',
      selector: 'input#search-input',
      fingerprint: 'input | text | search-input | search',
      html: '<input id="search-input" type="text" value="arigato" placeholder="search">',
    });

    expect(buildElementIdentityKey(empty)).toBe(buildElementIdentityKey(typed));
    const [e0] = assignHashedElementIds([empty]);
    const [e1] = assignHashedElementIds([typed]);
    expect(e0.id).toBe(e1.id);
  });

  test('id stays the same when <select> flips `aria-expanded`', () => {
    const collapsed = makeElement({
      type: 'selectable',
      tagName: 'select',
      selector: 'select#sort-by',
      fingerprint: 'select | sort-by | sort by',
      html: '<select id="sort-by" aria-expanded="false"><option>A</option></select>',
    });
    const expanded = makeElement({
      type: 'selectable',
      tagName: 'select',
      selector: 'select#sort-by',
      fingerprint: 'select | sort-by | sort by',
      html: '<select id="sort-by" aria-expanded="true"><option>A</option></select>',
    });

    expect(buildElementIdentityKey(collapsed)).toBe(
      buildElementIdentityKey(expanded),
    );
    const [c] = assignHashedElementIds([collapsed]);
    const [e] = assignHashedElementIds([expanded]);
    expect(c.id).toBe(e.id);
  });

  test('id differs when the fingerprint genuinely differs (e.g. another element on the same selector)', () => {
    // Two elements with the same selector string (which can happen with
    // generic selectors like `button.primary`) but different semantics.
    // Identity should distinguish them so neither is mislabeled as the
    // other.
    const submit = makeElement({
      selector: 'button.primary',
      fingerprint: 'button | submit | submit form',
    });
    const reset = makeElement({
      selector: 'button.primary',
      fingerprint: 'button | reset | reset form',
    });

    expect(buildElementIdentityKey(submit)).not.toBe(
      buildElementIdentityKey(reset),
    );
    const [a, b] = assignHashedElementIds([submit, reset]);
    expect(a.id).not.toBe(b.id);
  });

  test('falls back to outerHTML for legacy elements without a fingerprint', () => {
    // Backward compatibility: older producers or tests that populate only
    // `html` must still get a deterministic ID.
    const legacy = makeElement({ fingerprint: undefined });
    expect(getStableIdentityInput(legacy)).toBe(legacy.html);

    const [assigned] = assignHashedElementIds([legacy]);
    expect(assigned.id.length).toBe(3);
  });
});
