/* ===================================================================
   TaskFlow – Trello-like board for AI agent evaluation
   =================================================================== */

// Tracker init
window.tracker = new AgentTracker('taskflow.app', 'hard');

/* ---------- Data Model ---------- */

const LABEL_COLORS = {
    green:  '#61bd4f',
    yellow: '#f2d600',
    orange: '#ff9f1a',
    red:    '#eb5a46',
    purple: '#c377e0',
    blue:   '#0079bf'
};

// Board state – mutable
const boardData = {
    columns: [
        {
            id: 'todo',
            name: 'To Do',
            cards: [
                {
                    id: 'c1',
                    title: 'Write unit tests',
                    labels: ['blue'],
                    checklist: [
                        { text: 'Test auth flow', checked: false },
                        { text: 'Test API endpoints', checked: false },
                        { text: 'Test UI components', checked: false }
                    ],
                    due: null,
                    description: ''
                },
                {
                    id: 'c2',
                    title: 'Update documentation',
                    labels: ['green'],
                    checklist: [],
                    due: null,
                    description: ''
                },
                {
                    id: 'c3',
                    title: 'Fix login bug',
                    labels: ['red'],
                    checklist: [],
                    due: 'Apr 15',
                    description: ''
                },
                {
                    id: 'c4',
                    title: 'Refactor auth module',
                    labels: [],
                    checklist: [],
                    due: null,
                    description: ''
                }
            ]
        },
        {
            id: 'inprogress',
            name: 'In Progress',
            cards: [
                {
                    id: 'c5',
                    title: 'Design API schema',
                    labels: ['yellow'],
                    checklist: [
                        { text: 'Define endpoints', checked: false },
                        { text: 'Set up auth', checked: true },
                        { text: 'Write schemas', checked: false },
                        { text: 'Document API', checked: false }
                    ],
                    due: null,
                    description: ''
                },
                {
                    id: 'c6',
                    title: 'Build search feature',
                    labels: ['blue'],
                    checklist: [],
                    due: null,
                    description: ''
                },
                {
                    id: 'c7',
                    title: 'Create dashboard',
                    labels: ['purple'],
                    checklist: [],
                    due: 'Apr 20',
                    description: ''
                },
                {
                    id: 'c8',
                    title: 'Set up CI/CD',
                    labels: [],
                    checklist: [],
                    due: null,
                    description: ''
                }
            ]
        },
        {
            id: 'review',
            name: 'Review',
            cards: [
                {
                    id: 'c9',
                    title: 'Deploy staging build',
                    labels: ['green'],
                    checklist: [
                        { text: 'Run tests', checked: true },
                        { text: 'Deploy to staging', checked: false }
                    ],
                    due: null,
                    description: ''
                },
                {
                    id: 'c10',
                    title: 'Code review: payments',
                    labels: ['red'],
                    checklist: [],
                    due: null,
                    description: ''
                },
                {
                    id: 'c11',
                    title: 'Update user permissions',
                    labels: ['yellow'],
                    checklist: [],
                    due: null,
                    description: ''
                },
                {
                    id: 'c12',
                    title: 'Performance optimization',
                    labels: [],
                    checklist: [],
                    due: null,
                    description: ''
                }
            ]
        },
        {
            id: 'done',
            name: 'Done',
            cards: [
                {
                    id: 'c13',
                    title: 'Set up project repo',
                    labels: ['green'],
                    checklist: [],
                    due: null,
                    description: ''
                },
                {
                    id: 'c14',
                    title: 'Design mockups',
                    labels: ['purple'],
                    checklist: [],
                    due: null,
                    description: ''
                },
                {
                    id: 'c15',
                    title: 'Create database schema',
                    labels: ['blue'],
                    checklist: [],
                    due: null,
                    description: ''
                },
                {
                    id: 'c16',
                    title: 'Sprint planning meeting',
                    labels: [],
                    checklist: [],
                    due: null,
                    description: ''
                }
            ]
        }
    ]
};

let nextCardId = 17;
let activeFilter = null; // null or a label color string

/* ---------- Helpers ---------- */

function findCard(cardId) {
    for (const col of boardData.columns) {
        const card = col.cards.find(c => c.id === cardId);
        if (card) return { card, column: col };
    }
    return null;
}

function getColumnName(columnId) {
    const col = boardData.columns.find(c => c.id === columnId);
    return col ? col.name : columnId;
}

/* ---------- Render Board ---------- */

function renderBoard() {
    const board = document.getElementById('board');
    board.innerHTML = '';

    boardData.columns.forEach(col => {
        const colEl = document.createElement('div');
        colEl.className = 'column';
        colEl.dataset.columnId = col.id;

        // Header
        const header = document.createElement('div');
        header.className = 'column-header';
        header.innerHTML = `
            <span class="column-name">${col.name}</span>
            <button class="column-menu-btn" aria-label="List menu">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
                </svg>
            </button>
        `;
        colEl.appendChild(header);

        // Cards area
        const cardsContainer = document.createElement('div');
        cardsContainer.className = 'column-cards';
        cardsContainer.dataset.columnId = col.id;

        col.cards.forEach(card => {
            cardsContainer.appendChild(createCardElement(card, col.id));
        });

        colEl.appendChild(cardsContainer);

        // Footer: Add a card
        const footer = document.createElement('div');
        footer.className = 'column-footer';
        footer.innerHTML = `
            <button class="add-card-btn" data-column="${col.id}">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                Add a card
            </button>
            <div class="add-card-form" data-column="${col.id}">
                <textarea class="add-card-textarea" placeholder="Enter a title for this card..." data-column="${col.id}"></textarea>
                <div class="add-card-actions">
                    <button class="add-card-submit" data-column="${col.id}">Add Card</button>
                    <button class="add-card-cancel" data-column="${col.id}">&times;</button>
                </div>
            </div>
        `;
        colEl.appendChild(footer);

        board.appendChild(colEl);
    });

    applyLabelFilter();
}

function createCardElement(card, columnId) {
    const el = document.createElement('div');
    el.className = 'card';
    el.dataset.cardId = card.id;
    el.dataset.columnId = columnId;

    // Labels
    if (card.labels && card.labels.length > 0) {
        const labelsDiv = document.createElement('div');
        labelsDiv.className = 'card-labels';
        card.labels.forEach(color => {
            const chip = document.createElement('span');
            chip.className = `card-label card-label-${color}`;
            chip.dataset.labelColor = color;
            labelsDiv.appendChild(chip);
        });
        el.appendChild(labelsDiv);
    }

    // Title
    const titleDiv = document.createElement('div');
    titleDiv.className = 'card-title';
    titleDiv.textContent = card.title;
    el.appendChild(titleDiv);

    // Badges
    const badges = [];
    if (card.due) {
        badges.push(`<span class="card-badge card-badge-due">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            ${card.due}
        </span>`);
    }
    if (card.checklist && card.checklist.length > 0) {
        const done = card.checklist.filter(i => i.checked).length;
        const total = card.checklist.length;
        badges.push(`<span class="card-badge">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
            ${done}/${total}
        </span>`);
    }
    if (badges.length > 0) {
        const badgesDiv = document.createElement('div');
        badgesDiv.className = 'card-badges';
        badgesDiv.innerHTML = badges.join('');
        el.appendChild(badgesDiv);
    }

    // Pencil (quick edit) button — hidden by default, shown on hover via CSS
    const editBtn = document.createElement('button');
    editBtn.className = 'card-edit-btn';
    editBtn.setAttribute('aria-label', 'Quick edit');
    editBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>`;
    el.appendChild(editBtn);

    return el;
}

/* ---------- Drag and Drop ---------- */

let dragState = null; // { cardId, ghost, placeholder, startX, startY, originalColumn }

function initDrag(e, cardEl) {
    // Don't start drag on edit button click
    if (e.target.closest('.card-edit-btn')) return;

    const cardId = cardEl.dataset.cardId;
    const result = findCard(cardId);
    if (!result) return;

    const rect = cardEl.getBoundingClientRect();

    // Create ghost
    const ghost = cardEl.cloneNode(true);
    ghost.classList.add('card', 'drag-ghost');
    ghost.style.width = rect.width + 'px';
    ghost.style.left = rect.left + 'px';
    ghost.style.top = rect.top + 'px';
    document.body.appendChild(ghost);

    // Create placeholder
    const placeholder = document.createElement('div');
    placeholder.className = 'card-placeholder';
    placeholder.style.height = rect.height + 'px';

    // Replace card with placeholder
    cardEl.parentNode.insertBefore(placeholder, cardEl);
    cardEl.style.display = 'none';

    dragState = {
        cardId,
        cardEl,
        ghost,
        placeholder,
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top,
        originalColumn: cardEl.dataset.columnId
    };

    tracker.track('card_drag_start', {
        cardTitle: result.card.title,
        fromColumn: result.column.name
    });
}

function moveDrag(e) {
    if (!dragState) return;

    const { ghost, placeholder, offsetX, offsetY } = dragState;
    ghost.style.left = (e.clientX - offsetX) + 'px';
    ghost.style.top = (e.clientY - offsetY) + 'px';

    // Find target column cards container
    const targetEl = document.elementFromPoint(e.clientX, e.clientY);
    if (!targetEl) return;

    const targetCardsContainer = targetEl.closest('.column-cards');
    if (!targetCardsContainer) return;

    // Move placeholder to target column
    const cards = Array.from(targetCardsContainer.querySelectorAll('.card:not([style*="display: none"]), .card-placeholder'));
    let inserted = false;

    for (const child of cards) {
        if (child === placeholder) continue;
        const childRect = child.getBoundingClientRect();
        if (e.clientY < childRect.top + childRect.height / 2) {
            targetCardsContainer.insertBefore(placeholder, child);
            inserted = true;
            break;
        }
    }

    if (!inserted) {
        targetCardsContainer.appendChild(placeholder);
    }
}

function endDrag(e) {
    if (!dragState) return;

    const { cardId, cardEl, ghost, placeholder } = dragState;
    const result = findCard(cardId);
    if (!result) {
        cleanup();
        return;
    }

    // Figure out new column and position
    const newContainer = placeholder.closest('.column-cards');
    const newColumnId = newContainer ? newContainer.dataset.columnId : dragState.originalColumn;
    const newColumn = boardData.columns.find(c => c.id === newColumnId);
    const oldColumn = result.column;

    // Position among siblings
    const siblings = Array.from(newContainer.querySelectorAll('.card, .card-placeholder'));
    let newIndex = siblings.indexOf(placeholder);

    // Remove card from old column data
    const oldIdx = oldColumn.cards.indexOf(result.card);
    if (oldIdx !== -1) oldColumn.cards.splice(oldIdx, 1);

    // If same column and the placeholder is after the original position, adjust
    if (oldColumn === newColumn && newIndex > oldIdx) {
        newIndex = Math.max(0, newIndex - 1);
    }

    // Insert into new column data
    newColumn.cards.splice(newIndex, 0, result.card);

    tracker.track('card_drop', {
        cardTitle: result.card.title,
        toColumn: newColumn.name,
        position: newIndex
    });

    cleanup();
    renderBoard();

    function cleanup() {
        ghost.remove();
        placeholder.remove();
        cardEl.style.display = '';
        dragState = null;
    }
}

/* ---------- Hover Reveal Pencil ---------- */

document.addEventListener('mouseenter', function(e) {
    const card = e.target.closest ? e.target.closest('.card') : null;
    if (!card || card.classList.contains('drag-ghost')) return;
    const cardId = card.dataset.cardId;
    const result = findCard(cardId);
    if (result) {
        tracker.track('card_hover_edit_reveal', { cardTitle: result.card.title });
    }
}, true);

/* ---------- Quick Edit (Pencil click) ---------- */

function openQuickEdit(cardEl) {
    const cardId = cardEl.dataset.cardId;
    const result = findCard(cardId);
    if (!result) return;

    tracker.track('card_quick_edit_open', { cardTitle: result.card.title });

    // Replace card content with inline edit
    const origContent = cardEl.innerHTML;
    const origTitle = result.card.title;

    cardEl.innerHTML = `
        <div class="quick-edit-container">
            <textarea class="quick-edit-input">${origTitle}</textarea>
            <button class="quick-edit-save">Save</button>
        </div>
    `;

    const textarea = cardEl.querySelector('.quick-edit-input');
    textarea.focus();
    textarea.select();

    function save() {
        const newTitle = textarea.value.trim();
        if (newTitle && newTitle !== origTitle) {
            result.card.title = newTitle;
            tracker.track('card_quick_edit_save', { newTitle });
        }
        renderBoard();
    }

    cardEl.querySelector('.quick-edit-save').addEventListener('click', function(e) {
        e.stopPropagation();
        save();
    });

    textarea.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            save();
        }
        if (e.key === 'Escape') {
            renderBoard();
        }
    });

    // Prevent card click from opening modal
    cardEl.addEventListener('click', function(e) {
        e.stopPropagation();
    }, { once: true });
}

/* ---------- Card Modal ---------- */

let currentModalCardId = null;

function openCardModal(cardId) {
    const result = findCard(cardId);
    if (!result) return;

    currentModalCardId = cardId;
    const { card, column } = result;

    tracker.track('card_modal_open', { cardTitle: card.title });

    // Populate modal
    const overlay = document.getElementById('card-modal-overlay');
    document.getElementById('modal-title').textContent = card.title;
    document.getElementById('modal-title').style.display = '';
    document.getElementById('modal-title-input').style.display = 'none';
    document.getElementById('modal-column-name').textContent = column.name;

    // Labels in modal
    const labelsEl = document.getElementById('modal-labels');
    labelsEl.innerHTML = '';
    if (card.labels && card.labels.length > 0) {
        card.labels.forEach(color => {
            const chip = document.createElement('span');
            chip.className = `modal-label card-label-${color}`;
            labelsEl.appendChild(chip);
        });
    }

    // Description
    const descPlaceholder = document.getElementById('description-placeholder');
    const descTextarea = document.getElementById('description-textarea');
    const descActions = document.getElementById('description-actions');
    descPlaceholder.style.display = card.description ? 'none' : '';
    descPlaceholder.textContent = card.description || 'Add a more detailed description...';
    descTextarea.style.display = 'none';
    descTextarea.value = card.description || '';
    descActions.style.display = 'none';

    // Checklist
    const checklistSection = document.getElementById('checklist-section');
    if (card.checklist && card.checklist.length > 0) {
        checklistSection.style.display = '';
        renderChecklist(card);
    } else {
        checklistSection.style.display = 'none';
    }

    // Reset label picker
    document.getElementById('label-picker-popover').style.display = 'none';

    // Show modal
    overlay.classList.add('active');
}

function closeCardModal() {
    document.getElementById('card-modal-overlay').classList.remove('active');
    document.getElementById('label-picker-popover').style.display = 'none';
    tracker.track('card_modal_close', {});
    currentModalCardId = null;
    renderBoard(); // refresh cards in case labels/checklist changed
}

function renderChecklist(card) {
    const itemsEl = document.getElementById('checklist-items');
    itemsEl.innerHTML = '';

    const checked = card.checklist.filter(i => i.checked).length;
    const total = card.checklist.length;
    document.getElementById('checklist-progress').textContent = `${checked}/${total}`;

    const pct = total > 0 ? (checked / total * 100) : 0;
    document.getElementById('checklist-progress-bar').style.width = pct + '%';

    card.checklist.forEach((item, idx) => {
        const div = document.createElement('div');
        div.className = 'checklist-item' + (item.checked ? ' checked' : '');
        div.innerHTML = `
            <input type="checkbox" id="cl-item-${idx}" ${item.checked ? 'checked' : ''}>
            <label for="cl-item-${idx}">${item.text}</label>
        `;
        div.querySelector('input').addEventListener('change', function() {
            item.checked = this.checked;
            div.classList.toggle('checked', item.checked);
            tracker.track('checklist_check', { itemText: item.text, checked: item.checked });
            renderChecklist(card);
        });
        itemsEl.appendChild(div);
    });
}

/* ---------- Label Picker ---------- */

function openLabelPicker() {
    const popover = document.getElementById('label-picker-popover');
    popover.style.display = popover.style.display === 'none' ? '' : 'none';

    if (popover.style.display !== 'none') {
        tracker.track('label_picker_open', {});
        updateLabelPickerState();
    }
}

function updateLabelPickerState() {
    const result = findCard(currentModalCardId);
    if (!result) return;

    const swatches = document.querySelectorAll('#label-swatches .label-swatch');
    swatches.forEach(swatch => {
        const color = swatch.dataset.color;
        if (result.card.labels.includes(color)) {
            swatch.classList.add('selected');
        } else {
            swatch.classList.remove('selected');
        }
    });
}

function toggleLabel(color) {
    const result = findCard(currentModalCardId);
    if (!result) return;

    const idx = result.card.labels.indexOf(color);
    if (idx !== -1) {
        result.card.labels.splice(idx, 1);
        tracker.track('label_remove', { color });
    } else {
        result.card.labels.push(color);
        tracker.track('label_assign', { color });
    }

    updateLabelPickerState();

    // Update modal labels display
    const labelsEl = document.getElementById('modal-labels');
    labelsEl.innerHTML = '';
    result.card.labels.forEach(c => {
        const chip = document.createElement('span');
        chip.className = `modal-label card-label-${c}`;
        labelsEl.appendChild(chip);
    });
}

/* ---------- Add Card Inline ---------- */

function showAddCardForm(columnId) {
    tracker.track('add_card_click', { column: getColumnName(columnId) });

    const form = document.querySelector(`.add-card-form[data-column="${columnId}"]`);
    const btn = document.querySelector(`.add-card-btn[data-column="${columnId}"]`);
    if (form && btn) {
        form.classList.add('active');
        btn.style.display = 'none';
        const textarea = form.querySelector('.add-card-textarea');
        textarea.value = '';
        textarea.focus();
    }
}

function hideAddCardForm(columnId) {
    const form = document.querySelector(`.add-card-form[data-column="${columnId}"]`);
    const btn = document.querySelector(`.add-card-btn[data-column="${columnId}"]`);
    if (form && btn) {
        form.classList.remove('active');
        btn.style.display = '';
    }
}

function submitAddCard(columnId) {
    const textarea = document.querySelector(`.add-card-textarea[data-column="${columnId}"]`);
    const title = textarea.value.trim();
    if (!title) return;

    const col = boardData.columns.find(c => c.id === columnId);
    if (!col) return;

    const newCard = {
        id: 'c' + (nextCardId++),
        title,
        labels: [],
        checklist: [],
        due: null,
        description: ''
    };

    col.cards.push(newCard);

    tracker.track('card_create_submit', { cardTitle: title, column: col.name });

    renderBoard();
}

/* ---------- Board Menu Side Panel ---------- */

function openBoardMenu() {
    const panel = document.getElementById('board-menu-panel');
    panel.classList.add('open');
    tracker.track('board_menu_open', {});
    tracker.track('board_layout_shift', {});
}

function closeBoardMenu() {
    const panel = document.getElementById('board-menu-panel');
    panel.classList.remove('open');
    activeFilter = null;
    document.querySelectorAll('.filter-label-btn').forEach(b => b.classList.remove('active'));
    applyLabelFilter();
    tracker.track('board_menu_close', {});
    tracker.track('board_layout_shift', {});
}

function applyLabelFilter() {
    const allCards = document.querySelectorAll('.card');
    let matchCount = 0;

    allCards.forEach(cardEl => {
        if (!activeFilter) {
            cardEl.classList.remove('dimmed');
            return;
        }
        const labelChips = cardEl.querySelectorAll('.card-label');
        let hasLabel = false;
        labelChips.forEach(chip => {
            if (chip.dataset.labelColor === activeFilter) hasLabel = true;
        });
        if (hasLabel) {
            cardEl.classList.remove('dimmed');
            matchCount++;
        } else {
            cardEl.classList.add('dimmed');
        }
    });

    if (activeFilter) {
        tracker.track('board_filter_active', { matchingCards: matchCount });
    }
}

/* ---------- Board Name Edit ---------- */

function startBoardNameEdit() {
    const nameEl = document.getElementById('board-name');
    const current = nameEl.textContent;

    const input = document.createElement('input');
    input.type = 'text';
    input.value = current;
    input.className = 'board-name-input';

    nameEl.replaceWith(input);
    input.focus();
    input.select();

    function save() {
        const val = input.value.trim() || current;
        const h1 = document.createElement('h1');
        h1.className = 'board-name';
        h1.id = 'board-name';
        h1.textContent = val;
        input.replaceWith(h1);
        h1.addEventListener('click', startBoardNameEdit);
    }

    input.addEventListener('blur', save);
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { input.value = current; input.blur(); }
    });
}

/* ---------- Description Edit ---------- */

function startDescriptionEdit() {
    const result = findCard(currentModalCardId);
    if (!result) return;

    document.getElementById('description-placeholder').style.display = 'none';
    const textarea = document.getElementById('description-textarea');
    const actions = document.getElementById('description-actions');
    textarea.style.display = '';
    textarea.value = result.card.description || '';
    actions.style.display = '';
    textarea.focus();
}

function saveDescription() {
    const result = findCard(currentModalCardId);
    if (!result) return;

    const textarea = document.getElementById('description-textarea');
    result.card.description = textarea.value.trim();

    textarea.style.display = 'none';
    document.getElementById('description-actions').style.display = 'none';
    const placeholder = document.getElementById('description-placeholder');
    placeholder.style.display = '';
    placeholder.textContent = result.card.description || 'Add a more detailed description...';
}

function cancelDescription() {
    document.getElementById('description-textarea').style.display = 'none';
    document.getElementById('description-actions').style.display = 'none';
    document.getElementById('description-placeholder').style.display = '';
}

/* ---------- Card Title Edit in Modal ---------- */

function startModalTitleEdit() {
    const result = findCard(currentModalCardId);
    if (!result) return;

    const titleEl = document.getElementById('modal-title');
    const inputEl = document.getElementById('modal-title-input');
    const oldTitle = result.card.title;

    titleEl.style.display = 'none';
    inputEl.style.display = '';
    inputEl.value = oldTitle;
    inputEl.focus();
    inputEl.select();

    function save() {
        const newTitle = inputEl.value.trim();
        if (newTitle && newTitle !== oldTitle) {
            result.card.title = newTitle;
            tracker.track('card_title_edit', { oldTitle, newTitle });
        }
        titleEl.textContent = result.card.title;
        titleEl.style.display = '';
        inputEl.style.display = 'none';
    }

    inputEl.onblur = save;
    inputEl.onkeydown = function(e) {
        if (e.key === 'Enter') { e.preventDefault(); inputEl.blur(); }
        if (e.key === 'Escape') { inputEl.value = oldTitle; inputEl.blur(); }
    };
}

/* ---------- Event Delegation ---------- */

document.addEventListener('mousedown', function(e) {
    const cardEl = e.target.closest('.card');
    if (!cardEl) return;
    if (cardEl.classList.contains('drag-ghost')) return;
    if (e.target.closest('.card-edit-btn')) return;
    if (e.target.closest('.quick-edit-container')) return;

    // Delay drag start to distinguish from click
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;

    function onMove(ev) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
            moved = true;
            document.removeEventListener('mousemove', onMove);
            initDrag(e, cardEl);
        }
    }

    function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (!moved) {
            // It was a click, not a drag
            openCardModal(cardEl.dataset.cardId);
        }
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
});

document.addEventListener('mousemove', moveDrag);
document.addEventListener('mouseup', endDrag);

// Click delegation
document.addEventListener('click', function(e) {
    // Quick edit pencil
    const editBtn = e.target.closest('.card-edit-btn');
    if (editBtn) {
        e.stopPropagation();
        const cardEl = editBtn.closest('.card');
        if (cardEl) openQuickEdit(cardEl);
        return;
    }

    // Add card button
    const addBtn = e.target.closest('.add-card-btn');
    if (addBtn) {
        showAddCardForm(addBtn.dataset.column);
        return;
    }

    // Add card submit
    const submitBtn = e.target.closest('.add-card-submit');
    if (submitBtn) {
        submitAddCard(submitBtn.dataset.column);
        return;
    }

    // Add card cancel
    const cancelBtn = e.target.closest('.add-card-cancel');
    if (cancelBtn) {
        hideAddCardForm(cancelBtn.dataset.column);
        return;
    }

    // Board menu open
    if (e.target.closest('#board-menu-btn')) {
        openBoardMenu();
        return;
    }

    // Board menu close
    if (e.target.closest('#panel-close-btn')) {
        closeBoardMenu();
        return;
    }

    // Star toggle
    if (e.target.closest('#star-toggle')) {
        document.getElementById('star-toggle').classList.toggle('starred');
        return;
    }

    // Board name edit
    if (e.target.closest('#board-name')) {
        startBoardNameEdit();
        return;
    }

    // Modal close
    if (e.target.closest('#modal-close-btn') || e.target === document.getElementById('card-modal-overlay')) {
        closeCardModal();
        return;
    }

    // Modal title edit
    if (e.target.closest('#modal-title')) {
        startModalTitleEdit();
        return;
    }

    // Description edit
    if (e.target.closest('#description-placeholder')) {
        startDescriptionEdit();
        return;
    }

    // Description save
    if (e.target.closest('#desc-save-btn')) {
        saveDescription();
        return;
    }

    // Description cancel
    if (e.target.closest('#desc-cancel-btn')) {
        cancelDescription();
        return;
    }

    // Labels button in sidebar
    if (e.target.closest('#sidebar-labels-btn')) {
        openLabelPicker();
        return;
    }

    // Checklist button in sidebar — reveal hidden section and focus the add input
    if (e.target.closest('#sidebar-checklist-btn')) {
        const section = document.getElementById('checklist-section');
        if (section) section.style.display = '';
        const input = document.getElementById('checklist-add-input');
        if (input) {
            input.focus();
            input.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        tracker.track('checklist_section_reveal', {
            cardId: currentModalCardId,
        });
        return;
    }

    // Label picker close
    if (e.target.closest('#label-picker-close')) {
        document.getElementById('label-picker-popover').style.display = 'none';
        return;
    }

    // Label swatch click
    const swatch = e.target.closest('.label-swatch');
    if (swatch && swatch.closest('#label-swatches')) {
        toggleLabel(swatch.dataset.color);
        return;
    }

    // Filter label btn
    const filterBtn = e.target.closest('.filter-label-btn');
    if (filterBtn) {
        const color = filterBtn.dataset.color;
        const wasActive = filterBtn.classList.contains('active');

        // Deactivate all
        document.querySelectorAll('.filter-label-btn').forEach(b => b.classList.remove('active'));

        if (wasActive) {
            activeFilter = null;
        } else {
            filterBtn.classList.add('active');
            activeFilter = color;
            tracker.track('board_filter_apply', { filterType: 'label', color });
        }
        applyLabelFilter();
        return;
    }

    // Clear filter
    if (e.target.closest('#clear-filter-btn')) {
        activeFilter = null;
        document.querySelectorAll('.filter-label-btn').forEach(b => b.classList.remove('active'));
        applyLabelFilter();
        return;
    }
});

// Add card textarea Enter key
document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey && e.target.classList.contains('add-card-textarea')) {
        e.preventDefault();
        submitAddCard(e.target.dataset.column);
    }
});

// Checklist add item
document.addEventListener('click', function(e) {
    if (e.target.closest('#checklist-add-btn')) {
        const input = document.getElementById('checklist-add-input');
        const text = input.value.trim();
        if (!text) return;

        const result = findCard(currentModalCardId);
        if (!result) return;

        result.card.checklist.push({ text, checked: false });
        tracker.track('checklist_add_submit', { itemText: text });
        input.value = '';
        renderChecklist(result.card);

        // Also show checklist section if it was hidden
        document.getElementById('checklist-section').style.display = '';
    }
});

// Checklist add via Enter
document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && e.target.id === 'checklist-add-input') {
        e.preventDefault();
        document.getElementById('checklist-add-btn').click();
    }
});

// ESC to close modal
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        if (document.getElementById('card-modal-overlay').classList.contains('active')) {
            closeCardModal();
        }
    }
});

/* ---------- Init ---------- */
renderBoard();
