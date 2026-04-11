# eval/ — Agent Notes

Implementation knowledge for the mock sites under `eval/`. Repo-wide conventions live in `../AGENTS.md`. Read **both** before editing sites or test cases.

## Source of truth

- **`SPEC_NEW_SITES.md`** is the design brief that generated the four post-2026-03 sites: `mapquest/`, `staybnb/`, `taskflow/`, `vidhub/`. When regenerating or extending a site, re-read the relevant section there instead of reverse-engineering from the rendered HTML. The spec pins the **intended behaviours**; the HTML only reflects what actually shipped.
- Test-case YAMLs in `dataset/` are the second source of truth — a site change that breaks a criterion's expected event shape is a site bug, not a criterion bug, unless the spec disagrees.

## Tracker contract

- Every site uses the shared `eval/js/tracker.js` — `window.tracker = new AgentTracker('<site>', '<difficulty>')`. Do not create site-local trackers.
- Emitted event values must match YAML criteria **exactly**, including case. Normalize at the emit site, not in the criterion. Concrete case: StayBnB amenity checkboxes render "Wifi"/"Kitchen" but `staybnb_book.yaml` expects `amenity: "wifi"`. The fix is `.toLowerCase()` in the tracker call, not capitalizing the YAML.
- When instruction text references a button label, the label must be the literal DOM text. StayBnB's filter apply button reads "Show N stays" (live count), so the instruction and criterion description both say "Show N stays" — never a generic "Apply".

## Default-state events — do not auto-credit

Tempting anti-pattern: if a criterion expects `route_select` / `transport_mode_select` but the UI **pre-selects** the default option (shortest route, drive mode, etc.), a user who agrees with the default never clicks, so no event fires and the criterion would fail. The tempting "fix" is to emit a synthetic `*_select` on state entry with `defaultSelected: true`.

**Don't do this.** The synthetic event also fires when the agent does nothing, so the criterion passes for a no-op run — and in tests like `mapquest_nearby_pins` where "Choose driving mode" is scored, the agent gets credit without ever identifying the icon. It silently dilutes the test signal.

**Rules:**

1. Criteria must match only on explicit user interaction events. No state-entry auto-emits for `*_select` style events.
2. If a test asks the agent to click a pre-selected default, it is the test author's job to make the target unambiguous. Either:
   - Change the task to select a **non-default** option (e.g., `mode: "walk"` instead of `"drive"`), or
   - Pin the criterion to specific field values (e.g., `routeIndex: 0`) so explicit clicks still match, and accept that re-clicking the default is part of the task.
3. When naming the criterion "Select the shortest route", pin `routeIndex: 0` in the YAML so the scorer distinguishes shortest from non-shortest.

History: `mapquest.js` briefly emitted both events as state-entry defaults; the pattern was removed after a review showed `mapquest_nearby_pins` was auto-crediting `transport_mode_select: drive` on directions-panel entry.

## Panel-state machines vs page routes

MapQuest and StayBnB both have panels whose views swap in place rather than navigating. Keep state transitions **stateful** (class toggles on panel containers, `switchPanelState(...)`), not URL-based — the spec intentionally tests panel-state navigation.

Consequence: if two tests need the same control in different panel states, duplicate the DOM rather than routing between states. Concrete case: `mapquest_navigate` wants the Directions flow inside `place-detail`, but `mapquest_nearby_pins` wants the category chip bar visible from inside `place-detail` too. The chip bar is duplicated inside the place-detail state; active-class sync is done across both copies via `document.querySelectorAll('.chip[data-category="..."]')`.

## Deep-link entry points

Some tests start pre-loaded into a non-home view so the agent doesn't have to traverse navigation it isn't being scored on. StayBnB supports `#results` in `staybnb/js/staybnb.js#init()` to jump straight into results with Tokyo listings rendered. The test YAML's `start_url` ends with `/staybnb/#results`. Add a similar hash handler whenever a new test needs a non-home starting view.

## Stacking contexts — popovers and headers

Popovers anchored inside a header will be clipped to the header's effective z-order because the header's own `z-index` creates a stacking context. If a full-screen dismiss backdrop sits above that header z-index, clicks on the popover input land on the backdrop instead and close the popover immediately.

Concrete case: StayBnB's search pill popovers were unclickable until `.topbar` was raised from `z-index: 100` to `300`, above the `.popover-backdrop` at `150`. When adding any overlay that uses a backdrop pattern, verify the anchoring element's stacking context dominates the backdrop.

## Real images

Agents occasionally need real visual content (thumbnails, destination cards, gallery photos). Use **Lorem Picsum seeded URLs** so images are deterministic across runs:

```
https://picsum.photos/seed/<stable-seed>/<W>/<H>
```

Seeds used so far live in `staybnb/index.html` (home cards) and `staybnb/js/staybnb.js` (results + detail + gallery — seeds of form `staybnb-<listingId>-<k>`). Prefer `background-image: url(...)` with `background-size: cover` so the layout tolerates any aspect ratio.

## Drag-and-drop primitives

- **StayBnB price slider** is dual-handle. Each handle drag emits `price_slider_change` with `handle: "min"` or `handle: "max"`. The two criteria are independent, so the handles must be draggable independently — don't couple them.
- **TaskFlow cards** use HTML5 drag-and-drop, not click-to-move. Criteria expect `card_drop` with source and destination column IDs.

## Manual-test harness workflow

When validating a new or changed test via `evaluate_browser_agent.py --manual`:

1. `mkfifo /tmp/eval_in` and hold the write end open with a background `sleep` so the harness's `stdin` stays open across multiple tests.
2. The harness clears events at instruction display time — timing starts then, not at page load.
3. Sending `ok\n` to the FIFO completes a test and prints the score breakdown. A criterion that reports 0 despite visibly correct behaviour is almost always an event-shape mismatch (case, missing field, or default-state pattern above).

## Scope discipline

Keep site code minimal and aligned with the spec's stated challenges. Do **not** add extra animations, fallbacks, or abstractions beyond what a criterion exercises. The sites exist to probe specific agent weaknesses; incidental complexity dilutes the signal and creates spurious event noise.
