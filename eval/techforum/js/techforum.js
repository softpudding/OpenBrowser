window.tracker = new AgentTracker("techforum.com", "medium");

const TECHFORUM_POSTS = [
    {
        id: "1",
        title: "How do you evaluate the development trends of AI in 2025?",
        followers: "3,421 people following",
        answers: "128 answers",
        author: {
            name: "AI Researcher",
            bio: "PhD in AI, focused on machine learning",
            initial: "A",
            color: "#dce7ff",
        },
        content: [
            "The AI field in 2025 will show several important trends.",
            "Large models will keep improving, but the competitive edge will shift toward efficiency, evaluation discipline, and product fit.",
            "Multimodal systems, browser agents, and low-latency deployment patterns will move from demo territory into default product expectations.",
        ],
        tags: ["AI", "2025", "Multimodal", "Evaluation"],
        upvotes: 2341,
        comments: [
            {
                id: "1-1",
                author: "John Zhang",
                time: "2 hours ago",
                text: "Very insightful analysis. I especially agree with the point about multimodal AI becoming the default.",
                likes: 12,
            },
            {
                id: "1-2",
                author: "Li Si",
                time: "1 hour ago",
                text: "In real products, inference cost and reliability already matter more to our team than raw parameter count.",
                likes: 8,
            },
            {
                id: "1-3",
                author: "Wang Wu",
                time: "55 minutes ago",
                text: "For startups with one strong domain, what is the best first wedge right now?",
                likes: 3,
            },
            {
                id: "1-4",
                author: "Zhao Liu",
                time: "30 minutes ago",
                text: "I learned a lot from this. The section on practical deployment constraints was the most useful.",
                likes: 5,
            },
            {
                id: "1-5",
                author: "AI Researcher",
                time: "10 minutes ago",
                text: "For startups, I would begin with a narrow vertical workflow instead of chasing the broadest possible assistant.",
                likes: 20,
                badge: "Author",
            },
            {
                id: "1-6",
                author: "Deep Learning Engineer",
                time: "8 minutes ago",
                text: "Balancing model quality against serving cost is still the hardest part for applied teams.",
                likes: 15,
                hidden: true,
            },
            {
                id: "1-7",
                author: "Product Manager",
                time: "6 minutes ago",
                text: "Users care more about a reliable outcome than about the exact model name in the launch notes.",
                likes: 22,
                hidden: true,
            },
            {
                id: "1-8",
                author: "Investor Perspective",
                time: "5 minutes ago",
                text: "The advantage will accrue to teams that can operationalize evaluation quickly, not only to teams with larger training budgets.",
                likes: 18,
                hidden: true,
            },
            {
                id: "1-9",
                author: "Graduate Student",
                time: "3 minutes ago",
                text: "Are there any papers you recommend for efficient transformer systems? I want to dig deeper.",
                likes: 7,
                hidden: true,
            },
            {
                id: "1-10",
                author: "Startup CTO",
                time: "1 minute ago",
                text: "We are already shipping AI features in production, and the biggest gains came from evaluation and UX iteration.",
                likes: 11,
                hidden: true,
            },
        ],
    },
    {
        id: "2",
        title: "Should startups build private AI copilots or rely on hosted APIs first?",
        followers: "12,567 people following",
        answers: "246 answers",
        author: {
            name: "Infra Founder",
            bio: "Runs a workflow automation startup",
            initial: "I",
            color: "#ffe6d6",
        },
        content: [
            "Hosted APIs are still the fastest way to validate user demand.",
            "Private deployments become more attractive after the workflow is proven and the cost profile is understood.",
        ],
        tags: ["AI", "Startups", "APIs", "Infra"],
        upvotes: 4189,
        comments: [
            {
                id: "2-1",
                author: "Platform Engineer",
                time: "25 minutes ago",
                text: "We moved to a hybrid model after six months because latency and data boundaries started to matter more.",
                likes: 4,
            },
            {
                id: "2-2",
                author: "VC Associate",
                time: "14 minutes ago",
                text: "Early teams usually underestimate maintenance costs when they self-host too soon.",
                likes: 6,
            },
            {
                id: "2-3",
                author: "Security Lead",
                time: "5 minutes ago",
                text: "The answer changes quickly when customers ask for private networking and audit logs.",
                likes: 3,
            },
        ],
    },
    {
        id: "3",
        title: "What is the best study plan to switch from backend engineering to ML systems?",
        followers: "8,901 people following",
        answers: "96 answers",
        author: {
            name: "ML Systems Mentor",
            bio: "Helps backend engineers move into applied ML",
            initial: "M",
            color: "#dff4e4",
        },
        content: [
            "Do not start with papers alone. Start with linear algebra refresh, practical Python, and one end-to-end serving project.",
            "The most valuable bridge skill is still debugging data, interfaces, and production behavior under load.",
        ],
        tags: ["Career", "ML", "Learning", "Backend"],
        upvotes: 1874,
        comments: [
            {
                id: "3-1",
                author: "Backend Lead",
                time: "41 minutes ago",
                text: "Serving and observability carried over much more directly than I expected.",
                likes: 9,
            },
            {
                id: "3-2",
                author: "New Grad",
                time: "22 minutes ago",
                text: "Could you recommend one project that demonstrates both data and infra thinking?",
                likes: 2,
            },
        ],
    },
    {
        id: "4",
        title: "How do you decide when to move a workload from Kubernetes to serverless?",
        followers: "5,432 people following",
        answers: "73 answers",
        author: {
            name: "Cloud Architect",
            bio: "Designs multi-team platform migrations",
            initial: "C",
            color: "#e4edff",
        },
        content: [
            "The inflection point is usually not scale alone. It is how spiky the workload is and how much operational ownership the team can afford.",
            "For agent backends with idle periods, serverless can be the simpler default until tail latency becomes the bottleneck.",
        ],
        tags: ["Cloud", "Kubernetes", "Serverless", "Ops"],
        upvotes: 1625,
        comments: [
            {
                id: "4-1",
                author: "SRE",
                time: "35 minutes ago",
                text: "The biggest win was not cost. It was deleting the pager burden from one small team.",
                likes: 5,
            },
        ],
    },
    {
        id: "5",
        title: "Which product metrics are most reliable for AI feature launches?",
        followers: "12,345 people following",
        answers: "301 answers",
        author: {
            name: "Product Analyst",
            bio: "Measures launch quality for AI-native teams",
            initial: "P",
            color: "#ffe4f2",
        },
        content: [
            "Task success rate, user correction rate, and repeat usage tell you more than vanity adoption numbers.",
            "In AI launches, recovery behavior is often more revealing than first-click excitement.",
        ],
        tags: ["Product", "Metrics", "AI", "Launch"],
        upvotes: 5102,
        comments: [
            {
                id: "5-1",
                author: "Growth PM",
                time: "16 minutes ago",
                text: "We now track manual correction rate for every AI assist surface and it changed our roadmap.",
                likes: 11,
            },
            {
                id: "5-2",
                author: "Designer",
                time: "7 minutes ago",
                text: "This is the first framework I have seen that does not over-index on simple CTR.",
                likes: 4,
            },
        ],
    },
    {
        id: "6",
        title: "Is retrieval-augmented generation worth the operational complexity?",
        followers: "7,880 people following",
        answers: "118 answers",
        author: {
            name: "Search Engineer",
            bio: "Builds retrieval pipelines for support products",
            initial: "S",
            color: "#fff2d9",
        },
        content: [
            "It is worth it when freshness and citation matter, but many teams bolt on retrieval before they can even define document quality.",
            "The maintenance burden comes from indexing, permissions, and evaluation, not from embeddings alone.",
        ],
        tags: ["RAG", "Search", "AI", "Infra"],
        upvotes: 2087,
        comments: [],
    },
    {
        id: "7",
        title: "How do you evaluate browser automation agents for flaky consumer sites?",
        followers: "9,122 people following",
        answers: "141 answers",
        author: {
            name: "Automation Lead",
            bio: "Runs browser agent eval loops for QA teams",
            initial: "B",
            color: "#ddeeff",
        },
        content: [
            "A good benchmark has to include visual ambiguity, state drift, and interaction-specific verification.",
            "If you only test happy-path clicks, your evaluation does not resemble real browser work.",
        ],
        tags: ["Browser", "Automation", "Evaluation", "QA"],
        upvotes: 2760,
        comments: [
            {
                id: "7-1",
                author: "QA Manager",
                time: "32 minutes ago",
                text: "State drift between highlight and screenshot is where most of our false confidence used to come from.",
                likes: 10,
            },
        ],
    },
    {
        id: "8",
        title: "What signals matter most before buying a semiconductor ETF?",
        followers: "6,314 people following",
        answers: "84 answers",
        author: {
            name: "Markets Analyst",
            bio: "Focuses on semiconductors and macro rotations",
            initial: "T",
            color: "#f3e5ff",
        },
        content: [
            "Supply discipline, inventory normalization, and enterprise capex guidance matter more than one loud earnings print.",
            "Do not ignore valuation compression when rates and AI excitement start moving in opposite directions.",
        ],
        tags: ["Markets", "Investing", "Semiconductors", "ETF"],
        upvotes: 1394,
        comments: [],
    },
    {
        id: "9",
        title: "How can PMs write prompts that survive model upgrades?",
        followers: "11,204 people following",
        answers: "191 answers",
        author: {
            name: "Prompt PM",
            bio: "Owns agent prompts and evaluation health",
            initial: "R",
            color: "#ffe7cc",
        },
        content: [
            "Treat prompts like interfaces. Specify goals, invariants, and failure handling instead of stuffing examples into every corner.",
            "Stable prompts are paired with evals that catch regressions when the model gets smarter in a different direction.",
        ],
        tags: ["Prompting", "Product", "AI", "Evaluation"],
        upvotes: 3398,
        comments: [
            {
                id: "9-1",
                author: "Staff PM",
                time: "18 minutes ago",
                text: "This finally explains why our prompt got more brittle after we added more examples.",
                likes: 8,
            },
            {
                id: "9-2",
                author: "Applied Scientist",
                time: "10 minutes ago",
                text: "Interface-first prompting is the right way to explain this to non-research partners.",
                likes: 6,
            },
        ],
    },
    {
        id: "10",
        title: "What should a good cloud cost dashboard show each morning?",
        followers: "4,812 people following",
        answers: "57 answers",
        author: {
            name: "FinOps Lead",
            bio: "Owns cloud cost reporting and anomaly reviews",
            initial: "F",
            color: "#e2f8ff",
        },
        content: [
            "Yesterday versus seven-day baseline, top movers by service, and a clean split between growth and waste.",
            "If the dashboard cannot help an engineer decide what to do next, it is not a good dashboard.",
        ],
        tags: ["Cloud", "FinOps", "Dashboards", "Cost"],
        upvotes: 995,
        comments: [],
    },
    {
        id: "11",
        title: "Are local open-weight coding models useful for daily pair programming?",
        followers: "7,515 people following",
        answers: "88 answers",
        author: {
            name: "Developer Tools Engineer",
            bio: "Experiments with local and hosted code assistants",
            initial: "D",
            color: "#e7f0ff",
        },
        content: [
            "They are useful when you need low-latency iteration and modest context, but most teams still keep a stronger hosted model around for harder reasoning.",
            "The best setup is often a tiered workflow, not an all-or-nothing preference.",
        ],
        tags: ["Coding", "LLM", "Developer Tools", "Local Models"],
        upvotes: 2248,
        comments: [
            {
                id: "11-1",
                author: "Security Engineer",
                time: "12 minutes ago",
                text: "The privacy angle matters, but the biggest practical gain for us was lower latency on small edits.",
                likes: 7,
            },
        ],
    },
    {
        id: "12",
        title: "How do you test multimodal UI agents without manual spot checks?",
        followers: "10,208 people following",
        answers: "132 answers",
        author: {
            name: "Agent Evaluator",
            bio: "Builds eval suites for multimodal interfaces",
            initial: "E",
            color: "#fff0e0",
        },
        content: [
            "You need trackable frontend events, screenshot archives, and criteria that focus on intent completion instead of step-by-step literal replay.",
            "Manual spot checks still help, but they should refine the harness rather than replace it.",
        ],
        tags: ["Multimodal", "Agents", "Evaluation", "Frontend"],
        upvotes: 3014,
        comments: [
            {
                id: "12-1",
                author: "QA Researcher",
                time: "26 minutes ago",
                text: "The screenshot archive point is easy to underestimate until you need to debug a flaky failure.",
                likes: 9,
            },
        ],
    },
    {
        id: "13",
        title: "What is the safest rollout plan for an AI autocomplete feature?",
        followers: "5,278 people following",
        answers: "64 answers",
        author: {
            name: "Safety PM",
            bio: "Works on controlled AI product launches",
            initial: "G",
            color: "#f5ebff",
        },
        content: [
            "Start with internal dogfooding, then opt-in cohorts, then guardrailed general availability with clear correction telemetry.",
            "Rollbacks must be cheap, fast, and routine.",
        ],
        tags: ["AI", "Rollout", "Safety", "Autocomplete"],
        upvotes: 1166,
        comments: [],
    },
    {
        id: "14",
        title: "How do teams handle search relevance tuning after a major catalog expansion?",
        followers: "6,942 people following",
        answers: "79 answers",
        author: {
            name: "Search Relevance Lead",
            bio: "Owns ranking and retrieval quality for ecommerce",
            initial: "H",
            color: "#e4fff1",
        },
        content: [
            "Relevance usually regresses because filters, synonyms, and intent buckets were never revisited after the catalog doubled.",
            "Launch a judgment set before you rewrite the ranking stack.",
        ],
        tags: ["Search", "Relevance", "Ecommerce", "Ranking"],
        upvotes: 1437,
        comments: [],
    },
    {
        id: "15",
        title: "What makes a good incident retrospective for a failed model deployment?",
        followers: "4,099 people following",
        answers: "52 answers",
        author: {
            name: "Incident Commander",
            bio: "Runs operational reviews for ML platforms",
            initial: "J",
            color: "#ffe9eb",
        },
        content: [
            "Focus on system gaps, not dramatic timelines. The most useful retro ends with a stronger release path and clearer ownership.",
            "The model was only one part of the failure.",
        ],
        tags: ["ML Ops", "Incidents", "Retrospectives", "Reliability"],
        upvotes: 875,
        comments: [
            {
                id: "15-1",
                author: "Engineering Manager",
                time: "9 minutes ago",
                text: "The clean ownership point is usually where retros either succeed or become theater.",
                likes: 3,
            },
        ],
    },
    {
        id: "16",
        title: "Should startups prioritize evaluation infrastructure or prompt iteration first?",
        followers: "8,344 people following",
        answers: "102 answers",
        author: {
            name: "Applied AI Founder",
            bio: "Ships agentic workflows to operations teams",
            initial: "K",
            color: "#ebf6ff",
        },
        content: [
            "Prompt iteration is faster at the beginning, but you need lightweight evaluation very early or you will optimize for anecdotes.",
            "The correct answer is usually a cheap eval harness, not a giant infra project.",
        ],
        tags: ["Startups", "Evaluation", "Prompting", "Agents"],
        upvotes: 2488,
        comments: [],
    },
    {
        id: "17",
        title: "How do you design notification systems that avoid alert fatigue?",
        followers: "3,918 people following",
        answers: "46 answers",
        author: {
            name: "Product Operations",
            bio: "Designs alerts and workflow orchestration",
            initial: "L",
            color: "#fff7db",
        },
        content: [
            "Treat every notification as a cost. Batch aggressively, preserve urgency only for real exceptions, and measure mute behavior.",
            "If a team cannot explain the next action, the notification should not exist.",
        ],
        tags: ["Product", "Notifications", "Ops", "UX"],
        upvotes: 722,
        comments: [],
    },
    {
        id: "18",
        title: "What are practical ways to reduce screenshot latency in browser agents?",
        followers: "6,588 people following",
        answers: "74 answers",
        author: {
            name: "Runtime Engineer",
            bio: "Optimizes screenshots, rendering, and hidden-tab warmup",
            initial: "N",
            color: "#f1e9ff",
        },
        content: [
            "Warm the page before capture, avoid scaled live-tab CDP clips, and distinguish page readiness from layout drift.",
            "A good screenshot path is also a browser wake-up strategy.",
        ],
        tags: ["Browser", "Screenshots", "Performance", "Agents"],
        upvotes: 1588,
        comments: [
            {
                id: "18-1",
                author: "Extension Developer",
                time: "11 minutes ago",
                text: "Hidden-tab timer throttling explains so many mysterious first-highlight failures.",
                likes: 5,
            },
        ],
    },
    {
        id: "19",
        title: "How can analysts screen for resilient software companies in a rate-cut cycle?",
        followers: "5,611 people following",
        answers: "68 answers",
        author: {
            name: "Public Markets PM",
            bio: "Screens software and infra names for long-only funds",
            initial: "Q",
            color: "#e7fbff",
        },
        content: [
            "Look for durable net retention, sane valuation, and evidence that spending discipline survived the prior tightening cycle.",
            "A rate cut does not rescue a weak business model.",
        ],
        tags: ["Markets", "Software", "Screening", "Investing"],
        upvotes: 1197,
        comments: [],
    },
    {
        id: "20",
        title: "How do you structure career ladders for AI product engineers?",
        followers: "7,244 people following",
        answers: "91 answers",
        author: {
            name: "Engineering Director",
            bio: "Builds career frameworks for AI product teams",
            initial: "Y",
            color: "#e7ffee",
        },
        content: [
            "Separate experimentation skill, product judgment, and operational reliability instead of collapsing everything into one seniority label.",
            "The strongest AI product engineers are usually translators between research, engineering, and UX.",
        ],
        tags: ["Career", "AI", "Engineering", "Management"],
        upvotes: 2119,
        comments: [
            {
                id: "20-1",
                author: "Senior IC",
                time: "13 minutes ago",
                text: "This is the clearest articulation I have seen of why AI product work should not inherit the old mobile ladder unchanged.",
                likes: 6,
            },
        ],
    },
];

const tracker = window.tracker;
const toastState = {
    timerId: null,
};

document.addEventListener("DOMContentLoaded", () => {
    setSearchInputValue(getSearchQuery());
    bindGlobalEvents();
    renderPage();
});

function bindGlobalEvents() {
    const overlay = document.getElementById("all-comments-overlay");
    const closeButton = document.getElementById("all-comments-close");

    if (overlay) {
        overlay.addEventListener("click", closeAllCommentsModal);
    }

    if (closeButton) {
        closeButton.addEventListener("click", closeAllCommentsModal);
    }

    document.addEventListener("click", (event) => {
        const searchButton = event.target.closest("#main-search-button");
        if (searchButton) {
            event.preventDefault();
            runSearch();
            return;
        }

        const askButton = event.target.closest("#ask-btn");
        if (askButton) {
            event.preventDefault();
            tracker.track("ask_question_click", { location: "header" });
            showToast("Ask Question is mocked on this frontend.");
            return;
        }

        const loginButton = event.target.closest(".login-btn");
        if (loginButton) {
            event.preventDefault();
            tracker.track("login_click", { location: "header" });
            showToast("Login is disabled in this mock environment.");
            return;
        }

        const questionLink = event.target.closest(".question-link");
        if (questionLink) {
            const questionCard = questionLink.closest(".question-card");
            tracker.track("question_click", {
                questionTitle: questionLink.textContent.trim(),
                questionId: questionCard?.dataset.questionId || null,
                href: questionLink.href,
            });
            return;
        }

        const topicLink = event.target.closest(".topic-link");
        if (topicLink) {
            tracker.track("topic_click", {
                topicName: topicLink.textContent.trim(),
                href: topicLink.href,
            });

            if (topicLink.getAttribute("href") === "#") {
                event.preventDefault();
                const topicQuery = topicLink.textContent.replace(/^#/, "").trim();
                if (topicQuery) {
                    window.location.href = `/techforum/search.html?q=${encodeURIComponent(topicQuery)}`;
                }
            }
            return;
        }

        const columnItem = event.target.closest(".column-item");
        if (columnItem) {
            tracker.track("column_click", {
                columnTitle: columnItem.textContent.trim(),
                href: columnItem.href || "#",
            });

            if (columnItem.getAttribute("href") === "#") {
                event.preventDefault();
                showToast("This featured column is a visual stub in the mock.");
            }
            return;
        }

        const navItem = event.target.closest(".nav-item");
        if (navItem) {
            tracker.track("header_navigation", {
                item: navItem.textContent.trim(),
                href: navItem.href,
            });

            if (
                navItem.getAttribute("href") === "/techforum/topics.html" ||
                navItem.getAttribute("href") === "/techforum/people.html"
            ) {
                event.preventDefault();
                showToast("Only Home, Search, and Question detail are implemented here.");
            }
            return;
        }

        const sidebarItem = event.target.closest(".sidebar-item");
        if (sidebarItem && sidebarItem.getAttribute("href") === "#") {
            event.preventDefault();
            document.querySelectorAll(".sidebar-item").forEach((item) => {
                item.classList.remove("active");
            });
            sidebarItem.classList.add("active");
            tracker.track("sidebar_navigation", {
                item: sidebarItem.textContent.trim(),
            });
            return;
        }

        const actionButton = event.target.closest(".action-btn");
        if (actionButton) {
            event.preventDefault();
            handleActionButton(actionButton);
            return;
        }

        const commentToggle = event.target.closest(".comment-toggle");
        if (commentToggle) {
            event.preventDefault();
            toggleCommentSection(commentToggle);
            return;
        }

        const viewAllButton = event.target.closest(".view-all-comments-btn");
        if (viewAllButton) {
            event.preventDefault();
            openAllCommentsModal(viewAllButton.dataset.questionId);
            return;
        }

        const commentLikeButton = event.target.closest(".comment-like-btn");
        if (commentLikeButton) {
            event.preventDefault();
            handleCommentLike(commentLikeButton);
            return;
        }

        const commentReplyButton = event.target.closest(".comment-reply-btn");
        if (commentReplyButton) {
            event.preventDefault();
            openReplyInput(commentReplyButton);
            return;
        }

        const replyCancelButton = event.target.closest(".reply-cancel");
        if (replyCancelButton) {
            event.preventDefault();
            const replyContainer = replyCancelButton.closest(".reply-input-container");
            if (replyContainer) {
                replyContainer.remove();
            }
            return;
        }

        const replySubmitButton = event.target.closest(".reply-submit");
        if (replySubmitButton) {
            event.preventDefault();
            submitReply(replySubmitButton);
            return;
        }

        const commentSubmitButton = event.target.closest(".comment-submit-btn");
        if (commentSubmitButton) {
            event.preventDefault();
            submitDirectComment(commentSubmitButton);
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            closeAllCommentsModal();
            const openReply = document.querySelector(".reply-input-container");
            if (openReply) {
                openReply.remove();
            }
            return;
        }

        if (event.key === "Enter" && event.target.id === "main-search") {
            event.preventDefault();
            runSearch();
            return;
        }

        if (event.key === "Enter" && event.target.classList.contains("comment-input-field")) {
            event.preventDefault();
            const submitButton = event.target
                .closest(".comment-input-wrapper")
                ?.querySelector(".comment-submit-btn");
            if (submitButton) {
                submitButton.click();
            }
            return;
        }

        if (event.key === "Enter" && event.target.classList.contains("reply-input")) {
            event.preventDefault();
            const submitButton = event.target
                .closest(".reply-input-container")
                ?.querySelector(".reply-submit");
            if (submitButton) {
                submitButton.click();
            }
        }
    });
}

function renderPage() {
    const pageMode = document.body.dataset.pageMode;

    if (pageMode === "detail") {
        renderDetailPage();
        return;
    }

    if (pageMode === "search") {
        renderSearchPage();
        return;
    }

    renderHomePage();
}

function renderHomePage() {
    const summary = document.getElementById("feed-summary");
    const container = document.getElementById("feed-posts");

    if (!summary || !container) {
        return;
    }

    summary.innerHTML = `
        <div class="summary-eyebrow">Recommended feed</div>
        <div class="summary-title">Fresh threads from the TechForum community</div>
        <div class="summary-meta">${TECHFORUM_POSTS.length} posts across AI, cloud, product, investing, and career planning.</div>
    `;

    container.innerHTML = TECHFORUM_POSTS.map((post) => renderPostCard(post)).join("");
}

function renderSearchPage() {
    const query = getSearchQuery();
    const summary = document.getElementById("feed-summary");
    const container = document.getElementById("feed-posts");

    if (!summary || !container) {
        return;
    }

    const results = filterPosts(query);
    const safeQuery = escapeHtml(query || "all posts");
    const resultsLabel = results.length === 1 ? "result" : "results";

    summary.innerHTML = `
        <div class="summary-eyebrow">Search results</div>
        <div class="summary-title">${query ? `Results for "${safeQuery}"` : "Showing all TechForum posts"}</div>
        <div class="summary-meta">${results.length} ${resultsLabel}. Search matches titles, tags, author bios, answer previews, and existing comments.</div>
    `;

    if (!results.length) {
        container.innerHTML = `
            <div class="search-empty">
                <h2>No posts matched "${safeQuery}"</h2>
                <p>Try broader terms such as AI, browser, cloud, career, or evaluation.</p>
                <a class="search-empty-link" href="/techforum/">Back to the home feed</a>
            </div>
        `;
        return;
    }

    container.innerHTML = results.map((post) => renderPostCard(post)).join("");
}

function renderDetailPage() {
    const summary = document.getElementById("detail-summary");
    const container = document.getElementById("question-detail");

    if (!summary || !container) {
        return;
    }

    const questionId = new URLSearchParams(window.location.search).get("question") || "1";
    const post = getPostById(questionId);

    if (!post) {
        summary.innerHTML = `
            <div class="summary-eyebrow">Question detail</div>
            <div class="summary-title">Post not found</div>
            <div class="summary-meta">The requested question does not exist in this TechForum fixture.</div>
        `;
        container.innerHTML = `
            <div class="search-empty">
                <h2>Question not found</h2>
                <p>Try opening the question again from the TechForum feed.</p>
                <a class="search-empty-link" href="/techforum/">Return to home</a>
            </div>
        `;
        return;
    }

    document.title = `${post.title} - TechForum`;
    summary.innerHTML = `
        <div class="summary-eyebrow">Question detail</div>
        <div class="summary-title">${escapeHtml(post.title)}</div>
        <div class="summary-meta">${escapeHtml(post.followers)} | ${escapeHtml(post.answers)}</div>
    `;
    container.innerHTML = renderPostCard(post, true);
}

function renderPostCard(post, isDetailView = false) {
    const totalComments = post.comments.length;
    const visibleComments = post.comments.filter((comment) => !comment.hidden);
    const hiddenComments = post.comments.filter((comment) => comment.hidden);
    const content = post.content
        .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
        .join("");
    const tags = post.tags
        .map((tag) => `<a href="/techforum/search.html?q=${encodeURIComponent(tag)}" class="question-tag">#${escapeHtml(tag)}</a>`)
        .join("");
    const commentsMarkup = totalComments
        ? post.comments.map((comment) => renderComment(comment)).join("")
        : `<div class="empty-comment-state">No comments yet. Start the conversation.</div>`;
    const loadMoreMarkup = hiddenComments.length
        ? `
            <div class="comment-load-more">
                <button class="view-all-comments-btn" type="button" data-question-id="${post.id}">
                    View all comments
                </button>
            </div>
        `
        : "";

    return `
        <article class="question-card${isDetailView ? " detail-view" : ""}" data-question-id="${post.id}">
            <div class="question-header">
                <h2 class="question-title">
                    <a href="/techforum/questions.html?question=${post.id}" class="question-link">${escapeHtml(post.title)}</a>
                </h2>
                <div class="question-meta">
                    <span class="followers">${escapeHtml(post.followers)}</span>
                    <span class="answers">${escapeHtml(post.answers)}</span>
                </div>
            </div>
            <div class="answer-preview">
                <div class="author-info">
                    <img src="${buildAvatarDataUri(post.author.initial, post.author.color)}" alt="avatar" class="avatar" style="width: 38px; height: 38px; border-radius: 50%;">
                    <div class="author-details">
                        <span class="author-name">${escapeHtml(post.author.name)}</span>
                        <span class="author-bio">${escapeHtml(post.author.bio)}</span>
                    </div>
                </div>
                <div class="answer-content">${content}</div>
                <div class="question-tags">${tags}</div>
                <div class="answer-actions">
                    <button class="action-btn upvote" type="button" data-action="upvote" aria-pressed="false">
                        <span class="icon">👍</span>
                        <span class="count">${formatNumber(post.upvotes)}</span>
                    </button>
                    <button class="action-btn downvote" type="button" data-action="downvote" aria-pressed="false">
                        <span class="icon">👎</span>
                        <span class="button-label">Downvote</span>
                    </button>
                    <button class="action-btn share" type="button" data-action="share" aria-pressed="false">
                        <span class="icon">📤</span>
                        <span class="button-label">Share</span>
                    </button>
                    <button class="action-btn collect" type="button" data-action="collect" aria-pressed="false">
                        <span class="icon">☆</span>
                        <span class="button-label">Collect</span>
                    </button>
                    <button class="action-btn comment" type="button" data-action="comment">
                        <span class="icon">💬</span>
                        <span class="count">${formatNumber(totalComments)}</span>
                    </button>
                </div>
                <div class="comment-section">
                    <div class="comment-toggle" data-question-id="${post.id}">
                        <span class="comment-count">${formatNumber(totalComments)} comments</span>
                        <span class="toggle-icon">▼</span>
                    </div>
                    <div class="comment-list" data-question-id="${post.id}">
                        <div class="comment-input-area">
                            <div class="comment-input-wrapper">
                                <img src="${buildAvatarDataUri("Y", "#f0f0f0")}" alt="avatar" class="comment-input-avatar">
                                <input type="text" class="comment-input-field" placeholder="Write your comment..." data-question-id="${post.id}">
                                <button class="comment-submit-btn" type="button" data-question-id="${post.id}">Comment</button>
                            </div>
                        </div>
                        ${commentsMarkup}
                        ${loadMoreMarkup}
                    </div>
                </div>
            </div>
        </article>
    `;
}

function renderComment(comment, isReply = false) {
    const classes = ["comment-item"];
    if (comment.hidden) {
        classes.push("hidden-comment");
    }
    if (isReply) {
        classes.push("reply-comment");
    }
    const badgeMarkup = comment.badge
        ? `<span class="author-badge">${escapeHtml(comment.badge)}</span>`
        : "";
    const hiddenStyle = comment.hidden ? ' style="display: none;"' : "";

    return `
        <div class="${classes.join(" ")}" data-comment-id="${comment.id}"${hiddenStyle}>
            <img src="${buildAvatarDataUri(comment.author.charAt(0), "#f0f0f0")}" alt="avatar" class="comment-avatar">
            <div class="comment-content">
                <div class="comment-header">
                    <span class="comment-author">${escapeHtml(comment.author)}</span>
                    <span class="comment-time">${escapeHtml(comment.time)}</span>
                    ${badgeMarkup}
                </div>
                <div class="comment-text">${escapeHtml(comment.text)}</div>
                <div class="comment-actions">
                    <button class="comment-action-btn comment-like-btn" type="button" data-action="like">👍 ${formatNumber(comment.likes)}</button>
                    <button class="comment-action-btn comment-reply-btn" type="button" data-action="reply">Reply</button>
                </div>
            </div>
        </div>
    `;
}

function handleActionButton(button) {
    const action = button.dataset.action;
    const questionCard = button.closest(".question-card");

    if (!questionCard) {
        return;
    }

    const questionId = questionCard.dataset.questionId;
    const questionTitle = questionCard.querySelector(".question-title")?.textContent.trim() || "";

    tracker.track("answer_action", {
        action,
        questionId,
        questionTitle,
    });

    if (action === "upvote") {
        toggleUpvote(button, questionCard);
        return;
    }

    if (action === "downvote") {
        toggleDownvote(button, questionCard);
        return;
    }

    if (action === "comment") {
        tracker.track("comment_button_click", { questionId });
        const toggle = questionCard.querySelector(".comment-toggle");
        if (toggle) {
            toggleCommentSection(toggle, true);
        }
        return;
    }

    if (action === "share") {
        tracker.track("share_click", { questionId });
        handleShare(button, questionId);
        return;
    }

    if (action === "collect") {
        tracker.track("collect_click", { questionId });
        toggleCollect(button, questionId);
    }
}

function toggleUpvote(button, questionCard) {
    const countNode = button.querySelector(".count");
    if (!countNode) {
        return;
    }

    const wasActive = button.classList.contains("active");
    const currentCount = parseCount(countNode.textContent);
    const nextCount = wasActive ? Math.max(currentCount - 1, 0) : currentCount + 1;

    button.classList.toggle("active", !wasActive);
    button.setAttribute("aria-pressed", String(!wasActive));
    countNode.textContent = formatNumber(nextCount);

    tracker.track("upvote_toggle", {
        questionId: questionCard.dataset.questionId,
        voted: !wasActive,
    });

    if (!wasActive) {
        const downvoteButton = questionCard.querySelector('.action-btn[data-action="downvote"]');
        if (downvoteButton?.classList.contains("active")) {
            downvoteButton.classList.remove("active");
            downvoteButton.setAttribute("aria-pressed", "false");
            setButtonLabel(downvoteButton, "Downvote");
        }
    }
}

function toggleDownvote(button, questionCard) {
    const wasActive = button.classList.contains("active");
    button.classList.toggle("active", !wasActive);
    button.setAttribute("aria-pressed", String(!wasActive));
    setButtonLabel(button, !wasActive ? "Downvoted" : "Downvote");

    tracker.track("downvote_click", {
        questionId: questionCard.dataset.questionId,
    });
    tracker.track("downvote_toggle", {
        questionId: questionCard.dataset.questionId,
        downvoted: !wasActive,
    });

    if (!wasActive) {
        const upvoteButton = questionCard.querySelector('.action-btn[data-action="upvote"]');
        if (upvoteButton?.classList.contains("active")) {
            const countNode = upvoteButton.querySelector(".count");
            if (countNode) {
                countNode.textContent = formatNumber(Math.max(parseCount(countNode.textContent) - 1, 0));
            }
            upvoteButton.classList.remove("active");
            upvoteButton.setAttribute("aria-pressed", "false");
            tracker.track("upvote_toggle", {
                questionId: questionCard.dataset.questionId,
                voted: false,
            });
        }
    }
}

function handleShare(button, questionId) {
    const questionUrl = `${window.location.origin}/techforum/questions.html?question=${questionId}`;

    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(questionUrl).catch(() => {});
    }

    button.classList.add("active");
    button.setAttribute("aria-pressed", "true");
    setButtonLabel(button, "Copied");
    showToast("Question link copied.");

    window.setTimeout(() => {
        button.classList.remove("active");
        button.setAttribute("aria-pressed", "false");
        setButtonLabel(button, "Share");
    }, 1400);
}

function toggleCollect(button, questionId) {
    const wasActive = button.classList.contains("active");
    button.classList.toggle("active", !wasActive);
    button.setAttribute("aria-pressed", String(!wasActive));
    button.querySelector(".icon").textContent = !wasActive ? "★" : "☆";
    setButtonLabel(button, !wasActive ? "Collected" : "Collect");

    tracker.track("collect_toggle", {
        questionId,
        collected: !wasActive,
    });
}

function toggleCommentSection(toggle, fromCommentButton = false) {
    const questionId = toggle.dataset.questionId;
    const commentList = document.querySelector(`.comment-list[data-question-id="${questionId}"]`);

    if (!commentList) {
        return;
    }

    const isOpening = commentList.style.display === "none" || commentList.style.display === "";
    commentList.style.display = isOpening ? "block" : "none";
    commentList.classList.toggle("active", isOpening);
    toggle.classList.toggle("active", isOpening);

    const icon = toggle.querySelector(".toggle-icon");
    if (icon) {
        icon.textContent = isOpening ? "▲" : "▼";
    }

    tracker.track(isOpening ? "comment_section_expand" : "comment_section_collapse", {
        questionId,
        source: fromCommentButton ? "comment_button" : "comment_toggle",
    });
}

function openAllCommentsModal(questionId) {
    const modal = document.getElementById("all-comments-modal");
    const modalBody = document.getElementById("all-comments-body");
    const modalTitle = document.getElementById("all-comments-title");
    const questionCard = document.querySelector(`.question-card[data-question-id="${questionId}"]`);
    const sourceList = questionCard?.querySelector(`.comment-list[data-question-id="${questionId}"]`);

    if (!modal || !modalBody || !modalTitle || !questionCard || !sourceList) {
        return;
    }

    modalBody.innerHTML = "";
    Array.from(sourceList.querySelectorAll(".comment-item")).forEach((item) => {
        const clone = item.cloneNode(true);
        clone.classList.remove("hidden-comment");
        clone.style.display = "";
        modalBody.appendChild(clone);
    });

    modal.dataset.questionId = questionId;
    modal.style.display = "flex";
    modalTitle.textContent = `All comments on "${questionCard.querySelector(".question-title")?.textContent.trim() || "this question"}"`;
    lockBodyScroll();

    tracker.track("view_all_comments_click", { questionId });
}

function closeAllCommentsModal() {
    const modal = document.getElementById("all-comments-modal");
    if (!modal || modal.style.display === "none") {
        return;
    }

    modal.style.display = "none";
    modal.removeAttribute("data-question-id");
    unlockBodyScroll();
}

function handleCommentLike(button) {
    const wasActive = button.classList.contains("active");
    const currentCount = parseCount(button.textContent);
    const nextCount = wasActive ? Math.max(currentCount - 1, 0) : currentCount + 1;
    const questionId = button.closest(".question-card")?.dataset.questionId ||
        document.getElementById("all-comments-modal")?.dataset.questionId ||
        null;

    button.classList.toggle("active", !wasActive);
    button.textContent = `👍 ${formatNumber(nextCount)}`;

    tracker.track("comment_like", {
        liked: !wasActive,
        newCount: nextCount,
        questionId,
    });
}

function openReplyInput(replyButton) {
    const commentItem = replyButton.closest(".comment-item");
    const commentActions = replyButton.closest(".comment-actions");
    const questionId = replyButton.closest(".question-card")?.dataset.questionId ||
        document.getElementById("all-comments-modal")?.dataset.questionId ||
        null;

    if (!commentItem || !commentActions) {
        return;
    }

    removeReplyInputs();

    const replyContainer = document.createElement("div");
    replyContainer.className = "reply-input-container";
    replyContainer.innerHTML = `
        <input type="text" class="reply-input" placeholder="Write your reply...">
        <button class="reply-submit" type="button">Reply</button>
        <button class="reply-cancel" type="button">Cancel</button>
    `;

    commentActions.insertAdjacentElement("afterend", replyContainer);
    replyContainer.querySelector(".reply-input")?.focus();

    tracker.track("comment_reply_click", {
        questionId,
        commentId: commentItem.dataset.commentId || null,
    });
}

function submitReply(button) {
    const replyContainer = button.closest(".reply-input-container");
    const input = replyContainer?.querySelector(".reply-input");
    const commentItem = replyContainer?.closest(".comment-item");
    const questionId = commentItem?.closest(".question-card")?.dataset.questionId ||
        document.getElementById("all-comments-modal")?.dataset.questionId ||
        null;

    if (!replyContainer || !input || !commentItem || !questionId) {
        return;
    }

    const replyText = input.value.trim();
    if (!replyText) {
        return;
    }

    const replyMarkup = renderComment(
        {
            id: `reply-${Date.now()}`,
            author: "You",
            time: "Just now",
            text: replyText,
            likes: 0,
        },
        true
    );

    commentItem.insertAdjacentHTML("afterend", replyMarkup);
    replyContainer.remove();
    updateCommentCounters(questionId, 1);

    tracker.track("comment_reply_submit", {
        questionId,
        replyLength: replyText.length,
    });
}

function submitDirectComment(button) {
    const questionId = button.dataset.questionId;
    const questionCard = button.closest(".question-card");
    const input = questionCard?.querySelector(`.comment-input-field[data-question-id="${questionId}"]`);
    const commentList = questionCard?.querySelector(`.comment-list[data-question-id="${questionId}"]`);

    if (!input || !commentList || !questionId) {
        return;
    }

    const text = input.value.trim();
    if (!text) {
        return;
    }

    const emptyState = commentList.querySelector(".empty-comment-state");
    if (emptyState) {
        emptyState.remove();
    }

    const commentMarkup = renderComment({
        id: `comment-${Date.now()}`,
        author: "You",
        time: "Just now",
        text,
        likes: 0,
    });
    const inputArea = commentList.querySelector(".comment-input-area");

    if (inputArea) {
        inputArea.insertAdjacentHTML("afterend", commentMarkup);
    } else {
        commentList.insertAdjacentHTML("afterbegin", commentMarkup);
    }

    input.value = "";
    updateCommentCounters(questionId, 1);

    tracker.track("comment_submit_direct", {
        questionId,
        commentLength: text.length,
    });
}

function updateCommentCounters(questionId, delta) {
    document.querySelectorAll(`.question-card[data-question-id="${questionId}"]`).forEach((card) => {
        const commentButtonCount = card.querySelector('.action-btn[data-action="comment"] .count');
        const commentToggleCount = card.querySelector(".comment-toggle .comment-count");

        if (commentButtonCount) {
            commentButtonCount.textContent = formatNumber(parseCount(commentButtonCount.textContent) + delta);
        }

        if (commentToggleCount) {
            commentToggleCount.textContent = `${formatNumber(parseCount(commentToggleCount.textContent) + delta)} comments`;
        }
    });
}

function removeReplyInputs() {
    document.querySelectorAll(".reply-input-container").forEach((element) => {
        element.remove();
    });
}

function runSearch() {
    const searchInput = document.getElementById("main-search");
    const rawQuery = searchInput?.value.trim() || "";

    tracker.track("search", {
        query: rawQuery,
        location: "header",
    });

    if (!rawQuery) {
        window.location.href = "/techforum/";
        return;
    }

    window.location.href = `/techforum/search.html?q=${encodeURIComponent(rawQuery)}`;
}

function filterPosts(query) {
    const normalizedQuery = normalizeText(query);

    if (!normalizedQuery) {
        return [...TECHFORUM_POSTS];
    }

    return TECHFORUM_POSTS
        .map((post) => ({ post, score: scorePost(post, normalizedQuery) }))
        .filter((item) => item.score > 0)
        .sort((left, right) => {
            if (right.score !== left.score) {
                return right.score - left.score;
            }
            return Number(left.post.id) - Number(right.post.id);
        })
        .map((item) => item.post);
}

function scorePost(post, normalizedQuery) {
    let score = 0;
    const title = normalizeText(post.title);
    const author = normalizeText(`${post.author.name} ${post.author.bio}`);
    const tags = normalizeText(post.tags.join(" "));
    const body = normalizeText(post.content.join(" "));
    const comments = normalizeText(post.comments.map((comment) => `${comment.author} ${comment.text}`).join(" "));

    if (title.includes(normalizedQuery)) {
        score += title.startsWith(normalizedQuery) ? 12 : 8;
    }
    if (tags.includes(normalizedQuery)) {
        score += 6;
    }
    if (author.includes(normalizedQuery)) {
        score += 4;
    }
    if (body.includes(normalizedQuery)) {
        score += 3;
    }
    if (comments.includes(normalizedQuery)) {
        score += 2;
    }

    return score;
}

function getPostById(questionId) {
    return TECHFORUM_POSTS.find((post) => post.id === questionId) || null;
}

function getSearchQuery() {
    return new URLSearchParams(window.location.search).get("q") || "";
}

function setSearchInputValue(query) {
    const searchInput = document.getElementById("main-search");
    if (searchInput) {
        searchInput.value = query;
    }
}

function parseCount(value) {
    return Number.parseInt(String(value).replace(/[^\d]/g, ""), 10) || 0;
}

function setButtonLabel(button, label) {
    const labelNode = button.querySelector(".button-label");
    if (labelNode) {
        labelNode.textContent = label;
    }
}

function formatNumber(value) {
    return Number(value).toLocaleString("en-US");
}

function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
}

function buildAvatarDataUri(initial, background) {
    const safeInitial = escapeHtml(initial || "?");
    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
            <rect width="100" height="100" fill="${background}"/>
            <text x="50" y="52" font-size="42" text-anchor="middle" dy=".3em" fill="#4a4a4a">${safeInitial}</text>
        </svg>
    `;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function showToast(message) {
    const toast = document.getElementById("feedback-toast");
    if (!toast) {
        return;
    }

    toast.textContent = message;
    toast.classList.add("visible");

    if (toastState.timerId) {
        window.clearTimeout(toastState.timerId);
    }

    toastState.timerId = window.setTimeout(() => {
        toast.classList.remove("visible");
    }, 1800);
}

function lockBodyScroll() {
    const scrollY = window.scrollY;
    document.body.dataset.scrollY = String(scrollY);
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.overflow = "hidden";
}

function unlockBodyScroll() {
    const scrollY = Number.parseInt(document.body.dataset.scrollY || "0", 10);
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.overflow = "";
    delete document.body.dataset.scrollY;
    window.scrollTo(0, scrollY);
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
