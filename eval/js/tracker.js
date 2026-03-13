// Event Tracking Library for AI Agent Evaluation
// Tracks all user interactions and stores in localStorage

class AgentTracker {
    constructor(siteName, difficulty) {
        this.siteName = siteName;
        this.difficulty = difficulty;
        this.events = [];
        this.sessionId = this.generateSessionId();
        this.startTime = Date.now();
        
        // Load existing events from localStorage
        this.loadEvents();
        
        // Initialize tracking
        this.initTracking();
    }
    
    generateSessionId() {
        return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
    
    loadEvents() {
        const stored = localStorage.getItem('agent_tracking_events');
        if (stored) {
            try {
                this.events = JSON.parse(stored);
            } catch (e) {
                this.events = [];
            }
        }
    }
    
    saveEvents() {
        localStorage.setItem('agent_tracking_events', JSON.stringify(this.events));
    }
    
    track(eventType, data) {
        const event = {
            timestamp: Date.now(),
            sessionId: this.sessionId,
            site: this.siteName,
            difficulty: this.difficulty,
            page: window.location.pathname,
            eventType: eventType,
            ...data
        };
        
        this.events.push(event);
        this.saveEvents();
        
        // Also send to server if available
        this.sendToServer(event);
        
        console.log('[AgentTracker] Event:', event);
        return event;
    }
    
    sendToServer(event) {
        // Try to send to server endpoint
        fetch('/api/track', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(event)
        }).catch(() => {
            // Server might not be available, localStorage has it
        });
    }
    
    initTracking() {
        // Track clicks
        document.addEventListener('click', (e) => {
            const target = e.target;
            this.track('click', {
                element: target.tagName,
                elementId: target.id || null,
                elementClass: target.className || null,
                elementText: target.textContent?.trim().substring(0, 100) || null,
                selector: this.getSelector(target),
                x: e.clientX,
                y: e.clientY
            });
        });
        
        // Track scrolls
        let scrollTimeout;
        window.addEventListener('scroll', (e) => {
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => {
                this.track('scroll', {
                    scrollX: window.scrollX,
                    scrollY: window.scrollY,
                    maxScrollY: document.documentElement.scrollHeight - window.innerHeight
                });
            }, 100);
        });
        
        // Track input
        document.addEventListener('input', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                this.track('input', {
                    element: e.target.tagName,
                    elementId: e.target.id || null,
                    elementName: e.target.name || null,
                    inputType: e.target.type || null,
                    valueLength: e.target.value?.length || 0
                });
            }
        });
        
        // Track hover (with debounce)
        let hoverTimeout;
        document.addEventListener('mouseover', (e) => {
            clearTimeout(hoverTimeout);
            hoverTimeout = setTimeout(() => {
                this.track('hover', {
                    element: e.target.tagName,
                    elementId: e.target.id || null,
                    elementClass: e.target.className || null,
                    selector: this.getSelector(e.target)
                });
            }, 500);
        });
        
        // Track page navigation
        window.addEventListener('popstate', () => {
            this.track('navigation', {
                type: 'popstate',
                url: window.location.href
            });
        });
        
        // Track form submissions
        document.addEventListener('submit', (e) => {
            this.track('submit', {
                formId: e.target.id || null,
                formAction: e.target.action || null
            });
        });
        
        // Initial page view
        this.track('page_view', {
            url: window.location.href,
            title: document.title
        });
    }
    
    getSelector(element) {
        if (element.id) {
            return '#' + element.id;
        }
        if (element.className && typeof element.className === 'string') {
            return element.tagName.toLowerCase() + '.' + element.className.split(' ').join('.');
        }
        return element.tagName.toLowerCase();
    }
    
    getEvents() {
        return this.events;
    }
    
    exportEvents() {
        return JSON.stringify(this.events, null, 2);
    }
    
    clearEvents() {
        this.events = [];
        localStorage.removeItem('agent_tracking_events');
    }
}

// Make tracker available globally
window.AgentTracker = AgentTracker;
