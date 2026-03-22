window.tracker = new AgentTracker('bluebook.life', 'hard');

(function () {
  const CHANNELS = ['推荐', '穿搭', '美食', '彩妆', '职场', '情感', '家居', '游戏', '旅行', '健身'];
  const STORAGE_KEY = 'bluebook_eval_state_v1';

  const coverThemes = [
    ['linear-gradient(135deg, #13243d, #2b5b96)', '#d9ecff'],
    ['linear-gradient(135deg, #30210f, #aa6b2d)', '#fff4d9'],
    ['linear-gradient(135deg, #222136, #6e4cff)', '#e8e1ff'],
    ['linear-gradient(135deg, #0d2d2a, #14a38b)', '#d8fff5'],
    ['linear-gradient(135deg, #381824, #f0577c)', '#ffe3ea'],
    ['linear-gradient(135deg, #1d2330, #4b576d)', '#eef3fb'],
  ];

  const avatarThemes = ['#4f7cff', '#ff6b6b', '#7a5cff', '#0ca678', '#e8590c', '#9c36b5'];

  const seedNotes = [
    {
      id: 'note-openclaw-config',
      title: '养好 OpenClaw，先把配置文件啃明白',
      author: 'jesse~自然智群',
      avatar: '自',
      category: '职场',
      type: 'video',
      coverLabel: '视频 · 4:21',
      coverHeadline: 'OpenClaw\n下载之后\n先看配置',
      excerpt: '不少人装完直接开跑，结果卡在权限、路径和 hook 配置。把配置文件读明白，后面的稳定性会高很多。',
      tags: ['#openclaw', '#智能体', '#配置文件'],
      likedCount: 1346,
      collectCount: 3444,
      commentCount: 31,
      shareCount: 146,
      comments: [
        {
          id: 'comment-tutu-hook',
          author: '涂涂',
          avatar: '涂',
          region: '03-08 广东',
          text: '来自 OpenClaw 要维斯的问题！看到大家认真研究和配置真开心，真的很好，遇到问题欢迎随时交流，一起把数字管家养得更好！',
          likes: 1,
          replies: [],
        },
        {
          id: 'comment-rm-rf',
          author: '大王叫我来巡山',
          avatar: '巡',
          region: '03-10 浙江',
          text: 'rm -rf 直接执行，不要问为什么。',
          likes: 8,
          replies: [],
        },
        {
          id: 'comment-hook-enable',
          author: '坐标上海，找货代',
          avatar: '沪',
          region: '03-10 上海',
          text: '钩子怎么启用？',
          likes: 1,
          replies: [
            { author: '维护手册', text: '先检查 skills 和 hooks 目录，然后在配置里打开 enableHooks。' },
            { author: '夜半敲代码', text: '注意路径要用绝对路径，不然加载不到。' },
          ],
        },
        {
          id: 'comment-star-fire',
          author: '须纵酒',
          avatar: '须',
          region: '03-09 江苏',
          text: '这个项目 star 还没有你这帖子火，不太正常。',
          likes: 1,
          replies: [],
        },
      ],
    },
    {
      id: 'note-arigato-ai',
      title: '阿里嘎多，这套 AI 识图提示词模板真顶',
      author: 'Prompt 边角料',
      avatar: '提',
      category: '职场',
      type: 'image',
      coverLabel: '图文',
      coverHeadline: '阿里嘎多\nPrompt 模板\n直接起飞',
      excerpt: '把复杂 UI 拆成结构、动作和约束三段描述，比单纯问“帮我点一下”稳定很多。',
      tags: ['#prompt', '#阿里嘎多', '#浏览器自动化'],
      likedCount: 817,
      collectCount: 1522,
      commentCount: 18,
      shareCount: 73,
      comments: [
        {
          id: 'comment-template-1',
          author: '极客Shane',
          avatar: '极',
          region: '03-07 上海',
          text: '这种模板适合做表单和复杂列表任务，层次更清楚。',
          likes: 6,
          replies: [],
        },
        {
          id: 'comment-template-2',
          author: '夜航星',
          avatar: '夜',
          region: '03-08 深圳',
          text: '比纯截图问答强，尤其是要结合 DOM 的时候。',
          likes: 4,
          replies: [],
        },
      ],
    },
    {
      id: 'note-git-worktree',
      title: '用 AI 写代码时，有一个工具退早了会出事：git worktree',
      author: '鹿桃',
      avatar: '鹿',
      category: '职场',
      type: 'image',
      coverLabel: '图文',
      coverHeadline: 'AI 写代码\n别太早丢掉\nworktree',
      excerpt: '多会话并行调试和对照修改时，worktree 很适合隔离上下文。很多问题不是模型差，是工作区管理差。',
      tags: ['#gitworktree', '#工程效率'],
      likedCount: 265,
      collectCount: 905,
      commentCount: 12,
      shareCount: 22,
      comments: [
        {
          id: 'comment-worktree-1',
          author: '摸鱼程序猿',
          avatar: '摸',
          region: '03-09 北京',
          text: '同一个 repo 同时开两个 agent，worktree 不开真容易互相污染。',
          likes: 11,
          replies: [],
        },
      ],
    },
    {
      id: 'note-claude-im',
      title: 'Claude Code 都能连 IM 了，那 OpenClaw 还剩哪些独有优势？',
      author: '泥鳅还玉',
      avatar: '泥',
      category: '职场',
      type: 'image',
      coverLabel: '图文',
      coverHeadline: 'Claude Code\n还能连 IM？\nOpenClaw 呢',
      excerpt: '如果两边都能看图写代码，差异就会回到执行链路、浏览器能力和工程集成。',
      tags: ['#ClaudeCode', '#OpenClaw'],
      likedCount: 40,
      collectCount: 88,
      commentCount: 7,
      shareCount: 6,
      comments: [
        {
          id: 'comment-im-1',
          author: '路过听听',
          avatar: '路',
          region: '03-11 杭州',
          text: '浏览器交互和评测闭环还是差很多。',
          likes: 3,
          replies: [],
        },
      ],
    },
    {
      id: 'note-monkey-durian',
      title: '宁愿选择榴莲不放手',
      author: 'CCTV',
      avatar: '央',
      category: '旅行',
      type: 'video',
      coverLabel: '视频 · 0:42',
      coverHeadline: '猴子分榴莲\n比我还认真',
      excerpt: '真实自然状态下的小动物很有意思，这条视频循环看了很多遍。',
      tags: ['#动物', '#旅行见闻'],
      likedCount: 8314,
      collectCount: 1201,
      commentCount: 52,
      shareCount: 219,
      comments: [],
    },
    {
      id: 'note-entrance-carry',
      title: '泄露可判刑 10 年？这瓜吃到法条层面了',
      author: '路透桥',
      avatar: '路',
      category: '职场',
      type: 'video',
      coverLabel: '视频 · 1:13',
      coverHeadline: '这瓜吃到\n法条层面了',
      excerpt: '法规解读向内容，评论区吵得很热，卡点主要集中在证据链和责任边界。',
      tags: ['#热点解读', '#合规'],
      likedCount: 40,
      collectCount: 93,
      commentCount: 9,
      shareCount: 11,
      comments: [],
    },
    {
      id: 'note-cloudstack-skill',
      title: 'CloudStack 本身很强，装上这些 skills 直接起飞',
      author: '极客Shane',
      avatar: '极',
      category: '家居',
      type: 'image',
      coverLabel: '图文',
      coverHeadline: 'CloudStack\n本身很强\n装上 Skills',
      excerpt: '站内把复杂流程拆成 skill 之后，行为更稳定，复现也更容易。',
      tags: ['#skills', '#CloudStack'],
      likedCount: 504,
      collectCount: 1312,
      commentCount: 21,
      shareCount: 44,
      comments: [],
    },
    {
      id: 'note-night-station',
      title: '本人接到平顶山联合调查组通知',
      author: '芝菲奥莱死因不明',
      avatar: '芝',
      category: '情感',
      type: 'image',
      coverLabel: '图文',
      coverHeadline: '平顶山\n联合调查组\n通知',
      excerpt: '夜景配新闻截屏，标题党十足，但互动量很高。',
      tags: ['#夜景', '#热点'],
      likedCount: 4817,
      collectCount: 404,
      commentCount: 13,
      shareCount: 81,
      comments: [],
    },
  ];

  const state = {
    activeChannel: '推荐',
    graphicOnly: false,
    query: '',
    notes: [],
    filteredNotes: [],
    currentNoteId: null,
    likedNotes: {},
    collectedNotes: {},
    followedAuthors: {},
    commentLikes: {},
    expandedReplies: {},
    openReplyEditors: {},
  };

  const dom = {};

  function clampNumber(value) {
    return Math.max(0, Number(value) || 0);
  }

  function formatCount(value) {
    if (value >= 10000) {
      return `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)}万`;
    }
    return `${value}`;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getTheme(index) {
    return coverThemes[index % coverThemes.length];
  }

  function getAvatarColor(index) {
    return avatarThemes[index % avatarThemes.length];
  }

  function createGeneratedNotes() {
    const topics = [
      { title: '浏览器自动化', tags: ['#浏览器', '#自动化', '#效率'], category: '职场' },
      { title: 'vibe coding', tags: ['#AI编程', '#工程实践'], category: '职场' },
      { title: '厨房改造', tags: ['#家居', '#收纳'], category: '家居' },
      { title: '出差背包', tags: ['#旅行', '#装备'], category: '旅行' },
      { title: '健身饮食', tags: ['#健身', '#饮食'], category: '健身' },
      { title: '拍照修图', tags: ['#图文', '#修图'], category: '彩妆' },
      { title: '情绪整理', tags: ['#情感', '#自我管理'], category: '情感' },
      { title: '客厅配色', tags: ['#家居', '#氛围'], category: '家居' },
      { title: '代码审查', tags: ['#工程', '#Review'], category: '职场' },
    ];
    const authors = ['早睡早起', '软糖布丁', '骑猪看代码', '极北旅人', '蓝调少女', '步履不停', '云朵仓鼠', '晚风小日记', '一口西瓜冰'];
    const notes = [];

    for (let i = 0; i < 64; i += 1) {
      const topic = topics[i % topics.length];
      const author = authors[i % authors.length];
      const isVideo = i % 5 === 0;
      notes.push({
        id: `note-generated-${i + 1}`,
        title: `${topic.title} 第 ${i + 1} 条实战观察`,
        author,
        avatar: author.slice(0, 1),
        category: topic.category,
        type: isVideo ? 'video' : 'image',
        coverLabel: isVideo ? `视频 · 0:${String((i % 49) + 10).padStart(2, '0')}` : '图文',
        coverHeadline: `${topic.title}\n第 ${i + 1} 条`,
        excerpt: `围绕 ${topic.title} 的日常记录，第 ${i + 1} 条样本。为了模拟真实 feed，这里保留了不同长度标题、不同互动数和不同媒体样式。`,
        tags: topic.tags,
        likedCount: 80 + i * 37,
        collectCount: 20 + i * 19,
        commentCount: 3 + (i % 17),
        shareCount: 1 + (i % 9),
        comments: [
          {
            id: `generated-comment-${i + 1}-1`,
            author: `${author}同城`,
            avatar: author.slice(0, 1),
            region: `03-${String((i % 20) + 1).padStart(2, '0')} 上海`,
            text: `第 ${i + 1} 条内容的第一条评论，用来模拟真实列表高度。`,
            likes: i % 8,
            replies: [],
          },
        ],
      });
    }

    return notes;
  }

  function buildNotes() {
    return seedNotes.concat(createGeneratedNotes()).map((note, index) => ({
      ...note,
      gradient: getTheme(index)[0],
      coverColor: getTheme(index)[1],
      avatarColor: getAvatarColor(index),
      liked: false,
      collected: false,
    }));
  }

  function loadPersistedState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return;
      }

      const saved = JSON.parse(raw);
      state.likedNotes = saved.likedNotes || {};
      state.collectedNotes = saved.collectedNotes || {};
      state.followedAuthors = saved.followedAuthors || {};
      state.commentLikes = saved.commentLikes || {};
      state.graphicOnly = Boolean(saved.graphicOnly);
      state.activeChannel = saved.activeChannel || '推荐';
    } catch (_error) {
      // Ignore malformed local state.
    }
  }

  function persistState() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        likedNotes: state.likedNotes,
        collectedNotes: state.collectedNotes,
        followedAuthors: state.followedAuthors,
        commentLikes: state.commentLikes,
        graphicOnly: state.graphicOnly,
        activeChannel: state.activeChannel,
      }),
    );
  }

  function getCurrentNote() {
    return state.notes.find((note) => note.id === state.currentNoteId) || null;
  }

  function getSearchQueryFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('q') || '';
  }

  function updateUrlQuery(query) {
    const url = new URL(window.location.href);
    if (query) {
      url.searchParams.set('q', query);
    } else {
      url.searchParams.delete('q');
    }
    window.history.replaceState({}, '', url.toString());
  }

  function applyFilters() {
    const normalizedQuery = state.query.trim().toLowerCase();
    state.filteredNotes = state.notes.filter((note) => {
      if (state.activeChannel !== '推荐' && note.category !== state.activeChannel) {
        return false;
      }

      if (state.graphicOnly && note.type !== 'image') {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const haystack = [
        note.title,
        note.author,
        note.excerpt,
        note.tags.join(' '),
        note.comments.map((comment) => `${comment.author} ${comment.text}`).join(' '),
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }

  function renderChannels() {
    dom.channelBar.innerHTML = CHANNELS.map((channel) => `
      <button class="channel-chip ${state.activeChannel === channel ? 'active' : ''}" data-channel="${channel}">
        ${escapeHtml(channel)}
      </button>
    `).join('');
  }

  function createCoverMarkup(note) {
    return `
      <div class="note-cover" style="background:${note.gradient};">
        <span class="cover-badge">${escapeHtml(note.coverLabel)}</span>
        ${note.type === 'video' ? '<span class="cover-play">▶</span>' : ''}
        <div class="cover-copy" style="color:${note.coverColor};">${escapeHtml(note.coverHeadline).replace(/\n/g, '<br>')}</div>
      </div>
    `;
  }

  function renderFeed() {
    applyFilters();

    const queryPart = state.query ? `“${state.query}”` : '全部内容';
    const graphicPart = state.graphicOnly ? '，已开启只看图文' : '';
    dom.feedStatus.textContent = `当前显示 ${state.filteredNotes.length} 条内容，筛选：${queryPart}${graphicPart}`;
    dom.graphicFilter.classList.toggle('active', state.graphicOnly);

    if (state.filteredNotes.length === 0) {
      dom.noteGrid.innerHTML = `
        <div class="empty-state">
          <h3>没有找到相关内容</h3>
          <p>试试更短的关键词，或者点击右侧“刷新”换一批内容。</p>
        </div>
      `;
      return;
    }

    dom.noteGrid.innerHTML = state.filteredNotes.map((note) => `
      <article class="note-card" data-note-id="${note.id}">
        ${createCoverMarkup(note)}
        <div class="note-body">
          <h2 class="note-title">${escapeHtml(note.title)}</h2>
          <div class="note-meta">
            <div class="note-author">
              <span class="avatar-dot" style="background:${note.avatarColor};">${escapeHtml(note.avatar)}</span>
              <span>${escapeHtml(note.author)}</span>
            </div>
            <div class="meta-actions">
              <button class="meta-action card-like-btn ${state.likedNotes[note.id] ? 'active' : ''}" data-note-id="${note.id}" data-action="like">
                <span>♡</span>
                <span>${formatCount(note.likedCount + (state.likedNotes[note.id] ? 1 : 0))}</span>
              </button>
              <button class="meta-action card-comment-btn" data-note-id="${note.id}" data-action="comment">
                <span>◔</span>
                <span>${formatCount(note.commentCount)}</span>
              </button>
            </div>
          </div>
        </div>
      </article>
    `).join('');
  }

  function openNote(noteId, source, focusComments) {
    const note = state.notes.find((item) => item.id === noteId);
    if (!note) {
      return;
    }

    state.currentNoteId = noteId;
    dom.modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    dom.modalMedia.innerHTML = `
      <div class="media-card">
        <div class="media-gradient" style="background:${note.gradient}; color:${note.coverColor};">
          <h2>${escapeHtml(note.coverHeadline).replace(/\n/g, '<br>')}</h2>
          <p>${escapeHtml(note.excerpt)}</p>
        </div>
        ${note.type === 'video' ? '<div class="media-play">▶</div>' : ''}
      </div>
    `;

    dom.modalAuthorAvatar.textContent = note.avatar;
    dom.modalAuthorAvatar.style.background = note.avatarColor;
    dom.modalAuthorName.textContent = note.author;
    dom.modalNoteTime.textContent = `${note.category} · ${note.type === 'video' ? '视频笔记' : '图文笔记'} · 03-21 发布`;
    dom.modalFollowBtn.textContent = state.followedAuthors[note.author] ? '已关注' : '关注';
    dom.modalTitle.textContent = note.title;
    dom.modalDesc.textContent = note.excerpt;
    dom.modalTags.innerHTML = note.tags.map((tag) => `<span class="detail-tag">${escapeHtml(tag)}</span>`).join('');
    dom.modalCommentSummary.textContent = `共 ${note.commentCount} 条评论`;

    renderComments(note);
    renderDetailActions(note);

    tracker.track('note_open', {
      noteId: note.id,
      noteTitle: note.title,
      source,
      query: state.query || '',
    });

    if (focusComments) {
      dom.commentList.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } else {
      dom.commentList.parentElement.scrollTop = 0;
    }
  }

  function closeNote() {
    state.currentNoteId = null;
    dom.modal.classList.add('hidden');
    document.body.style.overflow = '';
  }

  function getCommentLikeKey(noteId, commentId) {
    return `${noteId}:${commentId}`;
  }

  function renderComments(note) {
    dom.commentList.innerHTML = note.comments.map((comment) => {
      const commentKey = getCommentLikeKey(note.id, comment.id);
      const liked = Boolean(state.commentLikes[commentKey]);
      const replyOpen = Boolean(state.openReplyEditors[commentKey]);
      const repliesOpen = Boolean(state.expandedReplies[commentKey]);

      return `
        <div class="comment-item" data-comment-id="${comment.id}">
          <div class="comment-avatar" style="background:${note.avatarColor};">${escapeHtml(comment.avatar)}</div>
          <div>
            <div class="comment-header">
              <span class="comment-author">${escapeHtml(comment.author)}</span>
              <span>${escapeHtml(comment.region)}</span>
            </div>
            <div class="comment-text">${escapeHtml(comment.text)}</div>
            <div class="comment-actions">
              <button class="like-wrapper ${liked ? 'active' : ''}" data-action="comment-like" data-comment-id="${comment.id}">
                <span>♡</span>
                <span>${clampNumber(comment.likes) + (liked ? 1 : 0)}</span>
              </button>
              <button class="reply-btn" data-action="comment-reply" data-comment-id="${comment.id}">回复</button>
              ${comment.replies && comment.replies.length > 0 ? `<button class="show-replies-btn" data-action="toggle-replies" data-comment-id="${comment.id}">${repliesOpen ? '收起回复' : `展开 ${comment.replies.length} 条回复`}</button>` : ''}
            </div>
            ${replyOpen ? `
              <div class="reply-editor">
                <input class="reply-input" data-reply-input="${comment.id}" placeholder="回复 ${escapeHtml(comment.author)}...">
                <button class="reply-submit" data-action="submit-reply" data-comment-id="${comment.id}">回复</button>
              </div>
            ` : ''}
            ${repliesOpen && comment.replies && comment.replies.length > 0 ? `
              <div class="reply-list">
                ${comment.replies.map((reply) => `<div class="reply-item"><b>${escapeHtml(reply.author)}</b>：${escapeHtml(reply.text)}</div>`).join('')}
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  function renderDetailActions(note) {
    const liked = Boolean(state.likedNotes[note.id]);
    const collected = Boolean(state.collectedNotes[note.id]);
    dom.detailActions.innerHTML = `
      <button class="detail-action ${liked ? 'active' : ''}" data-detail-action="like" data-note-id="${note.id}">
        <span>♡</span>
        <span class="detail-action-count">${clampNumber(note.likedCount) + (liked ? 1 : 0)}</span>
      </button>
      <button class="detail-action ${collected ? 'active' : ''}" data-detail-action="collect" data-note-id="${note.id}">
        <span>☆</span>
        <span class="detail-action-count">${clampNumber(note.collectCount) + (collected ? 1 : 0)}</span>
      </button>
      <button class="detail-action" data-detail-action="comment" data-note-id="${note.id}">
        <span>◔</span>
        <span class="detail-action-count">${note.commentCount}</span>
      </button>
      <button class="detail-action" data-detail-action="share" data-note-id="${note.id}">
        <span>↗</span>
        <span class="detail-action-count">${note.shareCount}</span>
      </button>
    `;
  }

  function toggleNoteLike(noteId, location) {
    const note = state.notes.find((item) => item.id === noteId);
    if (!note) {
      return;
    }

    const nextLiked = !state.likedNotes[noteId];
    state.likedNotes[noteId] = nextLiked;
    persistState();
    renderFeed();

    if (state.currentNoteId === noteId) {
      renderDetailActions(note);
    }

    tracker.track('note_like_toggle', {
      noteId,
      noteTitle: note.title,
      liked: nextLiked,
      location,
    });
  }

  function toggleCollect(noteId) {
    const note = state.notes.find((item) => item.id === noteId);
    if (!note) {
      return;
    }

    const nextCollected = !state.collectedNotes[noteId];
    state.collectedNotes[noteId] = nextCollected;
    persistState();
    renderDetailActions(note);

    tracker.track('note_collect_toggle', {
      noteId,
      noteTitle: note.title,
      collected: nextCollected,
    });
  }

  function runSearch(origin) {
    state.query = dom.searchInput.value.trim();
    updateUrlQuery(state.query);
    renderFeed();

    tracker.track('search_execute', {
      query: state.query,
      normalizedQuery: state.query.toLowerCase(),
      location: origin,
      resultsCount: state.filteredNotes.length,
    });
  }

  function clearSearch() {
    const previousQuery = state.query || dom.searchInput.value.trim();
    dom.searchInput.value = '';
    state.query = '';
    updateUrlQuery('');
    renderFeed();

    tracker.track('search_clear', {
      previousQuery,
    });
  }

  function shuffleNotes() {
    for (let index = state.notes.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      const temp = state.notes[index];
      state.notes[index] = state.notes[swapIndex];
      state.notes[swapIndex] = temp;
    }
  }

  function handleFeedReload() {
    shuffleNotes();
    renderFeed();
    tracker.track('feed_refresh', {
      query: state.query,
      graphicOnly: state.graphicOnly,
      visibleCount: state.filteredNotes.length,
    });
  }

  function toggleGraphicOnly() {
    state.graphicOnly = !state.graphicOnly;
    persistState();
    renderFeed();
    tracker.track('filter_toggle', {
      filter: 'graphic_only',
      enabled: state.graphicOnly,
    });
  }

  function toggleCommentLike(noteId, commentId) {
    const note = state.notes.find((item) => item.id === noteId);
    if (!note) {
      return;
    }

    const comment = note.comments.find((item) => item.id === commentId);
    if (!comment) {
      return;
    }

    const key = getCommentLikeKey(noteId, commentId);
    const liked = !state.commentLikes[key];
    state.commentLikes[key] = liked;
    persistState();
    renderComments(note);

    tracker.track('comment_like_toggle', {
      noteId,
      noteTitle: note.title,
      commentId,
      commentAuthor: comment.author,
      liked,
    });
  }

  function toggleReplyEditor(noteId, commentId) {
    const note = state.notes.find((item) => item.id === noteId);
    if (!note) {
      return;
    }

    const comment = note.comments.find((item) => item.id === commentId);
    if (!comment) {
      return;
    }

    const key = getCommentLikeKey(noteId, commentId);
    state.openReplyEditors[key] = !state.openReplyEditors[key];
    renderComments(note);

    tracker.track('comment_reply_open', {
      noteId,
      noteTitle: note.title,
      commentId,
      commentAuthor: comment.author,
      open: state.openReplyEditors[key],
    });
  }

  function submitReply(noteId, commentId) {
    const note = state.notes.find((item) => item.id === noteId);
    if (!note) {
      return;
    }

    const comment = note.comments.find((item) => item.id === commentId);
    if (!comment) {
      return;
    }

    const input = dom.commentList.querySelector(`[data-reply-input="${commentId}"]`);
    const value = input ? input.value.trim() : '';
    if (!value) {
      return;
    }

    if (!comment.replies) {
      comment.replies = [];
    }
    comment.replies.push({
      author: '小蓝书用户',
      text: value,
    });

    const key = getCommentLikeKey(noteId, commentId);
    state.openReplyEditors[key] = false;
    state.expandedReplies[key] = true;
    note.commentCount += 1;
    renderComments(note);
    renderDetailActions(note);
    renderFeed();

    tracker.track('comment_reply_submit', {
      noteId,
      noteTitle: note.title,
      commentId,
      commentAuthor: comment.author,
      value,
      valueLength: value.length,
    });
  }

  function toggleReplies(noteId, commentId) {
    const note = state.notes.find((item) => item.id === noteId);
    if (!note) {
      return;
    }

    const comment = note.comments.find((item) => item.id === commentId);
    if (!comment) {
      return;
    }

    const key = getCommentLikeKey(noteId, commentId);
    state.expandedReplies[key] = !state.expandedReplies[key];
    renderComments(note);

    tracker.track('comment_replies_toggle', {
      noteId,
      noteTitle: note.title,
      commentId,
      commentAuthor: comment.author,
      open: state.expandedReplies[key],
    });
  }

  function sendQuickComment() {
    const note = getCurrentNote();
    if (!note) {
      return;
    }

    const value = dom.quickCommentInput.value.trim();
    if (!value) {
      return;
    }

    note.comments.unshift({
      id: `quick-comment-${Date.now()}`,
      author: '小蓝书用户',
      avatar: '蓝',
      region: '刚刚',
      text: value,
      likes: 0,
      replies: [],
    });
    note.commentCount += 1;
    dom.quickCommentInput.value = '';
    renderComments(note);
    renderDetailActions(note);
    renderFeed();

    tracker.track('quick_comment_submit', {
      noteId: note.id,
      noteTitle: note.title,
      value,
      valueLength: value.length,
    });
  }

  function bindEvents() {
    dom.channelBar.addEventListener('click', (event) => {
      const target = event.target.closest('.channel-chip');
      if (!target) {
        return;
      }

      state.activeChannel = target.dataset.channel;
      persistState();
      renderChannels();
      renderFeed();
      tracker.track('channel_switch', {
        channel: state.activeChannel,
      });
    });

    dom.noteGrid.addEventListener('click', (event) => {
      const actionBtn = event.target.closest('[data-action]');
      if (actionBtn) {
        const noteId = actionBtn.dataset.noteId;
        const action = actionBtn.dataset.action;

        if (action === 'like') {
          toggleNoteLike(noteId, 'card');
        }

        if (action === 'comment') {
          openNote(noteId, 'card_comment', true);
          tracker.track('card_comment_open', { noteId });
        }
        return;
      }

      const noteCard = event.target.closest('.note-card');
      if (!noteCard) {
        return;
      }

      openNote(noteCard.dataset.noteId, 'feed_card', false);
    });

    dom.searchSubmit.addEventListener('click', () => runSearch('icon'));
    dom.searchClear.addEventListener('click', clearSearch);
    dom.searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        runSearch('enter');
      }
    });

    dom.graphicFilter.addEventListener('click', toggleGraphicOnly);
    dom.feedReload.addEventListener('click', handleFeedReload);

    dom.modal.addEventListener('click', (event) => {
      if (event.target === dom.modal) {
        closeNote();
      }
    });

    dom.noteClose.addEventListener('click', closeNote);

    dom.modalFollowBtn.addEventListener('click', () => {
      const note = getCurrentNote();
      if (!note) {
        return;
      }

      const followed = !state.followedAuthors[note.author];
      state.followedAuthors[note.author] = followed;
      persistState();
      dom.modalFollowBtn.textContent = followed ? '已关注' : '关注';

      tracker.track('author_follow_toggle', {
        noteId: note.id,
        author: note.author,
        followed,
      });
    });

    dom.detailActions.addEventListener('click', (event) => {
      const target = event.target.closest('[data-detail-action]');
      if (!target) {
        return;
      }

      const noteId = target.dataset.noteId;
      const action = target.dataset.detailAction;

      if (action === 'like') {
        toggleNoteLike(noteId, 'detail');
      } else if (action === 'collect') {
        toggleCollect(noteId);
      } else if (action === 'comment') {
        dom.quickCommentInput.focus();
        tracker.track('detail_comment_focus', { noteId });
      } else if (action === 'share') {
        tracker.track('note_share_click', { noteId });
      }
    });

    dom.commentList.addEventListener('click', (event) => {
      const target = event.target.closest('[data-action]');
      if (!target) {
        return;
      }

      const note = getCurrentNote();
      if (!note) {
        return;
      }

      const commentId = target.dataset.commentId;
      const action = target.dataset.action;

      if (action === 'comment-like') {
        toggleCommentLike(note.id, commentId);
      } else if (action === 'comment-reply') {
        toggleReplyEditor(note.id, commentId);
      } else if (action === 'submit-reply') {
        submitReply(note.id, commentId);
      } else if (action === 'toggle-replies') {
        toggleReplies(note.id, commentId);
      }
    });

    dom.quickCommentSend.addEventListener('click', sendQuickComment);
    dom.quickCommentInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        sendQuickComment();
      }
    });

    document.querySelectorAll('.sidebar-item, .sidebar-more, .top-link').forEach((node) => {
      node.addEventListener('click', (event) => {
        event.preventDefault();
      });
    });
  }

  function cacheDom() {
    dom.channelBar = document.getElementById('channel-bar');
    dom.noteGrid = document.getElementById('note-grid');
    dom.feedStatus = document.getElementById('feed-status');
    dom.searchInput = document.getElementById('search-input');
    dom.searchSubmit = document.getElementById('search-submit');
    dom.searchClear = document.getElementById('search-clear');
    dom.graphicFilter = document.getElementById('image-note-filter-el');
    dom.feedReload = document.getElementById('feed-reload');
    dom.modal = document.getElementById('note-modal');
    dom.noteClose = document.getElementById('note-close');
    dom.modalMedia = document.getElementById('modal-media');
    dom.modalAuthorAvatar = document.getElementById('modal-author-avatar');
    dom.modalAuthorName = document.getElementById('modal-author-name');
    dom.modalFollowBtn = document.getElementById('modal-follow-btn');
    dom.modalNoteTime = document.getElementById('modal-note-time');
    dom.modalTitle = document.getElementById('modal-title');
    dom.modalTags = document.getElementById('modal-tags');
    dom.modalDesc = document.getElementById('modal-desc');
    dom.modalCommentSummary = document.getElementById('modal-comment-summary');
    dom.commentList = document.getElementById('comment-list');
    dom.detailActions = document.getElementById('detail-actions');
    dom.quickCommentInput = document.getElementById('quick-comment-input');
    dom.quickCommentSend = document.getElementById('quick-comment-send');
  }

  function initialize() {
    loadPersistedState();
    state.notes = buildNotes();
    state.query = getSearchQueryFromUrl();

    cacheDom();
    dom.searchInput.value = state.query;
    renderChannels();
    renderFeed();
    bindEvents();

    tracker.track('bluebook_ready', {
      notesCount: state.notes.length,
      query: state.query,
    });
  }

  document.addEventListener('DOMContentLoaded', initialize);
})();
