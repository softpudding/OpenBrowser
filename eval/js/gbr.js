// GBR JavaScript - Easy Level
// Initialize tracker and add interactivity

// Global error handler to catch any unhandled errors
window.addEventListener('error', function(event) {
    console.error('[GBR] Global error:', event.error);
    console.error('[GBR] Error message:', event.message);
    console.error('[GBR] Error at:', event.filename, 'line:', event.lineno, 'col:', event.colno);
});

// Also catch unhandled promise rejections
window.addEventListener('unhandledrejection', function(event) {
    console.error('[GBR] Unhandled promise rejection:', event.reason);
});

document.addEventListener('DOMContentLoaded', function() {
    console.log('[GBR] DOMContentLoaded - initializing GBR functionality');
    
    // Initialize tracker for GBR (easy level)
    try {
        window.tracker = new AgentTracker('globalbusinessreview.com', 'easy');
        console.log('[GBR] Tracker initialized');
    } catch (error) {
        console.error('[GBR] Error initializing tracker:', error);
    }
    
    // Search toggle
    const searchToggle = document.getElementById('search-toggle');
    const searchBar = document.getElementById('search-bar');
    const searchInput = document.getElementById('search-input');
    const searchSubmit = document.getElementById('search-submit');
    
    console.log('[GBR] Search elements:', {
        searchToggle: !!searchToggle,
        searchBar: !!searchBar,
        searchInput: !!searchInput,
        searchSubmit: !!searchSubmit
    });
    
    if (searchToggle) {
        searchToggle.addEventListener('click', function() {
            console.log('[GBR] Search toggle clicked');
            if (searchBar.style.display === 'none') {
                searchBar.style.display = 'flex';
                searchInput.focus();
                console.log('[GBR] Search bar shown');
            } else {
                searchBar.style.display = 'none';
                console.log('[GBR] Search bar hidden');
            }
        });
    }
    
    // Search submit - navigate to search results page
    if (searchSubmit) {
        console.log('[GBR] Search submit button found, adding event listener');
        searchSubmit.addEventListener('click', function(e) {
            console.log('[GBR] Search submit button clicked');
            e.preventDefault(); // Prevent any default form submission
            const query = searchInput.value.trim();
            console.log('[GBR] Search query:', query);
            
            if (query) {
                console.log('[GBR] Searching for:', query);
                // Track the search if tracker is available
                if (window.tracker && typeof window.tracker.track === 'function') {
                    try {
                        window.tracker.track('search', {
                            query: query,
                            resultsPage: '/gbr/search.html?q=' + encodeURIComponent(query)
                        });
                    } catch (error) {
                        console.error('[GBR] Error tracking search:', error);
                    }
                } else {
                    console.log('[GBR] Tracker not available, skipping tracking');
                }
                const searchUrl = '/gbr/search.html?q=' + encodeURIComponent(query);
                console.log('[GBR] Navigating to:', searchUrl);
                window.location.href = searchUrl;
            } else {
                // Search bar is visible but empty
                console.log('[GBR] Empty search query');
                alert('Please enter a search term.');
                searchInput.focus();
            }
        });
    } else {
        console.error('[GBR] Search submit button NOT FOUND!');
    }
    
    // Search on Enter
    if (searchInput) {
        console.log('[GBR] Search input found, adding Enter key listener');
        searchInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                console.log('[GBR] Enter key pressed in search input');
                e.preventDefault(); // Prevent any default form submission
                if (searchSubmit) {
                    searchSubmit.click();
                }
            }
        });
    }
    
    // Subscribe button - show alert (mock functionality)
    const subscribeBtn = document.querySelector('.subscribe-btn');
    if (subscribeBtn) {
        subscribeBtn.addEventListener('click', function() {
            if (window.tracker && typeof window.tracker.track === 'function') {
                try {
                    window.tracker.track('subscribe_click', {
                        location: 'header'
                    });
                } catch (error) {
                    console.error('[GBR] Error tracking subscribe click:', error);
                }
            }
            alert('Thank you for your interest in subscribing to Global Business Review! This is a demo website. In a real implementation, you would be redirected to the subscription page.');
        });
    }
    
    // Sign in button - show alert (mock functionality)
    const signInBtn = document.querySelector('.sign-in-btn');
    if (signInBtn) {
        signInBtn.addEventListener('click', function() {
            if (window.tracker && typeof window.tracker.track === 'function') {
                try {
                    window.tracker.track('signin_click', {
                        location: 'header'
                    });
                } catch (error) {
                    console.error('[GBR] Error tracking signin click:', error);
                }
            }
            alert('This is a demo website. In a real implementation, you would be redirected to the sign in page.');
        });
    }
    
    // Track all article clicks - let them navigate naturally
    document.querySelectorAll('.article-link, .headline-link').forEach(function(link) {
        link.addEventListener('click', function(e) {
            // Don't prevent default - let navigation happen
            if (window.tracker && typeof window.tracker.track === 'function') {
                try {
                    window.tracker.track('article_click', {
                        articleTitle: this.textContent,
                        articleType: this.closest('article') ? 'article' : 'headline',
                        href: this.href
                    });
                } catch (error) {
                    console.error('[GBR] Error tracking article click:', error);
                }
            }
        });
    });
    
    // Add smooth scrolling (skip article links)
    document.querySelectorAll('a[href^="#"]').forEach(function(anchor) {
        // Skip article links that should navigate naturally
        if (anchor.classList.contains('article-link') || anchor.classList.contains('headline-link') || anchor.classList.contains('read-more')) {
            return;
        }
        anchor.addEventListener('click', function(e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({ behavior: 'smooth' });
            }
        });
    });
    
    console.log('[GBR] Mock website initialized. Tracker active.');
});
