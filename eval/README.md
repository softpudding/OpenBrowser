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
│   └── dataflow.yaml
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
└── finviz/               # Stock screener
    └── index.html
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
