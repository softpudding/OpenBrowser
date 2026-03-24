window.tracker = new AgentTracker('bluebook.life', 'hard');

(function () {
  const CHANNELS = ['For You', 'Style', 'Food', 'Beauty', 'Work', 'Wellness', 'Home', 'Gaming', 'Travel', 'Fitness'];
  const LEGACY_CHANNEL_MAP = {
    '推荐': 'For You',
    '穿搭': 'Style',
    '美食': 'Food',
    '彩妆': 'Beauty',
    '职场': 'Work',
    '情感': 'Wellness',
    '家居': 'Home',
    '游戏': 'Gaming',
    '旅行': 'Travel',
    '健身': 'Fitness',
  };

  const coverThemes = [
    ['linear-gradient(135deg, #13243d, #2b5b96)', '#d9ecff'],
    ['linear-gradient(135deg, #30210f, #aa6b2d)', '#fff4d9'],
    ['linear-gradient(135deg, #222136, #6e4cff)', '#e8e1ff'],
    ['linear-gradient(135deg, #0d2d2a, #14a38b)', '#d8fff5'],
    ['linear-gradient(135deg, #381824, #f0577c)', '#ffe3ea'],
    ['linear-gradient(135deg, #1d2330, #4b576d)', '#eef3fb'],
  ];

  const avatarThemes = ['#4f7cff', '#ff6b6b', '#7a5cff', '#0ca678', '#e8590c', '#9c36b5'];
  const detailLocations = ['Jingan, Shanghai', 'Chaoyang, Beijing', 'Binjiang, Hangzhou', 'Nanshan, Shenzhen', 'Jinjiang, Chengdu', 'Tianhe, Guangzhou', 'SIP, Suzhou'];
  const detailDevices = ['iPhone 15 Pro', 'iPhone 14 Pro', 'Fujifilm X-S20', 'Sony ZV-E10', 'Canon G7X3', 'DJI Pocket 3'];
  const detailMoods = ['This set came out better than expected', 'I keep coming back to this structure lately', 'I wanted to post this right away', 'This one feels worth saving for later'];
  const detailScenes = ['subway exit', 'office corner', 'weekend coffee shop', 'hotel window seat', 'sunset street corner', 'gallery entrance'];
  const detailTips = ['Lead with a strong first screen', 'Turn comment questions into page two', 'Keep comparison shots when possible', 'Do not over-explain the title'];

  const seedNotes = [
    {
      id: 'note-openclaw-config',
      title: 'Raise OpenClaw right: learn the config before you run it',
      author: 'Jesse / Natural Agent Lab',
      avatar: 'J',
      category: 'Work',
      type: 'video',
      coverLabel: 'Video · 4:21',
      coverHeadline: 'OpenClaw\ninstall first\nread config',
      excerpt: 'A lot of people install it and start right away, then get stuck on permissions, paths, and hook settings. Reading the config first makes the whole setup calmer.',
      tags: ['#openclaw', '#agents', '#config'],
      likedCount: 1346,
      collectCount: 3444,
      commentCount: 31,
      shareCount: 146,
      comments: [
        {
          id: 'comment-tutu-hook',
          author: 'TuTu',
          avatar: 'T',
          region: '03-08 Guangdong',
          text: 'Happy to see people seriously testing OpenClaw and comparing setups. If you run into issues, keep sharing details and we can make the workflow steadier together.',
          likes: 1,
          replies: [],
        },
        {
          id: 'comment-rm-rf',
          author: 'Night Patrol',
          avatar: 'N',
          region: '03-10 Zhejiang',
          text: 'Please do not blindly run rm -rf. Ask once before you regret it.',
          likes: 8,
          replies: [],
        },
        {
          id: 'comment-hook-enable',
          author: 'Shanghai Forwarder',
          avatar: 'S',
          region: '03-10 Shanghai',
          text: 'How do you enable hooks in this setup?',
          likes: 1,
          replies: [
            { author: 'Maintainer Notes', text: 'Check the skills and hooks folders first, then enable enableHooks in the config.' },
            { author: 'Midnight Commit', text: 'Use absolute paths or the loader may miss the files.' },
          ],
        },
        {
          id: 'comment-star-fire',
          author: 'Star Drifter',
          avatar: 'S',
          region: '03-09 Jiangsu',
          text: 'It is funny that this post is getting more heat than the repo stars.',
          likes: 1,
          replies: [],
        },
      ],
    },
    {
      id: 'note-arigato-ai',
      title: 'Arigato: this AI vision prompt template actually works',
      author: 'Prompt Margins',
      avatar: 'P',
      category: 'Work',
      type: 'image',
      coverLabel: 'Image post',
      coverHeadline: 'Arigato\nprompt stack\nthat ships',
      excerpt: 'Breaking a complex UI into structure, action, and constraint blocks is much steadier than asking a model to just click something for you.',
      tags: ['#prompt', '#arigato', '#browserautomation'],
      likedCount: 817,
      collectCount: 1522,
      commentCount: 18,
      shareCount: 73,
      comments: [
        {
          id: 'comment-template-1',
          author: 'Geek Shane',
          avatar: 'G',
          region: '03-07 Shanghai',
          text: 'This format works especially well for forms and long lists because the layers stay clear.',
          likes: 6,
          replies: [],
        },
        {
          id: 'comment-template-2',
          author: 'Night Voyager',
          avatar: 'N',
          region: '03-08 Shenzhen',
          text: 'It beats plain screenshot Q&A, especially when you need DOM context too.',
          likes: 4,
          replies: [],
        },
      ],
    },
    {
      id: 'note-git-worktree',
      title: 'When coding with AI, do not drop git worktree too early',
      author: 'Lutao',
      avatar: 'L',
      category: 'Work',
      type: 'image',
      coverLabel: 'Image post',
      coverHeadline: 'AI coding\nkeep your\nworktree',
      excerpt: 'When you compare patches or run multiple agents in parallel, worktree is the cleanest way to isolate context. Many problems are workspace problems, not model problems.',
      tags: ['#gitworktree', '#engineering'],
      likedCount: 265,
      collectCount: 905,
      commentCount: 12,
      shareCount: 22,
      comments: [
        {
          id: 'comment-worktree-1',
          author: 'Idle Dev',
          avatar: 'I',
          region: '03-09 Beijing',
          text: 'If two agents touch the same repo at once without worktrees, things get messy fast.',
          likes: 11,
          replies: [],
        },
      ],
    },
    {
      id: 'note-claude-im',
      title: 'Claude Code can plug into IM now, so what is still unique about OpenClaw?',
      author: 'Loach Jade',
      avatar: 'L',
      category: 'Work',
      type: 'image',
      coverLabel: 'Image post',
      coverHeadline: 'Claude Code\nhas IM now?\nOpenClaw then',
      excerpt: 'Once both tools can read screenshots and write code, the real difference goes back to execution flow, browser control, and engineering integration.',
      tags: ['#ClaudeCode', '#OpenClaw'],
      likedCount: 40,
      collectCount: 88,
      commentCount: 7,
      shareCount: 6,
      comments: [
        {
          id: 'comment-im-1',
          author: 'Passing By',
          avatar: 'P',
          region: '03-11 Hangzhou',
          text: 'Browser interaction and evaluation loops still feel pretty different.',
          likes: 3,
          replies: [],
        },
      ],
    },
    {
      id: 'note-monkey-durian',
      title: 'The monkey would rather keep the durian than let go',
      author: 'CCTV',
      avatar: 'C',
      category: 'Travel',
      type: 'video',
      coverLabel: 'Video · 0:42',
      coverHeadline: 'Monkey picks\ndurian pieces\nwith focus',
      excerpt: 'Animals in natural settings are endlessly watchable. I looped this clip more times than I should admit.',
      tags: ['#animals', '#travel'],
      likedCount: 8314,
      collectCount: 1201,
      commentCount: 52,
      shareCount: 219,
      comments: [],
    },
    {
      id: 'note-entrance-carry',
      title: 'Ten years for leaking? This drama reached the legal-code level',
      author: 'BridgeWire',
      avatar: 'B',
      category: 'Work',
      type: 'video',
      coverLabel: 'Video · 1:13',
      coverHeadline: 'The gossip\nreached the\nlaw books',
      excerpt: 'This one is half legal breakdown and half hot-topic debate. Most of the argument is about evidence and responsibility boundaries.',
      tags: ['#hottopic', '#compliance'],
      likedCount: 40,
      collectCount: 93,
      commentCount: 9,
      shareCount: 11,
      comments: [],
    },
    {
      id: 'note-cloudstack-skill',
      title: 'CloudStack is strong already, but these skills make it fly',
      author: 'Geek Shane',
      avatar: 'G',
      category: 'Home',
      type: 'image',
      coverLabel: 'Image post',
      coverHeadline: 'CloudStack\ngets better\nwith skills',
      excerpt: 'Breaking a complex workflow into reusable skills makes the behavior steadier and much easier to reproduce.',
      tags: ['#skills', '#CloudStack'],
      likedCount: 504,
      collectCount: 1312,
      commentCount: 21,
      shareCount: 44,
      comments: [],
    },
    {
      id: 'note-night-station',
      title: 'I just received a notice from the joint investigation team',
      author: 'Night Signal',
      avatar: 'N',
      category: 'Wellness',
      type: 'image',
      coverLabel: 'Image post',
      coverHeadline: 'Late night\ninvestigation\nnotice',
      excerpt: 'A moody city shot paired with a dramatic screenshot. Very headline-driven, very high engagement.',
      tags: ['#nightview', '#hottopic'],
      likedCount: 4817,
      collectCount: 404,
      commentCount: 13,
      shareCount: 81,
      comments: [],
    },
  ];

  const state = {
    activeChannel: 'For You',
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
    currentMediaIndex: 0,
    swipeStartX: null,
    swipeStartY: null,
    swipePointerId: null,
  };

  const dom = {};

  function clampNumber(value) {
    return Math.max(0, Number(value) || 0);
  }

  function normalizeChannel(channel) {
    if (!channel) {
      return 'For You';
    }

    const mapped = LEGACY_CHANNEL_MAP[channel] || channel;
    return CHANNELS.includes(mapped) ? mapped : 'For You';
  }

  function formatCount(value) {
    if (value >= 1000) {
      return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
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

  function hashString(value) {
    return Array.from(String(value)).reduce((hash, char) => hash + char.charCodeAt(0), 0);
  }

  function pickBySeed(items, seed, offset) {
    return items[(seed + offset) % items.length];
  }

  function escapeSvg(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function wrapText(value, maxCharsPerLine, maxLines) {
    const words = String(value).split(/\s+/).filter(Boolean);
    const lines = [];
    let current = '';

    words.forEach((word) => {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= maxCharsPerLine) {
        current = candidate;
        return;
      }

      if (current) {
        lines.push(current);
      }
      current = word;
    });

    if (current) {
      lines.push(current);
    }

    if (lines.length <= maxLines) {
      return lines;
    }

    const trimmed = lines.slice(0, maxLines);
    trimmed[maxLines - 1] = `${trimmed[maxLines - 1].slice(0, Math.max(0, maxCharsPerLine - 1))}…`;
    return trimmed;
  }

  function truncateText(value, maxChars) {
    const normalized = String(value).trim();
    if (normalized.length <= maxChars) {
      return normalized;
    }
    return `${normalized.slice(0, Math.max(0, maxChars - 1))}…`;
  }

  function buildSvgTextLines(lines, x, y, lineHeight, className) {
    return lines.map((line, index) => (
      `<text x="${x}" y="${y + index * lineHeight}" class="${className}">${escapeSvg(line)}</text>`
    )).join('');
  }

  function createSlideImageDataUrl(note, detailView, slide, index) {
    const headlineLines = wrapText(slide.headline, 18, 3);
    const titleLines = wrapText(slide.bodyTitle, 26, 1);
    const copyLines = wrapText(slide.bodyCopy, 34, 2);
    const bullets = slide.bullets.slice(0, 2);
    const authorChipLabel = truncateText(note.author, 20);
    const stickerLabels = slide.stickers.slice(0, 3).map((sticker) =>
      truncateText(sticker.replace(/^#/, '#'), 12),
    );
    const stickerMarkup = stickerLabels.map((sticker, stickerIndex) => `
      <g transform="translate(${60 + stickerIndex * 184}, 712)">
        <rect width="128" height="38" rx="18" fill="rgba(255,255,255,0.18)" />
        <text x="64" y="24" text-anchor="middle" class="sticker">${escapeSvg(sticker)}</text>
      </g>
    `).join('');
    const bulletMarkup = bullets.map((bullet, bulletIndex) => {
      const lines = wrapText(bullet, 40, 2);
      return `
        <circle cx="90" cy="${1036 + bulletIndex * 84}" r="6" fill="#ff5c7c" />
        ${buildSvgTextLines(lines, 112, 1044 + bulletIndex * 84, 24, 'bullet')}
      `;
    }).join('');

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="900" height="1440" viewBox="0 0 900 1440">
        <defs>
          <linearGradient id="bg${index}" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="${escapeSvg(note.coverColor)}" stop-opacity="0.22" />
            <stop offset="100%" stop-color="#101725" stop-opacity="0.04" />
          </linearGradient>
          <filter id="shadow${index}" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="28" stdDeviation="28" flood-color="rgba(14,18,28,0.28)" />
          </filter>
        </defs>
        <rect width="900" height="1440" rx="58" fill="#f8fbff" />
        <rect x="34" y="34" width="832" height="1372" rx="52" fill="${escapeSvg(note.gradient)}" />
        <rect x="34" y="34" width="832" height="1372" rx="52" fill="url(#bg${index})" />
        <g transform="translate(62 60)">
          <rect width="182" height="56" rx="28" fill="rgba(255,255,255,0.18)" />
          <circle cx="34" cy="28" r="16" fill="rgba(255,255,255,0.22)" />
          <text x="34" y="34" text-anchor="middle" class="avatar">${escapeSvg(note.avatar)}</text>
          <text x="64" y="34" class="chip">${escapeSvg(authorChipLabel)}</text>
        </g>
        <g transform="translate(666 60)">
          <rect width="168" height="56" rx="28" fill="rgba(255,255,255,0.18)" />
          <text x="84" y="34" text-anchor="middle" class="chip">${escapeSvg(slide.pageLabel)}</text>
        </g>
        <rect x="56" y="150" width="788" height="620" rx="40" fill="rgba(255,255,255,0.14)" />
        <g transform="translate(74 188)">
          <rect width="190" height="48" rx="24" fill="rgba(12,18,29,0.18)" />
          <text x="95" y="30" text-anchor="middle" class="eyebrow">${escapeSvg(slide.eyebrow)}</text>
        </g>
        ${buildSvgTextLines(headlineLines, 74, 314, 68, 'headline')}
        ${stickerMarkup}
        <g filter="url(#shadow${index})">
          <rect x="56" y="806" width="788" height="540" rx="44" fill="rgba(255,255,255,0.92)" />
        </g>
        ${buildSvgTextLines(titleLines, 86, 888, 40, 'bodyTitle')}
        ${buildSvgTextLines(copyLines, 86, 958, 28, 'bodyCopy')}
        ${bulletMarkup}
        <text x="86" y="1298" class="meta">${escapeSvg(detailView.location)} · ${escapeSvg(detailView.publishTime)}</text>
        <text x="814" y="1298" text-anchor="end" class="meta">♡ ${escapeSvg(formatCount(clampNumber(note.likedCount) + (state.likedNotes[note.id] ? 1 : 0)))}   ☆ ${escapeSvg(formatCount(clampNumber(note.collectCount) + (state.collectedNotes[note.id] ? 1 : 0)))}</text>
        <style>
          .avatar { fill: #ffffff; font: 700 16px 'Arial'; }
          .chip { fill: #ffffff; font: 600 17px 'Arial'; }
          .eyebrow { fill: #ffffff; font: 700 18px 'Arial'; letter-spacing: 0.08em; }
          .headline { fill: #ffffff; font: 800 54px 'Arial'; letter-spacing: -0.03em; }
          .sticker { fill: #ffffff; font: 600 14px 'Arial'; }
          .bodyTitle { fill: #1f2430; font: 800 28px 'Arial'; }
          .bodyCopy { fill: #475165; font: 400 22px 'Arial'; }
          .bullet { fill: #334155; font: 400 20px 'Arial'; }
          .meta { fill: #5d6777; font: 500 18px 'Arial'; }
        </style>
      </svg>
    `;

    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }

  function buildNoteDetailView(note) {
    const seed = hashString(note.id);
    const location = pickBySeed(detailLocations, seed, 1);
    const device = pickBySeed(detailDevices, seed, 3);
    const mood = pickBySeed(detailMoods, seed, 5);
    const scene = pickBySeed(detailScenes, seed, 7);
    const publishMonth = String((seed % 3) + 1).padStart(2, '0');
    const publishDay = String((seed % 19) + 8).padStart(2, '0');
    const publishTime = `${publishMonth}-${publishDay}`;
    const mediaSlides = Array.from({ length: note.type === 'video' ? 2 : 3 }, (_, index) => ({
      id: `${note.id}-slide-${index + 1}`,
      pageLabel: `Page ${index + 1}`,
      eyebrow: index === 0 ? note.category : index === 1 ? 'Close look' : 'Comment takeaways',
      headline:
        index === 0
          ? note.coverHeadline.replace(/\n/g, ' · ')
          : index === 1
            ? `These are the details I zoomed in on from the ${scene}`
            : 'The most repeated comment questions, cleaned up on one page',
      bodyTitle:
        index === 0
          ? `${note.title} cover breakdown`
          : index === 1
            ? 'If I only had one extra page, I would keep these details'
            : 'A short checklist worth saving',
      bodyCopy:
        index === 0
          ? `${mood}. I like putting the strongest idea on the first screen, then using later pages to add detail and context.`
          : index === 1
            ? `Like a real lifestyle carousel, this page should feel worth pausing on. The title, tags, and scene notes all need to work together.`
            : `For searchable content, the last page should end with a clean takeaway so people keep scrolling and then read the comments.`,
      stickers: [note.tags[index % note.tags.length], `@${note.author}`, pickBySeed(detailTips, seed, index)],
      bullets:
        index === 0
          ? [
              `Lead with the conclusion: ${note.excerpt}`,
              `The scene is ${scene}, so it feels like a real post instead of a banner.`,
              `Keep a strong hook on the ${note.type === 'video' ? 'video cover' : 'first image'}.`,
            ]
          : index === 1
            ? [
              'The left panel can be dense, but the reading rhythm should still feel loose.',
              'Zoomed details, sticker tags, and summary copy should appear in layers.',
              `A light device note like ${device} is enough.`,
            ]
          : [
              'Do not cram everything into the title. Leave room for the comment section to carry follow-up questions.',
              'High-like comments usually ask how or why, so answer that directly.',
              'Save-worthy posts often end best with a short checklist.',
            ],
    }));

    if (note.id === 'note-openclaw-config' && mediaSlides[1]) {
      mediaSlides[1].eyebrow = 'Recommended skills';
      mediaSlides[1].headline = 'Recommended OpenClaw skill: open-browser';
      mediaSlides[1].bodyTitle = 'Skill stack shown in the post images';
      mediaSlides[1].bodyCopy = 'If you only remember one thing from the image set, remember the recommended skill callout: open-browser.';
      mediaSlides[1].stickers = ['#open-browser', '#skill', '#browser'];
      mediaSlides[1].bullets = [
        'Recommended OpenClaw skill: open-browser.',
        'This page explicitly points people to the browser skill for rendered-page workflows.',
        'If you leave a comment after reading the images, mention which skill you saw here.',
      ];
    }

    const storyBlocks = [
      {
        label: 'Note body',
        copy: `${mood}. I split the ${note.category} topic into three layers: the hook on page one, the information layer in the middle, and the comment handoff at the end. Once the post is open, the left side should feel like browsing a carousel while the right side still reads like a real note.`,
      },
      {
        label: 'What to check after opening',
        items: [
          `Start with the main visual and sticker stack on the ${scene} page.`,
          `A small device or location note such as ${device} / ${location} makes the post feel more real.`,
          'Keep a high-like comment plus reply structure so interaction tasks still feel natural.',
        ],
      },
    ];

    return {
      location,
      device,
      mood,
      publishTime,
      mediaSlides,
      storyBlocks,
    };
  }

  function createGeneratedNotes() {
    const topics = [
      { title: 'Browser automation', tags: ['#browser', '#automation', '#workflow'], category: 'Work' },
      { title: 'Vibe coding', tags: ['#aicoding', '#engineering'], category: 'Work' },
      { title: 'Kitchen makeover', tags: ['#home', '#storage'], category: 'Home' },
      { title: 'Travel backpack', tags: ['#travel', '#gear'], category: 'Travel' },
      { title: 'Fitness meals', tags: ['#fitness', '#food'], category: 'Fitness' },
      { title: 'Photo retouching', tags: ['#imagepost', '#editing'], category: 'Beauty' },
      { title: 'Mood reset', tags: ['#wellness', '#selfcare'], category: 'Wellness' },
      { title: 'Living-room palette', tags: ['#home', '#ambience'], category: 'Home' },
      { title: 'Code review', tags: ['#engineering', '#review'], category: 'Work' },
    ];
    const authors = ['Early Bird', 'Soft Pudding', 'Boar Rider Dev', 'Northbound', 'Blue Mood', 'Still Moving', 'Cloud Hamster', 'Late Wind', 'Watermelon Pop'];
    const notes = [];

    for (let i = 0; i < 64; i += 1) {
      const topic = topics[i % topics.length];
      const author = authors[i % authors.length];
      const isVideo = i % 5 === 0;
      notes.push({
        id: `note-generated-${i + 1}`,
        title: `${topic.title}: field note ${i + 1}`,
        author,
        avatar: author.slice(0, 1),
        category: topic.category,
        type: isVideo ? 'video' : 'image',
        coverLabel: isVideo ? `Video · 0:${String((i % 49) + 10).padStart(2, '0')}` : 'Image post',
        coverHeadline: `${topic.title}\nNote ${i + 1}`,
        excerpt: `A daily observation about ${topic.title}, sample ${i + 1}. The feed intentionally keeps mixed title lengths, interaction counts, and media styles.`,
        tags: topic.tags,
        likedCount: 80 + i * 37,
        collectCount: 20 + i * 19,
        commentCount: 3 + (i % 17),
        shareCount: 1 + (i % 9),
        comments: [
          {
            id: `generated-comment-${i + 1}-1`,
            author: `${author} Local`,
            avatar: author.slice(0, 1),
            region: `03-${String((i % 20) + 1).padStart(2, '0')} Shanghai`,
            text: `First comment for note ${i + 1}, mainly here to make the list feel realistic.`,
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

  function keepNoteAwayFromTop(notes, noteId, minIndex) {
    const noteIndex = notes.findIndex((note) => note.id === noteId);
    if (noteIndex === -1 || noteIndex >= minIndex) {
      return notes;
    }

    const [targetNote] = notes.splice(noteIndex, 1);
    const insertIndex = Math.min(Math.max(minIndex, 0), notes.length);
    notes.splice(insertIndex, 0, targetNote);
    return notes;
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
      if (state.activeChannel !== 'For You' && note.category !== state.activeChannel) {
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

    const queryPart = state.query ? `"${state.query}"` : 'all posts';
    const graphicPart = state.graphicOnly ? ', images only enabled' : '';
    dom.feedStatus.textContent = `Showing ${state.filteredNotes.length} posts. Filter: ${queryPart}${graphicPart}`;
    dom.graphicFilter.classList.toggle('active', state.graphicOnly);

    if (state.filteredNotes.length === 0) {
      dom.noteGrid.innerHTML = `
        <div class="empty-state">
          <h3>No matching posts found</h3>
          <p>Try a shorter keyword, or hit Refresh on the right to load a new mix.</p>
        </div>
      `;
      return;
    }

    dom.noteGrid.innerHTML = state.filteredNotes.map((note) => `
      <article class="note-card" data-note-id="${note.id}">
        <button
          class="note-card-open"
          type="button"
          data-note-id="${note.id}"
          data-action="open-note"
          aria-label="Open ${escapeHtml(note.title)}"
        >
          ${createCoverMarkup(note)}
          <div class="note-body">
            <h2 class="note-title">${escapeHtml(note.title)}</h2>
          </div>
        </button>
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
      </article>
    `).join('');
  }

  function renderModalMedia(note, detailView) {
    const totalSlides = detailView.mediaSlides.length;
    const activeIndex = Math.max(0, Math.min(state.currentMediaIndex, totalSlides - 1));
    const activeSlide = detailView.mediaSlides[activeIndex];

    dom.modalMedia.innerHTML = `
      <div
        class="media-swiper swiper"
        data-note-id="${note.id}"
        data-swiper="bluebook"
        data-carousel="note-images"
        role="region"
        aria-roledescription="carousel"
        aria-label="Note images"
      >
        <button
          class="media-nav prev swiper-button-prev"
          data-media-nav="prev"
          aria-label="Previous image"
        >‹</button>
        <div class="media-viewport swiper-viewport">
          <div class="media-track swiper-wrapper" style="transform: translateX(-${activeIndex * 100}%);">
            ${detailView.mediaSlides.map((slide, index) => `
              <article
                class="media-slide swiper-slide ${index === activeIndex ? 'swiper-slide-active active' : ''}"
                data-slide-index="${index}"
                aria-current="${index === activeIndex ? 'true' : 'false'}"
              >
                <div class="media-frame">
                  <img
                    class="media-image"
                    src="${createSlideImageDataUrl(note, detailView, slide, index)}"
                    alt="${escapeHtml(slide.bodyTitle)}"
                    draggable="false"
                  >
                  ${note.type === 'video' && index === 0 ? '<div class="media-play">▶</div>' : ''}
                </div>
              </article>
            `).join('')}
          </div>
        </div>
        <button
          class="media-nav next swiper-button-next"
          data-media-nav="next"
          aria-label="Next image"
        >›</button>
        <div class="media-progress">
          <div class="media-dots">
            ${detailView.mediaSlides.map((slide, index) => `
              <button
                class="media-dot ${index === activeIndex ? 'active' : ''}"
                data-media-dot="${index}"
                aria-label="Open ${escapeHtml(slide.pageLabel)}"
              ></button>
            `).join('')}
          </div>
          <div class="media-counter fraction swiper-pagination-fraction">${activeIndex + 1} / ${totalSlides}</div>
        </div>
      </div>
    `;

    tracker.track('note_media_render', {
      noteId: note.id,
      slideIndex: activeIndex,
      slideCount: totalSlides,
      slideTitle: activeSlide.bodyTitle,
    });
  }

  function renderDetailStory(detailView) {
    dom.modalStory.innerHTML = detailView.storyBlocks.map((block) => `
      <div class="detail-story-block">
        <div class="detail-story-label">${escapeHtml(block.label)}</div>
        ${block.copy ? `<div class="detail-story-copy">${escapeHtml(block.copy)}</div>` : ''}
        ${block.items ? `
          <div class="detail-story-list">
            ${block.items.map((item) => `<div class="detail-story-item">${escapeHtml(item)}</div>`).join('')}
          </div>
        ` : ''}
      </div>
    `).join('');
  }

  function setMediaIndex(note, nextIndex, source) {
    const detailView = buildNoteDetailView(note);
    const totalSlides = detailView.mediaSlides.length;
    const normalizedIndex = (nextIndex + totalSlides) % totalSlides;
    if (normalizedIndex === state.currentMediaIndex && source !== 'open') {
      return;
    }

    state.currentMediaIndex = normalizedIndex;
    renderModalMedia(note, detailView);

    if (source && source !== 'open') {
      tracker.track('note_media_swipe', {
        noteId: note.id,
        source,
        slideIndex: normalizedIndex,
      });
    }
  }

  function beginSwipe(clientX, clientY, pointerId) {
    state.swipeStartX = clientX;
    state.swipeStartY = clientY;
    state.swipePointerId = pointerId ?? null;
  }

  function resetSwipe() {
    state.swipeStartX = null;
    state.swipeStartY = null;
    state.swipePointerId = null;
  }

  function finishSwipe(note, clientX, clientY, source) {
    if (!note || state.swipeStartX === null || state.swipeStartY === null) {
      resetSwipe();
      return;
    }

    const deltaX = clientX - state.swipeStartX;
    const deltaY = clientY - state.swipeStartY;
    resetSwipe();

    if (Math.abs(deltaX) < 48) {
      return;
    }

    if (Math.abs(deltaY) > Math.abs(deltaX) * 0.75) {
      return;
    }

    setMediaIndex(note, state.currentMediaIndex + (deltaX < 0 ? 1 : -1), source);
  }

  function openNote(noteId, source, focusComments) {
    const note = state.notes.find((item) => item.id === noteId);
    if (!note) {
      return;
    }

    const detailView = buildNoteDetailView(note);

    state.currentNoteId = noteId;
    state.currentMediaIndex = 0;
    dom.modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    renderModalMedia(note, detailView);

    dom.modalAuthorAvatar.textContent = note.avatar;
    dom.modalAuthorAvatar.style.background = note.avatarColor;
    dom.modalAuthorName.textContent = note.author;
    dom.modalNoteTime.textContent = `${detailView.publishTime} · ${note.type === 'video' ? 'video note' : 'image note'}`;
    dom.modalFollowBtn.textContent = state.followedAuthors[note.author] ? 'Following' : 'Follow';
    dom.modalTitle.textContent = note.title;
    dom.modalNoteLocation.textContent = detailView.location;
    dom.modalNoteDevice.textContent = detailView.device;
    dom.modalDesc.textContent = note.excerpt;
    dom.modalTags.innerHTML = note.tags.map((tag) => `<span class="detail-tag">${escapeHtml(tag)}</span>`).join('');
    renderDetailStory(detailView);
    dom.modalCommentSummary.textContent = `${note.commentCount} comments`;

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
    state.currentMediaIndex = 0;
    resetSwipe();
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
              <button class="reply-btn" data-action="comment-reply" data-comment-id="${comment.id}">Reply</button>
              ${comment.replies && comment.replies.length > 0 ? `<button class="show-replies-btn" data-action="toggle-replies" data-comment-id="${comment.id}">${repliesOpen ? 'Hide replies' : `Show ${comment.replies.length} replies`}</button>` : ''}
            </div>
            ${replyOpen ? `
              <div class="reply-editor">
                <input class="reply-input" data-reply-input="${comment.id}" placeholder="Reply to ${escapeHtml(comment.author)}...">
                <button class="reply-submit" data-action="submit-reply" data-comment-id="${comment.id}">Reply</button>
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

    keepNoteAwayFromTop(state.notes, 'note-openclaw-config', 18);
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
      author: 'BlueBook User',
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
      author: 'BlueBook User',
      avatar: 'B',
      region: 'Just now',
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

      state.activeChannel = normalizeChannel(target.dataset.channel);
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

        if (action === 'open-note') {
          openNote(noteId, 'feed_card', false);
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

    dom.modalMedia.addEventListener('click', (event) => {
      const note = getCurrentNote();
      if (!note) {
        return;
      }

      const navButton = event.target.closest('[data-media-nav]');
      if (navButton) {
        const direction = navButton.dataset.mediaNav === 'next' ? 1 : -1;
        setMediaIndex(note, state.currentMediaIndex + direction, navButton.dataset.mediaNav);
        return;
      }

      const dotButton = event.target.closest('[data-media-dot]');
      if (dotButton) {
        setMediaIndex(note, Number(dotButton.dataset.mediaDot), 'dot');
      }
    });

    dom.modalMedia.addEventListener('pointerdown', (event) => {
      const viewport = event.target.closest('.media-viewport');
      if (!viewport || event.button > 0) {
        return;
      }

      beginSwipe(event.clientX, event.clientY, event.pointerId);
      if (typeof viewport.setPointerCapture === 'function') {
        viewport.setPointerCapture(event.pointerId);
      }
    });

    dom.modalMedia.addEventListener('pointerup', (event) => {
      const note = getCurrentNote();
      if (state.swipePointerId !== null && event.pointerId !== state.swipePointerId) {
        return;
      }

      finishSwipe(note, event.clientX, event.clientY, 'swipe');
    });

    dom.modalMedia.addEventListener('pointercancel', () => {
      resetSwipe();
    });

    dom.modalMedia.addEventListener('touchstart', (event) => {
      const viewport = event.target.closest('.media-viewport');
      const touch = event.changedTouches[0];
      if (!viewport || !touch) {
        return;
      }

      beginSwipe(touch.clientX, touch.clientY, null);
    }, { passive: true });

    dom.modalMedia.addEventListener('touchend', (event) => {
      const note = getCurrentNote();
      const touch = event.changedTouches[0];
      if (!touch) {
        resetSwipe();
        return;
      }

      finishSwipe(note, touch.clientX, touch.clientY, 'swipe');
    });

    dom.noteClose.addEventListener('click', closeNote);

    dom.modalFollowBtn.addEventListener('click', () => {
      const note = getCurrentNote();
      if (!note) {
        return;
      }

      const followed = !state.followedAuthors[note.author];
      state.followedAuthors[note.author] = followed;
      dom.modalFollowBtn.textContent = followed ? 'Following' : 'Follow';

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
    dom.modalNoteLocation = document.getElementById('modal-note-location');
    dom.modalNoteDevice = document.getElementById('modal-note-device');
    dom.modalTags = document.getElementById('modal-tags');
    dom.modalDesc = document.getElementById('modal-desc');
    dom.modalStory = document.getElementById('modal-story');
    dom.modalCommentSummary = document.getElementById('modal-comment-summary');
    dom.commentList = document.getElementById('comment-list');
    dom.detailActions = document.getElementById('detail-actions');
    dom.quickCommentInput = document.getElementById('quick-comment-input');
    dom.quickCommentSend = document.getElementById('quick-comment-send');
  }

  function initialize() {
    state.notes = buildNotes();
    keepNoteAwayFromTop(state.notes, 'note-openclaw-config', 18);
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
