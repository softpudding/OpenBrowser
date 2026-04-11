/* StayBnB — Airbnb-like mock site JS */
(function () {
  'use strict';

  // ── Tracker ──────────────────────────────────────────────
  const tracker = new AgentTracker('staybnb.com', 'hard');
  window.tracker = tracker;

  // ── State ────────────────────────────────────────────────
  const state = {
    view: 'home',        // home | results | detail
    where: '',
    checkin: null,        // Date
    checkout: null,       // Date
    adults: 1,
    children: 0,
    infants: 0,
    pets: 0,
    activePopover: null,  // 'where' | 'when' | 'who' | null
    calMonth: new Date(2026, 3, 1), // April 2026
    hoverDate: null,
    currentListing: null,
    // filter state
    priceMin: 10,
    priceMax: 500,
    propertyTypes: [],
    amenities: [],
    instantBook: false
  };

  // ── Listings data ────────────────────────────────────────
  const LISTINGS = [
    { id:'shibuya-loft', title:'Shibuya Loft with Skyline View', type:'Entire apartment', area:'Shibuya', priceJPY:18500, priceUSD:125, rating:4.92, color:'#5B8FB9' },
    { id:'shinjuku-studio', title:'Shinjuku Cozy Studio', type:'Entire apartment', area:'Shinjuku', priceJPY:12000, priceUSD:80, rating:4.85, color:'#9B72AA' },
    { id:'asakusa-house', title:'Asakusa Traditional House', type:'Entire home', area:'Asakusa', priceJPY:25000, priceUSD:170, rating:4.95, color:'#D4A574' },
    { id:'roppongi-suite', title:'Roppongi Modern Suite', type:'Entire apartment', area:'Roppongi', priceJPY:22000, priceUSD:150, rating:4.78, color:'#7EC8E3' },
    { id:'ginza-penthouse', title:'Ginza Luxury Penthouse', type:'Entire apartment', area:'Ginza', priceJPY:45000, priceUSD:300, rating:4.97, color:'#C9B1FF' },
    { id:'harajuku-flat', title:'Harajuku Trendy Flat', type:'Private room', area:'Harajuku', priceJPY:15000, priceUSD:100, rating:4.88, color:'#FFB5A7' },
    { id:'akihabara-hub', title:'Akihabara Tech Hub', type:'Private room', area:'Akihabara', priceJPY:9500, priceUSD:65, rating:4.72, color:'#A8D8EA' },
    { id:'nakameguro-river', title:'Nakameguro Riverside', type:'Entire apartment', area:'Nakameguro', priceJPY:20000, priceUSD:135, rating:4.90, color:'#98D8C8' },
    { id:'ueno-park', title:'Ueno Park View', type:'Private room', area:'Ueno', priceJPY:11000, priceUSD:75, rating:4.83, color:'#F7DC6F' },
    { id:'ikebukuro-family', title:'Ikebukuro Family Space', type:'Entire home', area:'Ikebukuro', priceJPY:28000, priceUSD:190, rating:4.91, color:'#82E0AA' },
    { id:'shimokita-artist', title:'Shimokitazawa Artist Loft', type:'Private room', area:'Shimokitazawa', priceJPY:8000, priceUSD:55, rating:4.76, color:'#F1948A' },
    { id:'daikanyama-pent', title:'Daikanyama Designer Penthouse', type:'Entire apartment', area:'Daikanyama', priceJPY:55000, priceUSD:370, rating:4.98, color:'#BB8FCE' },
    { id:'odaiba-bay', title:'Odaiba Bayview Suite', type:'Entire apartment', area:'Odaiba', priceJPY:32000, priceUSD:215, rating:4.89, color:'#85C1E9' },
    { id:'koenji-retro', title:'Koenji Retro Studio', type:'Private room', area:'Koenji', priceJPY:6000, priceUSD:40, rating:4.68, color:'#F0B27A' },
    { id:'meguro-garden', title:'Meguro Garden Flat', type:'Entire apartment', area:'Meguro', priceJPY:19000, priceUSD:128, rating:4.86, color:'#ABEBC6' },
    { id:'ebisu-chic', title:'Ebisu Chic Apartment', type:'Entire apartment', area:'Ebisu', priceJPY:24000, priceUSD:162, rating:4.93, color:'#D7BDE2' },
    { id:'yanaka-heritage', title:'Yanaka Heritage Room', type:'Private room', area:'Yanaka', priceJPY:7500, priceUSD:50, rating:4.79, color:'#E59866' },
    { id:'azabu-luxury', title:'Azabu-Juban Luxury Villa', type:'Entire home', area:'Azabu-Juban', priceJPY:60000, priceUSD:400, rating:4.99, color:'#AED6F1' },
    { id:'nihonbashi-exec', title:'Nihonbashi Executive Suite', type:'Entire apartment', area:'Nihonbashi', priceJPY:35000, priceUSD:235, rating:4.94, color:'#A9CCE3' },
    { id:'kichijoji-cozy', title:'Kichijoji Cozy Hideaway', type:'Shared room', area:'Kichijoji', priceJPY:5000, priceUSD:35, rating:4.65, color:'#F9E79F' },
    { id:'tsukiji-market', title:'Tsukiji Market Flat', type:'Entire apartment', area:'Tsukiji', priceJPY:16000, priceUSD:108, rating:4.81, color:'#FADBD8' },
    { id:'shinagawa-biz', title:'Shinagawa Business Hotel Room', type:'Private room', area:'Shinagawa', priceJPY:10000, priceUSD:68, rating:4.70, color:'#D5F5E3' }
  ];

  // Disabled dates per month (YYYY-MM -> array of day numbers)
  const DISABLED_DATES = {
    '2026-04': [5, 11, 18, 23, 29],
    '2026-05': [2, 9, 14, 21, 27],
    '2026-06': [3, 8, 12, 22, 28],
    '2026-07': [4, 10, 16, 24, 30],
    '2026-08': [1, 7, 15, 20, 26],
    '2026-09': [3, 11, 17, 22, 28],
    '2026-10': [2, 8, 14, 21, 27],
    '2026-11': [5, 11, 16, 23, 29],
    '2026-12': [3, 9, 15, 22, 28]
  };

  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DOW = ['Su','Mo','Tu','We','Th','Fr','Sa'];

  const AUTOCOMPLETE = [
    { name: 'Tokyo, Japan', icon: '🗼' },
    { name: 'Paris, France', icon: '🗼' },
    { name: 'New York, United States', icon: '🗽' },
    { name: 'London, United Kingdom', icon: '🇬🇧' },
    { name: 'Bali, Indonesia', icon: '🏝' },
    { name: 'Barcelona, Spain', icon: '🇪🇸' }
  ];

  const REGIONS = ['Asia','Europe','North America','South America','Africa','Oceania'];

  const AMENITIES_LIST = ['Wifi','Kitchen','Washer','Air conditioning','Heating','TV','Iron','Hair dryer','Workspace','Pool','Hot tub','Free parking'];

  // ── Helpers ──────────────────────────────────────────────
  const $ = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);

  function fmtDate(d) {
    if (!d) return '—';
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  }
  function fmtDateShort(d) {
    if (!d) return 'Add dates';
    return `${MONTH_NAMES[d.getMonth()].slice(0,3)} ${d.getDate()}`;
  }
  function sameDay(a,b) { return a && b && a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
  function dateKey(y,m) { return `${y}-${String(m+1).padStart(2,'0')}`; }

  const pastelColors = ['#FFD1DC','#FFE4B5','#D4F1F4','#E8D5B7','#D5E8D4','#E6E6FA','#FFDAB9','#C1E1C1'];
  function randomColor(i) { return pastelColors[i % pastelColors.length]; }

  // ── Render helpers ───────────────────────────────────────

  // View switching
  function showView(name) {
    state.view = name;
    ['home','results','detail'].forEach(v => {
      const el = $(`#view-${v}`);
      if (el) el.classList.toggle('active', v === name);
    });
    // Show/hide filter bar
    const fb = $('#filter-bar');
    if (fb) fb.style.display = name === 'results' ? 'flex' : 'none';
    // Close popovers
    closePopovers();
  }

  // ── Popovers ─────────────────────────────────────────────
  function openPopover(which) {
    closePopovers();
    state.activePopover = which;
    const pop = $(`.popover-${which}`);
    if (pop) pop.classList.add('open');
    $$('.search-pill-seg').forEach(s => s.classList.toggle('active', s.dataset.seg === which));
    $('#popover-backdrop').classList.add('open');
    tracker.track('search_section_click', { section: which });
  }
  function closePopovers() {
    state.activePopover = null;
    $$('.popover').forEach(p => p.classList.remove('open'));
    $$('.search-pill-seg').forEach(s => s.classList.remove('active'));
    const bd = $('#popover-backdrop');
    if (bd) bd.classList.remove('open');
  }

  // ── Search pill text ─────────────────────────────────────
  function updatePillText() {
    const wv = $('#seg-where-val');
    const wnv = $('#seg-when-val');
    const whv = $('#seg-who-val');
    if (wv) wv.textContent = state.where || 'Search';
    if (wnv) wnv.textContent = (state.checkin && state.checkout)
      ? `${fmtDateShort(state.checkin)} – ${fmtDateShort(state.checkout)}`
      : 'Add dates';
    if (whv) {
      const total = state.adults + state.children;
      let txt = `${total} guest${total !== 1 ? 's' : ''}`;
      if (state.infants) txt += `, ${state.infants} infant${state.infants !== 1 ? 's' : ''}`;
      whv.textContent = txt;
    }
  }

  // ── WHERE popover ────────────────────────────────────────
  function initWhere() {
    const input = $('#where-input');
    const list = $('#autocomplete-list');
    if (!input || !list) return;

    function renderAC(filter) {
      const items = filter
        ? AUTOCOMPLETE.filter(a => a.name.toLowerCase().includes(filter.toLowerCase()))
        : AUTOCOMPLETE;
      list.innerHTML = items.map(a => `
        <div class="autocomplete-item" data-value="${a.name}">
          <div class="ac-icon">${a.icon}</div>
          <span>${a.name}</span>
        </div>`).join('');
    }
    renderAC('');
    input.addEventListener('input', () => renderAC(input.value));
    list.addEventListener('click', e => {
      const item = e.target.closest('.autocomplete-item');
      if (!item) return;
      state.where = item.dataset.value;
      input.value = item.dataset.value;
      tracker.track('autocomplete_select', { value: item.dataset.value });
      updatePillText();
    });
  }

  // ── WHEN / Calendar ──────────────────────────────────────
  function renderCalendar() {
    const wrap = $('#calendar-wrap');
    if (!wrap) return;

    const m1 = new Date(state.calMonth);
    const m2 = new Date(m1.getFullYear(), m1.getMonth() + 1, 1);

    wrap.innerHTML = `
      <div class="cal-month" data-idx="0">
        <div class="cal-header">
          <button class="cal-nav prev" id="cal-prev">&lsaquo;</button>
          <span class="cal-title">${MONTH_NAMES[m1.getMonth()]} ${m1.getFullYear()}</span>
        </div>
        ${buildMonthGrid(m1)}
      </div>
      <div class="cal-month" data-idx="1">
        <div class="cal-header">
          <span class="cal-title">${MONTH_NAMES[m2.getMonth()]} ${m2.getFullYear()}</span>
          <button class="cal-nav next" id="cal-next">&rsaquo;</button>
        </div>
        ${buildMonthGrid(m2)}
      </div>`;

    // nav
    $('#cal-prev').addEventListener('click', () => {
      state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() - 1, 1);
      const nm = new Date(state.calMonth);
      const nm2 = new Date(nm.getFullYear(), nm.getMonth() + 1, 1);
      tracker.track('calendar_month_nav', { direction: 'back', count: 1, targetMonths: `${MONTH_NAMES[nm.getMonth()]} ${nm.getFullYear()} / ${MONTH_NAMES[nm2.getMonth()]} ${nm2.getFullYear()}` });
      renderCalendar();
    });
    $('#cal-next').addEventListener('click', () => {
      state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() + 1, 1);
      const nm = new Date(state.calMonth);
      const nm2 = new Date(nm.getFullYear(), nm.getMonth() + 1, 1);
      tracker.track('calendar_month_nav', { direction: 'forward', count: 1, targetMonths: `${MONTH_NAMES[nm.getMonth()]} ${nm.getFullYear()} / ${MONTH_NAMES[nm2.getMonth()]} ${nm2.getFullYear()}` });
      renderCalendar();
    });

    // day clicks & hover
    wrap.querySelectorAll('.cal-day[data-date]').forEach(el => {
      if (el.classList.contains('disabled') || el.classList.contains('empty')) return;
      el.addEventListener('click', () => {
        const d = new Date(el.dataset.date + 'T00:00:00');
        if (!state.checkin || (state.checkin && state.checkout)) {
          state.checkin = d;
          state.checkout = null;
          tracker.track('date_select', { role: 'checkin', date: fmtDate(d) });
        } else {
          if (d <= state.checkin) {
            state.checkin = d;
            state.checkout = null;
            tracker.track('date_select', { role: 'checkin', date: fmtDate(d) });
          } else {
            state.checkout = d;
            tracker.track('date_select', { role: 'checkout', date: fmtDate(d) });
          }
        }
        state.hoverDate = null;
        updatePillText();
        renderCalendar();
      });
      el.addEventListener('mouseenter', () => {
        if (state.checkin && !state.checkout) {
          state.hoverDate = new Date(el.dataset.date + 'T00:00:00');
          applyHoverRange();
        }
      });
    });
    wrap.addEventListener('mouseleave', () => {
      state.hoverDate = null;
      clearHoverRange();
    });
  }

  function buildMonthGrid(d) {
    const y = d.getFullYear();
    const m = d.getMonth();
    const firstDow = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const dk = dateKey(y, m);
    const disabled = DISABLED_DATES[dk] || [];

    let html = '<div class="cal-grid">';
    DOW.forEach(w => { html += `<div class="cal-dow">${w}</div>`; });
    for (let i = 0; i < firstDow; i++) html += '<div class="cal-day empty"></div>';
    for (let day = 1; day <= daysInMonth; day++) {
      const iso = `${y}-${String(m+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      const dt = new Date(y, m, day);
      const dis = disabled.includes(day);
      let cls = 'cal-day';
      if (dis) cls += ' disabled';
      else {
        if (state.checkin && state.checkout) {
          if (sameDay(dt, state.checkin)) cls += ' range-start';
          else if (sameDay(dt, state.checkout)) cls += ' range-end';
          else if (dt > state.checkin && dt < state.checkout) cls += ' in-range';
        } else if (state.checkin && sameDay(dt, state.checkin)) {
          cls += ' selected';
        }
      }
      html += `<div class="${cls}" data-date="${iso}">${day}</div>`;
    }
    html += '</div>';
    return html;
  }

  function applyHoverRange() {
    if (!state.checkin || !state.hoverDate) return;
    const start = state.checkin;
    const end = state.hoverDate;
    if (end <= start) return;
    document.querySelectorAll('.cal-day[data-date]').forEach(el => {
      if (el.classList.contains('disabled')) return;
      const d = new Date(el.dataset.date + 'T00:00:00');
      el.classList.remove('range-hover', 'range-hover-end');
      if (d > start && d < end) el.classList.add('range-hover');
      if (sameDay(d, end)) el.classList.add('range-hover-end');
    });
  }
  function clearHoverRange() {
    document.querySelectorAll('.cal-day').forEach(el => {
      el.classList.remove('range-hover', 'range-hover-end');
    });
  }

  // ── WHO / Guest stepper ──────────────────────────────────
  function initWho() {
    const wrap = $('#who-popover');
    if (!wrap) return;
    renderGuestRows();
  }
  function renderGuestRows() {
    const wrap = $('#guest-rows');
    if (!wrap) return;
    const rows = [
      { key: 'adults', label: 'Adults', desc: 'Age 13+', min: 1 },
      { key: 'children', label: 'Children', desc: 'Ages 2–12', min: 0 },
      { key: 'infants', label: 'Infants', desc: 'Under 2', min: 0 },
      { key: 'pets', label: 'Pets', desc: '', min: 0 }
    ];
    wrap.innerHTML = rows.map(r => {
      const val = state[r.key];
      return `<div class="guest-row">
        <div class="guest-info">
          <div class="guest-type">${r.label}</div>
          ${r.desc ? `<div class="guest-desc">${r.desc}</div>` : ''}
        </div>
        <div class="stepper">
          <button class="stepper-btn" data-guest="${r.key}" data-action="decrement" ${val <= r.min ? 'disabled' : ''}>−</button>
          <span class="stepper-count" id="count-${r.key}">${val}</span>
          <button class="stepper-btn" data-guest="${r.key}" data-action="increment">+</button>
        </div>
      </div>`;
    }).join('');

    wrap.querySelectorAll('.stepper-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.guest;
        const action = btn.dataset.action;
        const min = key === 'adults' ? 1 : 0;
        if (action === 'increment') state[key]++;
        else if (action === 'decrement' && state[key] > min) state[key]--;
        tracker.track('guest_stepper_click', { guestType: key, action, finalCount: state[key] });
        renderGuestRows();
        updatePillText();
      });
    });
  }

  // ── Search submit ────────────────────────────────────────
  function doSearch() {
    tracker.track('search_submit', {
      where: state.where,
      checkin: fmtDate(state.checkin),
      checkout: fmtDate(state.checkout),
      adults: state.adults,
      children: state.children,
      infants: state.infants
    });
    closePopovers();
    renderResults();
    showView('results');
  }

  // ── Results view ─────────────────────────────────────────
  function renderResults() {
    const grid = $('#listings-grid');
    const mapSvg = $('#map-svg');
    if (!grid) return;

    // Filter listings by price
    let filtered = LISTINGS.filter(l => l.priceUSD >= state.priceMin && l.priceUSD <= state.priceMax);
    // Filter by property type
    if (state.propertyTypes.length) {
      filtered = filtered.filter(l => {
        return state.propertyTypes.some(t => {
          if (t === 'Entire place') return l.type.startsWith('Entire');
          return l.type === t;
        });
      });
    }
    // Filter by amenities — for demo we skip actual amenity data; always pass
    // Filter by instant book — skip for demo

    const count = filtered.length;
    const header = $('#listings-header');
    if (header) header.textContent = `${count} stays${state.where ? ' in ' + state.where : ''}`;

    grid.innerHTML = filtered.map((l, i) => {
      const imgs = [0,1,2,3].map(k => `https://picsum.photos/seed/staybnb-${l.id}-${k}/640/480`);
      return `<div class="listing-card" data-id="${l.id}">
        <div class="listing-card-img-wrap">
          <div class="listing-card-img" style="background-image:url('${imgs[0]}')" data-imgs='${JSON.stringify(imgs)}' data-ci="0"></div>
          <div class="listing-card-fav" data-liked="false">&#9825;</div>
          <div class="carousel-dots">${imgs.map((_,j) => `<div class="carousel-dot${j===0?' active':''}" data-dot="${j}"></div>`).join('')}</div>
          <div class="carousel-arrow left" data-dir="prev">&#8249;</div>
          <div class="carousel-arrow right" data-dir="next">&#8250;</div>
        </div>
        <div class="listing-card-info">
          <div class="listing-card-top">
            <div class="listing-card-title">${l.title}</div>
            <div class="listing-card-rating">&#9733; ${l.rating}</div>
          </div>
          <div class="listing-card-type">${l.type} · ${l.area}</div>
          <div class="listing-card-price"><span>¥${l.priceJPY.toLocaleString()}</span> / night <span style="color:var(--gray-500);font-weight:400;font-size:12px">(≈$${l.priceUSD})</span></div>
        </div>
      </div>`;
    }).join('');

    // Card interactions
    grid.querySelectorAll('.listing-card').forEach(card => {
      const id = card.dataset.id;
      // click -> detail
      card.addEventListener('click', e => {
        if (e.target.closest('.carousel-arrow') || e.target.closest('.listing-card-fav')) return;
        openDetail(id);
      });
      // hover -> highlight map
      card.addEventListener('mouseenter', () => {
        const pin = document.querySelector(`.map-pin[data-id="${id}"]`);
        if (pin) pin.classList.add('highlight');
      });
      card.addEventListener('mouseleave', () => {
        const pin = document.querySelector(`.map-pin[data-id="${id}"]`);
        if (pin) pin.classList.remove('highlight');
      });
    });

    // Carousel arrows
    grid.querySelectorAll('.carousel-arrow').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const wrap = btn.closest('.listing-card-img-wrap');
        const img = wrap.querySelector('.listing-card-img');
        const imgs = JSON.parse(img.dataset.imgs);
        let ci = parseInt(img.dataset.ci);
        if (btn.dataset.dir === 'next') ci = (ci + 1) % imgs.length;
        else ci = (ci - 1 + imgs.length) % imgs.length;
        img.style.backgroundImage = `url('${imgs[ci]}')`;
        img.dataset.ci = ci;
        wrap.querySelectorAll('.carousel-dot').forEach((d,j) => d.classList.toggle('active', j === ci));
      });
    });

    // Favorite hearts
    grid.querySelectorAll('.listing-card-fav').forEach(fav => {
      fav.addEventListener('click', e => {
        e.stopPropagation();
        const liked = fav.dataset.liked === 'true';
        fav.dataset.liked = String(!liked);
        fav.classList.toggle('liked', !liked);
        fav.innerHTML = liked ? '&#9825;' : '&#9829;';
      });
    });

    // Map
    renderMap(filtered);
  }

  function renderMap(listings) {
    const svg = $('#map-svg');
    if (!svg) return;
    // Simple scatter map
    const w = 500, h = 600;
    // deterministic positions based on index
    const positions = listings.map((l, i) => {
      const angle = (i / listings.length) * Math.PI * 2;
      const r = 120 + (i % 3) * 50;
      const x = w/2 + Math.cos(angle) * r + (i * 7 % 40);
      const y = h/2 + Math.sin(angle) * r + (i * 13 % 30);
      return { x: Math.max(40, Math.min(w-40, x)), y: Math.max(30, Math.min(h-30, y)) };
    });

    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.innerHTML = `<rect width="${w}" height="${h}" fill="#f0f0f0"/>` +
      listings.map((l, i) => {
        const p = positions[i];
        const label = `$${l.priceUSD}`;
        const tw = label.length * 7 + 12;
        return `<g class="map-pin" data-id="${l.id}" transform="translate(${p.x},${p.y})">
          <rect x="${-tw/2}" y="-12" width="${tw}" height="24" rx="12"/>
          <text text-anchor="middle" dy="4">${label}</text>
        </g>`;
      }).join('');

    // Pin hover -> highlight card
    svg.querySelectorAll('.map-pin').forEach(pin => {
      pin.addEventListener('mouseenter', () => {
        const card = document.querySelector(`.listing-card[data-id="${pin.dataset.id}"]`);
        if (card) card.style.boxShadow = '0 4px 16px rgba(255,56,92,.3)';
      });
      pin.addEventListener('mouseleave', () => {
        const card = document.querySelector(`.listing-card[data-id="${pin.dataset.id}"]`);
        if (card) card.style.boxShadow = '';
      });
    });
  }

  // ── Filter modal ─────────────────────────────────────────
  function openFilterModal() {
    tracker.track('filter_modal_open', {});
    $('#filter-modal').classList.add('open');
    renderFilterModal();
  }
  function closeFilterModal() {
    tracker.track('filter_modal_close', {});
    $('#filter-modal').classList.remove('open');
  }
  function renderFilterModal() {
    // Price slider values are maintained via state
    updateSliderUI();
    // Property type chips
    $$('.type-chip').forEach(c => {
      c.classList.toggle('active', state.propertyTypes.includes(c.dataset.type));
    });
    // Amenity checkboxes
    $$('.amenity-check input').forEach(cb => {
      cb.checked = state.amenities.includes(cb.dataset.amenity);
    });
    // Instant book
    const ib = $('#instant-book-toggle');
    if (ib) ib.checked = state.instantBook;
    // Count
    updateFilterCount();
  }

  function updateFilterCount() {
    let filtered = LISTINGS.filter(l => l.priceUSD >= state.priceMin && l.priceUSD <= state.priceMax);
    if (state.propertyTypes.length) {
      filtered = filtered.filter(l => state.propertyTypes.some(t => {
        if (t === 'Entire place') return l.type.startsWith('Entire');
        return l.type === t;
      }));
    }
    const btn = $('#filter-apply-btn');
    if (btn) btn.textContent = `Show ${filtered.length} stays`;
  }

  // ── Price slider (dual handle) ───────────────────────────
  function initPriceSlider() {
    const track = $('#price-track');
    const fill = $('#price-fill');
    const minHandle = $('#price-handle-min');
    const maxHandle = $('#price-handle-max');
    const minLabel = $('#price-label-min');
    const maxLabel = $('#price-label-max');
    if (!track) return;

    const PRICE_MIN = 10, PRICE_MAX = 500;

    function getTrackRect() { return track.getBoundingClientRect(); }

    function valToPercent(v) { return (v - PRICE_MIN) / (PRICE_MAX - PRICE_MIN) * 100; }
    function percentToVal(p) { return Math.round(PRICE_MIN + (p / 100) * (PRICE_MAX - PRICE_MIN)); }

    function updateSlider() {
      const pMin = valToPercent(state.priceMin);
      const pMax = valToPercent(state.priceMax);
      minHandle.style.left = pMin + '%';
      maxHandle.style.left = pMax + '%';
      fill.style.left = pMin + '%';
      fill.style.width = (pMax - pMin) + '%';
      if (minLabel) minLabel.textContent = '$' + state.priceMin;
      if (maxLabel) maxLabel.textContent = '$' + state.priceMax;
      const dl = $('#price-display-min');
      const dr = $('#price-display-max');
      if (dl) dl.textContent = '$' + state.priceMin;
      if (dr) dr.textContent = '$' + state.priceMax;
    }

    window._updateSliderUI = updateSlider;

    function startDrag(handle, which) {
      handle.addEventListener('mousedown', e => {
        e.preventDefault();
        handle.classList.add('dragging');
        const onMove = ev => {
          const rect = getTrackRect();
          let pct = ((ev.clientX - rect.left) / rect.width) * 100;
          pct = Math.max(0, Math.min(100, pct));
          let val = percentToVal(pct);
          if (which === 'min') {
            val = Math.min(val, state.priceMax - 5);
            state.priceMin = Math.max(PRICE_MIN, val);
          } else {
            val = Math.max(val, state.priceMin + 5);
            state.priceMax = Math.min(PRICE_MAX, val);
          }
          tracker.track('price_slider_change', { handle: which, value: state[which === 'min' ? 'priceMin' : 'priceMax'] });
          updateSlider();
          updateFilterCount();
        };
        const onUp = () => {
          handle.classList.remove('dragging');
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    }
    startDrag(minHandle, 'min');
    startDrag(maxHandle, 'max');
    updateSlider();
  }

  function updateSliderUI() {
    if (window._updateSliderUI) window._updateSliderUI();
  }

  // ── Detail view ──────────────────────────────────────────
  function openDetail(id) {
    const listing = LISTINGS.find(l => l.id === id);
    if (!listing) return;
    state.currentListing = listing;
    tracker.track('listing_open', { listingId: id });

    const view = $('#view-detail');
    // Photo grid — real images via Lorem Picsum (seeded for stability)
    const detailImgs = [0,1,2,3,4].map(k => `https://picsum.photos/seed/staybnb-${id}-d${k}/1200/800`);
    const allGalleryImgs = [...detailImgs, ...[5,6,7].map(k => `https://picsum.photos/seed/staybnb-${id}-d${k}/1200/800`)];

    view.querySelector('.photo-main').style.backgroundImage = `url('${detailImgs[0]}')`;
    view.querySelectorAll('.photo-small').forEach((el, i) => {
      el.style.backgroundImage = `url('${detailImgs[i + 1] || detailImgs[0]}')`;
    });

    // Title etc
    view.querySelector('.detail-title').textContent = listing.title;
    view.querySelector('.detail-subtitle').textContent = `${listing.type} · ${listing.area}, Tokyo`;
    view.querySelector('.detail-host-name').textContent = 'Hosted by Yuki';
    view.querySelector('.detail-host-tenure').textContent = 'Superhost · 4 years hosting';

    // Booking card
    view.querySelector('.booking-price-val').textContent = `¥${listing.priceJPY.toLocaleString()}`;
    view.querySelector('#booking-checkin').textContent = state.checkin ? fmtDate(state.checkin) : 'Add date';
    view.querySelector('#booking-checkout').textContent = state.checkout ? fmtDate(state.checkout) : 'Add date';
    const totalGuests = state.adults + state.children;
    view.querySelector('#booking-guests-val').textContent = `${totalGuests} guest${totalGuests !== 1 ? 's' : ''}`;

    // Price breakdown
    const nights = (state.checkin && state.checkout)
      ? Math.max(1, Math.round((state.checkout - state.checkin) / 86400000))
      : 1;
    const subtotal = listing.priceJPY * nights;
    const cleaning = 5000;
    const service = Math.round(subtotal * 0.12);
    const total = subtotal + cleaning + service;
    view.querySelector('#pb-nights').textContent = `¥${listing.priceJPY.toLocaleString()} × ${nights} night${nights !== 1 ? 's' : ''}`;
    view.querySelector('#pb-subtotal').textContent = `¥${subtotal.toLocaleString()}`;
    view.querySelector('#pb-cleaning').textContent = `¥${cleaning.toLocaleString()}`;
    view.querySelector('#pb-service').textContent = `¥${service.toLocaleString()}`;
    view.querySelector('#pb-total').textContent = `¥${total.toLocaleString()}`;

    // Gallery data
    view.dataset.galleryImgs = JSON.stringify(allGalleryImgs);

    // Reset confirm panel
    const cp = view.querySelector('.confirm-panel');
    if (cp) { cp.classList.remove('open'); cp.querySelector('.confirm-success').classList.remove('show'); }

    showView('detail');
  }

  // ── Gallery ──────────────────────────────────────────────
  function openGallery() {
    const view = $('#view-detail');
    const imgs = JSON.parse(view.dataset.galleryImgs || '[]');
    const overlay = $('#gallery-overlay');
    const grid = overlay.querySelector('.gallery-grid');
    grid.innerHTML = imgs.map((u, i) => `<div class="gallery-img" data-idx="${i}" style="background-image:url('${u}')"></div>`).join('');
    overlay.classList.add('open');
    tracker.track('gallery_open', { listingId: state.currentListing?.id });

    // Intersection observer for scroll tracking
    let viewed = new Set();
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) viewed.add(e.target.dataset.idx);
      });
      tracker.track('gallery_scroll', { photos_viewed: viewed.size });
    }, { root: overlay, threshold: 0.5 });
    grid.querySelectorAll('.gallery-img').forEach(img => io.observe(img));

    overlay.dataset.io = 'active'; // just a flag
  }
  function closeGallery() {
    $('#gallery-overlay').classList.remove('open');
    tracker.track('gallery_close', {});
  }

  // ── Reserve & Confirm ────────────────────────────────────
  function doReserve() {
    if (!state.currentListing) return;
    tracker.track('reserve_click', { listingId: state.currentListing.id });
    const cp = $('#view-detail').querySelector('.confirm-panel');
    if (cp) cp.classList.add('open');
  }
  function doConfirm() {
    if (!state.currentListing) return;
    tracker.track('booking_confirm', { listingId: state.currentListing.id });
    const cp = $('#view-detail').querySelector('.confirm-panel');
    if (cp) cp.querySelector('.confirm-success').classList.add('show');
  }

  // ── Init ─────────────────────────────────────────────────
  function init() {
    // Pill segments
    $$('.search-pill-seg').forEach(seg => {
      seg.addEventListener('click', () => {
        const which = seg.dataset.seg;
        if (state.activePopover === which) closePopovers();
        else openPopover(which);
      });
    });

    // Backdrop
    const bd = $('#popover-backdrop');
    if (bd) bd.addEventListener('click', closePopovers);

    // Search button
    const searchBtn = $('#search-btn');
    if (searchBtn) searchBtn.addEventListener('click', doSearch);

    // When subtabs (only Dates works)
    $$('.when-subtab').forEach(tab => {
      tab.addEventListener('click', () => {
        $$('.when-subtab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
      });
    });

    // Init popovers
    initWhere();
    initWho();
    renderCalendar();
    updatePillText();

    // Filter bar pills
    const filterBtn = $('#filter-btn');
    if (filterBtn) filterBtn.addEventListener('click', openFilterModal);

    // Filter modal close
    const fmClose = $('#filter-modal-close');
    if (fmClose) fmClose.addEventListener('click', closeFilterModal);

    // Filter modal overlay click
    const fmOverlay = $('#filter-modal');
    if (fmOverlay) fmOverlay.addEventListener('click', e => { if (e.target === fmOverlay) closeFilterModal(); });

    // Property type chips
    $$('.type-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const t = chip.dataset.type;
        if (state.propertyTypes.includes(t)) state.propertyTypes = state.propertyTypes.filter(x => x !== t);
        else state.propertyTypes.push(t);
        chip.classList.toggle('active');
        updateFilterCount();
      });
    });

    // Amenity checkboxes
    $$('.amenity-check input').forEach(cb => {
      cb.addEventListener('change', () => {
        const a = cb.dataset.amenity;
        if (cb.checked) { if (!state.amenities.includes(a)) state.amenities.push(a); }
        else { state.amenities = state.amenities.filter(x => x !== a); }
        tracker.track('amenity_toggle', { amenity: a.toLowerCase(), checked: cb.checked });
        updateFilterCount();
      });
    });

    // Instant book
    const ibToggle = $('#instant-book-toggle');
    if (ibToggle) ibToggle.addEventListener('change', () => {
      state.instantBook = ibToggle.checked;
      tracker.track('instant_book_toggle', { checked: ibToggle.checked });
      updateFilterCount();
    });

    // Filter apply
    const applyBtn = $('#filter-apply-btn');
    if (applyBtn) applyBtn.addEventListener('click', () => {
      tracker.track('filter_apply', {
        priceMin: state.priceMin,
        priceMax: state.priceMax,
        amenities: state.amenities,
        instantBook: state.instantBook
      });
      closeFilterModal();
      renderResults();
    });

    // Init price slider
    initPriceSlider();

    // Detail view events
    const showAllBtn = $('#show-all-photos');
    if (showAllBtn) showAllBtn.addEventListener('click', openGallery);

    const galleryCloseBtn = $('#gallery-close-btn');
    if (galleryCloseBtn) galleryCloseBtn.addEventListener('click', closeGallery);

    const reserveBtn = $('#reserve-btn');
    if (reserveBtn) reserveBtn.addEventListener('click', doReserve);

    const confirmBtn = $('#confirm-btn');
    if (confirmBtn) confirmBtn.addEventListener('click', doConfirm);

    // Detail back button
    const backBtn = $('#detail-back');
    if (backBtn) backBtn.addEventListener('click', () => showView('results'));

    // Photo grid click -> gallery
    $$('.photo-main, .photo-small').forEach(el => {
      el.addEventListener('click', openGallery);
    });

    // Category tabs
    $$('.cat-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        $$('.cat-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
      });
    });

    // Logo -> home
    const logo = $('#logo');
    if (logo) logo.addEventListener('click', () => showView('home'));

    // Start view — respect URL hash (#results / #detail) for deep-linking
    if (location.hash === '#results') {
      renderResults();
      showView('results');
    } else {
      showView('home');
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
