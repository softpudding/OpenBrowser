// CloudStack Tracker - Analytics and Event Tracking

(function() {
    'use strict';
    
    // Simple page view tracker
    const tracker = {
        pageViews: 0,
        events: [],
        
        trackPageView: function(pageName) {
            this.pageViews++;
            console.log('[Tracker] Page view:', pageName || window.location.pathname);
        },
        
        trackEvent: function(category, action, label) {
            this.events.push({
                category: category,
                action: action,
                label: label,
                timestamp: Date.now()
            });
            console.log('[Tracker] Event:', category, action, label);
        },
        
        trackClick: function(element) {
            this.trackEvent('click', 'element', element.tagName || 'unknown');
        }
    };
    
    // Track initial page view
    tracker.trackPageView();
    
    // Track navigation clicks
    document.addEventListener('click', function(e) {
        const target = e.target.closest('a, button');
        if (target) {
            tracker.trackClick(target);
        }
    });
    
    // Expose tracker globally
    window.cloudStackTracker = tracker;
    
    console.log('[Tracker] CloudStack tracker initialized');
})();
