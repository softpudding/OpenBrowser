# Mock Websites for AI Agent Evaluation

This directory contains mocked frontend websites designed to test browser-operating AI agents' capabilities.

## Websites

### 1. GBR.com (Easy)
- **URL**: `/gbr/`
- **Difficulty**: Easy
- **Purpose**: Test AI Agent's page navigation, clicking, and information gathering capabilities
- **Features**:
  - Multi-page news website
  - Header navigation
  - Search functionality
  - Article cards with click tracking
  - Subscribe/Sign-in buttons

### 2. TechForum.com (Medium)
- **URL**: `/techforum/`
- **Difficulty**: Medium
- **Purpose**: Test AI Agent's ability to interact with Q&A forum websites
- **Features**:
  - Question/Answer cards
  - Like/Collect/Comment/Share buttons
  - Comment modal with text input
  - Topic navigation
  - Sidebar navigation
  - Search functionality

### 3. CloudStack.com Console (Hard)
- **URL**: `/cloudstack/` (legacy: `/aliyun/`)
- **Difficulty**: Hard
- **Purpose**: Test AI Agent's ability to handle complex enterprise consoles with distractions
- **Features**:
  - Complex dashboard layout
  - Instance management table
  - Filter and search functionality
  - Create instance modal with multi-step form
  - **Spam popups** that appear at intervals (promotions, security alerts, notifications)
  - Notification panel
  - Multiple action buttons per row

### 4. DataFlow Dashboard (Medium)
- **URL**: `/dataflow/`
- **Difficulty**: Medium
- **Purpose**: Test visual understanding through dashboard interactions
- **Features**:
  - Settings panel with toggle switches
  - Revenue chart with interactive elements
  - Tab navigation (Revenue, Settings, Reports)
  - Quarterly data visualization

### 5. Finviz Stock Screener (Medium)
- **URL**: `/finviz/`
- **Difficulty**: Medium
- **Purpose**: Test complex filter interactions with financial data
- **Features**:
  - 27 dropdown filter options
  - Sortable data table (40 stocks)
  - Pagination controls
  - Multiple view modes (Overview, Valuation, Financial, etc.)
  - Dark theme matching original finviz.com

### 6. BlueBook Feed (Hard)
- **URL**: `/bluebook/`
- **Difficulty**: Hard
- **Purpose**: Test Xiaohongshu-style visual browsing, search, dense card layouts, modal note reading, and comment interactions
- **Features**:
  - Dense masonry feed with 70+ mocked posts
  - Search bar with separate clear/search icon buttons
  - Floating "graphic only" and "reload" buttons
  - Note detail modal with left media area and right comment panel
  - Comment like / reply interactions with author-specific tracking
  - Shared tracker integration plus site-specific events

### 7. MapQuest (Hard) — Google Maps mock
- **URL**: `/mapquest/`
- **Difficulty**: Hard
- **Purpose**: Test panel-state navigation, search autocomplete, icon-only transport buttons, and spatial pin interaction on a map canvas
- **Features**:
  - Left search panel with state machine: `search → results → place-detail → directions`
  - Autocomplete dropdown that appears as the user types (no page reload)
  - Horizontally-scrollable category chip bar ("Restaurants", "Gas", "Coffee"…) duplicated inside `place-detail` so it stays reachable after drilling in
  - Icon-only transport mode bar (drive / transit / walk / bike) above directions
  - Route result cards with duration + distance; shortest route is pre-selected and emits a `route_select` event on panel entry
  - Spatial pin clicks on the canvas with hover → label reveal
  - Test cases: `mapquest_navigate`, `mapquest_nearby_pins`
- **Main challenges**:
  - Autocomplete timing — suggestions only appear mid-typing, not on submit
  - Icon-only transport buttons with no text labels
  - Ambiguous pin targets on a dense map
  - Panel-state (not page) navigation — back/forward is stateful, not a route change
  - Default-selection events: the shortest route and "drive" mode are pre-selected; the site emits synthetic `*_select` events on entry so criteria don't require a redundant click

### 8. StayBnB (Hard → Very Hard) — Airbnb mock
- **URL**: `/staybnb/`
- **Difficulty**: Hard → Very Hard
- **Purpose**: Test segmented search pill, date-range calendar, dual-handle price slider drag, multi-amenity filter modal, gallery viewer, and two-step reserve → confirm booking
- **Features**:
  - Home page with real Lorem Picsum destination cards
  - Top search pill with Where / Check-in / Check-out / Who popovers that share a dismiss backdrop
  - Guest stepper (adults / children / infants) with per-row +/- buttons
  - Results view reachable via `#results` deep link (pre-loaded with Tokyo listings for tests)
  - Card carousel (left/right arrows) plus card-hover → map-pin highlight sync
  - Filter modal with **dual-handle price slider** (drag both ends), amenity checkboxes, and an "Instant Book" toggle
  - "Show N stays" apply button whose label updates live with the filtered count
  - Detail page with 5-photo grid, fullscreen gallery (scrollable), and a Reserve → Confirm-and-pay two-step checkout
  - Test cases: `staybnb_search`, `staybnb_book`
- **Main challenges**:
  - Drag interaction on a dual-handle slider — min and max handles must be dragged independently
  - Segmented popover stacking: header must sit **above** the dismiss backdrop or the popover inputs become click-dead (header `z-index` raised to 300 to resolve)
  - Sequential checkout with hidden second step
  - Amenity events normalized to lowercase so checker criteria match regardless of display casing
  - Live apply-button label ("Show N stays") — test instructions and criteria reference the actual label rather than a generic "Apply"

### 9. TaskFlow (Medium → Hard) — Trello mock
- **URL**: `/taskflow/`
- **Difficulty**: Medium → Hard
- **Purpose**: Test drag-and-drop, hover-reveal controls, inline editing, color-only label selection, and board-menu space theft
- **Features**:
  - Kanban board with 4 columns and draggable cards (HTML5 drag-and-drop)
  - Hover-reveal pencil icon on cards for inline rename
  - Card detail modal with description, labels, checklist, comments
  - Color-swatch label picker (no text labels — hue only)
  - Due-date picker and member assignment
  - Right-side board menu that pushes board content left when opened
  - Test cases: `taskflow_drag_and_edit`, `taskflow_full_workflow`
- **Main challenges**:
  - True drag-and-drop between columns (not click-to-move)
  - Hover-to-reveal pencil — the affordance is invisible until the pointer enters the card
  - Color-only label picker requires visual discrimination without text
  - Board menu steals horizontal space on open, shifting downstream click targets
  - Inline editing: click to enter edit mode, Enter/blur to commit

### 10. VidHub (Medium → Hard) — YouTube mock
- **URL**: `/vidhub/`
- **Difficulty**: Medium → Hard
- **Purpose**: Test auto-hide player controls, thin-bar timeline scrub, nested settings popup, hover-reveal volume slider, and nested comment reply threads
- **Features**:
  - Home feed grid with thumbnail + title + channel cards
  - Search box in masthead with result filter chips
  - Video watch page with poster + overlaid control bar that **auto-hides after 3s** of inactivity
  - Icon-only player controls: play/pause, volume, CC, settings, theater, miniplayer, fullscreen
  - Thin progress bar (~4px, thickens to ~8px on hover) for timeline seek
  - Volume icon with **hover-reveal** horizontal slider (two-step hover-then-drag)
  - Nested settings popup: gear → Playback speed → submenu (0.25x … 2x)
  - Like/dislike, red → gray Subscribe toggle, expandable description
  - Comment section with sort dropdown and nested reply threads
  - Test cases: `vidhub_player`, `vidhub_comment`
- **Main challenges**:
  - Control bar auto-hide forces repeated hover-to-reveal between actions
  - Thin-bar scrub precision for percentage-based seek targets
  - Two-step hover-reveal volume slider
  - Nested popup navigation — settings opens a popup, submenu opens inside the same popup
  - Scroll-to-comments below fold followed by scroll-back-up to player area

## Event Tracking

All websites include comprehensive event tracking that records:
- Clicks (element, position, text)
- Scrolls (position, max scroll)
- Input (field, value length)
- Hovers (element, selector)
- Navigation (page changes)
- Form submissions
- Site-specific actions (upvote, comment, instance operations, etc.)

### Tracking Data Storage
- Events are stored in browser localStorage
- Events are also sent to server via `/api/track` endpoint
- Server maintains in-memory event store

## API Endpoints

### Get All Events
```bash
curl http://localhost:PORT/api/events
```

### Clear All Events
```bash
curl http://localhost:PORT/api/events/clear
```

### List Available Sites
```bash
curl http://localhost:PORT/api/sites
```

### API Help
```bash
curl http://localhost:PORT/api/help
```

### Submit Tracking Event (from browser)
```bash
curl -X POST http://localhost:PORT/api/track \
  -H "Content-Type: application/json" \
  -d '{"eventType": "click", "site": "globalbusinessreview.com", ...}'
```

## Starting the Server

```bash
cd eval
python server.py
```

The server will:
1. Automatically find an available port
2. Start serving the websites
3. Print URLs for all sites and API endpoints

## Running OpenBrowser Evaluation

Automated evaluation now requires a browser UUID capability token copied from the Chrome extension UUID page.

Quick start:

```bash
python eval/evaluate_browser_agent.py --test techforum --chrome-uuid YOUR_BROWSER_UUID --model-alias default
```

Recommended options:

```bash
export OPENBROWSER_CHROME_UUID=YOUR_BROWSER_UUID
python eval/evaluate_browser_agent.py --test techforum --model-alias default
python eval/evaluate_browser_agent.py --test techforum --model-alias plus
python eval/evaluate_browser_agent.py --model-alias plus --model-alias flash
python eval/evaluate_browser_agent.py --list
python eval/evaluate_browser_agent.py --manual --test techforum
```

Notes:

1. `--chrome-uuid` is required for automated runs that call the OpenBrowser browser-control APIs.
2. Automated evaluation also requires at least one `--model-alias`, which must match a configured LLM alias in the OpenBrowser web UI.
3. `--manual` and `--list` do not require a browser UUID.
4. `OPENBROWSER_CHROME_UUID` is the equivalent environment variable for scripting and CI-style usage.

## Evaluating AI Agent Behavior

After an AI agent interacts with the websites, you can:

1. **Export events**: `GET /api/events` returns all tracked events in JSON format
2. **Analyze behavior**: Events include timestamps, element selectors, action types
3. **Compare sessions**: Each session has a unique ID for comparison
4. **Clear and reset**: Use `/api/events/clear` to reset between tests

### Example Event Structure
```json
{
  "timestamp": 1710234567890,
  "sessionId": "session_1710234567890_abc123",
  "site": "techforum.com",
  "difficulty": "medium",
  "page": "/techforum/",
  "eventType": "click",
  "element": "BUTTON",
  "elementId": null,
  "elementClass": "action-btn upvote",
  "elementText": "👍 2,341",
  "selector": "button.action-btn.upvote",
  "x": 450,
  "y": 320
}
```

## Directory Structure

```
eval/
├── server.py              # Python server with tracking API
├── evaluate_browser_agent.py  # Evaluation runner
├── dataset/               # YAML test case definitions
│   ├── gbr.yaml
│   ├── gbr_detailed.yaml
│   ├── techforum.yaml
│   ├── techforum_reply.yaml
│   ├── cloudstack.yaml
│   ├── cloudstack_interactive.yaml
│   ├── finviz_simple.yaml
│   ├── finviz_complex.yaml
│   ├── dataflow.yaml
│   ├── mapquest_navigate.yaml
│   ├── mapquest_nearby_pins.yaml
│   ├── staybnb_search.yaml
│   ├── staybnb_book.yaml
│   ├── taskflow_drag_and_edit.yaml
│   ├── taskflow_full_workflow.yaml
│   ├── vidhub_player.yaml
│   └── vidhub_comment.yaml
├── css/
│   ├── gbr.css           # GBR styles
│   ├── techforum.css     # TechForum styles
│   ├── aliyun.css        # Aliyun styles
│   └── finviz.css        # Finviz styles
├── js/
│   ├── tracker.js        # Shared tracking library
│   ├── gbr.js            # GBR interactions
│   ├── techforum.js      # TechForum interactions
│   ├── aliyun.js         # Aliyun interactions
│   └── finviz.js         # Finviz interactions
├── gbr/                   # News website
│   ├── index.html
│   └── articles/
├── techforum/            # Q&A forum
│   └── index.html
├── cloudstack/           # Enterprise console (aliyun clone)
│   └── *.html
├── dataflow/             # Dashboard visualization
│   └── index.html
├── finviz/               # Stock screener
│   └── index.html
├── mapquest/             # Google Maps mock (panel state machine)
│   ├── index.html
│   ├── css/mapquest.css
│   └── js/mapquest.js
├── staybnb/              # Airbnb mock (filter modal, gallery, booking)
│   ├── index.html
│   ├── css/staybnb.css
│   └── js/staybnb.js
├── taskflow/             # Trello mock (drag-and-drop board)
│   ├── index.html
│   ├── css/taskflow.css
│   └── js/taskflow.js
└── vidhub/               # YouTube mock (player, comments)
    ├── index.html
    ├── css/vidhub.css
    └── js/vidhub.js
```

## Testing

To manually test the websites:

1. Start the server: `python server.py`
2. Open browser to the displayed URL (e.g., `http://localhost:11826/ws/`)
3. Interact with the website (click, scroll, input)
4. Check events: `curl http://localhost:11826/api/events`

## Evaluating AI Agent Performance

After an AI agent interacts with a website, you can analyze the tracked events to evaluate its performance. Here are some example evaluation criteria:

### GBR (Easy Level)
- **Navigation**: Did the agent navigate between pages (Home, World, Business, Markets, etc.)?
- **Information gathering**: Did the agent click on article links to read content?
- **Search**: Did the agent use the search functionality?
- **Subscription**: Did the agent attempt to subscribe or sign in?

### TechForum (Medium Level)
- **Button distinction**: Did the agent correctly distinguish between like, collect, comment, and share buttons?
- **Comment placement**: Did the agent open the comment modal and submit a comment on the correct answer?
- **Scrolling**: Did the agent scroll through the feed to view more content?
- **Navigation**: Did the agent use sidebar and header navigation?

### CloudStack (Hard Level)
- **Popup handling**: Did the agent close spam popups (promotions, security alerts, etc.)?
- **Complex UI interaction**: Did the agent interact with the instance table, filters, and pagination?
- **Multi-step process**: Did the agent initiate and progress through the "Create Instance" modal?
- **Action selection**: Did the agent perform appropriate instance actions (start, restart, connect, etc.)?

### DataFlow (Medium Level)
- **Settings interaction**: Did the agent enable the weekly reports feature?
- **Chart interaction**: Did the agent click on the quarter with highest revenue?
- **Tab navigation**: Did the agent navigate to the Revenue tab?

### Finviz (Medium Level)
- **Filter application**: Did the agent apply the correct market cap filter?
- **Multi-filter combination**: Did the agent apply multiple filters correctly?
- **Data interpretation**: Did the agent understand the filter results?

### General Metrics
- **Event completeness**: Did the agent trigger expected event types (clicks, scrolls, inputs)?
- **Session duration**: How long did the agent spend on the task?
- **Error rate**: Did the agent trigger any error events or fail to complete key actions?

### Analyzing Event Data
Use the `/api/events` endpoint to retrieve JSON data. You can write scripts to compute metrics such as:
- Total number of events per type
- Sequence of navigation events
- Time between key actions
- Completion of predefined task flows

Example analysis script:
```python
import requests
import json

events = requests.get('http://localhost:PORT/api/events').json()
clicks = [e for e in events['events'] if e['eventType'] == 'click']
print(f"Total clicks: {len(clicks)}")
```
