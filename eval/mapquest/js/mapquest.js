/* ==========================================================
   MapQuest — Google Maps-like Mock Site  (mapquest.js)
   ========================================================== */

// ── Tracker ──────────────────────────────────────────────────
window.tracker = new AgentTracker('mapquest.com', 'hard');

// ── Place Data ───────────────────────────────────────────────
const PLACES = [
    {
        id: 'pike-place-market',
        name: 'Pike Place Market',
        coords: [180, 250],
        type: 'attraction',
        address: '85 Pike St, Seattle, WA 98101',
        rating: 4.6,
        reviews: 82417,
        hours: { open: true, close: '6 PM' },
        phone: '(206) 682-7453',
        website: 'pikeplacemarket.org',
        category: 'Public market'
    },
    {
        id: 'space-needle',
        name: 'Space Needle',
        coords: [120, 140],
        type: 'attraction',
        address: '400 Broad St, Seattle, WA 98109',
        rating: 4.5,
        reviews: 34812,
        hours: { open: true, close: '10 PM' },
        phone: '(206) 905-2100',
        website: 'spaceneedle.com',
        category: 'Observation tower'
    },
    {
        id: 'pike-place-parking-garage',
        name: 'Pike Place Market Parking Garage',
        coords: [185, 245],
        type: 'parking',
        address: '1531 Western Ave, Seattle, WA 98101',
        rating: 3.8,
        reviews: 412,
        hours: { open: true, close: '1 AM' },
        phone: '(206) 622-0570',
        website: '',
        category: 'Parking garage'
    },
    {
        id: 'pacific-place-parking',
        name: 'Pacific Place Parking',
        coords: [190, 248],
        type: 'parking',
        address: '600 Pine St, Seattle, WA 98101',
        rating: 3.5,
        reviews: 287,
        hours: { open: true, close: '12 AM' },
        phone: '(206) 405-2655',
        website: '',
        category: 'Parking garage'
    },
    {
        id: 'seattle-center',
        name: 'Seattle Center',
        coords: [115, 135],
        type: 'attraction',
        address: '305 Harrison St, Seattle, WA 98109',
        rating: 4.4,
        reviews: 12930,
        hours: { open: true, close: '9 PM' },
        phone: '(206) 684-7200',
        website: 'seattlecenter.com',
        category: 'Cultural center'
    },
    {
        id: 'starbucks-roastery',
        name: 'Starbucks Reserve Roastery',
        coords: [210, 200],
        type: 'coffee',
        address: '1124 Pike St, Seattle, WA 98101',
        rating: 4.4,
        reviews: 18245,
        hours: { open: true, close: '9 PM' },
        phone: '(206) 624-0173',
        website: 'starbucksreserve.com',
        category: 'Coffee roastery'
    },
    {
        id: 'pioneer-square',
        name: 'Pioneer Square',
        coords: [195, 310],
        type: 'attraction',
        address: 'Pioneer Square, Seattle, WA 98104',
        rating: 4.2,
        reviews: 7641,
        hours: { open: true, close: '11 PM' },
        phone: '',
        website: 'pioneersquare.org',
        category: 'Historic district'
    },
    {
        id: 'westlake-center',
        name: 'Westlake Center',
        coords: [200, 220],
        type: 'shopping',
        address: '400 Pine St, Seattle, WA 98101',
        rating: 4.0,
        reviews: 4521,
        hours: { open: true, close: '8 PM' },
        phone: '(206) 467-1600',
        website: 'westlakecenter.com',
        category: 'Shopping mall'
    }
];

const AD_PLACES = [
    {
        id: 'ad-seattle-tours',
        name: 'Sponsored: Seattle Tours',
        coords: [160, 190],
        type: 'ad',
        address: '1234 Tourist Way, Seattle, WA 98101',
        rating: 4.1,
        reviews: 523,
        hours: { open: true, close: '7 PM' },
        phone: '(206) 555-0199',
        website: 'seattletours.example.com',
        category: 'Tour operator · Ad',
        adDescription: 'Book award-winning Seattle city tours! Daily departures, waterfront views, local guides.'
    },
    {
        id: 'ad-best-western',
        name: 'Sponsored: Best Western',
        coords: [220, 270],
        type: 'ad',
        address: '200 Sixth Ave N, Seattle, WA 98109',
        rating: 3.9,
        reviews: 1892,
        hours: { open: true, close: '24 hours' },
        phone: '(206) 555-0177',
        website: 'bestwestern.example.com',
        category: 'Hotel · Ad',
        adDescription: 'Comfortable stays in the heart of Seattle. Free parking & breakfast included.'
    }
];

const ALL_PLACES = [...PLACES, ...AD_PLACES];

// ── State ────────────────────────────────────────────────────
let panelHistory = ['search'];   // stack of states
let currentState = 'search';
let currentPlaceId = null;
let activeChip = null;
let activeTransportMode = 'drive';
let activeRouteIndex = null;
let debounceTimer = null;

// ── DOM References ───────────────────────────────────────────
const panel = document.getElementById('left-panel');
const panelHeader = document.getElementById('panel-header');
const panelHeaderTitle = document.getElementById('panel-header-title');
const panelBackBtn = document.getElementById('panel-back-btn');
const panelToggle = document.getElementById('panel-toggle');

const stateSearch = document.getElementById('state-search');
const stateResults = document.getElementById('state-results');
const statePlaceDetail = document.getElementById('state-place-detail');
const stateDirections = document.getElementById('state-directions');

const searchInput = document.getElementById('search-input');
const resultsSearchInput = document.getElementById('results-search-input');
const autocompleteDropdown = document.getElementById('autocomplete-dropdown');

const chipBars = document.querySelectorAll('.chip-bar');

const mapPinsGroup = document.getElementById('map-pins');
const pinTooltipGroup = document.getElementById('pin-tooltip');
const tooltipBg = document.getElementById('tooltip-bg');
const tooltipText = document.getElementById('tooltip-text');

// Directions
const directionsOrigin = document.getElementById('directions-origin');
const directionsDestination = document.getElementById('directions-destination');
const originAutocomplete = document.getElementById('origin-autocomplete');
const destAutocomplete = document.getElementById('dest-autocomplete');
const swapBtn = document.getElementById('swap-btn');
const routeResults = document.getElementById('route-results');
const routeList = document.getElementById('route-list');
const transportTabs = document.getElementById('transport-tabs');

// ── Utility ──────────────────────────────────────────────────
function getPlaceById(id) {
    return ALL_PLACES.find(p => p.id === id) || null;
}

function starsHtml(rating) {
    const full = Math.floor(rating);
    const half = rating - full >= 0.3 && rating - full < 0.8;
    const empty = 5 - full - (half ? 1 : 0);
    return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty);
}

function typeIcon(type) {
    const map = {
        attraction: '🏛️',
        parking: '🅿️',
        coffee: '☕',
        shopping: '🛍️',
        ad: '📢'
    };
    return map[type] || '📍';
}

// ── Panel State Machine ──────────────────────────────────────
function switchPanelState(state, placeId) {
    // Deactivate all
    [stateSearch, stateResults, statePlaceDetail, stateDirections].forEach(el => el.classList.remove('active'));

    currentState = state;
    currentPlaceId = placeId || null;

    tracker.track('panel_state_change', { state, placeId: placeId || null });

    if (state === 'search') {
        stateSearch.classList.add('active');
        panelHeader.classList.add('hidden');
    } else if (state === 'results') {
        stateResults.classList.add('active');
        panelHeader.classList.remove('hidden');
        panelHeaderTitle.textContent = 'Search results';
    } else if (state === 'place-detail') {
        statePlaceDetail.classList.add('active');
        panelHeader.classList.remove('hidden');
        panelHeaderTitle.textContent = '';
        if (placeId) renderPlaceDetail(placeId);
    } else if (state === 'directions') {
        stateDirections.classList.add('active');
        panelHeader.classList.remove('hidden');
        panelHeaderTitle.textContent = '';
    }
}

function pushState(state, placeId) {
    panelHistory.push(state);
    switchPanelState(state, placeId);
}

function popState() {
    if (panelHistory.length > 1) {
        panelHistory.pop();
        const prev = panelHistory[panelHistory.length - 1];
        switchPanelState(prev);
    }
}

panelBackBtn.addEventListener('click', () => {
    popState();
    // Clear route drawings
    clearRoutes();
});

// ── Place Detail Renderer ────────────────────────────────────
function renderPlaceDetail(placeId) {
    const place = getPlaceById(placeId);
    if (!place) return;

    document.getElementById('place-name').textContent = place.name;
    document.getElementById('place-rating-number').textContent = place.rating.toFixed(1);
    document.getElementById('place-stars').textContent = starsHtml(place.rating);
    document.getElementById('place-review-count').textContent = `(${place.reviews.toLocaleString()} reviews)`;
    document.getElementById('place-category').textContent = place.category;
    document.getElementById('place-address-text').textContent = place.address;
    document.getElementById('place-website-text').textContent = place.website || 'N/A';
    document.getElementById('place-phone-text').textContent = place.phone || 'N/A';

    const hoursEl = document.getElementById('place-hours');
    if (place.hours.open) {
        hoursEl.innerHTML = `<span class="hours-status open">Open now</span><span class="hours-detail"> · Closes ${place.hours.close}</span>`;
    } else {
        hoursEl.innerHTML = `<span class="hours-status closed">Closed</span>`;
    }

    // Sponsored badge
    if (place.type === 'ad') {
        document.getElementById('place-category').textContent = place.category;
    }
}

// ── Directions Button ────────────────────────────────────────
document.getElementById('directions-btn').addEventListener('click', () => {
    const place = getPlaceById(currentPlaceId);
    if (place) {
        directionsDestination.value = place.name;
    }
    directionsOrigin.value = '';
    routeResults.classList.add('hidden');
    clearRoutes();
    pushState('directions', currentPlaceId);
});

// ── Save / Share buttons ─────────────────────────────────────
document.getElementById('save-btn').addEventListener('click', () => {
    tracker.track('place_save', { placeId: currentPlaceId });
});

document.getElementById('share-btn').addEventListener('click', () => {
    tracker.track('place_share', { placeId: currentPlaceId });
});

// ── Search Autocomplete ──────────────────────────────────────
function showAutocomplete(query, dropdown, fieldName) {
    if (!query.trim()) {
        dropdown.classList.add('hidden');
        return;
    }
    const lower = query.toLowerCase();
    const matches = ALL_PLACES.filter(p => p.name.toLowerCase().includes(lower));

    if (matches.length === 0) {
        dropdown.classList.add('hidden');
        return;
    }

    dropdown.innerHTML = matches.map(p => `
        <div class="autocomplete-item" data-place-id="${p.id}" data-field="${fieldName}">
            <div class="autocomplete-item-icon">${typeIcon(p.type)}</div>
            <div class="autocomplete-item-text">
                <div class="autocomplete-item-name">${p.name}</div>
                <div class="autocomplete-item-type">${p.category}</div>
            </div>
        </div>
    `).join('');
    dropdown.classList.remove('hidden');

    tracker.track('autocomplete_show', {});
}

function handleAutocompleteClick(e) {
    const item = e.target.closest('.autocomplete-item');
    if (!item) return;
    const placeId = item.dataset.placeId;
    const field = item.dataset.field;
    const place = getPlaceById(placeId);
    if (!place) return;

    const itemText = place.name;

    tracker.track('autocomplete_select', { itemText, field });

    if (field === 'search') {
        searchInput.value = itemText;
        autocompleteDropdown.classList.add('hidden');
        pushState('place-detail', placeId);
        highlightPin(placeId);
    } else if (field === 'origin') {
        directionsOrigin.value = itemText;
        originAutocomplete.classList.add('hidden');
        tryShowRoutes();
    } else if (field === 'destination') {
        directionsDestination.value = itemText;
        destAutocomplete.classList.add('hidden');
        tryShowRoutes();
    }
}

autocompleteDropdown.addEventListener('click', handleAutocompleteClick);
originAutocomplete.addEventListener('click', handleAutocompleteClick);
destAutocomplete.addEventListener('click', handleAutocompleteClick);

// Debounced input for search
searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        showAutocomplete(searchInput.value, autocompleteDropdown, 'search');
    }, 300);
});

// Enter key on search
searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        const query = searchInput.value.trim();
        if (!query) return;
        autocompleteDropdown.classList.add('hidden');
        tracker.track('search_enter', { query });
        renderSearchResults(query);
        pushState('results');
    }
});

// Directions origin autocomplete
directionsOrigin.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        showAutocomplete(directionsOrigin.value, originAutocomplete, 'origin');
    }, 300);
});

// Directions destination autocomplete
directionsDestination.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        showAutocomplete(directionsDestination.value, destAutocomplete, 'destination');
    }, 300);
});

// Close dropdowns on outside click
document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-container') && !e.target.closest('.field-input-wrap')) {
        autocompleteDropdown.classList.add('hidden');
        originAutocomplete.classList.add('hidden');
        destAutocomplete.classList.add('hidden');
    }
});

// ── Search Results ───────────────────────────────────────────
function renderSearchResults(query) {
    const lower = query.toLowerCase();
    const matches = ALL_PLACES.filter(p => p.name.toLowerCase().includes(lower));
    const resultsList = document.getElementById('results-list');
    resultsSearchInput.value = query;

    if (matches.length === 0) {
        resultsList.innerHTML = '<div style="padding:24px 16px;color:#70757a;">No results found</div>';
        return;
    }

    resultsList.innerHTML = matches.map(p => `
        <div class="result-item" data-place-id="${p.id}">
            <div class="result-item-icon">${typeIcon(p.type)}</div>
            <div class="result-item-info">
                <div class="result-item-name">${p.name}</div>
                <div class="result-item-meta">
                    <span class="result-item-rating">${starsHtml(p.rating)}</span>
                    ${p.rating.toFixed(1)} (${p.reviews.toLocaleString()}) · ${p.category}
                </div>
                <div class="result-item-meta">${p.address}</div>
            </div>
        </div>
    `).join('');

    // Click handler for results
    resultsList.querySelectorAll('.result-item').forEach(item => {
        item.addEventListener('click', () => {
            const placeId = item.dataset.placeId;
            pushState('place-detail', placeId);
            highlightPin(placeId);
        });
    });
}

// ── Suggestion Items in default search state ─────────────────
document.querySelectorAll('.suggestion-item').forEach(item => {
    item.addEventListener('click', () => {
        const placeId = item.dataset.placeId;
        if (placeId) {
            pushState('place-detail', placeId);
            highlightPin(placeId);
        }
    });
});

// ── Chip Bar ─────────────────────────────────────────────────
let chipScrollTracked = false;
chipBars.forEach(bar => {
    bar.addEventListener('scroll', () => {
        if (!chipScrollTracked) {
            tracker.track('chip_bar_scroll', { direction: 'right' });
            chipScrollTracked = true;
            setTimeout(() => { chipScrollTracked = false; }, 1000);
        }
    });
});

document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
        const category = chip.dataset.category;

        // Toggle active across all chip bars (they are duplicated across panel states)
        if (activeChip === category) {
            document.querySelectorAll(`.chip[data-category="${category}"]`).forEach(c => c.classList.remove('active'));
            activeChip = null;
        } else {
            document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
            document.querySelectorAll(`.chip[data-category="${category}"]`).forEach(c => c.classList.add('active'));
            activeChip = category;
        }

        tracker.track('nearby_chip_select', { category });
        renderPins();
    });
});

// ── Map Pins ─────────────────────────────────────────────────
function renderPins() {
    mapPinsGroup.innerHTML = '';

    // Determine which places to show pins for
    let visiblePlaces;
    if (activeChip) {
        // Category mapping
        const catMap = {
            restaurants: [],
            gas: [],
            coffee: ['coffee'],
            hotels: [],
            parking: ['parking'],
            groceries: [],
            attractions: ['attraction'],
            pharmacies: []
        };
        const types = catMap[activeChip] || [];
        visiblePlaces = PLACES.filter(p => types.includes(p.type));
        // Always show ad pins regardless of category
        visiblePlaces = visiblePlaces.concat(AD_PLACES);
    } else {
        // Default: all non-parking regular + ads
        visiblePlaces = PLACES.filter(p => p.type !== 'parking').concat(AD_PLACES);
    }

    visiblePlaces.forEach(place => {
        const [cx, cy] = place.coords;
        let pinEl;

        if (place.type === 'ad') {
            // Square pin for ads
            pinEl = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            pinEl.setAttribute('x', cx - 7);
            pinEl.setAttribute('y', cy - 7);
            pinEl.setAttribute('width', 14);
            pinEl.setAttribute('height', 14);
            pinEl.setAttribute('rx', 2);
            pinEl.classList.add('map-pin', 'pin-ad');
        } else {
            // Circle pin
            pinEl = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            pinEl.setAttribute('cx', cx);
            pinEl.setAttribute('cy', cy);
            pinEl.setAttribute('r', 8);
            const pinClass = place.type === 'parking' ? 'pin-parking'
                : place.type === 'coffee' ? 'pin-coffee'
                : place.type === 'shopping' ? 'pin-shopping'
                : 'pin-regular';
            pinEl.classList.add('map-pin', pinClass);
        }

        pinEl.setAttribute('data-pin-id', place.id);
        pinEl.setAttribute('data-place-name', place.name);

        // Click
        pinEl.addEventListener('click', () => {
            tracker.track('pin_click', { pinId: place.id, placeName: place.name });
            pushState('place-detail', place.id);
        });

        // Hover — tooltip
        pinEl.addEventListener('mouseenter', () => {
            tracker.track('pin_hover', { pinId: place.id });
            showTooltip(place.name, cx, cy);
        });
        pinEl.addEventListener('mouseleave', () => {
            hideTooltip();
        });

        mapPinsGroup.appendChild(pinEl);
    });
}

function highlightPin(placeId) {
    // Briefly flash a pin
    const pin = mapPinsGroup.querySelector(`[data-pin-id="${placeId}"]`);
    if (pin) {
        pin.style.transform = 'scale(1.4)';
        setTimeout(() => { pin.style.transform = ''; }, 500);
    }
}

function showTooltip(text, cx, cy) {
    tooltipText.textContent = text;
    // Measure text width approx
    const textLen = text.length * 7 + 16;
    tooltipBg.setAttribute('width', textLen);
    // Position above pin
    const tx = cx - textLen / 2;
    const ty = cy - 38;
    pinTooltipGroup.setAttribute('transform', `translate(${tx}, ${ty})`);
    pinTooltipGroup.style.display = '';
}

function hideTooltip() {
    pinTooltipGroup.style.display = 'none';
}

// ── Panel Collapse / Expand ──────────────────────────────────
panelToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const isCollapsed = panel.classList.contains('collapsed');
    if (isCollapsed) {
        panel.classList.remove('collapsed');
        tracker.track('panel_expand', {});
    } else {
        panel.classList.add('collapsed');
        tracker.track('panel_collapse', {});
    }
    tracker.track('map_viewport_change', {});
});

// Panel-toggle is now a sibling of .panel inside #app, so no DOM reparenting
// is needed. CSS uses #app:has(.panel.collapsed) to slide the button left and
// flip the chevron when the panel is collapsed.

// ── Transport Mode Tabs ──────────────────────────────────────
transportTabs.querySelectorAll('.transport-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        transportTabs.querySelectorAll('.transport-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        activeTransportMode = tab.dataset.mode;
        tracker.track('transport_mode_select', { mode: activeTransportMode });
        tryShowRoutes();
    });
});

// ── Swap Button ──────────────────────────────────────────────
swapBtn.addEventListener('click', () => {
    const tmp = directionsOrigin.value;
    directionsOrigin.value = directionsDestination.value;
    directionsDestination.value = tmp;
    tryShowRoutes();
});

// ── Route Generation ─────────────────────────────────────────
function tryShowRoutes() {
    const origin = directionsOrigin.value.trim();
    const dest = directionsDestination.value.trim();
    if (!origin || !dest) {
        routeResults.classList.add('hidden');
        clearRoutes();
        return;
    }

    // Generate mock routes — scaled by active transport mode
    const routes = generateRoutes(origin, dest, activeTransportMode);
    renderRouteResults(routes);
    drawRoutes(origin, dest);
}

function generateRoutes(origin, dest, mode) {
    // Pseudo-random but deterministic distances based on the O/D strings.
    const seed = (origin + dest).length;
    const dists = [
        0.5 + seed * 0.05,
        0.8 + seed * 0.05,
        1.1 + seed * 0.05,
    ];
    // Rough avg speeds in mph by mode; urban + stop lights baked in.
    const speedMph = ({ drive: 22, transit: 9, walk: 3, bike: 11 })[mode] || 22;
    function durMin(miles) {
        const mins = (miles / speedMph) * 60;
        return Math.max(1, Math.round(mins));
    }
    const labels = ['via Pike St', 'via 1st Ave', 'via Denny Way'];
    return dists.map((d, i) => ({
        time: `${durMin(d)} min`,
        distance: `${d.toFixed(1)} mi`,
        via: labels[i],
    }));
}

function renderRouteResults(routes) {
    routeList.innerHTML = routes.map((r, i) => `
        <div class="route-item${i === 0 ? ' active' : ''}" data-route-index="${i}">
            <div>
                <div class="route-time">${r.time}</div>
                <div class="route-via">${r.via}</div>
            </div>
            <div class="route-distance">${r.distance}</div>
        </div>
    `).join('');

    routeResults.classList.remove('hidden');
    activeRouteIndex = 0;
    tracker.track('route_results_render', {});

    // Route click handlers
    routeList.querySelectorAll('.route-item').forEach(item => {
        item.addEventListener('click', () => {
            routeList.querySelectorAll('.route-item').forEach(r => r.classList.remove('active'));
            item.classList.add('active');
            const idx = parseInt(item.dataset.routeIndex, 10);
            activeRouteIndex = idx;
            tracker.track('route_select', { routeIndex: idx });
            updateRouteHighlight(idx);
        });
    });
}

function drawRoutes(origin, dest) {
    // Find coords for origin and dest
    const oPlace = ALL_PLACES.find(p => p.name.toLowerCase() === origin.toLowerCase());
    const dPlace = ALL_PLACES.find(p => p.name.toLowerCase() === dest.toLowerCase());

    const ox = oPlace ? oPlace.coords[0] : 150;
    const oy = oPlace ? oPlace.coords[1] : 150;
    const dx = dPlace ? dPlace.coords[0] : 200;
    const dy = dPlace ? dPlace.coords[1] : 250;

    // Three route paths (slight variations)
    const midX = (ox + dx) / 2;
    const midY = (oy + dy) / 2;

    const r0 = document.getElementById('route-0');
    const r1 = document.getElementById('route-1');
    const r2 = document.getElementById('route-2');

    r0.setAttribute('d', `M${ox},${oy} Q${midX - 20},${midY - 10} ${dx},${dy}`);
    r1.setAttribute('d', `M${ox},${oy} Q${midX + 30},${midY - 30} ${dx},${dy}`);
    r2.setAttribute('d', `M${ox},${oy} Q${midX - 10},${midY + 40} ${dx},${dy}`);

    // Show first route highlighted
    updateRouteHighlight(0);
}

function updateRouteHighlight(activeIdx) {
    const routes = document.querySelectorAll('.route-path');
    routes.forEach((r, i) => {
        if (i === activeIdx) {
            r.setAttribute('opacity', '0.8');
            r.setAttribute('stroke', '#4285f4');
            r.setAttribute('stroke-width', '5');
        } else {
            r.setAttribute('opacity', '0.4');
            r.setAttribute('stroke', '#9aa0a6');
            r.setAttribute('stroke-width', '4');
        }
    });
}

function clearRoutes() {
    document.querySelectorAll('.route-path').forEach(r => {
        r.setAttribute('opacity', '0');
        r.setAttribute('d', '');
    });
}

// ── Zoom Controls ────────────────────────────────────────────
let zoomLevel = 1;
const mapSvg = document.getElementById('map-svg');

document.getElementById('zoom-in').addEventListener('click', () => {
    zoomLevel = Math.min(zoomLevel + 0.2, 3);
    applyZoom();
});

document.getElementById('zoom-out').addEventListener('click', () => {
    zoomLevel = Math.max(zoomLevel - 0.2, 0.5);
    applyZoom();
});

function applyZoom() {
    const cx = 200, cy = 225;
    const w = 400 / zoomLevel;
    const h = 450 / zoomLevel;
    const x = cx - w / 2;
    const y = cy - h / 2;
    mapSvg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
}

// ── Init ─────────────────────────────────────────────────────
renderPins();
