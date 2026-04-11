window.tracker = new AgentTracker("github.com", "hard");

(function () {
  const { createSeededStore, escapeHtml } = window.HardMockSite;

  function createIssue(config) {
    return {
      number: config.number,
      title: config.title,
      labels: config.labels || [],
      assignee: config.assignee || "",
      milestone: config.milestone || "",
      comments: config.comments || [],
      linkedPr: config.linkedPr || null,
      state: "open",
    };
  }

  function createPr(config) {
    return {
      number: config.number,
      title: config.title,
      labels: config.labels || [],
      linkedIssue: config.linkedIssue || null,
      conversation: config.conversation || [],
      files: config.files || [],
      reviewState: "",
    };
  }

  function buildSeedState() {
    const issues = [
      createIssue({
        number: 118,
        title: "Release blocker: billing webhook retries duplicate invoices",
        labels: ["release-blocker"],
        assignee: "",
        milestone: "",
        comments: ["The duplicate invoice path still appears in staging after repeated webhook retries."],
        linkedPr: 42,
      }),
      createIssue({
        number: 119,
        title: "Release blocker: billing webhook retries stale invoices",
        labels: ["release-blocker"],
        assignee: "kenji-review",
        milestone: "April Patch",
        comments: [],
      }),
      createIssue({
        number: 127,
        title: "Review queue: onboarding badge copy mismatch",
        labels: ["copy"],
        assignee: "",
        milestone: "",
        comments: [],
      }),
    ];

    for (let index = 1; index <= 9; index += 1) {
      issues.push(
        createIssue({
          number: 130 + index,
          title: `Seeded issue ${index}: platform cleanup task`,
          labels: index % 2 ? ["infra"] : ["ux"],
          assignee: index % 3 === 0 ? "mila-ops" : "",
          milestone: index % 4 === 0 ? "May Launch" : "",
          comments: [],
        }),
      );
    }

    const prs = [
      createPr({
        number: 42,
        title: "Tighten billing retry guard before release",
        linkedIssue: 118,
        labels: ["needs-review"],
        conversation: ["Blocks launch until the billing retry guard and dashboard wording are reviewed."],
        files: [
          {
            path: "api/billing/webhook_retry_adapter.py",
            viewed: false,
            hunks: [
              {
                id: "adapter-status-map",
                title: "Adapter response mapping",
                code: "status = map_retry_status(payload)",
                comments: [],
              },
            ],
          },
          {
            path: "api/billing/webhook_retry_adapter_test.py",
            viewed: false,
            hunks: [
              {
                id: "adapter-assertion-gap",
                title: "Adapter retry assertion gap",
                code: "assert response['retryable'] is True",
                comments: [],
              },
            ],
          },
          {
            path: "docs/billing/retry-policy-rollout.md",
            viewed: false,
            hunks: [
              {
                id: "rollout-note",
                title: "Rollout note refresh",
                code: "- Verify retry guard before launch freeze",
                comments: [],
              },
            ],
          },
          {
            path: "ops/runbooks/webhook-retry-playbook.md",
            viewed: false,
            hunks: [
              {
                id: "playbook-step",
                title: "Retry playbook wording",
                code: "1. Confirm retry count in staging",
                comments: [],
              },
            ],
          },
          {
            path: "server/billing/retry_backoff.py",
            viewed: false,
            hunks: [
              {
                id: "backoff-jitter",
                title: "Backoff jitter change",
                code: "delay = base_delay * multiplier",
                comments: [],
              },
            ],
          },
          {
            path: "server/billing/retry_policy_guard.py",
            viewed: false,
            hunks: [
              {
                id: "guard-wrapper-inline",
                title: "Inline retry guard wrapper",
                code: "return guard.should_block(order, attempts)",
                comments: [],
              },
            ],
          },
          {
            path: "server/billing/retry_policy.py",
            viewed: false,
            hunks: [
              {
                id: "retry-cap-guard",
                title: "Cap retries before duplicate invoice emission",
                code: "if attempts > MAX_RETRIES:\n    emit_duplicate_invoice(order)\n    return False",
                comments: [],
              },
            ],
          },
          {
            path: "server/billing/retry_policies.py",
            viewed: false,
            hunks: [
              {
                id: "legacy-policy-cleanup",
                title: "Legacy policy rename",
                code: "LEGACY_RETRY_POLICY = DEFAULTS.copy()",
                comments: [],
              },
            ],
          },
          {
            path: "server/billing/retry_policy_test.py",
            viewed: false,
            hunks: [
              {
                id: "retry-test-gap",
                title: "Expected retry cap",
                code: "assert retries == 4",
                comments: [],
              },
            ],
          },
          {
            path: "services/invoice/retry_guard.py",
            viewed: false,
            hunks: [
              {
                id: "guard-wrapper",
                title: "Guard wrapper around retry policy",
                code: "return retry_policy.should_retry(invoice, attempts)",
                comments: [],
              },
            ],
          },
          {
            path: "services/invoice/retry_guard_metrics.py",
            viewed: false,
            hunks: [
              {
                id: "metrics-tag",
                title: "Retry metrics tag adjustment",
                code: "metrics.increment('invoice.retry_guard.blocked')",
                comments: [],
              },
            ],
          },
          {
            path: "web/dashboard/release_gate_banner.tsx",
            viewed: false,
            hunks: [
              {
                id: "banner-copy",
                title: "Release banner copy",
                code: "return <Banner tone='info'>{copy}</Banner>",
                comments: [],
              },
            ],
          },
          {
            path: "web/dashboard/release_gate.ts",
            viewed: false,
            hunks: [
              {
                id: "status-badge-copy",
                title: "Status badge still reads ready to ship",
                code: "badge.copy = 'Ready to ship'\nif (hasBlocker) badge.tone = 'green'",
                comments: [],
              },
            ],
          },
          {
            path: "web/dashboard/release_gate_badge.tsx",
            viewed: false,
            hunks: [
              {
                id: "tone-mismatch",
                title: "Badge tone mismatch",
                code: "return <Badge tone='success'>{copy}</Badge>",
                comments: [],
              },
            ],
          },
          {
            path: "docs/release-checklist.md",
            viewed: false,
            hunks: [
              {
                id: "release-doc-copy",
                title: "Checklist wording update",
                code: "- Billing retry guard verified",
                comments: [],
              },
            ],
          },
        ],
      }),
      createPr({
        number: 44,
        title: "Polish review queue counters",
        linkedIssue: 127,
        labels: ["ux"],
        conversation: ["Non-blocking polish PR."],
        files: [],
      }),
    ];

    for (let index = 1; index <= 3; index += 1) {
      prs.push(
        createPr({
          number: 50 + index,
          title: `Seeded PR ${index}: misc cleanup`,
          linkedIssue: null,
          labels: ["maintenance"],
          conversation: ["Routine seeded PR."],
          files: [],
        }),
      );
    }

    return {
      issues,
      prs,
      ui: {
        repoTab: "issues",
        issueFilter: "",
        selectedIssueNumber: null,
        selectedPrNumber: null,
        prTab: "conversation",
        fileFilter: "",
        selectedFilePath: "",
        modal: null,
      },
    };
  }

  const store = createSeededStore({
    storageKey: "openbrowser.eval.github",
    seedState: buildSeedState(),
  });

  const LABEL_OPTIONS = ["release-blocker", "triage-needs-pm", "release-blocked", "needs-review"];
  const ASSIGNEE_OPTIONS = ["", "mila-ops", "kenji-review", "sara-devrel"];
  const MILESTONE_OPTIONS = ["", "May Launch", "April Patch", "Q2 Stabilization"];

  const app = document.getElementById("app");

  function getIssue(state, number) {
    return state.issues.find((issue) => issue.number === Number(number)) || null;
  }

  function getPr(state, number) {
    return state.prs.find((pr) => pr.number === Number(number)) || null;
  }

  function stemToken(token) {
    if (token.endsWith("ies") && token.length > 4) {
      return `${token.slice(0, -3)}y`;
    }
    if (token.endsWith("s") && token.length > 4) {
      return token.slice(0, -1);
    }
    return token;
  }

  function tokenizeSearch(text) {
    return String(text || "")
      .toLowerCase()
      .split(/[^a-z0-9-]+/)
      .filter(Boolean)
      .map(stemToken);
  }

  function parseIssueFilter(query) {
    const normalized = String(query || "").trim().toLowerCase();
    const labelMatches = Array.from(normalized.matchAll(/label:([^\s]+)/g)).map((match) => match[1]);
    const remainder = normalized.replace(/label:[^\s]+/g, " ").replace(/is:open/g, " ");
    return {
      requireOpen: normalized.includes("is:open"),
      labels: labelMatches,
      terms: tokenizeSearch(remainder),
    };
  }

  function matchesIssueFilter(issue, query) {
    if (!query.trim()) {
      return true;
    }

    const parsed = parseIssueFilter(query);
    if (parsed.requireOpen && issue.state !== "open") {
      return false;
    }
    if (parsed.labels.some((label) => !issue.labels.includes(label))) {
      return false;
    }

    const issueTokens = new Set(tokenizeSearch(`${issue.title} ${issue.number} ${issue.labels.join(" ")}`));
    return parsed.terms.every((term) => issueTokens.has(term));
  }

  function renderTopbar(state) {
    return `
      <header class="mock-topbar">
        <div class="github-topbar">
          <div class="github-brand">
            <div class="github-brand-mark">GH</div>
            <div>
              <div>northstar/platform</div>
              <div class="mock-subtle">Issues, PRs, files changed, review actions</div>
            </div>
          </div>
          <div class="mock-subtle">Many controls reuse the same words, but context matters: issue labels are not PR labels, and diff comments are not review summaries.</div>
          <div style="display: flex; gap: 10px;">
            <span class="mock-pill">Issues + PRs</span>
            <span class="mock-pill">Files changed is separate</span>
          </div>
        </div>
      </header>
    `;
  }

  function renderRepoNav(state) {
    return `
      <div class="github-repo-nav">
        <button class="mock-btn-ghost ${state.ui.repoTab === "issues" ? "active" : ""}" data-action="set-repo-tab" data-tab="issues">Issues</button>
        <button class="mock-btn-ghost ${state.ui.repoTab === "pulls" ? "active" : ""}" data-action="set-repo-tab" data-tab="pulls">Pull requests</button>
      </div>
    `;
  }

  function renderIssueList(state) {
    const issues = state.issues.filter((issue) => matchesIssueFilter(issue, state.ui.issueFilter));

    return `
      <section class="github-list-panel mock-card">
        <div class="github-filter-bar">
          <input id="issue-filter-input" class="mock-input" value="${escapeHtml(state.ui.issueFilter)}" placeholder="Filter issues with qualifiers">
          <button class="mock-btn" data-action="apply-issue-filter">Filter</button>
        </div>
        <div class="github-list">
          ${issues
            .map(
              (issue) => `
                <article class="github-list-item">
                  <div class="github-item-head">
                    <div>
                      <div class="github-item-title">#${issue.number} ${escapeHtml(issue.title)}</div>
                      <div class="github-metadata">
                        ${issue.labels.map((label) => `<span class="mock-badge">${escapeHtml(label)}</span>`).join("")}
                        ${issue.milestone ? `<span class="mock-badge">${escapeHtml(issue.milestone)}</span>` : ""}
                      </div>
                    </div>
                    <button class="mock-btn" data-action="open-issue" data-issue-number="${issue.number}">Open</button>
                  </div>
                </article>
              `,
            )
            .join("")}
        </div>
      </section>
    `;
  }

  function renderIssueDetail(state) {
    const issue = getIssue(state, state.ui.selectedIssueNumber);
    if (!issue) {
      return renderIssueList(state);
    }

    return `
      <section class="github-detail-panel mock-card">
        <div class="github-item-head">
          <div>
            <p class="mock-kicker">Issue #${issue.number}</p>
            <h2 class="mock-title">${escapeHtml(issue.title)}</h2>
            <div class="github-metadata">
              ${issue.labels.map((label) => `<span class="mock-badge">${escapeHtml(label)}</span>`).join("")}
              ${issue.assignee ? `<span class="mock-badge">${escapeHtml(issue.assignee)}</span>` : ""}
              ${issue.milestone ? `<span class="mock-badge">${escapeHtml(issue.milestone)}</span>` : ""}
            </div>
          </div>
          <button class="mock-btn-secondary" data-action="back-to-issue-list">Back</button>
        </div>
        <div class="github-comment-card" style="margin-top: 14px;">
          <div class="mock-kicker">Discussion</div>
          ${issue.comments.map((comment) => `<div class="mock-subtle">${escapeHtml(comment)}</div>`).join("") || '<div class="mock-subtle">No additional comments yet.</div>'}
        </div>
      </section>
    `;
  }

  function renderPrList(state) {
    return `
      <section class="github-list-panel mock-card">
        <div class="github-list">
          ${state.prs
            .map(
              (pr) => `
                <article class="github-list-item">
                  <div class="github-item-head">
                    <div>
                      <div class="github-item-title">#${pr.number} ${escapeHtml(pr.title)}</div>
                      <div class="github-metadata">
                        ${pr.labels.map((label) => `<span class="mock-badge">${escapeHtml(label)}</span>`).join("")}
                        ${pr.linkedIssue ? `<span class="mock-badge">links #${pr.linkedIssue}</span>` : ""}
                      </div>
                    </div>
                    <button class="mock-btn" data-action="open-pr" data-pr-number="${pr.number}">Open</button>
                  </div>
                </article>
              `,
            )
            .join("")}
        </div>
      </section>
    `;
  }

  function renderPrDetail(state) {
    const pr = getPr(state, state.ui.selectedPrNumber);
    if (!pr) {
      return renderPrList(state);
    }

    const filteredFiles = pr.files.filter((file) => {
      if (!state.ui.fileFilter.trim()) {
        return true;
      }
      return file.path.toLowerCase().includes(state.ui.fileFilter.trim().toLowerCase());
    });
    const selectedFile = filteredFiles.find((file) => file.path === state.ui.selectedFilePath) || filteredFiles[0] || null;

    return `
      <section class="github-detail-panel mock-card">
        <div class="github-item-head">
          <div class="github-pr-header">
            <p class="mock-kicker">Pull request #${pr.number}</p>
            <h2 class="mock-title">${escapeHtml(pr.title)}</h2>
            <div class="github-metadata">
              ${pr.labels.map((label) => `<span class="mock-badge">${escapeHtml(label)}</span>`).join("")}
            </div>
            ${pr.linkedIssue ? `<div class="github-linked-actions"><button class="mock-btn-ghost" data-action="open-linked-issue" data-issue-number="${pr.linkedIssue}">Open linked issue #${pr.linkedIssue}</button></div>` : ""}
          </div>
          <button class="mock-btn-secondary" data-action="back-to-pr-list">Back</button>
        </div>
        <div class="github-tabs">
          <button class="mock-btn-ghost ${state.ui.prTab === "conversation" ? "active" : ""}" data-action="set-pr-tab" data-pr-tab="conversation">Conversation</button>
          <button class="mock-btn-ghost ${state.ui.prTab === "files" ? "active" : ""}" data-action="set-pr-tab" data-pr-tab="files">Files changed</button>
        </div>
        ${
          state.ui.prTab === "conversation"
            ? `
              <div class="github-comment-card">
                <div class="mock-kicker">Conversation</div>
                ${pr.conversation.map((comment) => `<div class="mock-subtle">${escapeHtml(comment)}</div>`).join("")}
              </div>
            `
            : `
              <div class="github-filter-bar">
                <input id="file-filter-input" class="mock-input" value="${escapeHtml(state.ui.fileFilter)}" placeholder="Filter changed files">
                <button class="mock-btn" data-action="apply-file-filter">Filter files</button>
              </div>
              <div class="github-files-layout">
                <aside class="github-file-tree">
                  ${filteredFiles
                    .map(
                      (file) => `
                        <button class="mock-btn-ghost ${selectedFile?.path === file.path ? "active" : ""}" data-action="select-file" data-file-path="${file.path}">
                          ${escapeHtml(file.path)}
                        </button>
                      `,
                    )
                    .join("")}
                </aside>
                <div class="github-list">
                  ${
                    selectedFile
                      ? `
                        <article class="github-file-card">
                          <div class="github-item-head">
                            <div>
                              <div class="github-item-title" style="font-size: 18px;">${escapeHtml(selectedFile.path)}</div>
                              <div class="github-file-meta">
                                <span class="mock-badge">${selectedFile.viewed ? "Viewed" : "Not viewed"}</span>
                              </div>
                            </div>
                            <button class="mock-btn-secondary" data-action="mark-viewed" data-file-path="${selectedFile.path}">Mark viewed</button>
                          </div>
                          ${selectedFile.hunks
                            .map(
                              (hunk) => `
                                <div class="github-hunk">
                                  <div class="mock-kicker">${escapeHtml(hunk.id)}</div>
                                  <strong>${escapeHtml(hunk.title)}</strong>
                                  <code class="github-code">${escapeHtml(hunk.code)}</code>
                                  <div class="github-actions" style="margin-top: 10px;">
                                    <button class="mock-btn" data-action="open-diff-comment" data-file-path="${selectedFile.path}" data-hunk-id="${hunk.id}">Add inline comment</button>
                                  </div>
                                  ${hunk.comments.map((comment) => `<div class="mock-subtle" style="margin-top: 8px;">${escapeHtml(comment)}</div>`).join("")}
                                </div>
                              `,
                            )
                            .join("")}
                        </article>
                      `
                      : '<div class="mock-empty">No changed files match the current filter.</div>'
                  }
                </div>
              </div>
            `
        }
      </section>
    `;
  }

  function renderSidebar(state) {
    if (state.ui.repoTab === "issues") {
      const issue = getIssue(state, state.ui.selectedIssueNumber);
      if (!issue) {
        return `<aside class="github-sidebar mock-card"><div class="mock-empty">Open an issue to change labels, assignee, milestone, or leave a triage comment.</div></aside>`;
      }

      return `
        <aside class="github-sidebar mock-card">
          <div class="github-side-block">
            <label class="mock-kicker" for="issue-label-select">Add label</label>
            <select id="issue-label-select" class="mock-select">
              ${LABEL_OPTIONS.map((label) => `<option value="${label}">${label}</option>`).join("")}
            </select>
            <button class="mock-btn" style="margin-top: 10px;" data-action="add-issue-label">Add label</button>
          </div>
          <div class="github-side-block">
            <label class="mock-kicker" for="issue-assignee-select">Assignee</label>
            <select id="issue-assignee-select" class="mock-select">
              ${ASSIGNEE_OPTIONS.map((option) => `<option value="${option}" ${issue.assignee === option ? "selected" : ""}>${option || "Unassigned"}</option>`).join("")}
            </select>
            <button class="mock-btn" style="margin-top: 10px;" data-action="set-issue-assignee">Save assignee</button>
          </div>
          <div class="github-side-block">
            <label class="mock-kicker" for="issue-milestone-select">Milestone</label>
            <select id="issue-milestone-select" class="mock-select">
              ${MILESTONE_OPTIONS.map((option) => `<option value="${option}" ${issue.milestone === option ? "selected" : ""}>${option || "No milestone"}</option>`).join("")}
            </select>
            <button class="mock-btn" style="margin-top: 10px;" data-action="set-issue-milestone">Save milestone</button>
          </div>
          <div class="github-side-block">
            <label class="mock-kicker" for="issue-comment-input">Triage comment</label>
            <textarea id="issue-comment-input" class="mock-textarea" rows="5" placeholder="Leave an exact triage comment"></textarea>
            <button class="mock-btn" style="margin-top: 10px;" data-action="submit-issue-comment">Comment</button>
          </div>
        </aside>
      `;
    }

    const pr = getPr(state, state.ui.selectedPrNumber);
    if (!pr) {
      return `<aside class="github-sidebar mock-card"><div class="mock-empty">Open a PR to label it, inspect files changed, or submit a review.</div></aside>`;
    }

    return `
      <aside class="github-sidebar mock-card">
        <div class="github-side-block">
          <label class="mock-kicker" for="pr-label-select">PR label</label>
          <select id="pr-label-select" class="mock-select">
            ${LABEL_OPTIONS.map((label) => `<option value="${label}">${label}</option>`).join("")}
          </select>
          <button class="mock-btn" style="margin-top: 10px;" data-action="add-pr-label">Add label</button>
        </div>
        <div class="github-side-block">
          <div class="mock-kicker">Review actions</div>
          <button class="mock-btn" data-action="open-review-modal">Submit review</button>
        </div>
      </aside>
    `;
  }

  function renderModal(state) {
    const modal = state.ui.modal;
    if (!modal) {
      return "";
    }

    if (modal.type === "diff-comment") {
      return `
        <div class="mock-modal-backdrop">
          <div class="mock-modal">
            <div class="mock-modal-header">
              <div>
                <p class="mock-kicker">Inline diff comment</p>
                <h3 class="mock-title">${escapeHtml(modal.filePath)}</h3>
              </div>
              <button class="mock-btn-ghost" data-action="close-modal">Close</button>
            </div>
            <div class="mock-modal-body">
              <div class="mock-subtle">Hunk: ${escapeHtml(modal.hunkId)}</div>
              <textarea id="diff-comment-input" class="mock-textarea" rows="6">${escapeHtml(modal.body || "")}</textarea>
            </div>
            <div class="mock-modal-footer">
              <span class="mock-subtle">This must land on the exact file and hunk.</span>
              <button class="mock-btn" data-action="submit-diff-comment">Submit inline comment</button>
            </div>
          </div>
        </div>
      `;
    }

    if (modal.type === "review") {
      return `
        <div class="mock-modal-backdrop">
          <div class="mock-modal">
            <div class="mock-modal-header">
              <div>
                <p class="mock-kicker">Review submit</p>
                <h3 class="mock-title">Choose review state</h3>
              </div>
              <button class="mock-btn-ghost" data-action="close-modal">Close</button>
            </div>
            <div class="mock-modal-body">
              <div class="github-actions">
                <button class="mock-btn-secondary" data-action="set-review-state" data-review-state="comment">Comment</button>
                <button class="mock-btn-secondary" data-action="set-review-state" data-review-state="approve">Approve</button>
                <button class="mock-btn-secondary" data-action="set-review-state" data-review-state="request_changes">Request changes</button>
              </div>
              <textarea id="review-body-input" class="mock-textarea" rows="6" style="margin-top: 16px;">${escapeHtml(modal.body || "")}</textarea>
              <div class="mock-subtle" style="margin-top: 8px;">Current state: ${escapeHtml(modal.state || "comment")}</div>
            </div>
            <div class="mock-modal-footer">
              <span class="mock-subtle">The review state is scored independently from inline comments.</span>
              <button class="mock-btn" data-action="submit-review">Submit review</button>
            </div>
          </div>
        </div>
      `;
    }

    return "";
  }

  function render() {
    const state = store.getState();
    const mainContent =
      state.ui.repoTab === "issues" ? (state.ui.selectedIssueNumber ? renderIssueDetail(state) : renderIssueList(state)) : (state.ui.selectedPrNumber ? renderPrDetail(state) : renderPrList(state));

    app.innerHTML = `
      <div class="mock-page">
        ${renderTopbar(state)}
        <main class="github-shell">
          ${renderRepoNav(state)}
          <div class="github-layout">
            ${mainContent}
            ${renderSidebar(state)}
          </div>
        </main>
        ${renderModal(state)}
      </div>
    `;
  }

  function setRepoTab(tab) {
    store.update((state) => {
      state.ui.repoTab = tab;
      state.ui.selectedIssueNumber = null;
      state.ui.selectedPrNumber = null;
      state.ui.modal = null;
    });
    tracker.track("repo_nav", {
      tab,
    });
    render();
  }

  function applyIssueFilter() {
    const input = document.getElementById("issue-filter-input");
    const query = input ? input.value.trim() : "";
    store.update((state) => {
      state.ui.issueFilter = query;
    });
    tracker.track("issue_filter_apply", {
      query,
    });
    render();
  }

  function openIssue(number) {
    store.update((state) => {
      state.ui.selectedIssueNumber = Number(number);
    });
    tracker.track("issue_open", {
      issueNumber: Number(number),
    });
    render();
  }

  function addIssueLabel() {
    const state = store.getState();
    const issue = getIssue(state, state.ui.selectedIssueNumber);
    const select = document.getElementById("issue-label-select");
    const label = select ? select.value : "";
    if (!issue || !label || issue.labels.includes(label)) {
      return;
    }
    store.update((draft) => {
      const targetIssue = getIssue(draft, issue.number);
      if (targetIssue && !targetIssue.labels.includes(label)) {
        targetIssue.labels.push(label);
      }
    });
    tracker.track("label_add", {
      targetType: "issue",
      issueNumber: issue.number,
      labelId: label,
    });
    render();
  }

  function setIssueAssignee() {
    const state = store.getState();
    const issue = getIssue(state, state.ui.selectedIssueNumber);
    const select = document.getElementById("issue-assignee-select");
    const assignee = select ? select.value : "";
    if (!issue || issue.assignee === assignee) {
      return;
    }
    store.update((draft) => {
      const targetIssue = getIssue(draft, issue.number);
      if (targetIssue) {
        targetIssue.assignee = assignee;
      }
    });
    tracker.track("assignee_set", {
      issueNumber: issue.number,
      assignee,
    });
    render();
  }

  function setIssueMilestone() {
    const state = store.getState();
    const issue = getIssue(state, state.ui.selectedIssueNumber);
    const select = document.getElementById("issue-milestone-select");
    const milestone = select ? select.value : "";
    if (!issue || issue.milestone === milestone) {
      return;
    }
    store.update((draft) => {
      const targetIssue = getIssue(draft, issue.number);
      if (targetIssue) {
        targetIssue.milestone = milestone;
      }
    });
    tracker.track("milestone_set", {
      issueNumber: issue.number,
      milestoneId: milestone,
    });
    render();
  }

  function submitIssueComment() {
    const state = store.getState();
    const issue = getIssue(state, state.ui.selectedIssueNumber);
    const input = document.getElementById("issue-comment-input");
    const body = input ? input.value.trim() : "";
    if (!issue || !body) {
      return;
    }
    store.update((draft) => {
      const targetIssue = getIssue(draft, issue.number);
      targetIssue?.comments.push(body);
    });
    tracker.track("issue_comment_add", {
      issueNumber: issue.number,
      commentBody: body,
    });
    render();
  }

  function openPr(number) {
    store.update((state) => {
      state.ui.selectedPrNumber = Number(number);
      state.ui.selectedFilePath = "";
    });
    tracker.track("pr_open", {
      prNumber: Number(number),
    });
    render();
  }

  function setPrTab(prTab) {
    const state = store.getState();
    store.update((state) => {
      state.ui.prTab = prTab;
    });
    tracker.track("pr_tab_change", {
      prNumber: state.ui.selectedPrNumber,
      tab: prTab,
    });
    render();
  }

  function applyFileFilter() {
    const state = store.getState();
    const input = document.getElementById("file-filter-input");
    const query = input ? input.value.trim() : "";
    store.update((state) => {
      state.ui.fileFilter = query;
    });
    tracker.track("files_changed_filter_apply", {
      prNumber: state.ui.selectedPrNumber,
      query,
    });
    render();
  }

  function selectFile(filePath) {
    store.update((state) => {
      state.ui.selectedFilePath = filePath;
    });
    render();
  }

  function markViewed(filePath) {
    const state = store.getState();
    const pr = getPr(state, state.ui.selectedPrNumber);
    if (!pr) {
      return;
    }
    store.update((draft) => {
      const targetPr = getPr(draft, pr.number);
      const file = targetPr?.files.find((entry) => entry.path === filePath);
      if (file) {
        file.viewed = true;
      }
    });
    tracker.track("file_mark_viewed", {
      prNumber: pr.number,
      filePath,
    });
    render();
  }

  function openDiffComment(filePath, hunkId) {
    store.update((state) => {
      state.ui.modal = {
        type: "diff-comment",
        filePath,
        hunkId,
        body: "",
      };
    });
    render();
  }

  function submitDiffComment() {
    const state = store.getState();
    const pr = getPr(state, state.ui.selectedPrNumber);
    const modal = state.ui.modal;
    const input = document.getElementById("diff-comment-input");
    const body = input ? input.value.trim() : "";
    if (!pr || !modal || modal.type !== "diff-comment" || !body) {
      return;
    }
    store.update((draft) => {
      const targetPr = getPr(draft, pr.number);
      const file = targetPr?.files.find((entry) => entry.path === modal.filePath);
      const hunk = file?.hunks.find((entry) => entry.id === modal.hunkId);
      hunk?.comments.push(body);
      draft.ui.modal = null;
    });
    tracker.track("diff_comment_add", {
      prNumber: pr.number,
      filePath: modal.filePath,
      hunkId: modal.hunkId,
      commentBody: body,
    });
    render();
  }

  function addPrLabel() {
    const state = store.getState();
    const pr = getPr(state, state.ui.selectedPrNumber);
    const select = document.getElementById("pr-label-select");
    const label = select ? select.value : "";
    if (!pr || !label || pr.labels.includes(label)) {
      return;
    }
    store.update((draft) => {
      const targetPr = getPr(draft, pr.number);
      if (targetPr && !targetPr.labels.includes(label)) {
        targetPr.labels.push(label);
      }
    });
    tracker.track("label_add", {
      targetType: "pr",
      prNumber: pr.number,
      labelId: label,
    });
    render();
  }

  function openReviewModal() {
    store.update((state) => {
      state.ui.modal = {
        type: "review",
        state: "comment",
        body: "",
      };
    });
    render();
  }

  function submitReview() {
    const state = store.getState();
    const pr = getPr(state, state.ui.selectedPrNumber);
    const modal = state.ui.modal;
    const input = document.getElementById("review-body-input");
    const body = input ? input.value.trim() : "";
    if (!pr || !modal || modal.type !== "review") {
      return;
    }
    store.update((draft) => {
      const targetPr = getPr(draft, pr.number);
      if (targetPr) {
        targetPr.reviewState = modal.state;
      }
      draft.ui.modal = null;
    });
    tracker.track("review_submit", {
      prNumber: pr.number,
      state: modal.state,
      body,
    });
    render();
  }

  app.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.id === "issue-label-select") {
      addIssueLabel();
      return;
    }

    if (target.id === "issue-assignee-select") {
      setIssueAssignee();
      return;
    }

    if (target.id === "issue-milestone-select") {
      setIssueMilestone();
      return;
    }

    if (target.id === "pr-label-select") {
      addPrLabel();
    }
  });

  app.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) {
      return;
    }

    const action = target.dataset.action;

    if (action === "set-repo-tab") {
      setRepoTab(target.dataset.tab);
      return;
    }

    if (action === "apply-issue-filter") {
      applyIssueFilter();
      return;
    }

    if (action === "open-issue") {
      openIssue(target.dataset.issueNumber);
      return;
    }

    if (action === "back-to-issue-list") {
      store.update((state) => {
        state.ui.selectedIssueNumber = null;
      });
      render();
      return;
    }

    if (action === "add-issue-label") {
      addIssueLabel();
      return;
    }

    if (action === "set-issue-assignee") {
      setIssueAssignee();
      return;
    }

    if (action === "set-issue-milestone") {
      setIssueMilestone();
      return;
    }

    if (action === "submit-issue-comment") {
      submitIssueComment();
      return;
    }

    if (action === "open-pr") {
      openPr(target.dataset.prNumber);
      return;
    }

    if (action === "back-to-pr-list") {
      store.update((state) => {
        state.ui.selectedPrNumber = null;
        state.ui.selectedFilePath = "";
      });
      render();
      return;
    }

    if (action === "set-pr-tab") {
      setPrTab(target.dataset.prTab);
      return;
    }

    if (action === "apply-file-filter") {
      applyFileFilter();
      return;
    }

    if (action === "select-file") {
      selectFile(target.dataset.filePath);
      return;
    }

    if (action === "mark-viewed") {
      markViewed(target.dataset.filePath);
      return;
    }

    if (action === "open-diff-comment") {
      openDiffComment(target.dataset.filePath, target.dataset.hunkId);
      return;
    }

    if (action === "submit-diff-comment") {
      submitDiffComment();
      return;
    }

    if (action === "add-pr-label") {
      addPrLabel();
      return;
    }

    if (action === "open-review-modal") {
      openReviewModal();
      return;
    }

    if (action === "set-review-state") {
      store.update((state) => {
        if (state.ui.modal?.type === "review") {
          state.ui.modal.state = target.dataset.reviewState;
        }
      });
      render();
      return;
    }

    if (action === "submit-review") {
      submitReview();
      return;
    }

    if (action === "open-linked-issue") {
      setRepoTab("issues");
      openIssue(target.dataset.issueNumber);
      return;
    }

    if (action === "close-modal") {
      store.update((state) => {
        state.ui.modal = null;
      });
      render();
    }
  });

  render();
})();
