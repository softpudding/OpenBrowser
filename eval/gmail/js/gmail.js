window.tracker = new AgentTracker("mail.google.com", "hard");

(function () {
  const { createSeededStore, escapeHtml, parseOperatorQuery, uniqueSorted, normalize, debounce, formatLongDate } =
    window.HardMockSite;

  const LABELS = [
    { id: "lbl-finance-q2", name: "Finance/Q2" },
    { id: "lbl-vendors-shipping", name: "Vendors/Shipping" },
    { id: "lbl-campaigns-q3", name: "Campaigns/Q3" },
    { id: "lbl-legal-signoff", name: "Legal/Signoff" },
  ];

  const ATTACHMENTS = {
    upload: [
      { id: "pdf-board-pack-revision-c", name: "Board-Pack-Revision-C.pdf", kind: "pdf", size: "1.8 MB" },
      { id: "pdf-vendor-rate-sheet", name: "Vendor-Rate-Sheet-Delta.pdf", kind: "pdf", size: "880 KB" },
      { id: "pdf-campaign-recap", name: "Campaign-Recap-April.pdf", kind: "pdf", size: "2.1 MB" },
    ],
    drive: [
      { id: "drive-vendor-sla-summary", name: "Drive link: Vendor SLA Summary", kind: "drive", size: "Shortcut" },
      { id: "drive-board-annotations", name: "Drive link: Board annotations", kind: "drive", size: "Shortcut" },
      { id: "drive-renewal-notes", name: "Drive link: Renewal notes", kind: "drive", size: "Shortcut" },
    ],
  };

  function createThread(config) {
    return {
      id: config.id,
      category: config.category,
      senderName: config.senderName,
      senderEmail: config.senderEmail,
      subject: config.subject,
      snippet: config.snippet,
      unread: Boolean(config.unread),
      starred: Boolean(config.starred),
      archived: Boolean(config.archived),
      labelIds: config.labelIds || [],
      messages: config.messages || [],
      attachments: config.attachments || [],
      updatedAt: config.updatedAt,
      cluster: config.cluster || "general",
    };
  }

  function buildSeedThreads() {
    const importantThreads = [
      createThread({
        id: "thr-fin-board-pack",
        category: "updates",
        senderName: "Mira Lin",
        senderEmail: "mira.lin@aldercap.com",
        subject: "RE: Q2 Board Packet revisions",
        snippet: "Need your finance follow-up and the signed revision packet before 4 PM.",
        unread: true,
        labelIds: ["lbl-finance-q2"],
        attachments: ["pdf-board-pack-revision-c"],
        updatedAt: "2026-04-10T09:16:00",
        cluster: "board-packet",
        messages: [
          {
            id: "msg-fin-board-pack-1",
            from: "Mira Lin",
            email: "mira.lin@aldercap.com",
            timestamp: "Apr 9, 8:14 PM",
            body:
              "We tightened the appendix and need one final reply before Friday's board prep.\n\nPlease use search operators if needed because there is a promotions decoy with a similar subject.",
          },
          {
            id: "msg-fin-board-pack-2",
            from: "Mira Lin",
            email: "mira.lin@aldercap.com",
            timestamp: "Apr 10, 9:16 AM",
            body:
              "Reply with the exact sentence: Approved for Friday board prep. Please route the signed PDF back before 4 PM.\nAttach the revised PDF, not a Drive link.\nAdd the thread to the Finance/Board-Prep label once you respond.",
          },
        ],
      }),
      createThread({
        id: "thr-fin-board-pack-decoy",
        category: "promotions",
        senderName: "Mira Line Rewards",
        senderEmail: "bonus@mira-line-travel.com",
        subject: "Q2 Board Packet bonus fares",
        snippet: "Board packet members unlock Q2 reward routing and lounge upgrades.",
        unread: true,
        attachments: ["pdf-campaign-recap"],
        updatedAt: "2026-04-10T08:05:00",
        cluster: "board-packet",
        messages: [
          {
            id: "msg-fin-board-pack-decoy-1",
            from: "Mira Line Rewards",
            email: "bonus@mira-line-travel.com",
            timestamp: "Apr 10, 8:05 AM",
            body: "This is a promotions decoy thread and should not be labeled or replied to.",
          },
        ],
      }),
      createThread({
        id: "thr-campaign-april-pulse",
        category: "promotions",
        senderName: "Campaign Ops",
        senderEmail: "pulse@sendercamp.co",
        subject: "April Pulse relaunch / campaign thread",
        snippet: "Creative hold remains unresolved. Archive this campaign once reviewed.",
        unread: true,
        labelIds: ["lbl-campaigns-q3"],
        updatedAt: "2026-04-08T12:10:00",
        cluster: "campaign-cleanup",
        messages: [
          {
            id: "msg-campaign-april-pulse-1",
            from: "Campaign Ops",
            email: "pulse@sendercamp.co",
            timestamp: "Apr 8, 12:10 PM",
            body: "Archive this outdated relaunch campaign thread during inbox cleanup.",
          },
        ],
      }),
      createThread({
        id: "thr-campaign-april-pulse-followup",
        category: "promotions",
        senderName: "Campaign Ops",
        senderEmail: "pulse@sendercamp.co",
        subject: "April Pulse relaunch / campaign thread follow-up",
        snippet: "The retargeting push is canceled. Archive this campaign thread too.",
        unread: true,
        updatedAt: "2026-04-08T12:26:00",
        cluster: "campaign-cleanup",
        messages: [
          {
            id: "msg-campaign-april-pulse-followup-1",
            from: "Campaign Ops",
            email: "pulse@sendercamp.co",
            timestamp: "Apr 8, 12:26 PM",
            body: "This second campaign thread also belongs in the archive.",
          },
        ],
      }),
      createThread({
        id: "thr-campaign-decoy-metrics",
        category: "updates",
        senderName: "Campaign Analytics",
        senderEmail: "metrics@sendercamp.co",
        subject: "April Pulse relaunch metrics snapshot",
        snippet: "This analytics digest looks similar but should stay in the inbox.",
        unread: false,
        updatedAt: "2026-04-08T14:14:00",
        cluster: "campaign-cleanup",
        messages: [
          {
            id: "msg-campaign-decoy-metrics-1",
            from: "Campaign Analytics",
            email: "metrics@sendercamp.co",
            timestamp: "Apr 8, 2:14 PM",
            body: "Keep this metrics digest. It is not one of the campaign threads for archiving.",
          },
        ],
      }),
      createThread({
        id: "thr-urgent-payroll",
        category: "primary",
        senderName: "Priya Shah",
        senderEmail: "priya.shah@northstar.com",
        subject: "Urgent: payroll exception needs review",
        snippet: "Star this thread so the ops lead can find it later today.",
        unread: true,
        updatedAt: "2026-04-10T07:40:00",
        cluster: "inbox-cleanup",
        messages: [
          {
            id: "msg-urgent-payroll-1",
            from: "Priya Shah",
            email: "priya.shah@northstar.com",
            timestamp: "Apr 10, 7:40 AM",
            body: "Please star this urgent payroll exception thread during cleanup.",
          },
        ],
      }),
      createThread({
        id: "thr-renewal-redline",
        category: "updates",
        senderName: "Legal Ops",
        senderEmail: "legal.ops@northstar.com",
        subject: "Vendor renewal redline summary",
        snippet: "Mark this unread so it remains queued for the legal review block.",
        unread: false,
        labelIds: ["lbl-legal-signoff"],
        updatedAt: "2026-04-09T16:02:00",
        cluster: "inbox-cleanup",
        messages: [
          {
            id: "msg-renewal-redline-1",
            from: "Legal Ops",
            email: "legal.ops@northstar.com",
            timestamp: "Apr 9, 4:02 PM",
            body: "Mark this thread unread after cleanup. It should remain visible for legal follow-up.",
          },
        ],
      }),
      createThread({
        id: "thr-vendor-delta-blocker",
        category: "updates",
        senderName: "Casey Moran",
        senderEmail: "casey.moran@deltacomponents.io",
        subject: "Re: Delta Components customs hold",
        snippet: "The latest reply includes the exact escalation recipients and attachment path.",
        unread: true,
        labelIds: ["lbl-vendors-shipping"],
        updatedAt: "2026-04-10T11:05:00",
        cluster: "vendor-escalation",
        messages: [
          {
            id: "msg-vendor-delta-1",
            from: "Casey Moran",
            email: "casey.moran@deltacomponents.io",
            timestamp: "Apr 7, 6:18 PM",
            body:
              "We hit a customs hold in Rotterdam. Initial recommendation was to wait twenty-four hours before escalating.",
          },
          {
            id: "msg-vendor-delta-2",
            from: "Operations Desk",
            email: "ops@northstar.com",
            timestamp: "Apr 8, 8:45 AM",
            body:
              "Please expand the hidden history before acting. The most recent reply changes the escalation path and references a Drive attachment, not a PDF upload.",
          },
          {
            id: "msg-vendor-delta-3",
            from: "Casey Moran",
            email: "casey.moran@deltacomponents.io",
            timestamp: "Apr 10, 11:05 AM",
            body:
              "Escalate this to mila.ops@northstar.com and CC arun.procurement@northstar.com.\nUse the sentence: Escalating the Delta Components shipment blocker. Mila and Arun are looped in for a decision today.\nSave it as a draft first, reopen the draft, then attach the Drive link named Vendor SLA Summary before sending.",
          },
        ],
      }),
      createThread({
        id: "thr-vendor-delta-decoy",
        category: "updates",
        senderName: "Delta Loyalty",
        senderEmail: "offers@deltarewards.travel",
        subject: "Delta travel customs hold FAQ",
        snippet: "A plausible search decoy with the same customs wording.",
        unread: false,
        updatedAt: "2026-04-10T09:48:00",
        cluster: "vendor-escalation",
        messages: [
          {
            id: "msg-vendor-delta-decoy-1",
            from: "Delta Loyalty",
            email: "offers@deltarewards.travel",
            timestamp: "Apr 10, 9:48 AM",
            body: "This travel decoy should not be forwarded or drafted.",
          },
        ],
      }),
    ];

    const fillerClusters = [
      {
        cluster: "finance",
        category: "primary",
        senderName: "Finance Ops",
        senderEmail: "finance.ops@northstar.com",
        baseSubject: "Q2 variance note",
      },
      {
        cluster: "product",
        category: "updates",
        senderName: "Product Announce",
        senderEmail: "announce@northstar.com",
        baseSubject: "Workspace release digest",
      },
      {
        cluster: "sales",
        category: "promotions",
        senderName: "Revenue Studio",
        senderEmail: "hello@revenuestudio.io",
        baseSubject: "Pipeline acceleration package",
      },
      {
        cluster: "vendors",
        category: "updates",
        senderName: "Vendor Desk",
        senderEmail: "vendor.desk@northstar.com",
        baseSubject: "Shipping checkpoint",
      },
    ];

    const fillerThreads = [];
    fillerClusters.forEach((cluster, clusterIndex) => {
      for (let index = 1; index <= 8; index += 1) {
        fillerThreads.push(
          createThread({
            id: `thr-${cluster.cluster}-${index}`,
            category: cluster.category,
            senderName: cluster.senderName,
            senderEmail: cluster.senderEmail,
            subject: `${cluster.baseSubject} ${index}`,
            snippet: `Routine seeded message ${index} for ${cluster.cluster}.`,
            unread: index % 3 === 0,
            starred: index === clusterIndex + 2,
            updatedAt: `2026-04-${String((index % 8) + 1).padStart(2, "0")}T0${(clusterIndex % 4) + 8}:12:00`,
            cluster: cluster.cluster,
            messages: [
              {
                id: `msg-${cluster.cluster}-${index}`,
                from: cluster.senderName,
                email: cluster.senderEmail,
                timestamp: `Apr ${String((index % 8) + 1).padStart(2, "0")}, 8:12 AM`,
                body: `Routine seeded message ${index} in the ${cluster.cluster} cluster.`,
              },
            ],
          }),
        );
      }
    });

    return fillerThreads.concat(importantThreads);
  }

  function buildSeedState() {
    return {
      labels: LABELS.slice(),
      threads: buildSeedThreads(),
      drafts: [],
      ui: {
        mailbox: "primary",
        searchQuery: "",
        openThreadId: null,
        selectedThreadIds: [],
        expandedThreadIds: [],
        modal: null,
      },
      counters: {
        draft: 1,
        label: 1,
      },
    };
  }

  const store = createSeededStore({
    storageKey: "openbrowser.eval.gmail",
    seedState: buildSeedState(),
  });

  const app = document.getElementById("app");

  function getThreadById(state, threadId) {
    return state.threads.find((thread) => thread.id === threadId) || null;
  }

  function getDraftById(state, draftId) {
    return state.drafts.find((draft) => draft.id === draftId) || null;
  }

  function getLabelName(state, labelId) {
    return state.labels.find((label) => label.id === labelId)?.name || labelId;
  }

  function getVisibleThreads(state) {
    const query = state.ui.searchQuery.trim();
    const { operators, terms } = parseOperatorQuery(query);
    const visibleThreads = state.threads.filter((thread) => !thread.archived);

    if (!query) {
      if (state.ui.mailbox === "drafts") {
        return [];
      }

      return visibleThreads.filter((thread) => thread.category === state.ui.mailbox);
    }

    return visibleThreads.filter((thread) => {
      if (operators.from) {
        const senderBlob = `${thread.senderName} ${thread.senderEmail}`;
        if (!normalize(senderBlob).includes(normalize(operators.from))) {
          return false;
        }
      }

      if (operators.subject && !normalize(thread.subject).includes(normalize(operators.subject))) {
        return false;
      }

      if (operators.category && normalize(thread.category) !== normalize(operators.category)) {
        return false;
      }

      if (operators.label) {
        const labelNames = thread.labelIds.map((labelId) => getLabelName(state, labelId)).join(" ");
        if (!normalize(labelNames).includes(normalize(operators.label))) {
          return false;
        }
      }

      if (operators.has === "attachment" && thread.attachments.length === 0) {
        return false;
      }

      const searchBlob = `${thread.senderName} ${thread.senderEmail} ${thread.subject} ${thread.snippet} ${
        thread.messages[thread.messages.length - 1]?.body || ""
      }`;
      return terms.every((term) => normalize(searchBlob).includes(normalize(term)));
    });
  }

  function getMailboxCount(state, mailbox) {
    if (mailbox === "drafts") {
      return state.drafts.length;
    }

    return state.threads.filter((thread) => !thread.archived && thread.category === mailbox).length;
  }

  function getOpenDetail(state) {
    if (state.ui.mailbox === "drafts") {
      return null;
    }

    const openThread = getThreadById(state, state.ui.openThreadId);
    if (openThread && !openThread.archived) {
      return openThread;
    }

    return null;
  }

  function renderSidebar(state) {
    const mailboxes = [
      { id: "primary", label: "Primary" },
      { id: "promotions", label: "Promotions" },
      { id: "updates", label: "Updates" },
      { id: "drafts", label: "Drafts" },
    ];

    return `
      <aside class="gmail-sidebar mock-card">
        <button class="mock-btn gmail-compose-btn" data-action="open-compose" data-mode="new">
          Compose
        </button>
        <div class="gmail-nav-group">
          ${mailboxes
            .map(
              (mailbox) => `
                <button class="gmail-nav-item ${state.ui.mailbox === mailbox.id ? "active" : ""}" data-action="set-mailbox" data-mailbox="${mailbox.id}">
                  <span>${mailbox.label}</span>
                  <span>${getMailboxCount(state, mailbox.id)}</span>
                </button>
              `,
            )
            .join("")}
        </div>
        <div>
          <p class="mock-kicker">Nested Labels</p>
          <div class="gmail-label-list">
            ${state.labels
              .map(
                (label) => `
                  <div class="gmail-label-item">
                    <span>${escapeHtml(label.name)}</span>
                    <span>${state.threads.filter((thread) => thread.labelIds.includes(label.id) && !thread.archived).length}</span>
                  </div>
                `,
              )
              .join("")}
          </div>
        </div>
      </aside>
    `;
  }

  function renderThreadRow(state, thread) {
    const activeClass = state.ui.openThreadId === thread.id ? "active" : "";
    const selectedClass = state.ui.selectedThreadIds.includes(thread.id) ? "selected" : "";
    return `
      <article class="gmail-thread-row ${activeClass} ${selectedClass} ${thread.unread ? "unread" : ""}" data-thread-id="${thread.id}">
        <input class="gmail-thread-checkbox" type="checkbox" data-action="select-thread" data-thread-id="${thread.id}" ${
          state.ui.selectedThreadIds.includes(thread.id) ? "checked" : ""
        }>
        <button class="gmail-thread-star mock-btn-ghost" data-action="toggle-star" data-thread-id="${thread.id}">
          ${thread.starred ? "★" : "☆"}
        </button>
        <button class="gmail-thread-main mock-btn-ghost" data-action="open-thread" data-thread-id="${thread.id}">
          <div class="gmail-thread-topline">
            <span class="gmail-thread-sender">${escapeHtml(thread.senderName)}</span>
            <span class="gmail-thread-subject">${escapeHtml(thread.subject)}</span>
          </div>
          <div class="gmail-thread-meta">
            <span>${escapeHtml(thread.senderEmail)}</span>
            <span>${thread.attachments.length ? "Has attachment" : "No attachment"}</span>
            <span>${thread.category}</span>
          </div>
          <div class="gmail-thread-snippet">${escapeHtml(thread.snippet)}</div>
          <div class="gmail-thread-tags">
            ${thread.labelIds.map((labelId) => `<span class="mock-badge">${escapeHtml(getLabelName(state, labelId))}</span>`).join("")}
          </div>
        </button>
        <div class="gmail-thread-meta">
          <span>${formatLongDate(thread.updatedAt.slice(0, 10))}</span>
        </div>
      </article>
    `;
  }

  function renderListPanel(state) {
    const visibleThreads = getVisibleThreads(state);
    const selectionLabel = state.ui.selectedThreadIds.length
      ? `${state.ui.selectedThreadIds.length} selected`
      : state.ui.searchQuery
        ? `Search results for "${escapeHtml(state.ui.searchQuery)}"`
        : state.ui.mailbox[0].toUpperCase() + state.ui.mailbox.slice(1);

    return `
      <section class="gmail-list-panel mock-card">
        <div class="gmail-list-toolbar">
          <div>
            <p class="mock-kicker">Mailbox</p>
            <h2 class="mock-title">${selectionLabel}</h2>
          </div>
          <div class="gmail-toolbar-actions">
            <button class="mock-btn-secondary" data-action="apply-label" ${
              state.ui.selectedThreadIds.length ? "" : "disabled"
            }>Apply label</button>
            <button class="mock-btn-secondary" data-action="archive-selected" ${
              state.ui.selectedThreadIds.length ? "" : "disabled"
            }>Archive</button>
            <button class="mock-btn-secondary" data-action="mark-unread-selected" ${
              state.ui.selectedThreadIds.length ? "" : "disabled"
            }>Mark unread</button>
          </div>
        </div>
        <div class="gmail-thread-list">
          ${
            state.ui.mailbox === "drafts"
              ? renderDraftList(state)
              : visibleThreads.length
                ? visibleThreads.map((thread) => renderThreadRow(state, thread)).join("")
                : '<div class="mock-empty">No conversations match the current mailbox or operator search.</div>'
          }
        </div>
      </section>
    `;
  }

  function renderDraftList(state) {
    if (!state.drafts.length) {
      return '<div class="mock-empty">No drafts saved yet.</div>';
    }

    return state.drafts
      .map(
        (draft) => `
          <article class="gmail-thread-row" data-draft-id="${draft.id}">
            <div></div>
            <div></div>
            <button class="gmail-thread-main mock-btn-ghost" data-action="open-draft" data-draft-id="${draft.id}">
              <div class="gmail-draft-row">
                <span class="gmail-thread-subject">${escapeHtml(draft.subject || "(no subject)")}</span>
                <span class="gmail-thread-sender">${escapeHtml((draft.to || []).join(", ") || "No recipients")}</span>
                <span class="gmail-thread-snippet">${escapeHtml(draft.body || "Draft body is empty")}</span>
              </div>
            </button>
            <div class="gmail-thread-meta"><span>${formatLongDate(draft.updatedAt.slice(0, 10))}</span></div>
          </article>
        `,
      )
      .join("");
  }

  function renderDetailPanel(state) {
    const thread = getOpenDetail(state);

    if (!thread) {
      return `
        <section class="gmail-detail-panel mock-card">
          <div class="mock-empty">Open a thread to inspect the latest message, expand history, or start a reply.</div>
        </section>
      `;
    }

    const isExpanded = state.ui.expandedThreadIds.includes(thread.id);
    const hiddenMessages = thread.messages.length > 1 && !isExpanded ? thread.messages.slice(0, -1) : [];
    const visibleMessages = isExpanded ? thread.messages : thread.messages.slice(-1);

    return `
      <section class="gmail-detail-panel mock-card">
        <div class="gmail-thread-detail">
          <div class="gmail-thread-header">
            <div>
              <p class="mock-kicker">Conversation</p>
              <h2 class="mock-title">${escapeHtml(thread.subject)}</h2>
              <p class="mock-subtle">${escapeHtml(thread.senderName)} · ${escapeHtml(thread.senderEmail)}</p>
            </div>
            <div class="gmail-detail-actions">
              <button class="mock-btn-secondary" data-action="toggle-star" data-thread-id="${thread.id}">
                ${thread.starred ? "Unstar" : "Star"}
              </button>
              <button class="mock-btn-secondary" data-action="mark-thread-unread" data-thread-id="${thread.id}">
                Mark unread
              </button>
              <button class="mock-btn-secondary" data-action="open-compose" data-mode="reply" data-thread-id="${thread.id}">
                Reply
              </button>
              <button class="mock-btn-secondary" data-action="open-compose" data-mode="forward" data-thread-id="${thread.id}">
                Forward
              </button>
            </div>
          </div>
          ${
            hiddenMessages.length
              ? `
                <div class="gmail-collapsed-banner">
                  <div>
                    <strong>${hiddenMessages.length} older replies are collapsed</strong>
                    <div class="mock-subtle">Expand the history before acting if the latest reply references older context.</div>
                  </div>
                  <button class="mock-btn-secondary" data-action="expand-thread" data-thread-id="${thread.id}">
                    Show history
                  </button>
                </div>
              `
              : ""
          }
          ${visibleMessages
            .map(
              (message) => `
                <article class="gmail-message-card">
                  <div class="gmail-message-head">
                    <div>
                      <strong>${escapeHtml(message.from)}</strong>
                      <div class="mock-subtle">${escapeHtml(message.email)}</div>
                    </div>
                    <span class="mock-badge">${escapeHtml(message.timestamp)}</span>
                  </div>
                  <div class="gmail-message-body">${escapeHtml(message.body)}</div>
                </article>
              `,
            )
            .join("")}
          ${
            thread.attachments.length
              ? `
                <div>
                  <p class="mock-kicker">Existing Attachments</p>
                  <div class="gmail-thread-tags">
                    ${thread.attachments
                      .map((attachmentId) => {
                        const attachment = ATTACHMENTS.upload
                          .concat(ATTACHMENTS.drive)
                          .find((item) => item.id === attachmentId);
                        return `<span class="mock-badge">${escapeHtml(attachment ? attachment.name : attachmentId)}</span>`;
                      })
                      .join("")}
                  </div>
                </div>
              `
              : ""
          }
        </div>
      </section>
    `;
  }

  function renderComposeModal(state) {
    const modal = state.ui.modal;
    if (!modal || modal.type !== "compose") {
      return "";
    }

    const attachmentSource = modal.attachmentSource || "upload";
    const attachmentChoices = ATTACHMENTS[attachmentSource];

    return `
      <div class="mock-modal-backdrop">
        <div class="mock-modal gmail-compose-modal">
          <div class="mock-modal-header">
            <div>
              <p class="mock-kicker">${escapeHtml(modal.mode)} draft</p>
              <h3 class="mock-title">${escapeHtml(modal.subject || "(no subject)")}</h3>
            </div>
            <button class="mock-btn-ghost" data-action="close-compose">Close</button>
          </div>
          <div class="mock-modal-body">
            <div class="gmail-compose-grid two-col">
              <div>
                <label class="mock-kicker" for="compose-to">To</label>
                <input id="compose-to" class="mock-input" data-field="to" value="${escapeHtml((modal.to || []).join(", "))}">
              </div>
              <div>
                <label class="mock-kicker" for="compose-cc">CC</label>
                <input id="compose-cc" class="mock-input" data-field="cc" value="${escapeHtml((modal.cc || []).join(", "))}">
              </div>
            </div>
            <div class="gmail-compose-grid">
              <div>
                <label class="mock-kicker" for="compose-subject">Subject</label>
                <input id="compose-subject" class="mock-input" data-field="subject" value="${escapeHtml(modal.subject || "")}">
              </div>
              <div>
                <label class="mock-kicker" for="compose-body">Message</label>
                <textarea id="compose-body" class="mock-textarea" rows="9" data-field="body">${escapeHtml(modal.body || "")}</textarea>
              </div>
            </div>
            <div class="gmail-compose-toolbar">
              <button class="mock-btn-secondary" data-action="open-attachment-picker">Add attachment</button>
              <button class="mock-btn-secondary" data-action="save-draft">Save draft</button>
              <span class="mock-pill">Draft ID: ${escapeHtml(modal.id)}</span>
              <span class="mock-pill">Autosaves on typing</span>
            </div>
            <div>
              <p class="mock-kicker">Attachments</p>
              <div class="gmail-thread-tags">
                ${(modal.attachments || []).length
                  ? modal.attachments
                      .map((attachmentId) => {
                        const attachment = ATTACHMENTS.upload.concat(ATTACHMENTS.drive).find((item) => item.id === attachmentId);
                        return `<span class="mock-badge">${escapeHtml(attachment ? attachment.name : attachmentId)}</span>`;
                      })
                      .join("")
                  : '<span class="mock-subtle">No attachments yet.</span>'}
              </div>
            </div>
            ${
              modal.showAttachmentPicker
                ? `
                  <div class="mock-card" style="padding: 18px; margin-top: 18px;">
                    <div class="gmail-detail-actions" style="margin-bottom: 14px;">
                      <button class="mock-btn-secondary" data-action="set-attachment-source" data-source="upload">Mock upload</button>
                      <button class="mock-btn-secondary" data-action="set-attachment-source" data-source="drive">Drive link</button>
                    </div>
                    <div class="gmail-attachment-grid">
                      ${attachmentChoices
                        .map(
                          (attachment) => `
                            <button class="gmail-attachment-card ${modal.attachments.includes(attachment.id) ? "active" : ""}" data-action="attach-item" data-attachment-id="${attachment.id}">
                              <div class="mock-kicker">${escapeHtml(attachment.kind)}</div>
                              <strong>${escapeHtml(attachment.name)}</strong>
                              <div class="mock-subtle">${escapeHtml(attachment.size)}</div>
                            </button>
                          `,
                        )
                        .join("")}
                    </div>
                  </div>
                `
                : ""
            }
          </div>
          <div class="mock-modal-footer">
            <span class="mock-subtle">Underlying inbox stays visible beneath the compose modal, similar to Gmail.</span>
            <div class="gmail-compose-actions">
              <button class="mock-btn-secondary" data-action="apply-label-from-compose">Apply label</button>
              <button class="mock-btn" data-action="send-compose">Send</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderLabelModal(state) {
    const modal = state.ui.modal;
    if (!modal || modal.type !== "label") {
      return "";
    }

    return `
      <div class="mock-modal-backdrop">
        <div class="mock-modal">
          <div class="mock-modal-header">
            <div>
              <p class="mock-kicker">Thread labels</p>
              <h3 class="mock-title">Apply or create a nested label</h3>
            </div>
            <button class="mock-btn-ghost" data-action="close-label-modal">Close</button>
          </div>
          <div class="mock-modal-body">
            <div class="gmail-label-grid">
              ${state.labels
                .map(
                  (label) => `
                    <button class="gmail-label-option" data-action="commit-label" data-label-id="${label.id}">
                      <span>${escapeHtml(label.name)}</span>
                      <span class="mock-subtle">Apply</span>
                    </button>
                  `,
                )
                .join("")}
            </div>
            <div style="margin-top: 18px;">
              <label class="mock-kicker" for="new-label-name">Create a new label</label>
              <input id="new-label-name" class="mock-input" data-role="new-label-name" value="${escapeHtml(modal.newLabelName || "")}" placeholder="Finance/Board-Prep">
            </div>
          </div>
          <div class="mock-modal-footer">
            <span class="mock-subtle">Selected threads: ${escapeHtml((modal.threadIds || []).join(", "))}</span>
            <button class="mock-btn" data-action="create-label">Create label</button>
          </div>
        </div>
      </div>
    `;
  }

  function render() {
    const state = store.getState();
    app.innerHTML = `
      <div class="mock-page gmail-page">
        <header class="mock-topbar">
          <div class="gmail-topbar-inner">
            <div class="gmail-brand">
              <div class="gmail-brand-mark">M</div>
              <div>
                <div>Mailbox Workspace</div>
                <div class="mock-subtle">Primary, Promotions, Updates, Drafts</div>
              </div>
            </div>
            <form class="gmail-search-form" id="gmail-search-form">
              <input class="mock-input" id="gmail-search-input" value="${escapeHtml(state.ui.searchQuery)}" placeholder='Search mail. Operators: from:, subject:, label:, category:, has:attachment'>
              <button class="mock-btn gmail-search-submit" type="submit">Search</button>
            </form>
            <div class="gmail-topbar-actions">
              <span class="mock-pill">35+ seeded threads</span>
              <span class="mock-pill">Selection toolbar is stateful</span>
            </div>
          </div>
        </header>
        <main class="gmail-layout">
          ${renderSidebar(state)}
          ${renderListPanel(state)}
          ${renderDetailPanel(state)}
        </main>
        ${renderComposeModal(state)}
        ${renderLabelModal(state)}
      </div>
    `;
  }

  function trackSearch(query) {
    const parsed = parseOperatorQuery(query);
    tracker.track("mail_search_execute", {
      query,
      operators: Object.keys(parsed.operators).sort(),
      hasAttachmentOperator: parsed.operators.has === "attachment",
    });
  }

  function setMailbox(mailbox) {
    store.update((state) => {
      state.ui.mailbox = mailbox;
      state.ui.selectedThreadIds = [];
      state.ui.searchQuery = "";
    });
    render();
  }

  function openThread(threadId) {
    const nextState = store.update((state) => {
      state.ui.openThreadId = threadId;
      state.ui.mailbox = getThreadById(state, threadId)?.category || state.ui.mailbox;
      const thread = getThreadById(state, threadId);
      if (thread) {
        thread.unread = false;
      }
    });
    const thread = getThreadById(nextState, threadId);
    if (thread) {
      tracker.track("thread_open", {
        threadId: thread.id,
        category: thread.category,
        cluster: thread.cluster,
      });
    }
    render();
  }

  function toggleSelection(threadId) {
    const nextState = store.update((state) => {
      const selected = new Set(state.ui.selectedThreadIds);
      if (selected.has(threadId)) {
        selected.delete(threadId);
      } else {
        selected.add(threadId);
      }
      state.ui.selectedThreadIds = Array.from(selected);
    });

    tracker.track("thread_select", {
      threadId,
      threadIds: uniqueSorted(nextState.ui.selectedThreadIds),
    });
    render();
  }

  function toggleStar(threadId) {
    const nextState = store.update((state) => {
      const thread = getThreadById(state, threadId);
      if (thread) {
        thread.starred = !thread.starred;
      }
    });
    const thread = getThreadById(nextState, threadId);
    if (thread) {
      tracker.track("thread_star_toggle", {
        threadId,
        starred: thread.starred,
      });
    }
    render();
  }

  function archiveSelected() {
    const stateBefore = store.getState();
    const targetIds = uniqueSorted(stateBefore.ui.selectedThreadIds);
    if (!targetIds.length) {
      return;
    }

    store.update((state) => {
      state.threads.forEach((thread) => {
        if (targetIds.includes(thread.id)) {
          thread.archived = true;
        }
      });
      state.ui.selectedThreadIds = [];
      if (targetIds.includes(state.ui.openThreadId)) {
        state.ui.openThreadId = null;
      }
    });

    tracker.track("thread_archive", {
      threadIds: targetIds,
    });
    render();
  }

  function markUnread(targetIds) {
    const sortedIds = uniqueSorted(targetIds);
    if (!sortedIds.length) {
      return;
    }

    store.update((state) => {
      state.threads.forEach((thread) => {
        if (sortedIds.includes(thread.id)) {
          thread.unread = true;
        }
      });
      state.ui.selectedThreadIds = [];
    });

    tracker.track("thread_mark_unread", {
      threadIds: sortedIds,
      threadId: sortedIds[0],
    });
    render();
  }

  function expandThread(threadId) {
    const nextState = store.update((state) => {
      if (!state.ui.expandedThreadIds.includes(threadId)) {
        state.ui.expandedThreadIds.push(threadId);
      }
    });
    const thread = getThreadById(nextState, threadId);
    tracker.track("thread_expand", {
      threadId,
      expandedMessages: thread ? thread.messages.length : 0,
    });
    render();
  }

  function openLabelModal(threadIds) {
    store.update((state) => {
      state.ui.modal = {
        type: "label",
        threadIds: uniqueSorted(threadIds),
        newLabelName: "",
      };
    });
    render();
  }

  function applyLabel(labelId, threadIds) {
    const targetIds = uniqueSorted(threadIds);
    store.update((state) => {
      state.threads.forEach((thread) => {
        if (targetIds.includes(thread.id) && !thread.labelIds.includes(labelId)) {
          thread.labelIds.push(labelId);
        }
      });
      if (state.ui.modal?.type === "label") {
        state.ui.modal = null;
      }
    });

    tracker.track("label_apply", {
      labelId,
      labelName: getLabelName(store.getState(), labelId),
      threadIds: targetIds,
      threadId: targetIds[0],
    });
    render();
  }

  function createLabel() {
    const state = store.getState();
    const modal = state.ui.modal;
    if (!modal || modal.type !== "label") {
      return;
    }

    const name = (modal.newLabelName || "").trim();
    if (!name) {
      return;
    }

    const labelId = `lbl-custom-${state.counters.label}`;
    store.update((draft) => {
      draft.labels.push({ id: labelId, name });
      draft.counters.label += 1;
    });

    tracker.track("label_create", {
      labelId,
      labelName: name,
    });
    applyLabel(labelId, modal.threadIds || []);
  }

  function createComposeModal(mode, threadId, existingDraft) {
    const state = store.getState();
    const thread = threadId ? getThreadById(state, threadId) : null;
    const draftId = existingDraft?.id || `draft-${state.counters.draft}`;
    const subjectPrefix = mode === "forward" ? "Fwd: " : mode === "reply" ? "Re: " : "";

    const composeModal = {
      type: "compose",
      id: draftId,
      mode,
      threadId: threadId || null,
      subject: existingDraft?.subject || (thread ? `${subjectPrefix}${thread.subject}` : ""),
      to:
        existingDraft?.to ||
        (mode === "reply" && thread ? [thread.senderEmail] : mode === "forward" ? [] : []),
      cc: existingDraft?.cc || [],
      body: existingDraft?.body || "",
      attachments: existingDraft?.attachments || [],
      attachmentSource: existingDraft?.attachmentSource || "upload",
      showAttachmentPicker: false,
    };

    store.update((draft) => {
      if (!existingDraft) {
        draft.counters.draft += 1;
      }
      draft.ui.modal = composeModal;
    });

    if (mode === "reply") {
      tracker.track("reply_open", {
        threadId,
        draftId,
      });
    } else {
      tracker.track("compose_open", {
        threadId: threadId || null,
        draftId,
        mode,
      });
    }

    render();
  }

  const autosaveDraft = debounce(() => {
    const state = store.getState();
    const modal = state.ui.modal;
    if (!modal || modal.type !== "compose") {
      return;
    }

    tracker.track("draft_autosave", {
      draftId: modal.id,
      threadId: modal.threadId || null,
      mode: modal.mode,
    });
  }, 300);

  function upsertDraftFromModal(closeAfterSave) {
    const state = store.getState();
    const modal = state.ui.modal;
    if (!modal || modal.type !== "compose") {
      return;
    }

    const draftRecord = {
      id: modal.id,
      threadId: modal.threadId,
      mode: modal.mode,
      subject: modal.subject,
      to: modal.to || [],
      cc: modal.cc || [],
      body: modal.body,
      attachments: modal.attachments || [],
      attachmentSource: modal.attachmentSource || "upload",
      updatedAt: new Date().toISOString(),
    };

    store.update((draft) => {
      const existingIndex = draft.drafts.findIndex((item) => item.id === draftRecord.id);
      if (existingIndex >= 0) {
        draft.drafts.splice(existingIndex, 1, draftRecord);
      } else {
        draft.drafts.unshift(draftRecord);
      }

      if (closeAfterSave) {
        draft.ui.modal = null;
      }
    });

    tracker.track("draft_autosave", {
      draftId: draftRecord.id,
      threadId: draftRecord.threadId || null,
      mode: modal.mode,
    });

    if (closeAfterSave) {
      render();
    }
  }

  function sendCompose() {
    const state = store.getState();
    const modal = state.ui.modal;
    if (!modal || modal.type !== "compose") {
      return;
    }

    store.update((draft) => {
      if (modal.threadId) {
        const thread = getThreadById(draft, modal.threadId);
        if (thread) {
          thread.messages.push({
            id: `${modal.id}-sent`,
            from: "You",
            email: "me@northstar.com",
            timestamp: "Apr 10, 12:30 PM",
            body: modal.body,
          });
          thread.unread = false;
          if (modal.attachments.length) {
            thread.attachments = uniqueSorted(thread.attachments.concat(modal.attachments));
          }
        }
      }

      draft.drafts = draft.drafts.filter((item) => item.id !== modal.id);
      draft.ui.modal = null;
    });

    tracker.track("mail_send", {
      draftId: modal.id,
      threadId: modal.threadId || null,
      mode: modal.mode,
      to: modal.to || [],
      cc: modal.cc || [],
      subject: modal.subject,
      body: modal.body,
      attachmentIds: uniqueSorted(modal.attachments || []),
    });

    render();
  }

  function updateComposeField(field, value) {
    store.update((state) => {
      const modal = state.ui.modal;
      if (!modal || modal.type !== "compose") {
        return;
      }

      if (field === "to" || field === "cc") {
        modal[field] = value
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean);
      } else {
        modal[field] = value;
      }
    });
    upsertDraftFromModal(false);
    autosaveDraft();
  }

  function attachItem(attachmentId) {
    const state = store.getState();
    const modal = state.ui.modal;
    if (!modal || modal.type !== "compose") {
      return;
    }

    const attachmentPool = ATTACHMENTS.upload.concat(ATTACHMENTS.drive);
    const attachment = attachmentPool.find((item) => item.id === attachmentId);
    if (!attachment) {
      return;
    }

    store.update((draft) => {
      const compose = draft.ui.modal;
      if (!compose || compose.type !== "compose") {
        return;
      }
      if (!compose.attachments.includes(attachmentId)) {
        compose.attachments.push(attachmentId);
      }
    });

    tracker.track("attachment_add", {
      draftId: modal.id,
      attachmentId,
      source: normalize(attachment.kind) === "drive" ? "drive" : "upload",
    });
    upsertDraftFromModal(false);
    render();
  }

  app.addEventListener("submit", (event) => {
    if (event.target.id !== "gmail-search-form") {
      return;
    }

    event.preventDefault();
    const input = document.getElementById("gmail-search-input");
    const query = input ? input.value.trim() : "";
    store.update((state) => {
      state.ui.searchQuery = query;
      state.ui.selectedThreadIds = [];
    });
    trackSearch(query);
    render();
  });

  app.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) {
      return;
    }

    const action = target.dataset.action;
    const threadId = target.dataset.threadId;
    const draftId = target.dataset.draftId;

    if (action === "set-mailbox") {
      setMailbox(target.dataset.mailbox);
      return;
    }

    if (action === "open-thread" && threadId) {
      openThread(threadId);
      return;
    }

    if (action === "select-thread" && threadId) {
      toggleSelection(threadId);
      return;
    }

    if (action === "toggle-star" && threadId) {
      toggleStar(threadId);
      return;
    }

    if (action === "archive-selected") {
      archiveSelected();
      return;
    }

    if (action === "mark-unread-selected") {
      markUnread(store.getState().ui.selectedThreadIds);
      return;
    }

    if (action === "mark-thread-unread" && threadId) {
      markUnread([threadId]);
      return;
    }

    if (action === "expand-thread" && threadId) {
      expandThread(threadId);
      return;
    }

    if (action === "apply-label") {
      openLabelModal(store.getState().ui.selectedThreadIds);
      return;
    }

    if (action === "commit-label") {
      const modal = store.getState().ui.modal;
      applyLabel(target.dataset.labelId, modal?.threadIds || []);
      return;
    }

    if (action === "create-label") {
      createLabel();
      return;
    }

    if (action === "close-label-modal") {
      store.update((state) => {
        state.ui.modal = null;
      });
      render();
      return;
    }

    if (action === "open-compose") {
      createComposeModal(target.dataset.mode || "new", threadId || null, null);
      return;
    }

    if (action === "close-compose") {
      upsertDraftFromModal(true);
      return;
    }

    if (action === "open-draft" && draftId) {
      const draft = getDraftById(store.getState(), draftId);
      if (draft) {
        createComposeModal(draft.mode || (draft.threadId ? "forward" : "draft"), draft.threadId || null, draft);
      }
      return;
    }

    if (action === "save-draft") {
      upsertDraftFromModal(true);
      return;
    }

    if (action === "send-compose") {
      sendCompose();
      return;
    }

    if (action === "open-attachment-picker") {
      store.update((state) => {
        if (state.ui.modal?.type === "compose") {
          state.ui.modal.showAttachmentPicker = !state.ui.modal.showAttachmentPicker;
        }
      });
      render();
      return;
    }

    if (action === "set-attachment-source") {
      store.update((state) => {
        if (state.ui.modal?.type === "compose") {
          state.ui.modal.attachmentSource = target.dataset.source;
        }
      });
      render();
      return;
    }

    if (action === "attach-item") {
      attachItem(target.dataset.attachmentId);
      return;
    }

    if (action === "apply-label-from-compose") {
      const modal = store.getState().ui.modal;
      const threadIds = modal?.threadId ? [modal.threadId] : [];
      if (threadIds.length) {
        openLabelModal(threadIds);
      }
      return;
    }
  });

  app.addEventListener("input", (event) => {
    const modal = store.getState().ui.modal;
    if (!modal) {
      return;
    }

    const field = event.target.dataset.field;
    if (modal.type === "compose" && field) {
      updateComposeField(field, event.target.value);
      return;
    }

    if (modal.type === "label" && event.target.dataset.role === "new-label-name") {
      store.update((state) => {
        if (state.ui.modal?.type === "label") {
          state.ui.modal.newLabelName = event.target.value;
        }
      });
    }
  });

  render();
})();
