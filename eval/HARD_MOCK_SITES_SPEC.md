# Hard-Only Mock Website SPEC

This document defines 5 new pure-frontend mock websites to extend the eval suite under `eval/`.

All new dataset cases under `eval/dataset/` should be `hard` or `very hard`.
Do not add simple or single-action cases for these sites.

## Goals

- Expand coverage into stateful real-world workflows instead of adding more easy search-and-click tasks.
- Challenge OpenBrowser with long, multi-surface, ambiguity-heavy flows.
- Keep all sites pure frontend, deterministic, and easy to reset between runs.
- Make scoring strict through semantic tracker events and stable seeded IDs.

## Global Requirements

### Architecture

- Each website lives in `eval/<site>/`.
- Each site is pure frontend only: HTML, CSS, JS, embedded JSON/JS seed data, and local browser state.
- No real backend should be introduced for site logic. The only server dependency remains the existing tracker API in `eval/server.py`.
- Every site must support deterministic reset via `?reset=1` or equivalent local state clearing on load.

### Difficulty Policy

- Every new dataset file must be `hard` or `very hard`.
- Each workflow should require 6 to 12 meaningful actions.
- Each workflow must cross at least 2 surfaces, for example:
  - list -> detail -> modal -> list
  - search -> results -> detail -> checkout
  - issue list -> issue -> PR -> files changed
- Each workflow must include exact-target discrimination:
  - near-duplicate names
  - repeated buttons
  - similar cards
  - misleading but plausible decoys
- Each workflow must include at least one state dependency where a later step is only valid if an earlier step was correct.

### Interaction Design Rules

- Prefer realistic UI ambiguity over artificial randomness.
- Do not require unsupported OS-level file pickers, native downloads, CAPTCHAs, or external logins.
- If a real site normally uses upload, attachment, or drag/drop, provide an in-page mocked alternative.
- Use nested scroll containers, sticky toolbars, hidden actions after selection, and repeated labels to increase difficulty.
- Avoid impossible puzzles or hidden controls that a careful human could not reasonably find.

### Tracking Rules

- Emit semantic events for all workflow-critical actions.
- All tracked objects must have stable seeded IDs even if the ID is not visible in the UI.
- Dataset scoring should prioritize semantic checkpoints and final state, not generic click counts.

### Dataset Rules

- Each site ships exactly 3 dataset files:
  - 2 hard
  - 1 very hard
- Recommended time limits:
  - hard: 480 to 720 seconds
  - very hard: 720 to 1100 seconds
- Recommended cost limits:
  - hard: 1.0 to 1.8 RMB
  - very hard: 1.8 to 3.0 RMB

## 1. Gmail Mock

### Route

- `/gmail/`

### Why This Site

Current eval coverage already includes search, forums, dashboards, social feed interaction, console chat, and basic ecommerce. It does not cover inbox triage, threaded context, selection-dependent toolbars, or search operators.

### Real Website Behaviors To Mock

- Inbox categories such as Primary, Promotions, and Updates
- Left navigation with labels and nested labels
- Thread list with unread, starred, and attachment states
- Thread detail view with collapsed older replies
- Search bar with Gmail-style operator behavior
- Bulk selection checkboxes and selection toolbar
- Archive, mark unread, star, move, and label actions
- Compose modal and inline reply box
- Draft autosave
- Attachment insertion through a frontend picker modal

### Main Challenge

The challenge is not just finding a thread. The agent must preserve object identity across inbox, thread view, search results, and compose state. Important actions only appear after selection or after opening the correct thread, and many threads should look plausible.

### Main Interaction Types

- Search
- Open thread
- Expand collapsed messages
- Select one or many threads
- Apply existing label
- Create new label
- Archive
- Mark unread
- Star
- Compose or reply
- Add mock attachment
- Save draft
- Send

### Difficulty Levers

- Similar sender names and near-duplicate subject lines
- One correct thread and one decoy with almost the same search result
- Nested labels such as `Finance/Q2`
- Toolbar changes only after thread selection
- Compose modal remains open while inbox state is still visible beneath it
- One attachment path inserts a mock file and another inserts a mock Drive link

### Seeded State

- 35 to 45 threads
- At least 3 subject clusters with similar naming
- At least 1 urgent thread in Primary
- At least 1 convincing decoy in Promotions
- At least 1 multi-message thread where the correct clue is only in the latest reply
- At least 1 thread already associated with a label tree

### Dataset Files

- `gmail_exec_followup.yaml` (`hard`)
  - Search with operators
  - Open the correct finance thread
  - Create or apply the correct label
  - Reply with exact text
  - Attach the correct mock PDF
  - Send
- `gmail_inbox_cleanup.yaml` (`hard`)
  - Navigate categories
  - Bulk-select specific campaign threads
  - Archive them
  - Star one urgent thread
  - Mark another thread unread
  - Avoid one decoy
- `gmail_vendor_escalation.yaml` (`very hard`)
  - Find a buried vendor thread with search
  - Expand collapsed conversation history
  - Inspect the newest message
  - Reply or forward with exact recipients and CC
  - Save as draft
  - Reopen draft
  - Add mock Drive attachment
  - Send

### Semantic Events

- `mail_search_execute`
- `thread_open`
- `thread_expand`
- `thread_select`
- `thread_archive`
- `thread_mark_unread`
- `thread_star_toggle`
- `label_create`
- `label_apply`
- `compose_open`
- `reply_open`
- `attachment_add`
- `draft_autosave`
- `mail_send`

## 2. Google Drive Mock

### Route

- `/drive/`

### Why This Site

The current suite does not test nested file management, move/share workflows, selection state, or permission changes across several surfaces.

### Real Website Behaviors To Mock

- My Drive
- Shared with me
- Recent
- Breadcrumb navigation
- Folder tree navigation
- List and grid view toggle
- Search bar
- Details pane
- Multi-select toolbar
- Context menu
- Rename
- Move dialog with destination tree
- Shortcut creation
- Share dialog with role selector
- Frontend-only upload modal

### Main Challenge

The agent must track file identity across search results, folder views, move dialogs, and sharing modals. Similar filenames should make naive text matching fail.

### Main Interaction Types

- Search
- Open folder
- Switch view mode
- Select one or many items
- Rename
- Move
- Create shortcut
- Open share dialog
- Add collaborator
- Change permissions
- Upload replacement asset
- Delete obsolete duplicate

### Difficulty Levers

- Identical or near-identical filenames in different folders
- Shared and owned copies of similar files
- Hidden bulk toolbar until exact selection happens
- Destination picker with nested scroll container
- Permission dropdown inside modal
- Existing shortcut that looks similar to a real file

### Seeded State

- 50 to 70 files/folders
- At least 3 levels of nesting
- Duplicate names such as `Launch Brief`, `Launch Brief Final`, `Launch Brief v5`
- Shared items with badges and owner metadata
- At least 1 shortcut already present
- At least 1 project area containing visually similar assets

### Dataset Files

- `drive_project_reorg.yaml` (`hard`)
  - Search for a specific file
  - Move it into the correct nested folder
  - Rename it
  - Create a shortcut in a second destination
- `drive_permission_cleanup.yaml` (`hard`)
  - Locate a shared folder
  - Open share dialog
  - Add two collaborators with different roles
  - Downgrade an existing editor
  - Confirm final access state
- `drive_bulk_release_assets.yaml` (`very hard`)
  - Switch to list view
  - Multi-select several similarly named assets
  - Move them in one action
  - Upload a replacement asset with the mock picker
  - Delete one obsolete duplicate
  - Avoid touching the wrong file

### Semantic Events

- `drive_search_execute`
- `folder_open`
- `view_mode_change`
- `item_select`
- `multi_select_commit`
- `item_move`
- `item_rename`
- `shortcut_create`
- `share_dialog_open`
- `permission_add`
- `permission_change`
- `mock_upload_complete`
- `item_delete`

## 3. Booking.com Mock

### Route

- `/booking/`

### Why This Site

The suite currently lacks calendar-heavy travel workflows, guest/room allocation, multi-step result filtering, room policy comparison, and reservation completion.

### Real Website Behaviors To Mock

- Destination autocomplete
- Dual-month date picker
- Guest and room counters
- Search submit
- Search results list with sticky filters
- Sort controls
- Shortlist or save
- Property detail page
- Room-rate table
- Free cancellation and breakfast badges
- Traveler form
- Reservation confirmation page

### Main Challenge

The difficult part is policy discrimination. Many properties and room cards should look nearly valid. The correct path depends on subtle constraints such as cancellation policy, breakfast inclusion, neighborhood, or occupancy fit.

### Main Interaction Types

- Destination selection
- Date range selection
- Guest count changes
- Search
- Filter application
- Sorting
- Open property
- Shortlist toggle
- Select room/rate plan
- Fill traveler form
- Submit reservation

### Difficulty Levers

- Repeated `See availability` buttons
- Similar hotel names
- Similar room cards differing only in policy text
- Sticky filters and overlays
- Multi-room guest allocation
- Traveler form validation tied to earlier room selection

### Seeded State

- 18 to 25 properties in one city
- At least 3 hotels with highly similar names
- Each target hotel has multiple room-rate combinations
- Cancellation, breakfast, and payment timing vary independently
- At least 1 decoy hotel that matches most but not all constraints

### Dataset Files

- `booking_room_selection.yaml` (`hard`)
  - Choose destination, dates, and guests
  - Filter by review score and cancellation policy
  - Open the correct property
  - Select the one room plan matching breakfast and cancellation constraints
  - Continue toward reservation
- `booking_compare_and_book.yaml` (`hard`)
  - Shortlist two similar hotels
  - Compare them
  - Reopen the correct one
  - Choose the valid room offer
  - Fill traveler details
  - Confirm reservation
- `booking_family_trip_edgecase.yaml` (`very hard`)
  - Configure multi-room guests
  - Apply neighborhood and meal filters
  - Avoid decoy offers
  - Select two exact room types
  - Fill traveler forms
  - Add special request
  - Complete booking

### Semantic Events

- `destination_select`
- `date_range_select`
- `guest_count_change`
- `search_submit`
- `filter_apply`
- `sort_apply`
- `property_open`
- `shortlist_toggle`
- `rate_plan_select`
- `traveler_form_submit`
- `reservation_submit`

## 4. GitHub Mock

### Route

- `/github/`

### Why This Site

The current suite does not test multi-surface code review, issue triage, file-diff navigation, or review actions anchored to exact files and hunks.

### Real Website Behaviors To Mock

- Repository tabs
- Issues list
- Pull requests list
- Filter/query bar
- Labels, assignee, and milestone sidebar
- Issue comments
- PR Conversation tab
- PR Files changed tab
- Changed-file tree
- File filters
- Inline diff comments
- Mark-as-viewed
- Review submit modal with `Comment`, `Approve`, and `Request changes`

### Main Challenge

Many actions use the same language but have different meaning based on context. A generic comment is not a review comment. A label added to the issue is not a label added to the PR. The agent must land on the correct object, file, and diff hunk.

### Main Interaction Types

- Enter query filters
- Open issue
- Add label
- Set assignee
- Set milestone
- Add issue comment
- Open PR
- Switch PR tabs
- Filter changed files
- Add inline diff comment
- Mark file viewed
- Submit review

### Difficulty Levers

- Similar issue titles
- Similar file paths
- Review sidebar and file tree crowd the page
- Repeated `Comment` controls
- Two visually similar hunks where only one is correct
- Linked issue visible from PR sidebar but not necessarily opened yet

### Seeded State

- 10 to 15 issues
- 4 to 6 PRs
- At least 1 release-blocker issue
- At least 1 PR with 8 to 12 changed files
- Similar issue titles and labels
- At least 1 linked issue tied to the target PR

### Dataset Files

- `github_issue_triage_deep.yaml` (`hard`)
  - Filter issues with qualifiers
  - Open the correct issue
  - Add the right label
  - Assign the right owner
  - Set milestone
  - Leave an exact triage comment
- `github_pr_review.yaml` (`hard`)
  - Open a PR
  - Switch to `Files changed`
  - Filter to the right file path
  - Add an inline diff comment on the correct hunk
  - Mark another file viewed
  - Submit `Request changes`
  - Traverse linked issue and PR context
  - Inspect multiple changed files
  - Add two targeted review comments
  - Set a PR label
  - Submit the correct review state based on a blocker rule

### Semantic Events

- `repo_nav`
- `issue_filter_apply`
- `issue_open`
- `label_add`
- `assignee_set`
- `milestone_set`
- `issue_comment_add`
- `pr_open`
- `pr_tab_change`
- `files_changed_filter_apply`
- `diff_comment_add`
- `file_mark_viewed`
- `review_submit`

## 5. Amazon Mock

### Route

- `/amazon/`

### Why This Site

Northstar currently covers only a focused product-detail and add-to-bag flow. It does not test retail search noise, variant selection, seller/offers disambiguation, cart recovery, or full checkout.

### Real Website Behaviors To Mock

- Homepage search
- Search autocomplete
- Search results with sponsored cards
- Facet filters
- Sort dropdown
- Product detail page gallery
- Variant swatches or dropdowns
- Buy box
- Seller/offers panel
- Cart
- Save for later
- Restore from saved
- Address selection
- Shipping speed selection
- Payment selection
- Review order
- Place order

### Main Challenge

The main challenge is dense decision-making. The correct product may not be the first result, the default variant may be wrong, and the default seller may not satisfy the required delivery or condition constraints.

### Main Interaction Types

- Search
- Filter
- Sort
- Open PDP
- Select variant
- Open offers
- Select seller/offer
- Add to cart
- Adjust quantity
- Save for later
- Restore from saved
- Select address
- Select shipping
- Select payment
- Place order

### Difficulty Levers

- Sponsored result noise
- Sticky buy box
- Default wrong variant
- Offer selection hidden behind secondary control
- Accessory upsell in cart
- Delivery promise changes after address selection
- Repeated `Buy Now` and `Add to Cart` paths

### Seeded State

- 30 to 40 products
- 6 to 8 near-matching results for at least one target query
- At least 1 sponsored decoy
- PDPs with color, size, or configuration variants
- Multiple offers with seller, condition, and delivery differences
- Two addresses with different shipping ETA outcomes

### Dataset Files

- `amazon_variant_checkout.yaml` (`hard`)
  - Search through noisy results
  - Open the correct PDP
  - Select exact color and size
  - Add to cart
  - Remove an auto-added accessory
  - Choose address, shipping, payment
  - Place order
  - Add an item
  - Save it for later
  - Restore it
  - Adjust quantity
  - Remove wrong accessory
  - Change address so shipping updates
  - Complete checkout
- `amazon_offer_disambiguation.yaml` (`very hard`)
  - Search and open correct product
  - Open offers surface
  - Choose exact seller and condition
  - Verify delivery promise
  - Add correct offer to cart
  - Complete checkout without using the wrong `Buy Now` path

### Semantic Events

- `amazon_search_execute`
- `facet_select`
- `results_sort_apply`
- `product_open`
- `variant_select`
- `offer_open`
- `offer_select`
- `cart_add`
- `cart_qty_change`
- `save_for_later`
- `restore_from_saved`
- `address_select`
- `shipping_option_select`
- `payment_select`
- `place_order_click`

## Cross-Site Scoring Guidance

- Score exact object targeting, not approximate intent.
- Require stable seeded IDs in expected events:
  - `threadId`
  - `folderId`
  - `propertyId`
  - `issueNumber`
  - `prNumber`
  - `productId`
  - `offerId`
- Combine checkpoint scoring with final state scoring.
- Do not award full credit for reaching the right page if the wrong object was modified.
- Prefer semantic events over generic click selectors whenever possible.

## Suggested File Additions

### New Frontend Sites

- `eval/gmail/`
- `eval/drive/`
- `eval/booking/`
- `eval/github/`
- `eval/amazon/`

### New Dataset Files

- `eval/dataset/gmail_exec_followup.yaml`
- `eval/dataset/gmail_inbox_cleanup.yaml`
- `eval/dataset/gmail_vendor_escalation.yaml`
- `eval/dataset/drive_project_reorg.yaml`
- `eval/dataset/drive_permission_cleanup.yaml`
- `eval/dataset/drive_bulk_release_assets.yaml`
- `eval/dataset/booking_room_selection.yaml`
- `eval/dataset/booking_compare_and_book.yaml`
- `eval/dataset/booking_family_trip_edgecase.yaml`
- `eval/dataset/github_issue_triage_deep.yaml`
- `eval/dataset/github_pr_review.yaml`
- `eval/dataset/amazon_variant_checkout.yaml`
- `eval/dataset/amazon_offer_disambiguation.yaml`

## Notes

- This spec is challenge-first. The goal is to test OpenBrowser under realistic, difficult workflows, not to reproduce existing easy capabilities.
- Long workflows, repeated controls, contextual toolbars, multi-surface transitions, and decoy objects are desirable.
- The implementations should feel close enough to real websites that the model must genuinely interpret the UI rather than solve a toy puzzle.
