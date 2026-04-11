window.tracker = new AgentTracker("drive.google.com", "hard");

(function () {
  const { createSeededStore, escapeHtml, uniqueSorted, normalize, formatLongDate } = window.HardMockSite;

  function createItem(config) {
    return {
      id: config.id,
      type: config.type,
      name: config.name,
      parentId: config.parentId ?? null,
      section: config.section || "my-drive",
      owner: config.owner || "You",
      modifiedAt: config.modifiedAt || "2026-04-10",
      shortcutTo: config.shortcutTo || null,
      permissions: config.permissions || [],
    };
  }

  function buildSeedState() {
    const items = [
      createItem({ id: "folder-projects", type: "folder", name: "Projects", parentId: null, section: "my-drive" }),
      createItem({ id: "folder-design-archive", type: "folder", name: "Design Archive", parentId: null, section: "my-drive" }),
      createItem({ id: "folder-operations", type: "folder", name: "Operations", parentId: null, section: "my-drive" }),
      createItem({ id: "folder-release-assets", type: "folder", name: "Release Assets", parentId: null, section: "my-drive" }),
      createItem({ id: "folder-launch", type: "folder", name: "Launch", parentId: "folder-projects", section: "my-drive" }),
      createItem({ id: "folder-launch-working", type: "folder", name: "Working", parentId: "folder-launch", section: "my-drive" }),
      createItem({ id: "folder-launch-final", type: "folder", name: "Final", parentId: "folder-launch", section: "my-drive" }),
      createItem({ id: "folder-launch-board-approvals", type: "folder", name: "Board Approvals", parentId: "folder-launch-final", section: "my-drive" }),
      createItem({ id: "folder-shared-launch-handoff", type: "folder", name: "Shared Launch Handoff", parentId: "folder-launch-final", section: "my-drive" }),
      createItem({ id: "folder-release-social", type: "folder", name: "Social", parentId: "folder-release-assets", section: "my-drive" }),
      createItem({ id: "folder-release-ready-social", type: "folder", name: "Release Ready Social", parentId: "folder-release-social", section: "my-drive" }),
      createItem({ id: "folder-release-scratch", type: "folder", name: "Scratch", parentId: "folder-release-social", section: "my-drive" }),
      createItem({ id: "folder-shared-northstar-launch", type: "folder", name: "Northstar Launch Shared", parentId: null, section: "shared", owner: "Maya Perez",
        permissions: [
          { email: "alex@northstar.com", role: "editor" },
          { email: "finance.pm@northstar.com", role: "viewer" },
        ],
      }),
      createItem({ id: "folder-shared-quarterly-assets", type: "folder", name: "Quarterly Assets", parentId: null, section: "shared", owner: "Rina Cho" }),
      createItem({ id: "file-launch-brief-v5", type: "file", name: "Launch Brief v5", parentId: "folder-launch-working", section: "my-drive", modifiedAt: "2026-04-08" }),
      createItem({ id: "file-launch-brief-final", type: "file", name: "Launch Brief Final", parentId: "folder-launch-working", section: "my-drive", modifiedAt: "2026-04-07" }),
      createItem({ id: "file-launch-brief", type: "file", name: "Launch Brief", parentId: "folder-design-archive", section: "my-drive", modifiedAt: "2026-03-29" }),
      createItem({ id: "shortcut-launch-brief", type: "shortcut", name: "Launch Brief Shortcut", parentId: "folder-shared-launch-handoff", section: "my-drive", shortcutTo: "file-launch-brief-final" }),
      createItem({ id: "asset-keyvisual-final", type: "file", name: "Launch Keyvisual Final.png", parentId: "folder-release-scratch", section: "my-drive", modifiedAt: "2026-04-06" }),
      createItem({ id: "asset-keyvisual-final-2x", type: "file", name: "Launch Keyvisual Final@2x.png", parentId: "folder-release-scratch", section: "my-drive", modifiedAt: "2026-04-06" }),
      createItem({ id: "asset-keyvisual-final-print", type: "file", name: "Launch Keyvisual Final Print.png", parentId: "folder-release-scratch", section: "my-drive", modifiedAt: "2026-04-05" }),
      createItem({ id: "asset-keyvisual-final-copy", type: "file", name: "Launch Keyvisual Final copy.png", parentId: "folder-release-scratch", section: "my-drive", modifiedAt: "2026-04-04" }),
      createItem({ id: "shortcut-keyvisual-final", type: "shortcut", name: "Launch Keyvisual Final shortcut", parentId: "folder-release-scratch", section: "my-drive", shortcutTo: "asset-keyvisual-final" }),
    ];

    const fillerFolders = [
      "folder-projects",
      "folder-launch-working",
      "folder-launch-final",
      "folder-design-archive",
      "folder-operations",
      "folder-release-social",
      "folder-shared-quarterly-assets",
      "folder-shared-northstar-launch",
    ];

    fillerFolders.forEach((folderId, folderIndex) => {
      for (let index = 1; index <= 6; index += 1) {
        items.push(
          createItem({
            id: `${folderId}-file-${index}`,
            type: "file",
            name: `Seeded Asset ${folderIndex + 1}.${index}`,
            parentId: folderId,
            section: folderId.startsWith("folder-shared") ? "shared" : "my-drive",
            owner: folderId.startsWith("folder-shared") ? "Shared owner" : "You",
            modifiedAt: `2026-04-${String((index % 8) + 1).padStart(2, "0")}`,
          }),
        );
      }
    });

    return {
      items,
      ui: {
        section: "my-drive",
        currentFolderId: null,
        searchQuery: "",
        viewMode: "grid",
        selectedIds: [],
        detailItemId: "file-launch-brief-v5",
        modal: null,
      },
      counters: {
        shortcut: 1,
        upload: 1,
      },
    };
  }

  const store = createSeededStore({
    storageKey: "openbrowser.eval.drive",
    seedState: buildSeedState(),
  });

  const UPLOAD_CHOICES = [
    { id: "upload-launch-keyvisual-retouched", name: "Launch-Keyvisual-Final-retouched.png", destinationId: "folder-release-ready-social" },
    { id: "upload-board-brief-pdf", name: "Board-Brief.pdf", destinationId: "folder-launch-board-approvals" },
    { id: "upload-mini-logo-lockup", name: "Logo-Lockup-Mini.svg", destinationId: "folder-release-social" },
  ];

  const app = document.getElementById("app");

  function getItemById(state, itemId) {
    return state.items.find((item) => item.id === itemId) || null;
  }

  function getChildren(state, parentId, section) {
    return state.items.filter((item) => item.parentId === parentId && item.section === section);
  }

  function getFolderPath(state, folderId) {
    const path = [];
    let current = folderId ? getItemById(state, folderId) : null;
    while (current) {
      path.unshift(current);
      current = current.parentId ? getItemById(state, current.parentId) : null;
    }
    return path;
  }

  function getVisibleItems(state) {
    const query = state.ui.searchQuery.trim();
    if (query) {
      return state.items.filter((item) => {
        const parentPath = getFolderPath(state, item.parentId)
          .map((folder) => folder.name)
          .join(" / ");
        return normalize(`${item.name} ${item.owner} ${parentPath}`).includes(normalize(query));
      });
    }

    return state.items.filter(
      (item) => item.section === state.ui.section && item.parentId === state.ui.currentFolderId,
    );
  }

  function setDetail(itemId) {
    store.update((state) => {
      state.ui.detailItemId = itemId;
    });
  }

  function renderSidebar(state) {
    const sections = [
      { id: "my-drive", label: "My Drive" },
      { id: "shared", label: "Shared with me" },
      { id: "recent", label: "Recent" },
    ];

    const visibleFolders = state.items.filter(
      (item) =>
        item.type === "folder" &&
        item.section === (state.ui.section === "recent" ? "my-drive" : state.ui.section) &&
        (item.parentId === null || ["folder-projects", "folder-release-assets", "folder-shared-northstar-launch"].includes(item.parentId)),
    );

    return `
      <aside class="drive-sidebar mock-card">
        <div>
          <p class="mock-kicker">Workspace</p>
          <div class="drive-section-list">
            ${sections
              .map(
                (section) => `
                  <button class="drive-section-item ${state.ui.section === section.id ? "active" : ""}" data-action="set-section" data-section="${section.id}">
                    <span>${section.label}</span>
                    <span>${state.items.filter((item) => item.section === (section.id === "recent" ? "my-drive" : section.id)).length}</span>
                  </button>
                `,
              )
              .join("")}
          </div>
        </div>
        <div>
          <p class="mock-kicker">Folder Tree</p>
          <div class="drive-tree">
            ${visibleFolders
              .map(
                (folder) => `
                  <button class="drive-tree-item ${state.ui.currentFolderId === folder.id ? "active" : ""}" data-action="open-folder" data-folder-id="${folder.id}">
                    <span>${escapeHtml(folder.name)}</span>
                    <span>${getChildren(state, folder.id, folder.section).length}</span>
                  </button>
                `,
              )
              .join("")}
          </div>
        </div>
      </aside>
    `;
  }

  function renderItemCard(state, item) {
    const selected = state.ui.selectedIds.includes(item.id);
    const path = getFolderPath(state, item.parentId).map((folder) => folder.name).join(" / ");
    return `
      <article class="drive-item ${selected ? "selected" : ""}">
        <div class="drive-item-topline">
          <div>
            <div class="drive-item-name">${escapeHtml(item.name)}</div>
            <div class="drive-item-meta">${escapeHtml(item.type)} · ${escapeHtml(item.owner)}</div>
          </div>
          <input type="checkbox" data-action="toggle-select" data-item-id="${item.id}" ${selected ? "checked" : ""}>
        </div>
        <div class="drive-item-meta">${path ? escapeHtml(path) : "Top level"}</div>
        <div class="drive-item-meta">${formatLongDate(item.modifiedAt)}</div>
        <div class="drive-toolbar-actions">
          ${item.type === "folder"
            ? `<button class="mock-btn-secondary" data-action="open-folder" data-folder-id="${item.id}">Open</button>`
            : `<button class="mock-btn-secondary" data-action="focus-item" data-item-id="${item.id}">Details</button>`}
        </div>
      </article>
    `;
  }

  function renderListTable(state, items) {
    return `
      <table class="mock-table drive-list-table">
        <thead>
          <tr>
            <th>Select</th>
            <th>Name</th>
            <th>Type</th>
            <th>Owner</th>
            <th>Location</th>
          </tr>
        </thead>
        <tbody>
          ${items
            .map((item) => {
              const selected = state.ui.selectedIds.includes(item.id);
              const path = getFolderPath(state, item.parentId).map((folder) => folder.name).join(" / ");
              return `
                <tr class="${selected ? "selected" : ""}">
                  <td><input type="checkbox" data-action="toggle-select" data-item-id="${item.id}" ${selected ? "checked" : ""}></td>
                  <td>
                    <button class="mock-btn-ghost" data-action="${item.type === "folder" ? "open-folder" : "focus-item"}" ${
                      item.type === "folder" ? `data-folder-id="${item.id}"` : `data-item-id="${item.id}"`
                    }>
                      ${escapeHtml(item.name)}
                    </button>
                  </td>
                  <td>${escapeHtml(item.type)}</td>
                  <td>${escapeHtml(item.owner)}</td>
                  <td>${escapeHtml(path || "Top level")}</td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    `;
  }

  function renderMain(state) {
    const visibleItems = state.ui.section === "recent"
      ? state.items.slice().sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)).slice(0, 12)
      : getVisibleItems(state);
    const path = getFolderPath(state, state.ui.currentFolderId);
    const surfaceItem = getItemById(state, state.ui.currentFolderId);
    const singleTargetSelected = state.ui.selectedIds.length === 1;
    const surfaceActionTarget = singleTargetSelected
      ? getItemById(state, state.ui.selectedIds[0])
      : surfaceItem;
    const shareActionEnabled = Boolean(surfaceActionTarget);
    const selectionText = state.ui.selectedIds.length
      ? `${state.ui.selectedIds.length} selected`
      : state.ui.searchQuery
        ? `Search: ${escapeHtml(state.ui.searchQuery)}`
        : path.length
          ? path.map((folder) => folder.name).join(" / ")
          : state.ui.section === "shared"
            ? "Shared with me"
            : "My Drive";

    return `
      <section class="drive-main mock-card">
        <div class="drive-main-toolbar">
          <div>
            <p class="mock-kicker">Surface</p>
            <h2 class="mock-title">${selectionText}</h2>
            <div class="drive-breadcrumb">
              <button class="mock-btn-ghost" data-action="go-root">Root</button>
              ${path.map((folder) => `<span>${escapeHtml(folder.name)}</span>`).join("<span>/</span>")}
            </div>
          </div>
          <div class="drive-toolbar-actions">
            <button class="mock-btn-secondary" data-action="set-view" data-view-mode="grid">Grid</button>
            <button class="mock-btn-secondary" data-action="set-view" data-view-mode="list">List</button>
            <button class="mock-btn-secondary" data-action="open-rename" ${state.ui.selectedIds.length === 1 ? "" : "disabled"}>Rename</button>
            <button class="mock-btn-secondary" data-action="open-move" ${state.ui.selectedIds.length ? "" : "disabled"}>Move</button>
            <button class="mock-btn-secondary" data-action="open-shortcut" ${state.ui.selectedIds.length === 1 ? "" : "disabled"}>Create shortcut</button>
            <button class="mock-btn-secondary" data-action="open-share" ${shareActionEnabled ? "" : "disabled"}>Share</button>
            <button class="mock-btn-secondary" data-action="open-upload">Mock upload</button>
            <button class="mock-btn-danger" data-action="delete-selected" ${state.ui.selectedIds.length === 1 ? "" : "disabled"}>Delete</button>
          </div>
        </div>
        <div class="drive-content">
          ${
            visibleItems.length
              ? state.ui.viewMode === "grid"
                ? `<div class="drive-grid">${visibleItems.map((item) => renderItemCard(state, item)).join("")}</div>`
                : renderListTable(state, visibleItems)
              : '<div class="mock-empty">No items in this folder or search view.</div>'
          }
        </div>
      </section>
    `;
  }

  function renderDetail(state) {
    const detailItem = getItemById(state, state.ui.detailItemId) || getItemById(state, state.ui.selectedIds[0]) || null;

    if (!detailItem) {
      return `
        <aside class="drive-detail mock-card">
          <div class="mock-empty">Select a file or folder to inspect metadata, permissions, and move targets.</div>
        </aside>
      `;
    }

    const folderPath = getFolderPath(state, detailItem.parentId).map((folder) => folder.name).join(" / ");
    return `
      <aside class="drive-detail mock-card">
        <div>
          <p class="mock-kicker">Details</p>
          <h3 class="mock-title">${escapeHtml(detailItem.name)}</h3>
          <p class="mock-subtle">${escapeHtml(detailItem.type)} · ${escapeHtml(detailItem.owner)}</p>
        </div>
        <div class="drive-detail-block">
          <div class="mock-kicker">Location</div>
          <div>${escapeHtml(folderPath || "Top level")}</div>
        </div>
        <div class="drive-detail-block">
          <div class="mock-kicker">Modified</div>
          <div>${formatLongDate(detailItem.modifiedAt)}</div>
        </div>
        ${
          detailItem.permissions.length
            ? `
              <div class="drive-detail-block">
                <div class="mock-kicker">Permissions</div>
                ${detailItem.permissions
                  .map(
                    (permission) => `
                      <div class="drive-permission-row">
                        <span>${escapeHtml(permission.email)}</span>
                        <span class="mock-badge">${escapeHtml(permission.role)}</span>
                      </div>
                    `,
                  )
                  .join("")}
              </div>
            `
            : `
              <div class="drive-detail-block">
                <div class="mock-kicker">Permissions</div>
                <div class="mock-subtle">No custom collaborators on this item.</div>
              </div>
            `
        }
      </aside>
    `;
  }

  function getAllDestinationFolders(state) {
    return state.items.filter((item) => item.type === "folder");
  }

  function renderDestinationPicker(state, activeDestinationId) {
    return `
      <div class="drive-destination-picker">
        ${getAllDestinationFolders(state)
          .map((folder) => {
            const path = getFolderPath(state, folder.parentId).map((item) => item.name).join(" / ");
            return `
              <button class="drive-destination-item ${activeDestinationId === folder.id ? "active" : ""}" data-action="set-modal-destination" data-destination-id="${folder.id}">
                <span>${escapeHtml(folder.name)}</span>
                <span class="mock-subtle">${escapeHtml(path || folder.section)}</span>
              </button>
            `;
          })
          .join("")}
      </div>
    `;
  }

  function renderModal(state) {
    const modal = state.ui.modal;
    if (!modal) {
      return "";
    }

    if (modal.type === "rename") {
      return `
        <div class="mock-modal-backdrop">
          <div class="mock-modal">
            <div class="mock-modal-header">
              <div>
                <p class="mock-kicker">Rename item</p>
                <h3 class="mock-title">${escapeHtml(modal.itemId)}</h3>
              </div>
              <button class="mock-btn-ghost" data-action="close-modal">Close</button>
            </div>
            <div class="mock-modal-body">
              <label class="mock-kicker" for="drive-rename-input">New name</label>
              <input id="drive-rename-input" class="mock-input" data-modal-field="newName" value="${escapeHtml(modal.newName || "")}">
            </div>
            <div class="mock-modal-footer">
              <span class="mock-subtle">Rename preserves stable item IDs; scoring uses the same seeded object.</span>
              <button class="mock-btn" data-action="commit-rename">Save</button>
            </div>
          </div>
        </div>
      `;
    }

    if (modal.type === "move" || modal.type === "shortcut") {
      const title = modal.type === "move" ? "Move items" : "Create shortcut";
      return `
        <div class="mock-modal-backdrop">
          <div class="mock-modal">
            <div class="mock-modal-header">
              <div>
                <p class="mock-kicker">${modal.type}</p>
                <h3 class="mock-title">${title}</h3>
              </div>
              <button class="mock-btn-ghost" data-action="close-modal">Close</button>
            </div>
            <div class="mock-modal-body">
              <p class="mock-subtle">Selected: ${escapeHtml((modal.itemIds || []).join(", "))}</p>
              ${renderDestinationPicker(state, modal.destinationId || null)}
            </div>
            <div class="mock-modal-footer">
              <span class="mock-subtle">The destination picker is intentionally scrollable and nested.</span>
              <button class="mock-btn" data-action="${modal.type === "move" ? "commit-move" : "commit-shortcut"}">
                ${modal.type === "move" ? "Move items" : "Create shortcut"}
              </button>
            </div>
          </div>
        </div>
      `;
    }

    if (modal.type === "share") {
      const item = getItemById(state, modal.itemId);
      return `
        <div class="mock-modal-backdrop">
          <div class="mock-modal">
            <div class="mock-modal-header">
              <div>
                <p class="mock-kicker">Share dialog</p>
                <h3 class="mock-title">${escapeHtml(item ? item.name : modal.itemId)}</h3>
              </div>
              <button class="mock-btn-ghost" data-action="close-modal">Close</button>
            </div>
            <div class="mock-modal-body">
              ${(item?.permissions || [])
                .map(
                  (permission) => `
                    <div class="drive-permission-row">
                      <span>${escapeHtml(permission.email)}</span>
                      <select class="mock-select" data-action="change-permission-role" data-email="${permission.email}">
                        ${["viewer", "commenter", "editor"]
                          .map(
                            (role) => `<option value="${role}" ${permission.role === role ? "selected" : ""}>${role}</option>`,
                          )
                          .join("")}
                      </select>
                    </div>
                  `,
                )
                .join("")}
              <div class="mock-divider" style="margin: 14px 0;"></div>
              <div class="mock-split">
                <div>
                  <label class="mock-kicker" for="share-email">Add collaborator</label>
                  <input id="share-email" class="mock-input" data-modal-field="email" value="${escapeHtml(modal.email || "")}" placeholder="name@example.com">
                </div>
                <div>
                  <label class="mock-kicker" for="share-role">Role</label>
                  <select id="share-role" class="mock-select" data-modal-field="role">
                    ${["viewer", "commenter", "editor"]
                      .map((role) => `<option value="${role}" ${modal.role === role ? "selected" : ""}>${role}</option>`)
                      .join("")}
                  </select>
                </div>
              </div>
            </div>
            <div class="mock-modal-footer">
              <span class="mock-subtle">Add or downgrade collaborators from this modal.</span>
              <button class="mock-btn" data-action="add-permission">Add collaborator</button>
            </div>
          </div>
        </div>
      `;
    }

    if (modal.type === "upload") {
      return `
        <div class="mock-modal-backdrop">
          <div class="mock-modal">
            <div class="mock-modal-header">
              <div>
                <p class="mock-kicker">Frontend upload picker</p>
                <h3 class="mock-title">Choose a replacement asset</h3>
              </div>
              <button class="mock-btn-ghost" data-action="close-modal">Close</button>
            </div>
            <div class="mock-modal-body">
              <div class="mock-split">
                ${UPLOAD_CHOICES.map((choice) => `
                  <button class="drive-upload-option" data-action="select-upload-choice" data-upload-id="${choice.id}">
                    <span>${escapeHtml(choice.name)}</span>
                    <span class="mock-subtle">${escapeHtml(choice.destinationId)}</span>
                  </button>
                `).join("")}
              </div>
              <div style="margin-top: 16px;">
                <p class="mock-kicker">Destination</p>
                ${renderDestinationPicker(state, modal.destinationId || null)}
              </div>
            </div>
            <div class="mock-modal-footer">
              <span class="mock-subtle">This replaces native upload with deterministic in-page assets.</span>
              <button class="mock-btn" data-action="commit-upload" ${modal.uploadId ? "" : "disabled"}>Upload selected asset</button>
            </div>
          </div>
        </div>
      `;
    }

    return "";
  }

  function render() {
    const state = store.getState();
    app.innerHTML = `
      <div class="mock-page">
        <header class="mock-topbar">
          <div class="drive-topbar">
            <div class="drive-brand">
              <div class="drive-brand-mark">D</div>
              <div>
                <div style="font-weight: 800;">Drive Workspace</div>
                <div class="mock-subtle">Nested folders, sharing, shortcuts, uploads</div>
              </div>
            </div>
            <form id="drive-search-form" class="drive-search-form">
              <input id="drive-search-input" class="mock-input" value="${escapeHtml(state.ui.searchQuery)}" placeholder="Search in Drive">
              <button class="mock-btn drive-search-submit" type="submit">Search</button>
            </form>
            <div style="display: flex; gap: 10px;">
              <span class="mock-pill">50+ seeded objects</span>
              <span class="mock-pill">Bulk toolbar is selection-based</span>
            </div>
          </div>
        </header>
        <main class="drive-layout">
          ${renderSidebar(state)}
          ${renderMain(state)}
          ${renderDetail(state)}
        </main>
        ${renderModal(state)}
      </div>
    `;
  }

  function openFolder(folderId) {
    const state = store.getState();
    const folder = getItemById(state, folderId);
    if (!folder) {
      return;
    }

    store.update((draft) => {
      draft.ui.section = folder.section;
      draft.ui.currentFolderId = folder.id;
      draft.ui.searchQuery = "";
      draft.ui.selectedIds = [];
      draft.ui.detailItemId = folder.id;
    });

    tracker.track("folder_open", {
      folderId: folder.id,
      section: folder.section,
    });
    render();
  }

  function setSection(section) {
    store.update((state) => {
      state.ui.section = section;
      state.ui.currentFolderId = null;
      state.ui.searchQuery = "";
      state.ui.selectedIds = [];
    });
    render();
  }

  function setView(viewMode) {
    store.update((state) => {
      state.ui.viewMode = viewMode;
    });
    tracker.track("view_mode_change", {
      viewMode,
    });
    render();
  }

  function toggleSelect(itemId) {
    const nextState = store.update((state) => {
      const selected = new Set(state.ui.selectedIds);
      if (selected.has(itemId)) {
        selected.delete(itemId);
      } else {
        selected.add(itemId);
      }
      state.ui.selectedIds = Array.from(selected);
      state.ui.detailItemId = itemId;
    });

    tracker.track("item_select", {
      itemId,
      itemIds: uniqueSorted(nextState.ui.selectedIds),
    });
    render();
  }

  function openRenameModal() {
    const state = store.getState();
    if (state.ui.selectedIds.length !== 1) {
      return;
    }

    const item = getItemById(state, state.ui.selectedIds[0]);
    if (!item) {
      return;
    }

    store.update((draft) => {
      draft.ui.modal = {
        type: "rename",
        itemId: item.id,
        newName: item.name,
      };
    });
    render();
  }

  function commitRename() {
    const state = store.getState();
    const modal = state.ui.modal;
    if (!modal || modal.type !== "rename") {
      return;
    }

    store.update((draft) => {
      const item = getItemById(draft, modal.itemId);
      if (item) {
        item.name = modal.newName.trim();
      }
      draft.ui.modal = null;
    });

    tracker.track("item_rename", {
      itemId: modal.itemId,
      newName: modal.newName.trim(),
    });
    render();
  }

  function openDestinationModal(type) {
    const state = store.getState();
    if (!state.ui.selectedIds.length) {
      return;
    }

    const selectedIds = uniqueSorted(state.ui.selectedIds);

    store.update((draft) => {
      draft.ui.modal = {
        type,
        itemIds: selectedIds,
        destinationId: draft.ui.currentFolderId,
      };
    });

    if (type === "move" && selectedIds.length > 1) {
      tracker.track("multi_select_commit", {
        itemIds: selectedIds,
      });
    }
    render();
  }

  function commitMove() {
    const state = store.getState();
    const modal = state.ui.modal;
    if (!modal || modal.type !== "move" || !modal.destinationId) {
      return;
    }

    const itemIds = uniqueSorted(modal.itemIds || []);
    store.update((draft) => {
      draft.items.forEach((item) => {
        if (itemIds.includes(item.id)) {
          item.parentId = modal.destinationId;
        }
      });
      draft.ui.modal = null;
      draft.ui.selectedIds = [];
      draft.ui.detailItemId = modal.destinationId;
    });

    tracker.track("item_move", {
      itemIds,
      itemId: itemIds[0],
      destinationId: modal.destinationId,
    });
    render();
  }

  function commitShortcut() {
    const state = store.getState();
    const modal = state.ui.modal;
    if (!modal || modal.type !== "shortcut" || !modal.destinationId || modal.itemIds.length !== 1) {
      return;
    }

    const sourceItem = getItemById(state, modal.itemIds[0]);
    const shortcutId = `shortcut-generated-${state.counters.shortcut}`;
    if (!sourceItem) {
      return;
    }

    store.update((draft) => {
      draft.items.push(
        createItem({
          id: shortcutId,
          type: "shortcut",
          name: `${sourceItem.name} shortcut`,
          parentId: modal.destinationId,
          section: getItemById(draft, modal.destinationId)?.section || "my-drive",
          owner: "You",
          shortcutTo: sourceItem.id,
        }),
      );
      draft.counters.shortcut += 1;
      draft.ui.modal = null;
      draft.ui.selectedIds = [];
    });

    tracker.track("shortcut_create", {
      sourceId: sourceItem.id,
      shortcutId,
      destinationId: modal.destinationId,
    });
    render();
  }

  function openShareDialog() {
    const state = store.getState();
    const itemId = state.ui.selectedIds.length === 1
      ? state.ui.selectedIds[0]
      : state.ui.currentFolderId;
    const item = itemId ? getItemById(state, itemId) : null;
    if (!item) {
      return;
    }

    store.update((draft) => {
      draft.ui.modal = {
        type: "share",
        itemId: item.id,
        email: "",
        role: "viewer",
      };
    });

    tracker.track("share_dialog_open", {
      itemId: item.id,
    });
    render();
  }

  function addPermission() {
    const state = store.getState();
    const modal = state.ui.modal;
    if (!modal || modal.type !== "share" || !modal.email.trim()) {
      return;
    }

    store.update((draft) => {
      const item = getItemById(draft, modal.itemId);
      if (!item) {
        return;
      }
      item.permissions.push({
        email: modal.email.trim(),
        role: modal.role,
      });
      draft.ui.modal.email = "";
      draft.ui.modal.role = "viewer";
    });

    tracker.track("permission_add", {
      itemId: modal.itemId,
      email: modal.email.trim(),
      role: modal.role,
    });
    render();
  }

  function changePermission(email, role) {
    const state = store.getState();
    const modal = state.ui.modal;
    if (!modal || modal.type !== "share") {
      return;
    }

    store.update((draft) => {
      const item = getItemById(draft, modal.itemId);
      const permission = item?.permissions.find((entry) => entry.email === email);
      if (permission) {
        permission.role = role;
      }
    });

    tracker.track("permission_change", {
      itemId: modal.itemId,
      email,
      role,
    });
    render();
  }

  function openUploadModal() {
    store.update((state) => {
      state.ui.modal = {
        type: "upload",
        uploadId: "",
        destinationId: state.ui.currentFolderId || "folder-release-ready-social",
      };
    });
    render();
  }

  function commitUpload() {
    const state = store.getState();
    const modal = state.ui.modal;
    if (!modal || modal.type !== "upload" || !modal.uploadId || !modal.destinationId) {
      return;
    }

    const choice = UPLOAD_CHOICES.find((item) => item.id === modal.uploadId);
    if (!choice) {
      return;
    }

    const itemId = choice.id;
    store.update((draft) => {
      draft.items.push(
        createItem({
          id: itemId,
          type: "file",
          name: choice.name,
          parentId: modal.destinationId,
          section: getItemById(draft, modal.destinationId)?.section || "my-drive",
          modifiedAt: "2026-04-10",
        }),
      );
      draft.ui.modal = null;
      draft.ui.detailItemId = itemId;
    });

    tracker.track("mock_upload_complete", {
      itemId,
      destinationId: modal.destinationId,
      name: choice.name,
    });
    render();
  }

  function deleteSelected() {
    const state = store.getState();
    if (state.ui.selectedIds.length !== 1) {
      return;
    }

    const itemId = state.ui.selectedIds[0];
    store.update((draft) => {
      draft.items = draft.items.filter((item) => item.id !== itemId);
      draft.ui.selectedIds = [];
      draft.ui.modal = null;
      draft.ui.detailItemId = null;
    });

    tracker.track("item_delete", {
      itemId,
    });
    render();
  }

  app.addEventListener("submit", (event) => {
    if (event.target.id !== "drive-search-form") {
      return;
    }

    event.preventDefault();
    const input = document.getElementById("drive-search-input");
    const query = input ? input.value.trim() : "";
    store.update((state) => {
      state.ui.searchQuery = query;
      state.ui.section = "my-drive";
      state.ui.currentFolderId = null;
      state.ui.selectedIds = [];
    });

    tracker.track("drive_search_execute", {
      query,
    });
    render();
  });

  app.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) {
      return;
    }

    const action = target.dataset.action;

    if (action === "set-section") {
      setSection(target.dataset.section);
      return;
    }

    if (action === "open-folder") {
      openFolder(target.dataset.folderId);
      return;
    }

    if (action === "go-root") {
      store.update((state) => {
        state.ui.currentFolderId = null;
        state.ui.selectedIds = [];
      });
      render();
      return;
    }

    if (action === "set-view") {
      setView(target.dataset.viewMode);
      return;
    }

    if (action === "toggle-select") {
      toggleSelect(target.dataset.itemId);
      return;
    }

    if (action === "focus-item") {
      setDetail(target.dataset.itemId);
      render();
      return;
    }

    if (action === "open-rename") {
      openRenameModal();
      return;
    }

    if (action === "commit-rename") {
      commitRename();
      return;
    }

    if (action === "open-move") {
      openDestinationModal("move");
      return;
    }

    if (action === "commit-move") {
      commitMove();
      return;
    }

    if (action === "open-shortcut") {
      openDestinationModal("shortcut");
      return;
    }

    if (action === "commit-shortcut") {
      commitShortcut();
      return;
    }

    if (action === "set-modal-destination") {
      store.update((state) => {
        if (state.ui.modal) {
          state.ui.modal.destinationId = target.dataset.destinationId;
        }
      });
      render();
      return;
    }

    if (action === "open-share") {
      openShareDialog();
      return;
    }

    if (action === "add-permission") {
      addPermission();
      return;
    }

    if (action === "open-upload") {
      openUploadModal();
      return;
    }

    if (action === "select-upload-choice") {
      store.update((state) => {
        if (state.ui.modal?.type === "upload") {
          state.ui.modal.uploadId = target.dataset.uploadId;
        }
      });
      render();
      return;
    }

    if (action === "commit-upload") {
      commitUpload();
      return;
    }

    if (action === "delete-selected") {
      deleteSelected();
      return;
    }

    if (action === "close-modal") {
      store.update((state) => {
        state.ui.modal = null;
      });
      render();
    }
  });

  app.addEventListener("input", (event) => {
    const field = event.target.dataset.modalField;
    if (!field) {
      return;
    }

    store.update((state) => {
      if (state.ui.modal) {
        state.ui.modal[field] = event.target.value;
      }
    });
  });

  app.addEventListener("change", (event) => {
    if (event.target.dataset.action === "change-permission-role") {
      changePermission(event.target.dataset.email, event.target.value);
    }
  });

  render();
})();
