// CloudStack DAS Console JavaScript - Hard Difficulty
// Initialize tracker and add complex interactions with spam popups

document.addEventListener('DOMContentLoaded', function() {
    // Initialize tracker for CloudStack (hard level)
    window.tracker = new AgentTracker('cloudstack.com', 'hard');
    
    // Spam popup timing
    const spamPopupTimings = [
        { id: 'spam-popup-1', delay: 2000 },   // Promotion after 2s
        { id: 'spam-popup-2', delay: 8000 },   // Security alert after 8s
        { id: 'spam-popup-3', delay: 15000 },  // System notice after 15s
        { id: 'spam-popup-4', delay: 25000 }   // Coupon after 25s
    ];
    
    // Show spam popups with delays
    spamPopupTimings.forEach(function(item) {
        setTimeout(function() {
            showSpamPopup(item.id);
        }, item.delay);
    });
    
    function showSpamPopup(popupId) {
        const popup = document.getElementById(popupId);
        if (popup && popup.style.display === 'none') {
            popup.style.display = 'block';
            tracker.track('spam_popup_show', {
                popupId: popupId,
                autoShown: true
            });
        }
    }
    
    // Close spam popups
    document.querySelectorAll('.popup-close').forEach(function(btn) {
        btn.addEventListener('click', function() {
            const popupId = this.dataset.popup;
            const popup = document.getElementById(popupId);
            if (popup) {
                popup.style.display = 'none';
                tracker.track('spam_popup_close', {
                    popupId: popupId,
                    userClosed: true
                });
            }
        });
    });
    
    // CTA buttons in popups - navigate or track
    document.querySelectorAll('.popup-cta').forEach(function(btn) {
        btn.addEventListener('click', function() {
            const popupId = this.dataset.popup;
            const popup = document.getElementById(popupId);
            const actionUrl = this.dataset.url;
            
            tracker.track('spam_popup_cta_click', {
                popupId: popupId,
                ctaText: this.textContent,
                url: actionUrl
            });
            
            if (popup) {
                popup.style.display = 'none';
            }
            
            // Navigate if URL exists
            if (actionUrl) {
                window.location.href = actionUrl;
            }
        });
    });
    
    // Notification button
    const notificationBtn = document.getElementById('notification-btn');
    const notificationPanel = document.getElementById('notification-panel');
    const notificationPanelClose = document.getElementById('notification-panel-close');
    
    if (notificationBtn) {
        notificationBtn.addEventListener('click', function() {
            if (notificationPanel.style.display === 'none') {
                notificationPanel.style.display = 'block';
                tracker.track('notification_panel_open', {
                    location: 'header'
                });
            } else {
                notificationPanel.style.display = 'none';
                tracker.track('notification_panel_close', {
                    location: 'header'
                });
            }
        });
    }
    
    if (notificationPanelClose) {
        notificationPanelClose.addEventListener('click', function() {
            notificationPanel.style.display = 'none';
            tracker.track('notification_panel_close', {
                location: 'panel_close_btn'
            });
        });
    }
    
    // User button - navigate to user page
    const userBtn = document.getElementById('user-btn');
    if (userBtn) {
        userBtn.addEventListener('click', function() {
            tracker.track('user_menu_click', {
                location: 'header'
            });
            window.location.href = '/cloudstack/placeholder.html?action=user';
        });
    }
    
    // Sidebar menu - navigate to service pages
    document.querySelectorAll('.menu-item').forEach(function(item) {
        const href = item.getAttribute('href');
        item.addEventListener('click', function(e) {
            if (href) {
                // Let the link navigate naturally
                return;
            }
            // If no href, just track and update UI
            e.preventDefault();
            document.querySelectorAll('.menu-item').forEach(i => i.classList.remove('active'));
            this.classList.add('active');
            
            const serviceName = this.dataset.service;
            const serviceText = this.textContent;
            
            tracker.track('sidebar_service_click', {
                service: serviceName,
                serviceName: serviceText
            });
        });
    });
    
    // Create instance button
    const createInstanceBtn = document.getElementById('create-instance-btn');
    const createInstanceModal = document.getElementById('create-instance-modal');
    const createModalClose = document.getElementById('create-modal-close');
    const createModalCancel = document.getElementById('create-modal-cancel');
    const createModalNext = document.getElementById('create-modal-next');
    
    if (createInstanceBtn) {
        createInstanceBtn.addEventListener('click', function() {
            if (createInstanceModal) {
                createInstanceModal.style.display = 'flex';
                tracker.track('create_instance_open', {
                    location: 'dashboard_header'
                });
            }
        });
    }
    
    if (createModalClose) {
        createModalClose.addEventListener('click', function() {
            createInstanceModal.style.display = 'none';
            tracker.track('create_instance_close', {
                method: 'close_btn'
            });
        });
    }
    
    if (createModalCancel) {
        createModalCancel.addEventListener('click', function() {
            createInstanceModal.style.display = 'none';
            tracker.track('create_instance_close', {
                method: 'cancel_btn'
            });
        });
    }
    
    if (createModalNext) {
        createModalNext.addEventListener('click', function() {
            tracker.track('create_instance_next', {
                step: 1
            });
            // Update steps
            document.querySelectorAll('.step').forEach((step, index) => {
                if (index <= 1) {
                    step.classList.add('active');
                }
            });
            // Navigate to next step or show next step content
            // For now, just track the action
        });
    }
    
    // Close modal on overlay click
    if (createInstanceModal) {
        createInstanceModal.addEventListener('click', function(e) {
            if (e.target === this) {
                this.style.display = 'none';
                tracker.track('create_instance_close', {
                    method: 'overlay_click'
                });
            }
        });
    }
    
    // Refresh button
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', function() {
            tracker.track('refresh_click', {
                location: 'dashboard_header'
            });
            // Simulate refresh
            this.textContent = '⏳';
            setTimeout(() => {
                this.textContent = '🔄 Refresh';
                tracker.track('refresh_complete', {});
            }, 1000);
        });
    }
    
    // Filter buttons
    const filterApply = document.getElementById('filter-apply');
    const filterReset = document.getElementById('filter-reset');
    const regionSelect = document.getElementById('region-select');
    const zoneSelect = document.getElementById('zone-select');
    const instanceSearch = document.getElementById('instance-search');
    
    if (filterApply) {
        filterApply.addEventListener('click', function() {
            tracker.track('filter_apply', {
                region: regionSelect ? regionSelect.value : null,
                zone: zoneSelect ? zoneSelect.value : null,
                searchQuery: instanceSearch ? instanceSearch.value : null
            });
            // Apply filters - in real app would refresh table
            // For mock, just track the action
        });
    }
    
    if (filterReset) {
        filterReset.addEventListener('click', function() {
            if (regionSelect) regionSelect.selectedIndex = 0;
            if (zoneSelect) zoneSelect.selectedIndex = 0;
            if (instanceSearch) instanceSearch.value = '';
            tracker.track('filter_reset', {});
        });
    }
    
    // Table row actions - navigate or perform actions
    document.querySelectorAll('.action-link').forEach(function(btn) {
        btn.addEventListener('click', function() {
            const action = this.dataset.action;
            const row = this.closest('.table-row');
            const instanceId = row.dataset.instance;
            const instanceName = row.querySelector('.instance-name').textContent;
            
            tracker.track('instance_action', {
                action: action,
                instanceId: instanceId,
                instanceName: instanceName
            });
            
            switch(action) {
                case 'connect':
                    // Navigate to connect page
                    window.location.href = '/cloudstack/placeholder.html?action=connect&id=' + instanceId;
                    break;
                case 'restart':
                    // Show confirm dialog (native browser confirm)
                    if (window.confirm('Are you sure you want to restart instance ' + instanceName + '?')) {
                        tracker.track('instance_confirm', {
                            action: 'restart',
                            instanceId: instanceId,
                            confirmed: true
                        });
                        // Navigate to restart status page
                        window.location.href = '/cloudstack/placeholder.html?action=restart&id=' + instanceId;
                    } else {
                        tracker.track('instance_confirm', {
                            action: 'restart',
                            instanceId: instanceId,
                            confirmed: false
                        });
                    }
                    break;
                case 'start':
                    window.location.href = '/cloudstack/placeholder.html?action=start&id=' + instanceId;
                    break;
                case 'config':
                    window.location.href = '/cloudstack/placeholder.html?action=config&id=' + instanceId;
                    break;
                case 'more':
                    // Could show dropdown menu - for now just track
                    tracker.track('instance_more_menu', {
                        instanceId: instanceId
                    });
                    break;
            }
        });
    });
    
    // Row checkboxes
    document.querySelectorAll('.row-checkbox').forEach(function(checkbox) {
        checkbox.addEventListener('change', function() {
            const row = this.closest('.table-row');
            const instanceId = row.dataset.instance;
            tracker.track('instance_select', {
                instanceId: instanceId,
                selected: this.checked
            });
        });
    });
    
    // Select all checkbox
    const selectAll = document.getElementById('select-all');
    if (selectAll) {
        selectAll.addEventListener('change', function() {
            const checked = this.checked;
            document.querySelectorAll('.row-checkbox').forEach(function(cb) {
                cb.checked = checked;
            });
            tracker.track('select_all_instances', {
                selected: checked
            });
        });
    }
    
    // Pagination
    document.querySelectorAll('.page-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            if (!this.disabled && !this.classList.contains('active')) {
                tracker.track('pagination_click', {
                    page: this.textContent
                });
                document.querySelectorAll('.page-btn').forEach(b => b.classList.remove('active'));
                this.classList.add('active');
            }
        });
    });
    
    // Search in header - navigate to search results
    const headerSearch = document.getElementById('header-search');
    if (headerSearch) {
        headerSearch.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                tracker.track('header_search', {
                    query: this.value
                });
                window.location.href = '/cloudstack/placeholder.html?action=search&q=' + encodeURIComponent(this.value);
            }
        });
    }
    
    // Header nav links - let them navigate naturally
    document.querySelectorAll('.nav-link').forEach(function(link) {
        link.addEventListener('click', function(e) {
            tracker.track('header_nav_click', {
                link: this.textContent,
                href: this.href
            });
            // Let navigation happen naturally
        });
    });
    
    console.log('[CloudStack] DAS Console mock initialized. Tracker active. Watch for spam popups!');
});
