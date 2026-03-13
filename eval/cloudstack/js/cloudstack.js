// CloudStack Console JavaScript

document.addEventListener('DOMContentLoaded', function() {
    // Notification button
    const notificationBtn = document.getElementById('notification-btn');
    const notificationPanel = document.getElementById('notification-panel');
    const notificationPanelClose = document.getElementById('notification-panel-close');
    
    if (notificationBtn && notificationPanel) {
        notificationBtn.addEventListener('click', function() {
            notificationPanel.style.display = notificationPanel.style.display === 'none' ? 'block' : 'none';
        });
    }
    
    if (notificationPanelClose && notificationPanel) {
        notificationPanelClose.addEventListener('click', function() {
            notificationPanel.style.display = 'none';
        });
    }
    
    // Spam popups - show after delay
    const spamPopups = document.querySelectorAll('.spam-popup');
    spamPopups.forEach((popup, index) => {
        setTimeout(() => {
            popup.style.display = 'block';
        }, 2000 + (index * 3000));
    });
    
    // Close spam popups
    document.querySelectorAll('.popup-close, .popup-cta').forEach(btn => {
        btn.addEventListener('click', function() {
            const popupId = this.getAttribute('data-popup');
            if (popupId) {
                document.getElementById(popupId).style.display = 'none';
            }
        });
    });
    
    // Create instance modal
    const createInstanceBtn = document.getElementById('create-instance-btn');
    const createInstanceModal = document.getElementById('create-instance-modal');
    const createModalClose = document.getElementById('create-modal-close');
    const createModalCancel = document.getElementById('create-modal-cancel');
    const createModalNext = document.getElementById('create-modal-next');
    
    if (createInstanceBtn && createInstanceModal) {
        createInstanceBtn.addEventListener('click', function() {
            createInstanceModal.style.display = 'flex';
        });
    }
    
    if (createModalClose && createInstanceModal) {
        createModalClose.addEventListener('click', function() {
            createInstanceModal.style.display = 'none';
        });
    }
    
    if (createModalCancel && createInstanceModal) {
        createModalCancel.addEventListener('click', function() {
            createInstanceModal.style.display = 'none';
        });
    }
    
    if (createModalNext) {
        createModalNext.addEventListener('click', function() {
            alert('Proceeding to next step...');
        });
    }
    
    // Close modal on overlay click
    if (createInstanceModal) {
        createInstanceModal.addEventListener('click', function(e) {
            if (e.target === this) {
                this.style.display = 'none';
            }
        });
    }
    
    // Select all checkbox
    const selectAll = document.getElementById('select-all');
    const rowCheckboxes = document.querySelectorAll('.row-checkbox');
    
    if (selectAll) {
        selectAll.addEventListener('change', function() {
            rowCheckboxes.forEach(cb => {
                cb.checked = this.checked;
            });
        });
    }
    
    // Refresh button
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', function() {
            this.textContent = '🔄 Refreshing...';
            setTimeout(() => {
                this.textContent = '🔄 Refresh';
            }, 1000);
        });
    }
    
    // Filter buttons
    const filterApply = document.getElementById('filter-apply');
    const filterReset = document.getElementById('filter-reset');
    
    if (filterApply) {
        filterApply.addEventListener('click', function() {
            alert('Filters applied');
        });
    }
    
    if (filterReset) {
        filterReset.addEventListener('click', function() {
            document.getElementById('region-select').selectedIndex = 0;
            document.getElementById('zone-select').selectedIndex = 0;
            document.getElementById('instance-search').value = '';
        });
    }
    
    // Action buttons in table
    document.querySelectorAll('.action-link').forEach(btn => {
        btn.addEventListener('click', function() {
            const action = this.getAttribute('data-action');
            if (action) {
                alert('Action: ' + action);
            }
        });
    });
    
    // Pagination
    document.querySelectorAll('.page-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            if (!this.disabled && this.textContent !== '<' && this.textContent !== '>') {
                document.querySelectorAll('.page-btn').forEach(b => b.classList.remove('active'));
                this.classList.add('active');
            }
        });
    });
    
    // Sidebar menu
    document.querySelectorAll('.sidebar-menu a').forEach(link => {
        link.addEventListener('click', function(e) {
            // Don't prevent default - allow navigation
            document.querySelectorAll('.sidebar-menu a').forEach(l => l.classList.remove('active'));
            this.classList.add('active');
        });
    });
    
    console.log('CloudStack Console loaded successfully');
});
