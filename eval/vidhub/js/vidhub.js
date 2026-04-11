/* =====================================================
   VidHub — YouTube-like Mock Site (single-page, two views)
   ===================================================== */

// ---------- Tracker ----------
window.tracker = new AgentTracker('vidhub.com', 'hard');

// ---------- Color palette for thumbnails ----------
const PALETTE = [
    '#6c5ce7','#00b894','#e17055','#0984e3','#fdcb6e',
    '#e84393','#00cec9','#d63031','#a29bfe','#55efc4',
    '#fab1a0','#74b9ff','#636e72','#2d3436','#b2bec3',
];
function thumbColor(idx) { return PALETTE[idx % PALETTE.length]; }
function avatarColor(name) {
    let h = 0; for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
    return PALETTE[Math.abs(h) % PALETTE.length];
}
// Lorem Picsum (CC0 Unsplash imagery) — deterministic seed per video so the
// thumbnail is stable across renders. Size 480x270 matches a 16:9 preview.
function thumbImage(v)  { return `https://picsum.photos/seed/vidhub-${v.id}/480/270`; }
function playerImage(v) { return `https://picsum.photos/seed/vidhub-${v.id}/1280/720`; }

// ---------- VIDEO DATA ----------
const VIDEOS = [
    { id:'ml-tutorial', title:'Machine Learning Tutorial for Beginners', channel:'TechAcademy', channelId:'tech-academy', subs:'1.2M', views:'1.2M views', ago:'3 months ago', duration:'45:22', durationSec:2722,
      desc:'A comprehensive introduction to machine learning covering supervised learning, unsupervised learning, neural networks, and more.\n\nTopics covered:\n- What is Machine Learning?\n- Types of ML algorithms\n- Hands-on with Python & scikit-learn\n- Building your first model\n- Evaluation metrics\n- Real-world applications\n\nResources: https://techacademy.example.com/ml', likes:42000 },
    { id:'transformers-visual-guide', title:'Understanding Transformers — Visual Guide', channel:'AI Explained', channelId:'ai-explained', subs:'890K', views:'890K views', ago:'1 month ago', duration:'28:15', durationSec:1695,
      desc:'A visual deep-dive into the Transformer architecture that powers GPT, BERT, and modern LLMs.\n\nWe cover:\n- Self-attention mechanism\n- Multi-head attention\n- Positional encoding\n- Encoder-Decoder structure\n- Key/Query/Value intuitions\n\nPaper: "Attention Is All You Need" (Vaswani et al., 2017)', likes:31000 },
    { id:'rest-api-node', title:'Building a REST API with Node.js', channel:'CodeWithSam', channelId:'code-with-sam', subs:'456K', views:'456K views', ago:'2 weeks ago', duration:'32:10', durationSec:1930,
      desc:'Learn to build a production-ready REST API from scratch using Node.js, Express, and MongoDB.', likes:18000 },
    { id:'css-grid-guide', title:'CSS Grid Complete Guide', channel:'DesignCraft', channelId:'design-craft', subs:'350K', views:'678K views', ago:'1 month ago', duration:'24:08', durationSec:1448,
      desc:'Master CSS Grid layout with practical examples and responsive design patterns.', likes:22000 },
    { id:'python-data', title:'Python Data Analysis', channel:'DataPro', channelId:'data-pro', subs:'275K', views:'234K views', ago:'5 days ago', duration:'38:45', durationSec:2325,
      desc:'Pandas, NumPy, and Matplotlib — everything you need for data analysis in Python.', likes:9800 },
    { id:'react-hooks', title:'React Hooks Deep Dive', channel:'ReactMasters', channelId:'react-masters', subs:'520K', views:'567K views', ago:'3 weeks ago', duration:'41:30', durationSec:2490,
      desc:'Understand useState, useEffect, useContext, useMemo, useCallback and custom hooks.', likes:24000 },
    { id:'docker-beginners', title:'Docker for Beginners', channel:'DevOps Daily', channelId:'devops-daily', subs:'310K', views:'345K views', ago:'2 months ago', duration:'29:55', durationSec:1795,
      desc:'Containers, images, Dockerfiles, and Docker Compose explained from zero.', likes:14000 },
    { id:'js-es2024', title:'JavaScript ES2024 Features', channel:'JSConf', channelId:'jsconf', subs:'198K', views:'189K views', ago:'1 week ago', duration:'18:22', durationSec:1102,
      desc:'All the new features landing in ES2024 — Array grouping, Promise.withResolvers, and more.', likes:7600 },
    { id:'system-design', title:'System Design Interview Prep', channel:'TechAcademy', channelId:'tech-academy', subs:'1.2M', views:'789K views', ago:'4 weeks ago', duration:'52:18', durationSec:3138,
      desc:'How to approach system design interviews: scaling, caching, load balancing, and real examples.', likes:35000 },
    { id:'rust-crash', title:'Rust Programming Crash Course', channel:'LowLevel', channelId:'low-level', subs:'145K', views:'123K views', ago:'6 days ago', duration:'55:03', durationSec:3303,
      desc:'Ownership, borrowing, lifetimes, and why Rust is taking over systems programming.', likes:5400 },
    { id:'web-security', title:'Web Security Best Practices', channel:'SecureCode', channelId:'secure-code', subs:'220K', views:'234K views', ago:'2 weeks ago', duration:'26:40', durationSec:1600,
      desc:'XSS, CSRF, SQL injection, CSP headers, and how to protect your web apps.', likes:11000 },
    { id:'graphql-vs-rest', title:'GraphQL vs REST Explained', channel:'API Guru', channelId:'api-guru', subs:'180K', views:'456K views', ago:'3 weeks ago', duration:'22:15', durationSec:1335,
      desc:'When to use GraphQL vs REST, pros/cons, and a live migration example.', likes:19000 },
];

// ---------- COMMENTS DATA ----------
function getComments(videoId) {
    const base = [
        { author:'Alex Rivera', time:'1 week ago', text:'Great content as always! Subscribed.', likes:45 },
        { author:'Maria K.', time:'3 days ago', text:'Can you do a follow-up on this topic? Would love to see more advanced examples.', likes:23 },
        { author:'JohnDev42', time:'5 days ago', text:'I was stuck on this for hours. This video fixed it in 10 minutes.', likes:67 },
        { author:'Priya S.', time:'2 weeks ago', text:'The production quality of these videos keeps getting better.', likes:12 },
        { author:'TechNerd88', time:'4 days ago', text:'Timestamp 14:22 has a small error — the parameter should be reversed.', likes:89 },
        { author:'CodeNewbie', time:'1 day ago', text:'Finally someone explains this in plain English. Thank you!', likes:34 },
        { author:'DevManager', time:'6 days ago', text:'Sharing this with my entire team. Mandatory viewing.', likes:56 },
        { author:'Lisa Chen', time:'2 days ago', text:'The pacing is perfect — not too fast, not too slow.', likes:18 },
    ];

    if (videoId === 'transformers-visual-guide') {
        // Required test comment at top
        base.unshift({
            author: 'Dr. Sarah Chen',
            time: '2 days ago',
            text: 'This is the best explanation of multi-head attention I\'ve seen. The visual diagrams really help clarify the concept.',
            likes: 245,
            replies: [
                { author:'AI Explained', time:'2 days ago', text:'Thank you Dr. Chen! We spent weeks on those diagrams.', likes:78 },
                { author:'MLStudent', time:'1 day ago', text:'@Dr. Sarah Chen do you have any paper recommendations for going deeper?', likes:15 },
                { author:'Dr. Sarah Chen', time:'1 day ago', text:'@MLStudent Definitely read the original "Attention Is All You Need" paper, then Jay Alammar\'s blog posts.', likes:42 },
                { author:'TransformerFan', time:'12 hours ago', text:'This whole thread is gold. Bookmarked.', likes:9 },
            ]
        });
    }
    return base;
}

// ---------- STATE ----------
let currentView = 'home'; // 'home' | 'watch' | 'search'
let currentVideoId = null;
let isPlaying = false;
let isMuted = false;
let volumeLevel = 0.8;
let currentPlaybackSpeed = 1;
let currentQuality = 'Auto';
let subscribed = {};
let liked = {};
let disliked = {};
let controlTimeout = null;
let settingsOpen = false;

// ---------- DOM REFS ----------
const $home   = document.getElementById('home-view');
const $search = document.getElementById('search-view');
const $watch  = document.getElementById('watch-view');

// ---------- HELPERS ----------
function show(el) { el.style.display = ''; }
function hide(el) { el.style.display = 'none'; }
function formatNum(n) {
    if (typeof n === 'string') return n;
    if (n >= 1e6) return (n/1e6).toFixed(1).replace(/\.0$/,'') + 'M';
    if (n >= 1e3) return (n/1e3).toFixed(1).replace(/\.0$/,'') + 'K';
    return String(n);
}
function formatTime(sec) {
    sec = Math.floor(sec);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ':' + String(s).padStart(2, '0');
}

// ---------- VIEW SWITCHING ----------
function switchView(view) {
    currentView = view;
    hide($home); hide($search); hide($watch);
    if (view === 'home')   show($home);
    if (view === 'search') show($search);
    if (view === 'watch')  show($watch);
    window.scrollTo(0, 0);
}

// ---------- RENDER HOME FEED ----------
function renderFeed() {
    const grid = document.getElementById('feed-grid');
    grid.innerHTML = '';
    VIDEOS.forEach((v, idx) => {
        const card = document.createElement('div');
        card.className = 'video-card';
        card.setAttribute('data-id', v.id);
        card.innerHTML = `
            <div class="card-thumb">
                <div class="card-thumb-color" style="background:${thumbColor(idx)}"></div>
                <img class="card-thumb-img" src="${thumbImage(v)}" alt="${v.title}" loading="lazy">
                <span class="card-duration">${v.duration}</span>
            </div>
            <div class="card-body">
                <div class="avatar-circle card-avatar" style="background:${avatarColor(v.channel)}">${v.channel[0]}</div>
                <div class="card-meta">
                    <div class="card-title">${v.title}</div>
                    <div class="card-channel">${v.channel}</div>
                    <div class="card-stats">${v.views} &middot; ${v.ago}</div>
                </div>
            </div>`;
        card.addEventListener('click', () => openVideo(v.id));
        grid.appendChild(card);
    });
}

// ---------- OPEN VIDEO ----------
function openVideo(videoId) {
    currentVideoId = videoId;
    const v = VIDEOS.find(x => x.id === videoId);
    if (!v) return;

    tracker.track('video_open', { videoId: v.id, videoTitle: v.title });

    // Fill watch page
    document.getElementById('watch-title').textContent = v.title;
    document.getElementById('watch-channel-name').textContent = v.channel;
    document.getElementById('watch-channel-subs').textContent = v.subs + ' subscribers';
    const chAv = document.getElementById('watch-channel-avatar');
    chAv.textContent = v.channel[0];
    chAv.style.background = avatarColor(v.channel);
    document.getElementById('like-count').textContent = formatNum(v.likes);

    // Subscribe button state
    const subBtn = document.getElementById('subscribe-btn');
    if (subscribed[v.channelId]) {
        subBtn.textContent = 'Subscribed';
        subBtn.classList.add('subscribed');
    } else {
        subBtn.textContent = 'Subscribe';
        subBtn.classList.remove('subscribed');
    }

    // Like/dislike state
    document.getElementById('like-btn').classList.toggle('active', !!liked[v.id]);
    document.getElementById('dislike-btn').classList.toggle('active', !!disliked[v.id]);

    // Player surface — fallback color behind a Lorem Picsum hero image
    const surface = document.getElementById('player-surface');
    surface.style.background = `${thumbColor(VIDEOS.indexOf(v))} center/cover no-repeat url("${playerImage(v)}")`;

    // Time
    document.getElementById('time-display').textContent = '0:00 / ' + v.duration;

    // Progress reset
    document.getElementById('progress-played').style.width = '0%';
    document.getElementById('progress-scrubber').style.left = '0%';

    // Description
    const descBox = document.getElementById('description-box');
    document.getElementById('desc-stats').textContent = v.views + '  ' + v.ago;
    const descText = document.getElementById('desc-text');
    descText.textContent = v.desc;
    descText.classList.add('collapsed');
    document.getElementById('desc-toggle').textContent = '...more';

    // Reset playing state
    isPlaying = false;
    showPlayIcon();

    // Settings popup closed
    hide(document.getElementById('settings-popup'));
    settingsOpen = false;

    // Render comments
    renderComments(v.id);

    // Render up-next
    renderUpNext(v.id);

    switchView('watch');

    // Track visibility of player area and comments
    observeVisibility();
}

// ---------- DESCRIPTION ----------
(function() {
    const descBox = document.getElementById('description-box');
    const descText = document.getElementById('desc-text');
    const descToggle = document.getElementById('desc-toggle');
    descBox.addEventListener('click', (e) => {
        if (descText.classList.contains('collapsed')) {
            descText.classList.remove('collapsed');
            descToggle.textContent = 'Show less';
            tracker.track('description_expand', {});
        } else {
            descText.classList.add('collapsed');
            descToggle.textContent = '...more';
            tracker.track('description_collapse', {});
        }
    });
})();

// ---------- COMMENTS ----------
let currentCommentSort = 'top'; // 'top' | 'newest'

function parseAgoHours(s) {
    // e.g. "2 days ago", "1 week ago", "12 hours ago"
    const m = String(s || '').match(/^(\d+)\s+(hour|day|week|month|year)s?\s+ago$/i);
    if (!m) return 1e12;
    const n = parseInt(m[1], 10);
    const mult = { hour: 1, day: 24, week: 24 * 7, month: 24 * 30, year: 24 * 365 }[m[2].toLowerCase()];
    return n * mult;
}

function renderComments(videoId) {
    const comments = getComments(videoId).slice();
    if (currentCommentSort === 'newest') {
        comments.sort((a, b) => parseAgoHours(a.time) - parseAgoHours(b.time));
    } else {
        // 'top' = by likes descending; Dr. Sarah Chen (245) stays first on transformers video
        comments.sort((a, b) => (b.likes || 0) - (a.likes || 0));
    }
    document.getElementById('comments-count').textContent = '1,247 Comments';
    const list = document.getElementById('comments-list');
    list.innerHTML = '';
    comments.forEach(c => {
        list.appendChild(buildComment(c));
    });
}

function buildComment(c) {
    const item = document.createElement('div');
    item.className = 'comment-item';
    item.setAttribute('data-author', c.author);
    const col = avatarColor(c.author);
    let html = `
        <div class="avatar-circle comment-avatar" style="background:${col}">${c.author[0]}</div>
        <div class="comment-body">
            <div><span class="comment-author">${c.author}</span><span class="comment-time">${c.time}</span></div>
            <div class="comment-text">${c.text}</div>
            <div class="comment-actions">
                <button class="comment-like-btn">&#128077; ${c.likes}</button>
                <button class="comment-dislike-btn">&#128078;</button>
                <button class="comment-reply-btn" data-author="${c.author}">Reply</button>
            </div>`;

    if (c.replies && c.replies.length) {
        html += `<button class="reply-toggle" data-count="${c.replies.length}" data-author="${c.author}">${c.replies.length} replies</button>`;
        html += `<div class="replies-container" style="display:none;" data-parent="${c.author}">`;
        c.replies.forEach(r => {
            const rc = avatarColor(r.author);
            html += `
                <div class="comment-item" data-author="${r.author}">
                    <div class="avatar-circle comment-avatar" style="background:${rc}">${r.author[0]}</div>
                    <div class="comment-body">
                        <div><span class="comment-author">${r.author}</span><span class="comment-time">${r.time}</span></div>
                        <div class="comment-text">${r.text}</div>
                        <div class="comment-actions">
                            <button class="comment-like-btn">&#128077; ${r.likes}</button>
                            <button class="comment-dislike-btn">&#128078;</button>
                            <button class="comment-reply-btn" data-author="${c.author}">Reply</button>
                        </div>
                    </div>
                </div>`;
        });
        html += `</div>`;
    }

    html += `<div class="inline-reply-area" data-parent="${c.author}"></div>`;
    html += `</div>`;
    item.innerHTML = html;
    return item;
}

// Comment event delegation
document.getElementById('comments-list').addEventListener('click', (e) => {
    const target = e.target;

    // Reply toggle (expand/collapse)
    if (target.classList.contains('reply-toggle')) {
        const author = target.getAttribute('data-author');
        const count = parseInt(target.getAttribute('data-count'), 10);
        const container = target.parentElement.querySelector('.replies-container');
        if (container) {
            const isHidden = container.style.display === 'none';
            container.style.display = isHidden ? '' : 'none';
            target.textContent = isHidden ? 'Hide replies' : count + ' replies';
            if (isHidden) {
                tracker.track('reply_thread_expand', { parentCommentAuthor: author, replyCount: count });
            }
        }
        return;
    }

    // Reply button
    if (target.classList.contains('comment-reply-btn')) {
        const author = target.getAttribute('data-author');
        tracker.track('reply_click', { parentCommentAuthor: author });
        // Always resolve to the top-level comment-item (direct child of #comments-list).
        // Nested replies don't have their own .inline-reply-area, so we hoist up.
        const commentsList = document.getElementById('comments-list');
        let topLevel = target.closest('.comment-item');
        while (topLevel && topLevel.parentElement !== commentsList) {
            topLevel = topLevel.parentElement && topLevel.parentElement.closest('.comment-item');
        }
        const replyArea = topLevel ? topLevel.querySelector('.inline-reply-area') : null;
        if (!replyArea) return;
        if (replyArea.querySelector('.reply-input-row')) return; // already open
        replyArea.innerHTML = `
            <div class="reply-input-row">
                <div class="avatar-circle comment-avatar" style="background:#7c4dff">Y</div>
                <div style="flex:1">
                    <input type="text" class="reply-input" placeholder="Add a reply..." data-parent="${author}">
                    <div class="reply-submit-row">
                        <button class="reply-cancel-btn">Cancel</button>
                        <button class="reply-submit-btn" data-parent="${author}" disabled>Reply</button>
                    </div>
                </div>
            </div>`;
        const input = replyArea.querySelector('.reply-input');
        const submitBtn = replyArea.querySelector('.reply-submit-btn');
        input.focus();
        input.addEventListener('input', () => {
            const hasText = input.value.trim().length > 0;
            submitBtn.classList.toggle('enabled', hasText);
            submitBtn.disabled = !hasText;
            if (hasText) {
                // Must use key "value" (not value_contains) — evaluator's value_contains
                // criterion reads event.value and checks substring inclusion.
                tracker.track('reply_input', { value: input.value.trim() });
            }
        });
        submitBtn.addEventListener('click', () => {
            if (!input.value.trim()) return;
            tracker.track('reply_submit', { parentCommentAuthor: author, replyText: input.value.trim() });
            // Render the new reply visually
            const newReply = document.createElement('div');
            newReply.className = 'comment-item';
            newReply.innerHTML = `
                <div class="avatar-circle comment-avatar" style="background:#7c4dff">Y</div>
                <div class="comment-body">
                    <div><span class="comment-author">You</span><span class="comment-time">Just now</span></div>
                    <div class="comment-text">${input.value.trim()}</div>
                </div>`;
            replyArea.parentElement.querySelector('.replies-container')?.appendChild(newReply);
            replyArea.innerHTML = '';
        });
        replyArea.querySelector('.reply-cancel-btn').addEventListener('click', () => {
            replyArea.innerHTML = '';
        });
        return;
    }
});

// Sort dropdown
(function() {
    const sortBtn = document.getElementById('sort-btn');
    const sortMenu = document.getElementById('sort-menu');
    const sortLabel = document.getElementById('sort-label');
    sortBtn.addEventListener('click', () => {
        const open = sortMenu.style.display === 'none';
        sortMenu.style.display = open ? '' : 'none';
        if (open) tracker.track('comment_sort_open', {});
    });
    sortMenu.addEventListener('click', (e) => {
        if (e.target.classList.contains('sort-option')) {
            const sort = e.target.getAttribute('data-sort');
            sortLabel.textContent = e.target.textContent;
            sortMenu.style.display = 'none';
            tracker.track('comment_sort_change', { sort });
            // Actually re-order the list, then re-attach visibility observers.
            if (sort !== currentCommentSort) {
                currentCommentSort = sort;
                if (currentVideoId) {
                    renderComments(currentVideoId);
                    observeVisibility();
                }
            }
        }
    });
    document.addEventListener('click', (e) => {
        if (!sortBtn.contains(e.target) && !sortMenu.contains(e.target)) {
            sortMenu.style.display = 'none';
        }
    });
})();

// ---------- SUBSCRIBE ----------
document.getElementById('subscribe-btn').addEventListener('click', () => {
    const v = VIDEOS.find(x => x.id === currentVideoId);
    if (!v) return;
    subscribed[v.channelId] = !subscribed[v.channelId];
    const btn = document.getElementById('subscribe-btn');
    if (subscribed[v.channelId]) {
        btn.textContent = 'Subscribed';
        btn.classList.add('subscribed');
        tracker.track('channel_subscribe', { channelId: v.channelId, channelName: v.channel });
    } else {
        btn.textContent = 'Subscribe';
        btn.classList.remove('subscribed');
    }
});

// ---------- LIKE / DISLIKE ----------
document.getElementById('like-btn').addEventListener('click', () => {
    if (!currentVideoId) return;
    liked[currentVideoId] = !liked[currentVideoId];
    if (liked[currentVideoId]) disliked[currentVideoId] = false;
    document.getElementById('like-btn').classList.toggle('active', liked[currentVideoId]);
    document.getElementById('dislike-btn').classList.toggle('active', false);
    tracker.track('video_like', { videoId: currentVideoId });
});
document.getElementById('dislike-btn').addEventListener('click', () => {
    if (!currentVideoId) return;
    disliked[currentVideoId] = !disliked[currentVideoId];
    if (disliked[currentVideoId]) liked[currentVideoId] = false;
    document.getElementById('dislike-btn').classList.toggle('active', disliked[currentVideoId]);
    document.getElementById('like-btn').classList.toggle('active', false);
    tracker.track('video_dislike', { videoId: currentVideoId });
});

// ---------- PLAYER CONTROLS (auto-hide) ----------
(function() {
    const playerArea = document.getElementById('player-area');

    function showControls() {
        playerArea.classList.add('controls-visible');
        tracker.track('player_controls_show', {});
        resetControlTimer();
    }
    function hideControls() {
        playerArea.classList.remove('controls-visible');
        tracker.track('player_controls_hide', {});
    }
    function resetControlTimer() {
        clearTimeout(controlTimeout);
        controlTimeout = setTimeout(hideControls, 3000);
    }

    playerArea.addEventListener('mouseenter', showControls);
    playerArea.addEventListener('mousemove', () => {
        if (!playerArea.classList.contains('controls-visible')) {
            showControls();
        } else {
            resetControlTimer();
        }
    });
    playerArea.addEventListener('mouseleave', () => {
        clearTimeout(controlTimeout);
        hideControls();
    });
    playerArea.addEventListener('click', (e) => {
        // Ignore clicks on control bar itself
        if (e.target.closest('.control-bar') || e.target.closest('.settings-popup')) return;
        togglePlay();
    });
})();

// ---------- PLAY / PAUSE ----------
function showPlayIcon() {
    document.querySelector('.icon-play').style.display = '';
    document.querySelector('.icon-pause').style.display = 'none';
}
function showPauseIcon() {
    document.querySelector('.icon-play').style.display = 'none';
    document.querySelector('.icon-pause').style.display = '';
}
function togglePlay() {
    isPlaying = !isPlaying;
    if (isPlaying) { showPauseIcon(); tracker.track('player_play', {}); }
    else           { showPlayIcon();  tracker.track('player_pause', {}); }
}
document.getElementById('play-pause-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    togglePlay();
});

// ---------- VOLUME ----------
(function() {
    const area   = document.getElementById('volume-area');
    const btn    = document.getElementById('volume-btn');
    const slider = document.getElementById('volume-slider');

    area.addEventListener('mouseenter', () => {
        area.classList.add('slider-visible');
        tracker.track('volume_slider_reveal', {});
    });
    area.addEventListener('mouseleave', () => {
        area.classList.remove('slider-visible');
    });

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        isMuted = !isMuted;
        document.querySelector('.icon-vol-on').style.display  = isMuted ? 'none' : '';
        document.querySelector('.icon-vol-mute').style.display = isMuted ? ''     : 'none';
        slider.value = isMuted ? 0 : volumeLevel * 100;
        tracker.track('volume_change', { level: isMuted ? 0 : volumeLevel });
    });

    slider.addEventListener('input', () => {
        volumeLevel = slider.value / 100;
        isMuted = volumeLevel === 0;
        document.querySelector('.icon-vol-on').style.display  = isMuted ? 'none' : '';
        document.querySelector('.icon-vol-mute').style.display = isMuted ? ''     : 'none';
        tracker.track('volume_change', { level: volumeLevel });
    });
})();

// ---------- PROGRESS BAR ----------
(function() {
    const area     = document.getElementById('progress-area');
    const track    = document.getElementById('progress-track');
    const played   = document.getElementById('progress-played');
    const scrubber = document.getElementById('progress-scrubber');
    const tooltip  = document.getElementById('progress-tooltip');

    area.addEventListener('mousemove', (e) => {
        const rect = track.getBoundingClientRect();
        let frac = (e.clientX - rect.left) / rect.width;
        frac = Math.max(0, Math.min(1, frac));
        tooltip.style.left = (frac * 100) + '%';
        const v = VIDEOS.find(x => x.id === currentVideoId);
        if (v) tooltip.textContent = formatTime(frac * v.durationSec);
    });

    area.addEventListener('click', (e) => {
        const rect = track.getBoundingClientRect();
        let frac = (e.clientX - rect.left) / rect.width;
        frac = Math.max(0, Math.min(1, frac));
        played.style.width = (frac * 100) + '%';
        scrubber.style.left = (frac * 100) + '%';
        const v = VIDEOS.find(x => x.id === currentVideoId);
        if (v) {
            document.getElementById('time-display').textContent = formatTime(frac * v.durationSec) + ' / ' + v.duration;
        }
        tracker.track('player_seek', { position: parseFloat(frac.toFixed(3)) });
    });
})();

// ---------- SETTINGS POPUP ----------
(function() {
    const btn   = document.getElementById('settings-btn');
    const popup = document.getElementById('settings-popup');

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (settingsOpen) { closeSettings(); return; }
        openSettingsMain();
    });

    // Close settings when clicking outside
    document.addEventListener('click', (e) => {
        if (settingsOpen && !popup.contains(e.target) && e.target !== btn) {
            closeSettings();
        }
    });

    function closeSettings() {
        hide(popup);
        settingsOpen = false;
    }

    function openSettingsMain() {
        settingsOpen = true;
        show(popup);
        tracker.track('settings_open', {});
        popup.innerHTML = `
            <div class="sp-item" data-sub="playback-speed">
                <span>Playback speed</span><span>${currentPlaybackSpeed === 1 ? 'Normal' : currentPlaybackSpeed + 'x'}</span>
            </div>
            <div class="sp-item" data-sub="quality">
                <span>Quality</span><span>${currentQuality}</span>
            </div>
            <div class="sp-item" data-sub="subtitles">
                <span>Subtitles/CC</span><span>Off</span>
            </div>`;
        popup.querySelectorAll('.sp-item').forEach(item => {
            item.addEventListener('click', (ev) => {
                ev.stopPropagation();
                const sub = item.getAttribute('data-sub');
                tracker.track('settings_submenu_open', { submenu: sub });
                if (sub === 'playback-speed') openSpeedSub();
                else if (sub === 'quality') openQualitySub();
                else if (sub === 'subtitles') openSubtitlesSub();
            });
        });
    }

    function openSpeedSub() {
        const speeds = [0.25, 0.5, 1, 1.25, 1.5, 2];
        popup.innerHTML = `<div class="sp-back">&larr; Playback speed</div>` +
            speeds.map(s => `<div class="sp-option ${s === currentPlaybackSpeed ? 'active' : ''}" data-speed="${s}">${s === 1 ? 'Normal' : s + 'x'}</div>`).join('');
        popup.querySelector('.sp-back').addEventListener('click', (ev) => { ev.stopPropagation(); openSettingsMain(); });
        popup.querySelectorAll('.sp-option').forEach(opt => {
            opt.addEventListener('click', (ev) => {
                ev.stopPropagation();
                currentPlaybackSpeed = parseFloat(opt.getAttribute('data-speed'));
                tracker.track('playback_speed_change', { speed: currentPlaybackSpeed });
                openSettingsMain();
            });
        });
    }

    function openQualitySub() {
        const quals = ['1080p', '720p', '480p', '360p', 'Auto'];
        popup.innerHTML = `<div class="sp-back">&larr; Quality</div>` +
            quals.map(q => `<div class="sp-option ${q === currentQuality ? 'active' : ''}" data-q="${q}">${q}</div>`).join('');
        popup.querySelector('.sp-back').addEventListener('click', (ev) => { ev.stopPropagation(); openSettingsMain(); });
        popup.querySelectorAll('.sp-option').forEach(opt => {
            opt.addEventListener('click', (ev) => {
                ev.stopPropagation();
                currentQuality = opt.getAttribute('data-q');
                tracker.track('quality_change', { quality: currentQuality });
                openSettingsMain();
            });
        });
    }

    function openSubtitlesSub() {
        const opts = ['Off', 'English', 'English (auto-generated)'];
        popup.innerHTML = `<div class="sp-back">&larr; Subtitles/CC</div>` +
            opts.map(o => `<div class="sp-option ${o === 'Off' ? 'active' : ''}" data-cc="${o}">${o}</div>`).join('');
        popup.querySelector('.sp-back').addEventListener('click', (ev) => { ev.stopPropagation(); openSettingsMain(); });
    }
})();

// ---------- SEARCH ----------
(function() {
    const input = document.getElementById('search-input');
    const btn   = document.getElementById('search-btn');

    function doSearch() {
        const q = input.value.trim();
        if (!q) return;
        tracker.track('search_submit', { query: q });
        const results = VIDEOS.filter(v => v.title.toLowerCase().includes(q.toLowerCase()) || v.channel.toLowerCase().includes(q.toLowerCase()));
        renderSearchResults(results, q);
        switchView('search');
    }

    btn.addEventListener('click', doSearch);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
})();

function renderSearchResults(results, query) {
    const container = document.getElementById('search-results');
    container.innerHTML = '';
    if (results.length === 0) {
        container.innerHTML = '<p style="color:#606060;padding:40px 0;">No results found for "' + query + '"</p>';
        return;
    }
    results.forEach((v, idx) => {
        const card = document.createElement('div');
        card.className = 'search-result-card';
        card.innerHTML = `
            <div class="search-thumb">
                <div class="search-thumb-color" style="background:${thumbColor(VIDEOS.indexOf(v))}"></div>
                <img class="search-thumb-img" src="${thumbImage(v)}" alt="${v.title}" loading="lazy">
                <span class="card-duration">${v.duration}</span>
            </div>
            <div class="search-result-meta">
                <h3>${v.title}</h3>
                <div class="meta-line">${v.views} &middot; ${v.ago}</div>
                <div class="meta-line">${v.channel}</div>
                <div class="meta-line" style="margin-top:8px;">${v.desc.substring(0, 120)}...</div>
            </div>`;
        card.addEventListener('click', () => openVideo(v.id));
        container.appendChild(card);
    });
}

// ---------- UP NEXT SIDEBAR ----------
function renderUpNext(currentId) {
    const list = document.getElementById('up-next-list');
    list.innerHTML = '';
    const others = VIDEOS.filter(v => v.id !== currentId);
    // Show up to 8
    others.slice(0, 8).forEach((v) => {
        const card = document.createElement('div');
        card.className = 'up-next-card';
        card.innerHTML = `
            <div class="up-next-thumb">
                <div class="up-next-thumb-color" style="background:${thumbColor(VIDEOS.indexOf(v))}"></div>
                <img class="up-next-thumb-img" src="${thumbImage(v)}" alt="${v.title}" loading="lazy">
                <span class="up-next-dur">${v.duration}</span>
            </div>
            <div class="up-next-meta">
                <div class="up-next-title">${v.title}</div>
                <div class="up-next-channel">${v.channel}</div>
                <div class="up-next-stats">${v.views} &middot; ${v.ago}</div>
            </div>`;
        card.addEventListener('click', () => openVideo(v.id));
        list.appendChild(card);
    });
}

// ---------- LOGO → HOME ----------
document.getElementById('logo-link').addEventListener('click', (e) => {
    e.preventDefault();
    switchView('home');
});

// ---------- INTERSECTION OBSERVERS (visibility tracking) ----------
let playerObserver = null;
let commentsObserver = null;
let commentItemObservers = [];

function observeVisibility() {
    // Clean up previous observers
    if (playerObserver) playerObserver.disconnect();
    if (commentsObserver) commentsObserver.disconnect();
    commentItemObservers.forEach(o => o.disconnect());
    commentItemObservers = [];

    // Track player_area_visible, but only after the user has scrolled away
    // from the player first — the player starts above the fold so the naive
    // observer would fire immediately on watch-page load and auto-credit any
    // "scroll back to the player" criterion.
    let playerHasLeftViewport = false;
    playerObserver = new IntersectionObserver((entries) => {
        entries.forEach(e => {
            if (!e.isIntersecting) {
                playerHasLeftViewport = true;
                return;
            }
            if (playerHasLeftViewport) {
                tracker.track('player_area_visible', {});
                playerObserver.disconnect();
            }
        });
    }, { threshold: 0.5 });
    playerObserver.observe(document.getElementById('player-area'));

    // Track comments_section_visible
    commentsObserver = new IntersectionObserver((entries) => {
        entries.forEach(e => {
            if (e.isIntersecting) {
                tracker.track('comments_section_visible', {});
                commentsObserver.disconnect();
            }
        });
    }, { threshold: 0.1 });
    commentsObserver.observe(document.getElementById('comments-section'));

    // Track individual comment visibility
    document.querySelectorAll('#comments-list > .comment-item').forEach(item => {
        const author = item.getAttribute('data-author');
        if (!author) return;
        const obs = new IntersectionObserver((entries) => {
            entries.forEach(e => {
                if (e.isIntersecting) {
                    tracker.track('comment_visible', { authorName: author });
                    obs.disconnect();
                }
            });
        }, { threshold: 0.5 });
        obs.observe(item);
        commentItemObservers.push(obs);
    });
}

// ---------- INIT ----------
renderFeed();
switchView('home');
