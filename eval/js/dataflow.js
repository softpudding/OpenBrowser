document.addEventListener('DOMContentLoaded', function() {
    window.tracker = new AgentTracker('dataflow.io', 'medium');

    const allModals = document.querySelectorAll('.modal-overlay');
    const allModalCloses = document.querySelectorAll('.modal-close, .modal-close-btn');

    const iconBtns = {
        'header-icon-1': { modal: 'saved-modal', name: 'saved' },
        'header-icon-2': { modal: 'downloads-modal', name: 'downloads' },
        'header-icon-3': { modal: 'history-modal', name: 'history' },
        'header-icon-4': { modal: 'favorites-modal', name: 'favorites' },
        'header-icon-5': { modal: 'notifications-modal', name: 'notifications' },
        'header-icon-7': { modal: 'messages-modal', name: 'messages' }
    };

    const settingsBtn = document.getElementById('header-icon-6');
    const settingsModal = document.getElementById('settings-modal');
    const settingsModalClose = document.getElementById('settings-modal-close');
    const settingsCancel = document.getElementById('settings-cancel');
    const settingsSave = document.getElementById('settings-save');

    const quarterModal = document.getElementById('quarter-modal');
    const quarterModalClose = document.getElementById('quarter-modal-close');
    const quarterClose = document.getElementById('quarter-close');
    const quarterModalTitle = document.getElementById('quarter-modal-title');
    const quarterRevenue = document.getElementById('quarter-revenue');
    const pageTitle = document.getElementById('page-title');
    const breadcrumbCurrent = document.getElementById('breadcrumb-current');
    const reportsHub = document.getElementById('reports-hub');
    const openQ4ReportBtn = document.getElementById('open-q4-report-btn');

    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');
    let activeTab = 'overview';
    let activeWorkspace = 'dashboard';

    tabs[0]?.classList.add('active');
    tabContents[0]?.classList.add('active');

    const bars = document.querySelectorAll('.bar');
    const yearFilter = document.getElementById('year-filter');
    const exportBtn = document.getElementById('export-btn');
    const addWidgetBtn = document.getElementById('add-widget-btn');
    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');

    const navItems = document.querySelectorAll('.nav-item');
    const cardLinks = document.querySelectorAll('.card-link');

    const revenueData = {
        Q1: {
            value: 45000,
            orders: 892,
            aov: 50.45,
            conversion: 3.1,
            growth: '+8.2%',
            months: [
                { name: 'January', revenue: 14200, orders: 284 },
                { name: 'February', revenue: 15100, orders: 301 },
                { name: 'March', revenue: 15700, orders: 307 }
            ],
            products: [
                { name: 'Enterprise Plan', revenue: 18200 },
                { name: 'Professional Plan', revenue: 12400 },
                { name: 'Starter Plan', revenue: 8900 }
            ],
            insights: [
                'Strong performance in March due to new product launch',
                'Conversion rate improved by 0.4% from previous quarter',
                'Enterprise plan saw 12% increase in signups'
            ]
        },
        Q2: {
            value: 52000,
            orders: 1034,
            aov: 50.29,
            conversion: 3.4,
            growth: '+15.6%',
            months: [
                { name: 'April', revenue: 16800, orders: 332 },
                { name: 'May', revenue: 17200, orders: 345 },
                { name: 'June', revenue: 18000, orders: 357 }
            ],
            products: [
                { name: 'Enterprise Plan', revenue: 22400 },
                { name: 'Professional Plan', revenue: 15600 },
                { name: 'Add-on: Analytics', revenue: 7200 }
            ],
            insights: [
                'Summer promotion drove 15% more conversions',
                'New analytics add-on became a top seller',
                'Customer retention rate reached 94%'
            ]
        },
        Q3: {
            value: 38000,
            orders: 756,
            aov: 50.26,
            conversion: 3.1,
            growth: '-26.9%',
            months: [
                { name: 'July', revenue: 13200, orders: 264 },
                { name: 'August', revenue: 11800, orders: 236 },
                { name: 'September', revenue: 13000, orders: 256 }
            ],
            products: [
                { name: 'Enterprise Plan', revenue: 15800 },
                { name: 'Professional Plan', revenue: 11200 },
                { name: 'Starter Plan', revenue: 6800 }
            ],
            insights: [
                'Seasonal slowdown typical for Q3',
                'Marketing budget was reduced by 20%',
                'Focus shifted to customer retention over acquisition'
            ]
        },
        Q4: {
            value: 71000,
            orders: 1234,
            aov: 57.54,
            conversion: 4.2,
            growth: '+86.8%',
            months: [
                { name: 'October', revenue: 21500, orders: 378 },
                { name: 'November', revenue: 24800, orders: 426 },
                { name: 'December', revenue: 24700, orders: 430 }
            ],
            products: [
                { name: 'Enterprise Plan', revenue: 32400 },
                { name: 'Professional Plan', revenue: 21200 },
                { name: 'Add-on: Analytics', revenue: 9800 }
            ],
            insights: [
                'Black Friday and holiday promotions drove record sales',
                'Average order value increased by 14.3%',
                'New enterprise features launched successfully',
                'Customer acquisition cost reduced by 22%'
            ]
        }
    };

    const quarterMonthlyBody = document.getElementById('quarter-monthly-body');
    const quarterProducts = document.getElementById('quarter-products');
    const quarterInsights = document.getElementById('quarter-insights');
    const quarterExport = document.getElementById('quarter-export');

    function syncWorkspaceChrome() {
        const showReportsHub = activeWorkspace === 'reports' && activeTab === 'overview';
        if (reportsHub) {
            reportsHub.hidden = !showReportsHub;
        }
        if (pageTitle) {
            pageTitle.textContent = activeWorkspace === 'reports' ? 'Reports' : 'Dashboard';
        }
        if (breadcrumbCurrent) {
            breadcrumbCurrent.textContent = activeWorkspace === 'reports' ? 'Reports' : 'Dashboard';
        }
    }

    function switchWorkspace(workspace) {
        activeWorkspace = workspace;
        syncWorkspaceChrome();

        if (workspace === 'reports') {
            switchTab('overview');
            tracker.track('reports_workspace_open', {
                source: 'sidebar'
            });
        }
    }

    function openSettingsModal() {
        settingsModal.style.display = 'flex';
        tracker.track('settings_modal_open', {
            location: 'header',
            element: 'settings-btn'
        });
    }

    function closeSettingsModal(method) {
        settingsModal.style.display = 'none';
        tracker.track('settings_modal_close', { method: method });
    }

    if (settingsBtn) {
        settingsBtn.addEventListener('click', openSettingsModal);
    }

    if (settingsModalClose) {
        settingsModalClose.addEventListener('click', function() {
            closeSettingsModal('close_btn');
        });
    }

    if (settingsCancel) {
        settingsCancel.addEventListener('click', function() {
            closeSettingsModal('cancel_btn');
        });
    }

    if (settingsSave) {
        settingsSave.addEventListener('click', function() {
            tracker.track('settings_save', {
                emailNotifications: document.getElementById('email-notif')?.checked,
                pushNotifications: document.getElementById('push-notif')?.checked,
                weeklyReports: document.getElementById('weekly-reports')?.checked
            });
            closeSettingsModal('save_btn');
        });
    }

    if (settingsModal) {
        settingsModal.addEventListener('click', function(e) {
            if (e.target === settingsModal) {
                closeSettingsModal('overlay_click');
            }
        });
    }

    function closeAllModals() {
        allModals.forEach(function(modal) {
            modal.style.display = 'none';
        });
    }

    function openModal(modalId, btnId, modalName) {
        const modal = document.getElementById(modalId);
        if (!modal) return;
        
        closeAllModals();
        modal.style.display = 'flex';
        tracker.track('modal_open', {
            modal: modalName,
            button: btnId
        });
    }

    Object.keys(iconBtns).forEach(function(btnId) {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.addEventListener('click', function() {
                openModal(iconBtns[btnId].modal, btnId, iconBtns[btnId].name);
            });
        }
    });

    allModalCloses.forEach(function(closeBtn) {
        closeBtn.addEventListener('click', function() {
            const modalId = this.dataset.modal;
            const modal = document.getElementById(modalId);
            if (modal) {
                modal.style.display = 'none';
                tracker.track('modal_close', {
                    modal: modalId.replace('-modal', ''),
                    method: 'close_btn'
                });
            }
        });
    });

    allModals.forEach(function(modal) {
        modal.addEventListener('click', function(e) {
            if (e.target === this) {
                this.style.display = 'none';
                tracker.track('modal_close', {
                    modal: this.id.replace('-modal', ''),
                    method: 'overlay_click'
                });
            }
        });
    });

    function openQuarterModal(quarter) {
        const data = revenueData[quarter];
        quarterModalTitle.textContent = quarter + ' Revenue Report';
        quarterRevenue.textContent = '$' + data.value.toLocaleString();
        
        document.getElementById('quarter-orders').textContent = data.orders.toLocaleString();
        document.getElementById('quarter-aov').textContent = '$' + data.aov.toFixed(2);
        document.getElementById('quarter-conversion').textContent = data.conversion + '%';
        document.getElementById('quarter-growth').textContent = data.growth + ' vs Q3';
        
        if (quarterMonthlyBody) {
            quarterMonthlyBody.innerHTML = '';
            data.months.forEach(function(month) {
                const row = document.createElement('tr');
                row.innerHTML = '<td>' + month.name + '</td><td>$' + month.revenue.toLocaleString() + '</td><td>' + month.orders + '</td><td>$' + (month.revenue / month.orders).toFixed(2) + '</td>';
                quarterMonthlyBody.appendChild(row);
            });
        }
        
        if (quarterProducts) {
            quarterProducts.innerHTML = '';
            data.products.forEach(function(product, index) {
                const div = document.createElement('div');
                div.className = 'report-product';
                div.innerHTML = '<span class="report-product-rank">' + (index + 1) + '</span><span class="report-product-name">' + product.name + '</span><span class="report-product-value">$' + product.revenue.toLocaleString() + '</span>';
                quarterProducts.appendChild(div);
            });
        }
        
        if (quarterInsights) {
            quarterInsights.innerHTML = '';
            data.insights.forEach(function(insight) {
                const li = document.createElement('li');
                li.textContent = insight;
                quarterInsights.appendChild(li);
            });
        }
        
        quarterModal.style.display = 'flex';

        bars.forEach(function(b) {
            b.classList.remove('selected');
        });
        document.querySelector('.bar[data-quarter="' + quarter + '"]')?.classList.add('selected');

        tracker.track('quarter_detail_open', {
            quarter: quarter,
            value: data.value
        });
    }

    function closeQuarterModal(method) {
        quarterModal.style.display = 'none';
        tracker.track('quarter_detail_close', { method: method });
    }

    bars.forEach(function(bar) {
        bar.addEventListener('click', function() {
            const quarter = this.dataset.quarter;
            tracker.track('chart_bar_click', {
                quarter: quarter,
                value: revenueData[quarter]?.value,
                element: 'bar',
                elementClass: 'bar'
            });
            openQuarterModal(quarter);
        });
    });

    if (quarterModalClose) {
        quarterModalClose.addEventListener('click', function() {
            closeQuarterModal('close_btn');
        });
    }

    if (quarterClose) {
        quarterClose.addEventListener('click', function() {
            closeQuarterModal('close_btn');
        });
    }

    if (quarterExport) {
        quarterExport.addEventListener('click', function() {
            tracker.track('quarter_report_export', {
                quarter: quarterModalTitle.textContent.split(' ')[0]
            });
        });
    }

    if (openQ4ReportBtn) {
        openQ4ReportBtn.addEventListener('click', function() {
            tracker.track('reports_shortcut_click', {
                target: 'q4_report'
            });
            openQuarterModal('Q4');
        });
    }

    if (quarterModal) {
        quarterModal.addEventListener('click', function(e) {
            if (e.target === quarterModal) {
                closeQuarterModal('overlay_click');
            }
        });
    }

    function switchTab(tabName) {
        activeTab = tabName;
        tabs.forEach(function(t) {
            t.classList.remove('active');
        });
        document.querySelector('.tab[data-tab="' + tabName + '"]')?.classList.add('active');

        tabContents.forEach(function(content) {
            content.classList.remove('active');
        });
        document.getElementById('content-' + tabName)?.classList.add('active');
        syncWorkspaceChrome();
    }

    tabs.forEach(function(tab) {
        tab.addEventListener('click', function() {
            const tabName = this.dataset.tab;
            tracker.track('tab_click', {
                tab: tabName,
                element: 'tab',
                elementClass: 'tab'
            });
            switchTab(tabName);
        });
    });

    if (yearFilter) {
        yearFilter.addEventListener('change', function() {
            tracker.track('year_filter_change', {
                year: this.value
            });
        });
    }

    if (exportBtn) {
        exportBtn.addEventListener('click', function() {
            tracker.track('export_click', {
                location: 'tabs_actions'
            });
        });
    }

    if (addWidgetBtn) {
        addWidgetBtn.addEventListener('click', function() {
            tracker.track('add_widget_click', {
                location: 'tabs_actions'
            });
        });
    }

    if (searchInput && searchBtn) {
        searchBtn.addEventListener('click', function() {
            if (searchInput.value.trim()) {
                tracker.track('search', {
                    query: searchInput.value.trim()
                });
            }
        });
        searchInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter' && this.value.trim()) {
                tracker.track('search', {
                    query: this.value.trim(),
                    method: 'enter_key'
                });
            }
        });
    }

    navItems.forEach(function(item) {
        item.addEventListener('click', function(e) {
            if (this.getAttribute('href') === '#') {
                e.preventDefault();
            }
            navItems.forEach(function(i) {
                i.classList.remove('active');
            });
            this.classList.add('active');
            tracker.track('nav_click', {
                text: this.textContent.trim(),
                location: 'sidebar'
            });

            if (this.dataset.view === 'dashboard') {
                switchWorkspace('dashboard');
            } else if (this.dataset.view === 'reports') {
                switchWorkspace('reports');
            }
        });
    });

    cardLinks.forEach(function(link) {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            tracker.track('card_link_click', {
                text: this.textContent.trim(),
                card: this.closest('.card')?.querySelector('h3')?.textContent
            });
        });
    });

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            if (settingsModal.style.display === 'flex') {
                closeSettingsModal('escape_key');
            }
            if (quarterModal.style.display === 'flex') {
                closeQuarterModal('escape_key');
            }
        }
    });

    syncWorkspaceChrome();
});
