## Bug Report: `highlight_elements` with `type='any'` Never Returns Scrollable Elements

**Date:** 2026-03-22
**Component:** `extension/src/commands/highlight-detection.injected.js`
**Severity:** Medium
**Type:** Logic Error / Dead Code

---

### Summary

When calling `highlight_elements(element_type='any')`, scrollable elements are effectively **never returned** due to short-circuit logic in `resolveElementCandidate()`. The scrollable check (lines 948-957) is dead code for `type='any'`.

---

### Root Cause

In `resolveElementCandidate(el, 'any')` (lines 837-973):

```javascript
const clickableCandidate = resolveClickableCandidate(el);  // Traverses UP DOM tree

if (clickableCandidate) {
    return { type: 'clickable', ... };  // ← EARLY RETURN
}

// Lines 924-969 below are NEVER reached when clickableCandidate exists:
if (isInputableCandidate(el))      // dead code
if (isSelectableCandidate(el))     // dead code
if (isScrollableCandidate(el))    // dead code ← SCROLLABLE NEVER RETURNED
if (isHoverableCandidate(el))      // dead code
```

The function short-circuits on the first clickable ancestor found (by traversing UP the DOM tree), making all subsequent type checks dead code for `type='any'`.

---

### Expected Behavior

Per collision-aware pagination design, `type='any'` should return elements across **all types** (clickable, inputable, selectable, scrollable, hoverable), prioritized by `HIGHLIGHT_TYPE_PRIORITY`.

---

### Actual Behavior

`type='any'` effectively becomes `type='clickable'`. Elements are only returned if:
- They themselves are clickable, OR
- Any **ancestor** has clickable characteristics (pointer cursor + text content)

This causes:
- Scrollable divs to be misclassified as "clickable" (their ancestor)
- Hoverable elements to be skipped entirely
- False positives where a non-interactive ancestor shadows the actual target element

---

### Affected Code Paths

- `resolveElementCandidate()` — lines 912-922 (early return on `clickableCandidate`)
- `resolveClickableCandidate()` — lines 632-689 (DOM tree traversal with `isTightClickableWrapper` checks)

---

### Suggested Fix

For `type='any'`, collect candidates across ALL types and use `compareCandidates()` with `HIGHLIGHT_TYPE_PRIORITY` for selection — matching the behavior of the specific-type paths (lines 840-910) rather than short-circuiting.
