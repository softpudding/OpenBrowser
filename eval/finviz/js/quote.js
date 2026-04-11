// Finviz mock quote page

document.addEventListener('DOMContentLoaded', function() {
    initializeQuotePage();
});

function initializeQuotePage() {
    updateQuoteDatetime();
    setupQuoteThemeToggle();

    if (typeof AgentTracker === 'function') {
        window.tracker = new AgentTracker('finviz', 'hard');
    }

    const ticker = new URLSearchParams(window.location.search).get('t');
    const stocks = Array.isArray(window.FINVIZ_STOCKS_DATA) ? window.FINVIZ_STOCKS_DATA : [];
    const stock = stocks.find(item => String(item.ticker).toUpperCase() === String(ticker || '').toUpperCase());

    if (!stock) {
        renderMissingQuote(ticker);
        return;
    }

    renderQuotePage(stock);

    if (window.tracker) {
        window.tracker.track('quote_view', {
            ticker: stock.ticker,
            company: stock.company,
            sector: stock.sector,
        });
    }
}

function setupQuoteThemeToggle() {
    const toggle = document.getElementById('themeToggle');
    if (!toggle) {
        return;
    }

    toggle.addEventListener('click', function() {
        document.body.classList.toggle('light-theme');
        document.body.classList.toggle('dark-theme');
    });
}

function updateQuoteDatetime() {
    const target = document.getElementById('headerDatetime');
    if (!target) {
        return;
    }

    const now = new Date();
    const options = {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    };
    target.textContent = `${now.toLocaleDateString('en-US', options)} ET`;
}

function renderMissingQuote(ticker) {
    const main = document.querySelector('.quote-main');
    if (!main) {
        return;
    }

    document.title = 'Ticker Not Found - Finviz Quote';
    main.innerHTML = `
        <section class="quote-empty">
            <div>
                <h1>Unknown Ticker</h1>
                <p>No mock Finviz record was found for ${escapeHtml(ticker || 'that symbol')}.</p>
                <p><a href="/finviz/" class="quote-back-link">Return to the screener</a></p>
            </div>
        </section>
    `;
}

function renderQuotePage(stock) {
    document.title = `${stock.ticker} Quote - Finviz`;
    setText('breadcrumbTicker', stock.ticker);
    setText('quoteTicker', stock.ticker);
    setText('quoteCompany', stock.company);
    setText('quotePrice', formatMoney(stock.price));
    setText('quoteVolume', formatCompactVolume(stock.volume));
    setText('quoteMarketCap', formatCompactMarketCap(stock.marketCap));
    setText('quoteTarget', `${formatMoney(stock.targetPrice)} (${formatSignedPercent(stock.targetGapPct)})`);

    const changeNode = document.getElementById('quoteChange');
    if (changeNode) {
        changeNode.textContent = formatSignedPercent(stock.change);
        changeNode.classList.toggle('positive', Number(stock.change) >= 0);
        changeNode.classList.toggle('negative', Number(stock.change) < 0);
    }

    const summary = `${stock.company} is a ${titleize(stock.sector)} name in ${stock.industry}. `
        + `This mock quote page synthesizes a plausible price chart and market narrative for automation testing.`;
    setText('quoteSummary', summary);

    renderTags(stock);
    renderKeyStats(stock);
    renderFilterFields(stock);
    renderNarrative(stock);
    renderHeadlines(stock);
    renderChart(stock);
}

function renderTags(stock) {
    const container = document.getElementById('quoteTags');
    if (!container) {
        return;
    }

    const tags = [
        stock.exchange ? stock.exchange.toUpperCase() : null,
        stock.index ? normalizeIndexLabel(stock.index) : 'No Index',
        stock.country ? titleize(stock.country) : null,
        ...(Array.isArray(stock.themes) ? stock.themes.map(theme => theme.toUpperCase()) : []),
    ].filter(Boolean);

    container.innerHTML = tags.map(tag => `<span class="quote-tag">${escapeHtml(tag)}</span>`).join('');
}

function renderKeyStats(stock) {
    const stats = [
        ['P/E', formatNumber(stock.pe, 1)],
        ['Forward P/E', formatNumber(stock.forwardPe, 1)],
        ['PEG', formatNumber(stock.peg, 2)],
        ['Dividend Yield', formatSignedPercent(stock.dividendYield, false)],
        ['RSI', formatNumber(stock.rsi, 1)],
        ['Relative Volume', formatNumber(stock.relVolume, 2)],
        ['Avg Volume', formatCompactVolume(stock.avgVolume)],
        ['Short Float', formatSignedPercent(stock.shortFloat, false)],
        ['Analyst Recom', formatNumber(stock.analystRecom, 1)],
        ['Beta', formatNumber(stock.beta, 2)],
        ['Volatility', formatSignedPercent(stock.volatility, false)],
        ['52W Range', `${formatMoney(stock.low52w)} - ${formatMoney(stock.high52w)}`],
    ];

    const container = document.getElementById('keyStats');
    if (!container) {
        return;
    }

    container.innerHTML = stats
        .map(([label, value]) => `
            <div class="quote-stat">
                <div class="quote-stat-label">${escapeHtml(label)}</div>
                <div class="quote-stat-value">${escapeHtml(value)}</div>
            </div>
        `)
        .join('');
}

function renderFilterFields(stock) {
    const container = document.getElementById('quoteFilterFields');
    if (!container) {
        return;
    }

    const fields = [
        ['Exchange', stock.exchange ? stock.exchange.toUpperCase() : 'N/A'],
        ['Index', stock.index ? normalizeIndexLabel(stock.index) : 'None'],
        ['Sector', titleize(stock.sector)],
        ['Industry', stock.industry],
        ['Country', titleize(stock.country)],
        ['Market Cap', formatCompactMarketCap(stock.marketCap)],
        ['Price', formatMoney(stock.price)],
        ['Change', formatSignedPercent(stock.change)],
        ['P/E', formatNumber(stock.pe, 1)],
        ['Forward P/E', formatNumber(stock.forwardPe, 1)],
        ['Avg Volume', formatCompactVolume(stock.avgVolume)],
        ['Relative Volume', formatNumber(stock.relVolume, 2)],
        ['Perf Week', formatSignedPercent(stock.perf1w)],
        ['Perf Month', formatSignedPercent(stock.perf4w)],
        ['Dividend Yield', formatSignedPercent(stock.dividendYield, false)],
        ['Short Float', formatSignedPercent(stock.shortFloat, false)],
        ['Analyst Recom', formatNumber(stock.analystRecom, 1)],
        ['Beta', formatNumber(stock.beta, 2)],
        ['Volatility', formatSignedPercent(stock.volatility, false)],
        ['Themes', formatTagList(stock.themes)],
        ['Sub-themes', formatTagList(stock.subthemes)],
        ['ETF', stock.isEtf ? 'Yes' : 'No'],
    ];

    container.innerHTML = fields
        .map(([label, value]) => `
            <div class="quote-dataset-item">
                <div class="quote-dataset-label">${escapeHtml(label)}</div>
                <div class="quote-dataset-value">${escapeHtml(value)}</div>
            </div>
        `)
        .join('');
}

function renderNarrative(stock) {
    const container = document.getElementById('quoteNarrative');
    if (!container) {
        return;
    }

    const marketTone = Number(stock.perf4w) >= 0 ? 'outperforming' : 'lagging';
    const demandTone = Number(stock.relVolume) > 1 ? 'active' : 'muted';
    const riskTone = Number(stock.beta) > 1.5 || Number(stock.volatility) > 5 ? 'elevated' : 'moderate';

    const paragraphs = [
        `${stock.ticker} has been ${marketTone} over the last month, with a synthetic ${formatSignedPercent(stock.perf4w)} move that lines up with ${stock.industry.toLowerCase()} sentiment in this mock dataset.`,
        `Order flow looks ${demandTone}: current turnover is ${formatCompactVolume(stock.volume)} against an average of ${formatCompactVolume(stock.avgVolume)}, while RSI sits at ${formatNumber(stock.rsi, 1)}.`,
        `Risk remains ${riskTone}. The model assigns beta at ${formatNumber(stock.beta, 2)}, volatility at ${formatSignedPercent(stock.volatility, false)}, and a target-price spread of ${formatSignedPercent(stock.targetGapPct)} versus the latest print.`,
    ];

    container.innerHTML = paragraphs.map(text => `<p>${escapeHtml(text)}</p>`).join('');
}

function renderHeadlines(stock) {
    const container = document.getElementById('quoteHeadlines');
    if (!container) {
        return;
    }

    const rng = createSeededRng(`${stock.ticker}-headlines`);
    const timeBuckets = ['8 min ago', '31 min ago', '1 hr ago', '4 hr ago'];
    const verbs = ['extends', 'tests', 'reverses', 'holds', 'reclaims'];
    const focuses = [
        'month-to-date momentum',
        'relative-volume spike',
        '52-week range breakout',
        'target-price debate',
        'sector rotation bid',
    ];

    const headlines = timeBuckets.map((time, index) => {
        const verb = verbs[Math.floor(rng() * verbs.length)];
        const focus = focuses[Math.floor(rng() * focuses.length)];
        return {
            time,
            title: `${stock.ticker} ${verb} ${focus} as ${stock.industry.toLowerCase()} peers reset positioning`,
            href: '#',
            index,
        };
    });

    container.innerHTML = headlines
        .map(item => `
            <div class="quote-headline">
                <div class="quote-headline-time">${escapeHtml(item.time)}</div>
                <div class="quote-headline-title">${escapeHtml(item.title)}</div>
            </div>
        `)
        .join('');
}

function renderChart(stock) {
    const chart = document.getElementById('quoteChart');
    if (!chart) {
        return;
    }

    const width = 760;
    const height = 340;
    const padding = { top: 28, right: 18, bottom: 38, left: 18 };
    const values = generateSeries(stock, 56);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(1, max - min);
    const usableWidth = width - padding.left - padding.right;
    const usableHeight = height - padding.top - padding.bottom;

    const points = values.map((value, index) => {
        const x = padding.left + (usableWidth * index) / (values.length - 1);
        const y = padding.top + usableHeight - ((value - min) / span) * usableHeight;
        return { x, y, value };
    });

    const linePath = points
        .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
        .join(' ');

    const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(2)} ${(height - padding.bottom).toFixed(2)}`
        + ` L ${points[0].x.toFixed(2)} ${(height - padding.bottom).toFixed(2)} Z`;

    const bars = points
        .filter((_, index) => index % 2 === 0)
        .map((point, index) => {
            const magnitude = 12 + Math.abs(Math.sin(index * 0.7)) * 42;
            const y = height - padding.bottom - magnitude;
            return `<rect x="${(point.x - 3).toFixed(2)}" y="${y.toFixed(2)}" width="6" height="${magnitude.toFixed(2)}" rx="2" fill="rgba(90,159,212,0.20)" />`;
        })
        .join('');

    const last = points[points.length - 1];
    const fillColor = Number(stock.change) >= 0 ? 'rgba(0,166,81,0.16)' : 'rgba(255,51,0,0.16)';
    const lineColor = Number(stock.change) >= 0 ? '#00a651' : '#ff3300';

    chart.innerHTML = `
        <defs>
            <linearGradient id="quoteGradient" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stop-color="${fillColor}" stop-opacity="0.9"></stop>
                <stop offset="100%" stop-color="${fillColor}" stop-opacity="0"></stop>
            </linearGradient>
        </defs>
        <g opacity="0.45">
            ${buildHorizontalGuides(width, height, padding)}
        </g>
        <g opacity="0.85">${bars}</g>
        <path d="${areaPath}" fill="url(#quoteGradient)"></path>
        <path d="${linePath}" fill="none" stroke="${lineColor}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>
        <circle cx="${last.x.toFixed(2)}" cy="${last.y.toFixed(2)}" r="5.5" fill="${lineColor}" stroke="#ffffff" stroke-width="2"></circle>
        <text x="${(last.x - 10).toFixed(2)}" y="${(last.y - 12).toFixed(2)}" fill="${lineColor}" font-size="12" font-weight="700" text-anchor="end">${escapeHtml(formatMoney(last.value))}</text>
        <text x="${padding.left}" y="${height - 12}" fill="currentColor" font-size="11" opacity="0.65">Jan</text>
        <text x="${(width / 2).toFixed(2)}" y="${height - 12}" fill="currentColor" font-size="11" opacity="0.65" text-anchor="middle">Mid-cycle</text>
        <text x="${(width - padding.right).toFixed(2)}" y="${height - 12}" fill="currentColor" font-size="11" opacity="0.65" text-anchor="end">Now</text>
    `;
}

function buildHorizontalGuides(width, height, padding) {
    const guides = [];
    const guideCount = 4;
    for (let index = 0; index <= guideCount; index += 1) {
        const y = padding.top + ((height - padding.top - padding.bottom) * index) / guideCount;
        guides.push(`<line x1="${padding.left}" y1="${y.toFixed(2)}" x2="${width - padding.right}" y2="${y.toFixed(2)}" stroke="rgba(255,255,255,0.08)" stroke-width="1" />`);
    }
    return guides.join('');
}

function generateSeries(stock, count) {
    const rng = createSeededRng(`${stock.ticker}-${stock.price}-${stock.perf4w}`);
    const basePrice = Number(stock.price);
    const monthlyTrend = Number(stock.perf4w) / 100;
    const weeklyTrend = Number(stock.perf1w) / 100;
    const amplitude = Math.max(0.025, Number(stock.volatility) / 100);
    const values = [];
    let current = Math.max(0.4, basePrice * (1 - monthlyTrend * 0.5));

    for (let index = 0; index < count; index += 1) {
        const drift = monthlyTrend / count + weeklyTrend / (count * 2.4);
        const swing = (rng() - 0.5) * amplitude;
        const curve = Math.sin(index / 4.5) * amplitude * 0.35;
        current = Math.max(0.25, current * (1 + drift + swing + curve / count));
        values.push(current);
    }

    values[count - 1] = basePrice;
    return smoothSeries(values);
}

function smoothSeries(values) {
    return values.map((value, index) => {
        const prev = values[index - 1] ?? value;
        const next = values[index + 1] ?? value;
        return (prev + value + next) / 3;
    });
}

function createSeededRng(seedText) {
    let seed = 0;
    for (const char of String(seedText)) {
        seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
    }
    return function() {
        seed = (1664525 * seed + 1013904223) >>> 0;
        return seed / 4294967296;
    };
}

function normalizeIndexLabel(value) {
    const map = {
        sp500: 'S&P 500',
        ndx: 'NASDAQ 100',
        dji: 'DJIA',
        rut: 'Russell 2000',
    };
    return map[value] || value.toUpperCase();
}

function formatTagList(values) {
    if (!Array.isArray(values) || values.length === 0) {
        return 'None';
    }
    return values.map(value => titleize(String(value).replaceAll('-', ' '))).join(', ');
}

function setText(id, value) {
    const target = document.getElementById(id);
    if (target) {
        target.textContent = value;
    }
}

function formatNumber(value, digits) {
    const amount = Number(value);
    return Number.isFinite(amount) ? amount.toFixed(digits) : '0.00';
}

function formatMoney(value) {
    return Number(value).toFixed(2);
}

function formatSignedPercent(value, includePlus = true) {
    const amount = Number(value);
    const prefix = includePlus && amount >= 0 ? '+' : '';
    return `${prefix}${amount.toFixed(2)}%`;
}

function formatCompactVolume(value) {
    const amount = Number(value);
    if (amount >= 1000000) {
        return `${(amount / 1000000).toFixed(2)}M`;
    }
    if (amount >= 1000) {
        return `${(amount / 1000).toFixed(2)}K`;
    }
    return String(Math.round(amount));
}

function formatCompactMarketCap(value) {
    const amount = Number(value);
    if (amount >= 1000000) {
        return `${(amount / 1000000).toFixed(2)}T`;
    }
    if (amount >= 1000) {
        return `${(amount / 1000).toFixed(2)}B`;
    }
    return `${amount.toFixed(0)}M`;
}

function titleize(value) {
    return String(value || '')
        .split(' ')
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
