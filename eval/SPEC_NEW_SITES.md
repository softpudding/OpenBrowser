# SPEC: New Mock Evaluation Sites

Four new pure-frontend mock websites targeting interaction patterns not covered
by the existing seven sites (GBR, TechForum, CloudStack, DataFlow, Finviz,
BlueBook, Northstar).

Design goal: **challenge the agent**, not reproduce capability it already
handles.  Each site is designed around one or two interaction patterns that are
genuinely hard for a vision-based browser agent and that no existing eval site
tests.

All sites are self-contained HTML/CSS/JS served by the existing `eval/server.py`
static-file mechanism, with event tracking via the shared `tracker.js` library
plus site-specific custom events.

Research basis: real-website layout, interaction sequences, and agent-tripping
edge cases were verified against current Google Maps help docs, Airbnb help
center, Atlassian/Trello support docs, and YouTube accessibility/support docs
(April 2026).

---

## 1. MapQuest — Google Maps mock

**Directory:** `eval/mapquest/`
**Difficulty:** Hard
**Real-world model:** Google Maps (maps.google.com)

### Why this is hard

Maps is a spatial UI.  The agent must reason about autocomplete dropdown
timing, distinguish visually similar pin clusters, read a directions panel that
changes dynamically, and operate transport-mode toggle buttons that look nearly
identical.  There is no clean DOM shortcut — the map canvas is an image, and
the side panel is dense.

### Real layout to reproduce

Google Maps desktop uses a **left search/results panel** (collapsible via an
arrow on its right edge) plus a **full map canvas** to the right.  Key layout
elements:

- **Search box** at the top-left inside the panel.
- **Category/filter chips** appear below the search box after a category query.
- **Panel body** swaps between: search results list, place detail view,
  directions form — these are _panel states_, not separate pages.
- **Map controls** float over the map canvas: zoom +/– (bottom-right), compass
  (top-right), layers/satellite toggle, Street View pegman, fullscreen.
- **Map pins**: red for main results, mini-pins/dots for secondary results,
  **square ad pins** that look like real results (distractor).

The collapsible panel is important: collapsing it changes the usable map
viewport and can shift which pins are visible.

### Behaviours to mock

| Behaviour | Notes |
|-----------|-------|
| Search bar with debounced autocomplete | Typing shows a dropdown of suggested places after ~300ms debounce.  Suggestions include both places and recent searches.  Agent must **wait for the dropdown** and click the correct suggestion rather than pressing Enter on partial text.  Pressing Enter before autocomplete renders should yield different (less precise) results. |
| Panel state transitions | Selecting a result **swaps** the panel from list-view into place-detail view (not a new page navigation).  "Back" arrow returns to list.  Directions button swaps into directions form state. |
| Place detail panel | Name, address, rating (stars), hours, reviews, photos, "Directions" button, "Save" button, "Share" button.  Scrollable within the panel. |
| Directions mode | "Directions" button swaps panel into a two-field form (origin / destination) with transport-mode tabs above.  Swapping the origin/destination has a swap button. |
| Transport mode toggle — icon-only | Four icon-only buttons (car, transit, walk, bike) with **no text labels**.  Agent must identify mode by icon shape alone.  Active mode has a blue underline. |
| Route result list | After filling origin + destination and choosing a mode, 2–3 route options appear with time / distance.  Routes highlighted on map in blue (selected) and gray (alternatives).  Agent must click the correct route. |
| Map pin interaction | Clickable pins on an SVG map.  Include: clustered pins close together (agent must click the correct one), ad-style square pins (distractor, opens different panel content). |
| Pin hover preview | Hovering a pin shows a small tooltip with place name.  The tooltip disappears on mouseout. |
| "Nearby" category chips | Horizontal chip bar: "Restaurants", "Gas stations", "Coffee", "Hotels", "Parking", "Groceries", "Attractions", "Pharmacies".  Bar is **horizontally scrollable** — "Parking" and later chips are off-screen initially.  Clicking a chip filters the map pins. |
| Panel collapse / expand | Arrow button on panel right edge collapses/expands the panel.  Collapsing changes the map viewport. |

### Main challenges for the agent

1. **Autocomplete timing** — dropdown appears after a 300ms debounce; pressing
   Enter early yields a generic "search results" list rather than selecting the
   specific place.  The agent must learn to wait.
2. **Icon-only buttons** — transport mode tabs have no text labels; the agent
   must identify drive/transit/walk/bike by icon recognition alone.
3. **Panel state (not page) transitions** — the panel body changes without a
   URL change; the agent cannot rely on page navigation events.
4. **Ambiguous pins** — two pins close together (e.g., Pike Place Market and
   Pike Place Chowder); the agent must click the correct one based on the
   panel content it expects.  Ad pins add further distraction.
5. **Scroll-to-reveal chips** — the "Nearby" chip bar requires horizontal
   scroll to find "Parking" or later categories.
6. **Collapse interaction** — the panel collapse arrow is a small target; the
   agent might accidentally click it when trying to interact with the panel
   edge.

### Interaction types

- Text input with debounced autocomplete selection
- Panel state transitions (no page nav)
- Panel collapse / expand
- Icon-only button clicks (no text)
- SVG spatial click targeting (pins)
- Pin hover previews
- Horizontal scroll within a chip bar
- Multi-field form (origin + destination) with field swap
- Tab switching (transport modes)

### Test cases

#### mapquest_navigate.yaml — Hard

**Instruction:** Search for "Pike Place Market" and select it from the
autocomplete dropdown (do NOT just press Enter — wait for suggestions).  From
the place detail panel, click "Directions".  Set the origin to "Space Needle"
(again selecting from autocomplete).  Switch to the walking mode (the
pedestrian icon — there are no text labels, only icons).  From the route
results, select the shortest route.  Then collapse the left panel using the
arrow on its right edge.

**Criteria (total ~11 pts):**

| # | Criterion | Event | Points |
|---|-----------|-------|--------|
| 1 | Select "Pike Place Market" from autocomplete (not Enter) | `autocomplete_select`, itemText contains "Pike Place Market" | 1.5 |
| 2 | Click Directions in place panel | `click` on `#directions-btn` | 0.5 |
| 3 | Panel transitions to directions state | `panel_state_change`, state = "directions" | 0.5 |
| 4 | Enter and select "Space Needle" as origin | `autocomplete_select`, field = "origin", itemText contains "Space Needle" | 1.5 |
| 5 | Select walking mode (icon-only, no text) | `transport_mode_select`, mode = "walk" | 2.0 |
| 6 | Select the shortest route from results | `route_select`, routeIndex = shortest | 1.5 |
| 7 | Collapse the left panel via edge arrow | `panel_collapse` | 1.5 |
| 8 | Map viewport changes after collapse | `map_viewport_change` | 0.5 (optional) |

Note: The walking icon is a small pedestrian silhouette among four icon-only
buttons (car, bus, walk, bike).  The agent must identify it purely by shape.

#### mapquest_nearby_pins.yaml — Very Hard

**Instruction:** Search for "Pike Place Market" and select it from the
autocomplete dropdown.  Then scroll the Nearby category bar to the right until
you find the "Parking" chip (it is off-screen initially) and click it.
Multiple parking pins will appear on the map.  Two pins are very close
together — click specifically on "Pike Place Market Parking Garage" (NOT
"Pacific Place Parking" which is the adjacent pin).  Once the correct detail
panel opens, click "Directions" and set the origin to "Pike Place Market"
(already searched).  Choose the driving mode.

**Criteria (total ~13 pts):**

| # | Criterion | Event | Points |
|---|-----------|-------|--------|
| 1 | Select "Pike Place Market" from autocomplete | `autocomplete_select`, itemText contains "Pike Place Market" | 1.0 |
| 2 | Scroll the Nearby chip bar to reveal "Parking" | `chip_bar_scroll`, direction = "right" | 1.5 |
| 3 | Click the "Parking" chip | `nearby_chip_select`, category = "parking" | 1.0 |
| 4 | Click the correct parking pin (not the distractor) | `pin_click`, pinId = "pike-place-parking-garage" | 3.0 |
| 5 | Verify correct panel content | `panel_state_change`, state = "place-detail", placeId = "pike-place-parking-garage" | 1.0 |
| 6 | Click Directions from parking detail | `click` on `#directions-btn` | 0.5 |
| 7 | Set origin to Pike Place Market | `autocomplete_select`, field = "origin", itemText contains "Pike Place Market" | 1.5 |
| 8 | Choose driving mode (car icon) | `transport_mode_select`, mode = "drive" | 1.5 |
| 9 | Route results display | `route_results_render` | 1.0 (optional) |

---

## 2. StayBnB — Airbnb mock

**Directory:** `eval/staybnb/`
**Difficulty:** Hard
**Real-world model:** Airbnb (airbnb.com)

### Why this is hard

Airbnb's search flow chains several complex widgets in sequence: a location
autocomplete, a **date-range calendar** (two-month view, click check-in then
check-out), a guest counter with +/– steppers, and a faceted filter panel with
price sliders and checkbox groups.  Each widget has precise click targets and
stateful transitions.  A date-range calendar is one of the hardest standard UI
patterns for a vision agent — the agent must click two specific dates across a
grid of ~60 cells that all look alike.

### Real layout to reproduce

Current Airbnb desktop homepage has:

- **Top-level category tabs**: "Homes", "Experiences" (switching changes the
  page context — mock "Homes" only but show tabs as distractors).
- **Search bar** as a segmented pill with three sections: "Where", "When",
  "Who".  Clicking each section expands its popover below.
- **"Where" popover**: text input with location autocomplete + "I'm flexible"
  region grid below.
- **"When" popover**: dual-month calendar with three sub-tabs: "Dates"
  (specific), "Flexible", "Months".  Calendar shows two months side-by-side.
  Some dates may be **disabled/grayed out** (unavailable).  Hover on a date
  after check-in selection shows range preview.  Forward/back arrows navigate
  months.
- **"Who" popover**: stepper rows for Adults, Children, Infants, Pets.  Each
  has +/– buttons.  Adults minimum is 1 (– button is disabled at 1).
- **Search results page**: split layout — listing cards on the left, map on
  the right.  Cards have image carousel (dots), title, type, price/night,
  rating.  Hovering a card highlights its pin on the map.  Moving the map
  surfaces new listings.
- **Filter bar**: row of pill buttons ("Price", "Type of place", "Rooms and
  beds", etc.) plus a "Filters" button that opens a full-screen modal.
- **Filter modal**: price range with **dual-handle slider** (drag interaction),
  property type chips, amenity checkboxes, "Instant Book" toggle.
- **Listing detail page**: photo grid (1 large + 4 thumbnails), "Show all
  photos" button opens fullscreen gallery.  Sticky booking card on right rail
  shows dates, guests, price breakdown, and **"Reserve"** button.  Note:
  "Reserve" may lead to "Confirm and pay" (instant book) or "Request to book"
  — mock the instant-book path.
- **Booking confirmation panel**: shows dates, guests, price breakdown, total.
  "Confirm and pay" button completes the flow.

### Behaviours to mock

| Behaviour | Notes |
|-----------|-------|
| Segmented search pill | Three clickable segments ("Where", "When", "Who").  Only one popover open at a time.  Clicking a different segment closes the current popover and opens the new one. |
| Location autocomplete | Text input in "Where" popover.  Suggestions appear below.  Also show "I'm flexible" region grid as distractor. |
| Dual-month date-range calendar | Two-month side-by-side view inside "When" popover.  Sub-tabs: "Dates" / "Flexible" / "Months" (mock "Dates" as primary, others as distractors).  Click a date to set check-in, then click another to set check-out.  **Disabled dates** (grayed, unclickable) scattered in the calendar for realism.  Range preview on hover after first date selected.  Month navigation arrows. |
| Guest stepper | +/– buttons per category (Adults, Children, Infants, Pets).  Adults ≥ 1 enforced (– disabled at 1).  Total guests displayed in the search pill. |
| Listing card grid with map | Left column: 20+ listing cards with image, title, price, rating.  Right column: map with pins.  **Card-pin hover sync**: hovering a card highlights its map pin and vice versa. |
| Image carousel on cards | Each listing card has 3–5 dots; left/right arrows appear on hover to cycle images.  Small, timing-sensitive targets. |
| Filter modal with price slider | Full-screen overlay.  Dual-handle price slider: agent must **drag** min and max handles.  Below: property type chips, amenity checkboxes (10+), "Instant Book" toggle. |
| Listing detail page | Photo grid (1 large + 4 small), "Show all photos" → fullscreen scrollable gallery.  Amenity list, reviews, host info.  Sticky booking card on right. |
| Reserve → Confirm flow | Click "Reserve" → booking summary with price breakdown → "Confirm and pay" completes booking.  Two-step: Reserve first, then Confirm. |

### Main challenges for the agent

1. **Date-range calendar** — ~60 visually identical cells.  The agent must
   navigate to the correct month (forward arrows), then click the exact date
   for check-in, then a different date for check-out.  Disabled dates are
   traps — clicking them does nothing.  This is the single hardest widget.
2. **Dual-handle price slider** — the agent must drag (mousedown → mousemove →
   mouseup) two separate handles on the same track.  The handles are ~16px
   circles.  No existing eval site tests drag interaction.
3. **Segmented search pill** — the popover switch behavior (click "When"
   closes "Where" popover) is confusing if the agent doesn't understand that
   only one section is active at a time.
4. **Guest stepper precision** — +/– buttons are small (~24px).  The agent
   must click the correct button for the correct guest type and may need
   multiple clicks (e.g., 2 adults requires one extra + click since default
   is 1).
5. **Card-pin hover sync** — hovering a listing card changes the map; the
   agent might get confused by the visual state change.
6. **Two-step reserve** — "Reserve" doesn't immediately confirm; the agent
   must also click "Confirm and pay".

### Interaction types

- Segmented pill navigation (popover switching)
- Text input with autocomplete popover
- Calendar date-cell clicking (two sequential picks across a grid)
- Month navigation arrows
- Stepper buttons (+/– click, repeated)
- Drag interaction (dual-handle price slider)
- Checkbox and toggle interactions
- Card hover interactions (image carousel arrows, card-pin sync)
- Modal open / scroll / close
- Photo gallery scrolling
- Multi-step form with state carry-over (search → filter → detail → reserve → confirm)

### Test cases

#### staybnb_search.yaml — Hard

**Instruction:** On the StayBnB homepage, search for stays in "Tokyo" using
the segmented search bar.  Click the "When" section, navigate forward to June
2026 in the calendar (the default view shows the current month), and select
June 10 as check-in and June 17 as check-out.  Note: some dates in the
calendar are grayed out and unclickable — make sure to pick available dates.
Then click the "Who" section and set 3 adults, 1 child, and 1 infant.  Click
"Search".

**Criteria (total ~11 pts):**

| # | Criterion | Event | Points |
|---|-----------|-------|--------|
| 1 | Click "Where" and select "Tokyo" from autocomplete | `autocomplete_select`, value contains "Tokyo" | 1.0 |
| 2 | Click "When" to open date picker | `search_section_click`, section = "when" | 0.5 |
| 3 | Navigate calendar forward to June | `calendar_month_nav`, direction = "forward", count >= 1 | 1.0 |
| 4 | Select check-in June 10 (avoid disabled dates) | `date_select`, role = "checkin", date = "2026-06-10" | 1.5 |
| 5 | Select check-out June 17 | `date_select`, role = "checkout", date = "2026-06-17" | 1.5 |
| 6 | Click "Who" to open guest stepper | `search_section_click`, section = "who" | 0.5 |
| 7 | Increment adults to 3 (click + twice) | `guest_stepper_click`, guestType = "adults", finalCount = 3 | 1.0 |
| 8 | Increment children to 1 | `guest_stepper_click`, guestType = "children", finalCount = 1 | 1.0 |
| 9 | Increment infants to 1 | `guest_stepper_click`, guestType = "infants", finalCount = 1 | 1.0 |
| 10 | Click Search | `search_submit` | 1.5 |

Note: adults default to 1, so the agent must click + twice.  The calendar
shows two months side-by-side; the agent must use the forward arrow to reach
June if it's not already displayed.  Disabled (grayed) dates are traps.

#### staybnb_book.yaml — Very Hard

**Instruction:** On the StayBnB search results page (pre-loaded with Tokyo
listings), open the "Filters" modal.  Drag the price slider to set a range of
approximately $50–$150/night (the slider has two handles — drag both).
Check the "Wifi" and "Kitchen" amenity checkboxes.  Toggle on "Instant Book".
Apply filters.  From the filtered results, open the listing "Shibuya Loft with
Skyline View".  Click "Show all photos" to open the fullscreen gallery and
scroll through at least 5 photos.  Close the gallery, then click "Reserve"
and complete the booking by clicking "Confirm and pay" on the confirmation
panel.

**Criteria (total ~15 pts):**

| # | Criterion | Event | Points |
|---|-----------|-------|--------|
| 1 | Open filter modal | `filter_modal_open` | 0.5 |
| 2 | Drag price min handle to ~$50 | `price_slider_change`, handle = "min", value within [40, 60] | 2.0 |
| 3 | Drag price max handle to ~$150 | `price_slider_change`, handle = "max", value within [140, 160] | 2.0 |
| 4 | Check "Wifi" amenity | `amenity_toggle`, amenity = "wifi", checked = true | 0.5 |
| 5 | Check "Kitchen" amenity | `amenity_toggle`, amenity = "kitchen", checked = true | 0.5 |
| 6 | Toggle "Instant Book" on | `instant_book_toggle`, checked = true | 0.5 |
| 7 | Apply filters | `filter_apply` | 0.5 |
| 8 | Open "Shibuya Loft" listing | `listing_open`, listingId = "shibuya-loft" | 1.0 |
| 9 | Click "Show all photos" | `gallery_open`, listingId = "shibuya-loft" | 1.0 |
| 10 | Scroll through gallery (5+ photos viewed) | `gallery_scroll`, photos_viewed >= 5 | 1.5 |
| 11 | Close gallery | `gallery_close` | 0.5 |
| 12 | Click Reserve | `reserve_click`, listingId = "shibuya-loft" | 1.5 |
| 13 | Click Confirm and pay | `booking_confirm`, listingId = "shibuya-loft" | 3.0 |

Note: the dual-handle price slider is the hardest element — the agent must
perform drag (mousedown + mousemove + mouseup) on two separate 16px handles.
The "Confirm and pay" step is a distinct second action after "Reserve" — the
agent must not assume Reserve alone completes the booking.

---

## 3. TaskFlow — Trello mock

**Directory:** `eval/taskflow/`
**Difficulty:** Medium → Hard
**Real-world model:** Trello (trello.com)

### Why this is hard

Trello's core interaction is **drag-and-drop**, which no existing eval site
tests.  The agent must mousedown on a card, hold, move to a different column,
and mouseup to drop.  This is a fundamentally different interaction primitive
from click or type.  Beyond drag-and-drop, the agent must handle inline
editing (click-to-edit title), card detail modals with checklists, and label
assignment from a color palette popover.

### Real layout to reproduce

Trello desktop board has two header bars plus the board body:

- **Global header** (top): app switcher, Trello logo, search box, Create
  button, notifications bell, user avatar.
- **Board header** (below global): board name (editable), star toggle,
  visibility indicator, board members (avatars), Power-Ups button, Automation
  button, Filter button, "..." board menu.  The board menu is a slide-in right
  panel (steals horizontal space from board body when open).
- **Board body**: horizontally scrollable strip of **lists** (columns).  Each
  list has a header (list name, "..." menu), vertically stacked cards, and an
  "Add a card" footer.
- **Card anatomy**: title text, optional colored label chips (top), optional
  badges (due date, checklist progress, comment count, attachment count).
  **Hover reveals a pencil icon** (quick-edit) in the top-right corner of the
  card — this is hidden by default.
- **Card-back modal** (click a card): title (click-to-edit), description
  (click-to-edit), activity/comments.  Right sidebar: "Add" section (Members,
  Labels, Checklist, Dates, Attachment, Cover).  "Actions" section (Move,
  Copy, Archive).  New layout: "Add" is under title, "Actions" at top-right.
- **Label picker popover**: click "Labels" in card-back → popover with 6
  colored swatches (green, yellow, orange, red, purple, blue).  Labels have
  **no text names by default** — agent must pick by color.  Click to toggle.
- **Checklist**: inside card-back.  Items with checkboxes.  Progress bar at
  top.  "Add an item" input at bottom.
- **Drag feedback**: dragged card becomes semi-transparent with a shadow.  A
  **placeholder gap** appears at the drop position.  **Auto-scroll** triggers
  when the cursor nears the left/right edges of the board.

### Behaviours to mock

| Behaviour | Notes |
|-----------|-------|
| Kanban board with 4 columns | "To Do", "In Progress", "Review", "Done".  Each column has 4–5 cards. |
| Card drag-and-drop | mousedown on card → card lifts with shadow, becomes semi-transparent → mousemove to target column → placeholder gap appears → mouseup to drop.  Auto-scroll near edges. |
| Hover-reveal pencil (quick-edit) | Pencil icon hidden by default; appears on card hover in top-right corner.  Clicking it opens inline title edit + label/member quick-assign. |
| Card-back modal | Click a card to open.  Title: click-to-edit.  Description: click-to-edit.  Checklist with checkable items.  Label picker.  Member assignment.  Due date.  "Archive" button. |
| Inline card creation | "Add a card" button at bottom of each column.  Click → textarea appears inline → type title → Enter or "Add Card" button. |
| Label picker popover — color-only | 6 colored swatches, no text names.  Click to toggle on/off.  Selected labels show a checkmark overlay. |
| Checklist interaction | Items with checkboxes.  Progress bar updates.  "Add an item" text input at bottom.  Agent must check specific items and add new ones. |
| Board menu side panel | "..." button opens a right-side panel that **steals horizontal space** from the board.  This can push rightmost columns partially off-screen. |
| Card title inline edit | In card-back: click title text → text becomes an input → type → click away or press Enter to save. |
| Board filter bar | Filter button opens a filter popover.  Filter by label color, member, due date.  Filtering dims non-matching cards (they are still visible but grayed out). |

### Main challenges for the agent

1. **Drag-and-drop** — requires coordinated mousedown → mousemove → mouseup
   across different DOM elements.  The agent must identify source card and
   target column precisely.  The placeholder gap and auto-scroll add visual
   state that the agent must interpret correctly.  This is the single most
   important missing interaction pattern in the current eval suite.
2. **Hover-reveal pencil** — the quick-edit icon is **invisible until hover**.
   The agent must know to hover a card to reveal it.  This is similar to
   YouTube's auto-hide control bar but on individual cards.
3. **Inline editing** — no visible input field until the agent clicks.  Both
   the card title in the modal and the "Add a card" flow use click-to-reveal
   inputs.
4. **Color-only label picker** — labels are pure color swatches with no text;
   the agent must pick by color (e.g., "assign the red label").  Selected
   labels have a subtle checkmark overlay that may be hard to distinguish.
5. **Board menu steals space** — opening the board menu pushes columns
   partially off-screen, changing the visual layout.  The agent must handle
   this gracefully.

### Interaction types

- Drag-and-drop (mousedown + mousemove + mouseup)
- Hover-to-reveal (pencil icon on card hover)
- Click-to-edit inline fields (title, description)
- Modal open / close
- Checkbox toggling (checklist items)
- Color-swatch selection (visual-only, no text)
- Inline form creation (add card)
- Popover menus (label picker, card menu)
- Side panel that changes board layout
- Board-level filtering (dims non-matching cards)

### Test cases

#### taskflow_drag_and_edit.yaml — Hard

**Instruction:** On the TaskFlow board, drag the card "Write unit tests" from
"To Do" and drop it into the "In Progress" column.  Then open the card
"Design API schema" (in "In Progress") by clicking it.  In the card-back
modal, check off the checklist item "Define endpoints" and add a new checklist
item "Add rate limiting".  Then close the modal.  Finally, hover over the
card "Deploy staging build" in the "Review" column to reveal the pencil
quick-edit icon, and click it to rename the card to "Deploy production build".

**Criteria (total ~12 pts):**

| # | Criterion | Event | Points |
|---|-----------|-------|--------|
| 1 | Drag "Write unit tests" | `card_drag_start`, cardTitle = "Write unit tests", fromColumn = "To Do" | 1.0 |
| 2 | Drop in "In Progress" | `card_drop`, cardTitle = "Write unit tests", toColumn = "In Progress" | 2.5 |
| 3 | Open "Design API schema" card-back | `card_modal_open`, cardTitle = "Design API schema" | 0.5 |
| 4 | Check "Define endpoints" | `checklist_check`, itemText = "Define endpoints", checked = true | 1.5 |
| 5 | Add "Add rate limiting" checklist item | `checklist_add_submit`, itemText contains "rate limiting" | 1.5 |
| 6 | Close card-back modal | `card_modal_close` | 0.5 |
| 7 | Hover "Deploy staging build" to reveal pencil | `card_hover_edit_reveal`, cardTitle = "Deploy staging build" | 1.5 |
| 8 | Click pencil to enter quick-edit | `card_quick_edit_open`, cardTitle = "Deploy staging build" | 1.0 |
| 9 | Rename to "Deploy production build" | `card_quick_edit_save`, newTitle = "Deploy production build" | 1.5 |

Note: the pencil icon is invisible until hover — the agent must move the
cursor over the card to reveal it, then click it before moving away.

#### taskflow_full_workflow.yaml — Very Hard

**Instruction:** Create a new card in the "Review" column titled "Security
audit".  Open the card-back, assign the red label (fourth color swatch from
left — there are no text names, only colors), add a new checklist item "Run
OWASP scan" and check it off.  Close the card-back.  Then drag "Security
audit" from "Review" to "Done".  After dropping it, open the board menu
(the "..." button in the board header) — note that this slides in a panel
from the right that shrinks the board.  Use the filter in the board menu to
filter by the red label, confirming that only red-labeled cards remain fully
visible (others should be dimmed).

**Criteria (total ~14 pts):**

| # | Criterion | Event | Points |
|---|-----------|-------|--------|
| 1 | Click "Add a card" in Review | `add_card_click`, column = "Review" | 0.5 |
| 2 | Type and submit "Security audit" | `card_create_submit`, cardTitle = "Security audit", column = "Review" | 1.0 |
| 3 | Open card-back | `card_modal_open`, cardTitle = "Security audit" | 0.5 |
| 4 | Open label picker | `label_picker_open` | 0.5 |
| 5 | Assign red label (4th swatch, color-only) | `label_assign`, color = "red" | 1.5 |
| 6 | Add checklist item "Run OWASP scan" | `checklist_add_submit`, itemText contains "OWASP" | 1.0 |
| 7 | Check off the item | `checklist_check`, itemText contains "OWASP", checked = true | 1.0 |
| 8 | Close card-back | `card_modal_close` | 0.5 |
| 9 | Drag "Security audit" from Review | `card_drag_start`, cardTitle = "Security audit", fromColumn = "Review" | 1.0 |
| 10 | Drop in Done | `card_drop`, cardTitle = "Security audit", toColumn = "Done" | 2.0 |
| 11 | Open board menu ("...") | `board_menu_open` | 0.5 |
| 12 | Board menu steals horizontal space | `board_layout_shift` | 0.5 (optional) |
| 13 | Apply filter by red label | `board_filter_apply`, filterType = "label", color = "red" | 2.0 |
| 14 | Non-matching cards are dimmed | `board_filter_active`, matchingCards >= 1 | 0.5 (optional) |

Note: the board menu opening changes the board width, potentially shifting
columns.  The label picker shows 6 color swatches with no text — "red" is
positional (4th from left: green, yellow, orange, red, purple, blue).

---

## 4. VidHub — YouTube mock

**Directory:** `eval/vidhub/`
**Difficulty:** Medium → Hard
**Real-world model:** YouTube (youtube.com)

### Why this is hard

YouTube combines a recommendation feed, video player controls, and a social
interaction layer.  The main challenge is **video player interaction**: the
agent must operate a custom player control bar that **auto-hides on idle** —
small, icon-only targets on a dark bar overlaid on video content.  The
timeline scrub requires a click on a thin (~4px) progress bar that only
thickens to ~8px on hover.  The comment section is below the fold and has
nested reply threads.

### Real layout to reproduce

YouTube desktop has:

- **Fixed masthead** (top): hamburger menu, YouTube logo, search box (center,
  with voice search mic icon), Create button, notifications bell, user avatar.
- **Home feed** (default page): grid of video thumbnail cards.  Each card has
  thumbnail (with duration badge), title, channel name + avatar, view count,
  upload age.  Thumbnail hover shows animated preview (mock as a slight
  overlay change).
- **Video watch page** (click a video):
  - **Player area** (top-left, dominant): video poster/frame with overlaid
    control bar at bottom.
  - **Control bar elements** (left to right): play/pause, next, volume
    icon + hover-reveal slider, current time / duration, progress bar
    (thin line, full width, clickable + draggable scrubber dot), CC button,
    settings gear, theater mode, miniplayer, fullscreen.
    - The bar **auto-hides after 3s of inactivity**.  Hovering/clicking the
      video area reveals it.
    - **Settings gear** opens a nested popup: Playback speed (submenu),
      Quality (submenu), Subtitles/CC.  Nested — clicking "Playback speed"
      opens a second-level menu inside the same popup.
    - **Autoplay toggle** is at the bottom of the player area.
  - **Below player** (left column): video title, channel avatar + name +
    subscriber count + "Subscribe" button (red → gray on click), like/dislike
    buttons (icon + count), Share button, "...more" overflow, Save button.
  - **Description** (expandable): truncated by default, "...more" link expands
    full description.
  - **Comment section** (below description): comment count, sort dropdown
    ("Top comments" / "Newest first"), comment input field at top.  Each
    comment has: avatar, name, timestamp, text, like button + count, dislike,
    reply button, "N replies" expand link.
  - **Reply thread**: clicking "N replies" expands nested replies below the
    parent comment.  Reply input appears when clicking "Reply" on a specific
    comment.
  - **Right sidebar**: recommended/up-next video cards (thumbnail + title +
    channel + view count).

### Behaviours to mock

| Behaviour | Notes |
|-----------|-------|
| Home feed grid | Video thumbnail cards with title, channel, views, age.  Clicking a card navigates to watch page. |
| Search with results | Search box in masthead.  Enter triggers search results page.  Filter chips below results: "Today", "This week", "4–20 minutes", etc. |
| Video player with auto-hide controls | Poster image + control overlay.  Controls appear on hover/click, **hide after 3s idle**.  Agent must hover to reveal, then act before they hide. |
| Play/pause toggle | Single button, icon changes between play (▶) and pause (❚❚).  No text label. |
| Timeline progress bar | Thin red line (~4px height, thickens to ~8px on hover).  Clickable to seek.  Draggable scrubber dot.  Hover shows timestamp tooltip. |
| Volume: click to mute + hover to reveal slider | Volume icon click toggles mute.  Hovering the icon **reveals a horizontal slider** (hidden by default).  Agent must hover to see the slider, then drag or click it. |
| Settings — nested popup | Gear icon opens popup.  Items: "Playback speed", "Quality", "Subtitles/CC".  Clicking an item opens a **second-level submenu** inside the same popup (e.g., speed options: 0.25x, 0.5x, Normal, 1.25x, 1.5x, 2x).  Agent must navigate two popup levels. |
| Like / Dislike | Icon-only buttons below video.  Like fills blue on click, count increments.  Dislike has no visible count. |
| Subscribe button | Red "Subscribe" → gray "Subscribed" on click.  Has bell icon for notifications. |
| Description expand/collapse | "...more" link expands truncated description.  "Show less" collapses. |
| Comment sort dropdown | "Top comments" / "Newest first" dropdown at top of comment section. |
| Comment reply thread expand | "N replies" link expands nested replies.  Each reply has its own like/reply affordances. |
| Comment reply input | Click "Reply" on a comment → nested input field appears below that comment.  Submit button. |
| Recommended sidebar | Right column on watch page.  Video cards.  Clicking navigates to a different video (watch page reloads). |

### Main challenges for the agent

1. **Control bar auto-hide** — controls disappear after 3s.  The agent must
   hover the player area to reveal controls, then click the target button
   before they hide again.  If the agent is too slow, controls disappear
   mid-action.
2. **Timeline scrub precision** — the progress bar is a thin line; the agent
   must click at a specific horizontal percentage (e.g., "skip to halfway").
   The scrubber dot is ~12px.  The bar thickens on hover but is very thin
   otherwise.
3. **Volume hover-reveal slider** — the volume slider is invisible until the
   agent hovers the volume icon.  Two-step interaction: hover to reveal, then
   interact with the slider.
4. **Nested settings popup** — settings opens a popup, and sub-items open a
   second-level popup.  The agent must navigate into the correct submenu and
   select an option, all within a single popup flow.
5. **Scroll-to-comments** — the comment section is below the fold; the agent
   must scroll past video metadata, description, and possibly ads to reach it.
6. **Nested reply threads** — expanding replies and then replying within the
   thread requires navigating nested, dynamically-appearing UI elements.
7. **Icon-only player buttons** — play, pause, volume, CC, settings,
   fullscreen are all icons with no text labels.

### Interaction types

- Hover-to-reveal (control bar, volume slider)
- Auto-hide timing (3s control bar)
- Icon-only button clicks (player controls)
- Progress bar click / drag (timeline seek)
- Hover-reveal slider (volume)
- Nested popup navigation (settings → submenu)
- Toggle buttons (play/pause, like, subscribe)
- Scroll to off-screen content (comments)
- Expand/collapse (description, reply threads)
- Nested comment reply with text input
- Sort dropdown
- Search with filter chips
- Sidebar card navigation

### Test cases

#### vidhub_player.yaml — Hard

**Instruction:** On the VidHub homepage, search for "machine learning
tutorial" and open the first result.  On the video page, hover over the player
area to reveal the control bar (it auto-hides after 3 seconds), then click
play.  Seek to approximately the 75% mark on the timeline by clicking the
progress bar.  Then open the Settings menu (gear icon) and navigate into the
"Playback speed" submenu to select "1.5x".  Finally, like the video and
subscribe to the channel.

**Criteria (total ~12 pts):**

| # | Criterion | Event | Points |
|---|-----------|-------|--------|
| 1 | Search and submit query | `search_submit`, query contains "machine learning" | 0.5 |
| 2 | Open first result | `video_open`, videoId = target | 0.5 |
| 3 | Hover player to reveal controls | `player_controls_show` | 1.0 |
| 4 | Click play (icon-only) | `player_play` | 1.0 |
| 5 | Seek to ~75% on thin progress bar | `player_seek`, position within [0.60, 0.90] | 2.0 |
| 6 | Open Settings (gear icon, icon-only) | `settings_open` | 1.0 |
| 7 | Navigate to Playback speed submenu | `settings_submenu_open`, submenu = "playback-speed" | 1.5 |
| 8 | Select 1.5x speed | `playback_speed_change`, speed = 1.5 | 1.5 |
| 9 | Like the video (icon-only) | `video_like`, videoId = target | 1.5 |
| 10 | Subscribe to channel | `channel_subscribe`, channelId = target | 1.5 |

Note: the control bar hides after 3s of inactivity — the agent must hover to
re-reveal it for each player interaction.  The settings gear opens a popup,
and "Playback speed" opens a nested second-level submenu within that popup.
All player buttons are icon-only with no text labels.

#### vidhub_comment.yaml — Very Hard

**Instruction:** Navigate to the video "Understanding Transformers — Visual
Guide" from the homepage feed.  First, expand the video description by
clicking "...more" below the title.  Then scroll down past the description to
the comments section.  Change the comment sort to "Newest first" using the
dropdown.  Find the comment by "Dr. Sarah Chen" (you may need to scroll within
the comments).  Expand her reply thread by clicking "4 replies".  Reply to her
comment with a message that includes the phrase "attention mechanism".  After
submitting the reply, scroll back up and hover over the player to reveal
controls, then hover over the volume icon to reveal the volume slider and
adjust it to approximately 50%.

**Criteria (total ~15 pts):**

| # | Criterion | Event | Points |
|---|-----------|-------|--------|
| 1 | Open target video from feed | `video_open`, videoId = "transformers-visual-guide" | 0.5 |
| 2 | Expand description ("...more") | `description_expand` | 1.0 |
| 3 | Scroll to comments section | `comments_section_visible` | 0.5 |
| 4 | Open sort dropdown | `comment_sort_open` | 0.5 |
| 5 | Select "Newest first" | `comment_sort_change`, sort = "newest" | 1.0 |
| 6 | Locate Dr. Sarah Chen's comment | `comment_visible`, authorName = "Dr. Sarah Chen" | 1.0 |
| 7 | Expand "4 replies" thread | `reply_thread_expand`, parentCommentAuthor = "Dr. Sarah Chen" | 1.5 |
| 8 | Click Reply on her comment | `reply_click`, parentCommentAuthor = "Dr. Sarah Chen" | 1.0 |
| 9 | Type reply with "attention mechanism" | `reply_input`, value_contains = "attention mechanism" | 1.5 |
| 10 | Submit reply | `reply_submit`, parentCommentAuthor = "Dr. Sarah Chen" | 2.0 |
| 11 | Scroll back up to player area | `player_area_visible` (scroll up) | 0.5 |
| 12 | Hover player to reveal controls | `player_controls_show` | 0.5 |
| 13 | Hover volume icon to reveal slider | `volume_slider_reveal` | 1.5 |
| 14 | Adjust volume to ~50% | `volume_change`, level within [0.35, 0.65] | 2.0 |

Note: this test combines scroll-down + interact + scroll-back-up + hover-reveal
patterns.  The volume slider is hidden until the agent hovers the volume icon —
a two-step hover-then-interact sequence.  The reply thread is nested and only
appears after clicking "4 replies".

---

## Summary

| Site | Mocks | Dir | Difficulty | Primary challenge | Key missing pattern filled |
|------|-------|-----|------------|-------------------|--------------------------|
| MapQuest | Google Maps | `eval/mapquest/` | Hard | Autocomplete timing, icon-only transport buttons, ambiguous spatial pins, panel state transitions | Autocomplete, spatial clicks, icon-only UI, panel-state (not page) nav |
| StayBnB | Airbnb | `eval/staybnb/` | Hard → Very Hard | Date-range calendar, dual-handle price slider drag, segmented search pill, multi-step booking | Date picker, drag interaction, stepper precision, sequential checkout |
| TaskFlow | Trello | `eval/taskflow/` | Medium → Hard | Drag-and-drop cards, hover-reveal pencil, color-only labels, inline edit, board menu space theft | Drag-and-drop, hover-to-reveal, inline editing, color-swatch selection |
| VidHub | YouTube | `eval/vidhub/` | Medium → Hard | Auto-hide control bar, timeline scrub, nested settings popup, volume hover-reveal, nested reply threads | Auto-hide timing, media controls, nested popups, hover-reveal slider |

### Implementation order (suggested)

1. **TaskFlow** — cleanest scope, drag-and-drop is the highest-value missing
   primitive
2. **VidHub** — well-defined layout, player controls and auto-hide are a clear
   gap
3. **MapQuest** — spatial UI adds visual complexity, panel-state transitions
   are novel
4. **StayBnB** — most widgets, most test-case points, hardest date picker
   challenge, builds on patterns from the others
