#!/usr/bin/env python3
"""
Mock Websites Server for AI Agent Evaluation
Serves 3 mocked websites (GBR, TechForum, CloudStack) with event tracking capabilities.

Usage:
    python server.py

The server will:
1. Start on fixed port 16605
2. Serve the mocked websites
3. Collect tracking events from agent interactions
4. Export events via /api/events endpoint
"""

import http.server
import socketserver
import html
import json
import os
import random
import socket
from datetime import datetime
from urllib.parse import urlparse, parse_qs

# Configuration
PORT = 16605
EVAL_DIR = os.path.dirname(os.path.abspath(__file__))

# In-memory event storage
events_store = {"events": [], "sessions": {}}

# URL mappings
URL_MAPPINGS = {
    "/": ("/gbr/index.html", "text/html"),
    "/gbr/": ("/gbr/index.html", "text/html"),
    "/gbr/index.html": ("/gbr/index.html", "text/html"),
    "/gbr/world.html": ("/gbr/world.html", "text/html"),
    "/gbr/business.html": ("/gbr/business.html", "text/html"),
    "/gbr/markets.html": ("/gbr/markets.html", "text/html"),
    "/gbr/tech.html": ("/gbr/tech.html", "text/html"),
    "/gbr/politics.html": ("/gbr/politics.html", "text/html"),
    "/gbr/opinion.html": ("/gbr/opinion.html", "text/html"),
    "/zhihu": ("/techforum/index.html", "text/html"),  # Legacy redirect
    "/zhihu/": ("/techforum/index.html", "text/html"),  # Legacy redirect
    "/techforum/": ("/techforum/index.html", "text/html"),
    "/techforum/index.html": ("/techforum/index.html", "text/html"),
    "/techforum/questions.html": ("/techforum/questions.html", "text/html"),
    "/aliyun": ("/cloudstack/index.html", "text/html"),
    "/aliyun/": ("/cloudstack/index.html", "text/html"),
    "/aliyun/index.html": ("/cloudstack/index.html", "text/html"),
    "/cloudstack/": ("/cloudstack/index.html", "text/html"),
    "/cloudstack/index.html": ("/cloudstack/index.html", "text/html"),
    "/cloudstack/rds.html": ("/cloudstack/rds.html", "text/html"),
    "/cloudstack/oss.html": ("/cloudstack/oss.html", "text/html"),
    "/cloudstack/vpc.html": ("/cloudstack/vpc.html", "text/html"),
    "/cloudstack/slb.html": ("/cloudstack/slb.html", "text/html"),
    "/cloudstack/cms.html": ("/cloudstack/cms.html", "text/html"),
    "/cloudstack/actiontrail.html": ("/cloudstack/actiontrail.html", "text/html"),
    "/cloudstack/config.html": ("/cloudstack/config.html", "text/html"),
    "/cloudstack/security.html": ("/cloudstack/security.html", "text/html"),
    "/cloudstack/billing.html": ("/cloudstack/billing.html", "text/html"),
    "/cloudstack/budget.html": ("/cloudstack/budget.html", "text/html"),
    "/cloudstack/placeholder.html": ("/cloudstack/placeholder.html", "text/html"),
    "/gbr/articles/business-article1.html": (
        "/gbr/articles/business-article1.html",
        "text/html",
    ),
    "/gbr/articles/business-article2.html": (
        "/gbr/articles/business-article2.html",
        "text/html",
    ),
    "/gbr/articles/business-article3.html": (
        "/gbr/articles/business-article3.html",
        "text/html",
    ),
    "/gbr/articles/business-article4.html": (
        "/gbr/articles/business-article4.html",
        "text/html",
    ),
    "/gbr/articles/world-article1.html": (
        "/gbr/articles/world-article1.html",
        "text/html",
    ),
    "/gbr/articles/world-article2.html": (
        "/gbr/articles/world-article2.html",
        "text/html",
    ),
    "/gbr/articles/world-article3.html": (
        "/gbr/articles/world-article3.html",
        "text/html",
    ),
    "/gbr/articles/world-article4.html": (
        "/gbr/articles/world-article4.html",
        "text/html",
    ),
    "/gbr/articles/markets-article1.html": (
        "/gbr/articles/markets-article1.html",
        "text/html",
    ),
    "/gbr/articles/markets-article2.html": (
        "/gbr/articles/markets-article2.html",
        "text/html",
    ),
    "/gbr/articles/markets-article3.html": (
        "/gbr/articles/markets-article3.html",
        "text/html",
    ),
    "/gbr/articles/markets-article4.html": (
        "/gbr/articles/markets-article4.html",
        "text/html",
    ),
    "/gbr/articles/tech-article1.html": (
        "/gbr/articles/tech-article1.html",
        "text/html",
    ),
    "/gbr/articles/tech-article2.html": (
        "/gbr/articles/tech-article2.html",
        "text/html",
    ),
    "/gbr/articles/tech-article3.html": (
        "/gbr/articles/tech-article3.html",
        "text/html",
    ),
    "/gbr/articles/tech-article4.html": (
        "/gbr/articles/tech-article4.html",
        "text/html",
    ),
    "/gbr/articles/politics-article1.html": (
        "/gbr/articles/politics-article1.html",
        "text/html",
    ),
    "/gbr/articles/politics-article2.html": (
        "/gbr/articles/politics-article2.html",
        "text/html",
    ),
    "/gbr/articles/politics-article3.html": (
        "/gbr/articles/politics-article3.html",
        "text/html",
    ),
    "/gbr/articles/politics-article4.html": (
        "/gbr/articles/politics-article4.html",
        "text/html",
    ),
    "/gbr/articles/opinion-article1.html": (
        "/gbr/articles/opinion-article1.html",
        "text/html",
    ),
    "/gbr/articles/opinion-article2.html": (
        "/gbr/articles/opinion-article2.html",
        "text/html",
    ),
    "/gbr/articles/opinion-article3.html": (
        "/gbr/articles/opinion-article3.html",
        "text/html",
    ),
    "/gbr/articles/opinion-article4.html": (
        "/gbr/articles/opinion-article4.html",
        "text/html",
    ),
    "/gbr/articles/home-article1.html": (
        "/gbr/articles/home-article1.html",
        "text/html",
    ),
    "/gbr/articles/home-article2.html": (
        "/gbr/articles/home-article2.html",
        "text/html",
    ),
    "/gbr/articles/home-article3.html": (
        "/gbr/articles/home-article3.html",
        "text/html",
    ),
    "/gbr/articles/home-article4.html": (
        "/gbr/articles/home-article4.html",
        "text/html",
    ),
    "/gbr/articles/home-article5.html": (
        "/gbr/articles/home-article5.html",
        "text/html",
    ),
    "/dataflow/": ("/dataflow/index.html", "text/html"),
    "/dataflow/index.html": ("/dataflow/index.html", "text/html"),
}

CSS_MIMETYPE = "text/css"
JS_MIMETYPE = "application/javascript"
SVG_MIMETYPE = "image/svg+xml"
PNG_MIMETYPE = "image/png"
JPG_MIMETYPE = "image/jpeg"
GIF_MIMETYPE = "image/gif"


def find_available_port():
    """Find an available port in range 8000-20000 (deprecated - using fixed port 16605)"""
    # Ports to avoid
    used_ports = {
        33212,
        5000,
        5001,
        55029,
        7000,
        8080,
        8888,
        14013,
        14016,
        14019,
        14022,
        14023,
        18789,
        18791,
        18792,
        33210,
        33211,
        3653,
        4530,
        4544,
        5020,
        5770,
        6379,
        8765,
        8766,
    }

    def is_port_available(port):
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind(("127.0.0.1", port))
            sock.close()
            return True
        except Exception:
            return False

    # Find an available port
    for _ in range(100):
        port = random.randint(8000, 20000)
        if port not in used_ports and is_port_available(port):
            return port

    # Fallback: let OS assign a port
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


class MockWebsiteHandler(http.server.SimpleHTTPRequestHandler):
    """Custom HTTP handler for mock websites with tracking API"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=EVAL_DIR, **kwargs)

    def do_GET(self):
        """Handle GET requests"""
        parsed_path = urlparse(self.path)
        path = parsed_path.path

        # API endpoints
        if path == "/api/events":
            self.send_json_response(events_store)
            return
        elif path == "/api/events/clear":
            events_store["events"] = []
            events_store["sessions"] = {}
            self.send_json_response(
                {"status": "cleared", "message": "All events cleared"}
            )
            return
        elif path == "/api/sites":
            sites = {
                "sites": [
                    {
                        "name": "globalbusinessreview.com",
                        "difficulty": "easy",
                        "url": "/gbr/",
                        "description": "News website - test navigation and information gathering",
                    },
                    {
                        "name": "techforum.com",
                        "difficulty": "medium",
                        "url": "/techforum/",
                        "description": "Q&A forum - test interactions (like, collect, comment)",
                    },
                    {
                        "name": "cloudstack.com",
                        "difficulty": "hard",
                        "url": "/cloudstack/",
                        "description": "Cloud console - test complex UI with spam popups",
                    },
                    {
                        "name": "dataflow.io",
                        "difficulty": "medium",
                        "url": "/dataflow/",
                        "description": "Analytics dashboard - test visual understanding (spatial, charts, state)",
                    },
                ]
            }
            self.send_json_response(sites)
            return
        elif path == "/api/help":
            help_text = {
                "endpoints": {
                    "GET /api/events": "Get all tracked events",
                    "GET /api/events/clear": "Clear all events",
                    "GET /api/sites": "List available mock sites",
                    "GET /api/help": "Show this help",
                    "POST /api/track": "Submit tracking event (from browser)",
                },
                "sites": {
                    "/gbr/": "Global Business Review mock (easy)",
                    "/techforum/": "TechForum Q&A mock (medium)",
                    "/cloudstack/": "CloudStack console mock (hard)",
                    "/dataflow/": "DataFlow analytics dashboard mock (medium)",
                },
            }
            self.send_json_response(help_text)
            return

        # Search results page
        if path == "/gbr/search.html":
            self.handle_search(parsed_path)
            return

        # Redirect directory access without trailing slash to with slash
        # This ensures relative paths in HTML work correctly
        if not path.endswith("/"):
            fs_path = os.path.join(EVAL_DIR, path.lstrip("/"))
            if os.path.isdir(fs_path):
                # Send 301 redirect to add trailing slash
                self.send_response(301)
                self.send_header("Location", path + "/")
                self.end_headers()
                return

        # Static file serving
        # Check URL mappings
        # Debug: print path and mapping
        # print(f"DEBUG: path={path}, in URL_MAPPINGS={path in URL_MAPPINGS}")
        if path in URL_MAPPINGS:
            file_path, content_type = URL_MAPPINGS[path]
            # print(f"DEBUG: mapping {path} -> {file_path}")
            self.send_file(file_path, content_type)
            return

        # Check for CSS files
        if path.startswith("/css/") and path.endswith(".css"):
            self.send_file(path, CSS_MIMETYPE)
            return

        # Check for JS files (including site-specific JS folders)
        if path.startswith("/js/") and path.endswith(".js"):
            self.send_file(path, JS_MIMETYPE)
            return

        # Check for site-specific JS files (e.g., /techforum/js/, /gbr/js/, /cloudstack/js/)
        for site in ["techforum", "gbr", "cloudstack", "aliyun", "zhihu", "dataflow"]:
            if path.startswith(f"/{site}/js/") and path.endswith(".js"):
                self.send_file(path, JS_MIMETYPE)
                return

        # Check for site-specific CSS files
        for site in ["techforum", "gbr", "cloudstack", "aliyun", "zhihu", "dataflow"]:
            if path.startswith(f"/{site}/css/") and path.endswith(".css"):
                self.send_file(path, CSS_MIMETYPE)
                return

        # Check for image files
        if path.endswith(".svg"):
            self.send_file(path, SVG_MIMETYPE)
            return
        elif path.endswith(".png"):
            self.send_file(path, PNG_MIMETYPE)
            return
        elif path.endswith(".jpg") or path.endswith(".jpeg"):
            self.send_file(path, JPG_MIMETYPE)
            return
        elif path.endswith(".gif"):
            self.send_file(path, GIF_MIMETYPE)
            return

        # Default: try to serve as-is
        self.send_file(path, "text/html")

    def do_POST(self):
        """Handle POST requests"""
        parsed_path = urlparse(self.path)
        path = parsed_path.path

        if path == "/api/track":
            content_length = int(self.headers.get("Content-Length", 0))
            post_data = self.rfile.read(content_length)

            try:
                event = json.loads(post_data.decode("utf-8"))
                event["received_at"] = datetime.now().isoformat()
                events_store["events"].append(event)

                # Track sessions
                session_id = event.get("sessionId", "unknown")
                if session_id not in events_store["sessions"]:
                    events_store["sessions"][session_id] = {
                        "sessionId": session_id,
                        "site": event.get("site", "unknown"),
                        "difficulty": event.get("difficulty", "unknown"),
                        "start_time": event.get("timestamp"),
                        "events_count": 0,
                    }
                events_store["sessions"][session_id]["events_count"] += 1
                events_store["sessions"][session_id]["last_activity"] = event.get(
                    "timestamp"
                )

                self.send_json_response({"status": "ok", "message": "Event tracked"})
            except Exception as e:
                self.send_error_response(400, str(e))
            return

        self.send_error_response(404, "Not Found")

    def send_file(self, file_path, content_type):
        """Send a file with appropriate headers"""
        full_path = os.path.join(EVAL_DIR, file_path.lstrip("/"))

        if not os.path.exists(full_path):
            self.send_error_response(404, f"File not found: {file_path}")
            return

        # If path is a directory, try to serve index.html
        if os.path.isdir(full_path):
            index_path = os.path.join(full_path, "index.html")
            if os.path.exists(index_path):
                full_path = index_path
            else:
                self.send_error_response(404, f"Directory index not found: {file_path}")
                return

        try:
            with open(full_path, "rb") as f:
                content = f.read()

            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", len(content))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self.send_error_response(500, str(e))

    def handle_search(self, parsed_path):
        """Handle search requests and display results"""
        # Parse query parameters
        query_params = parse_qs(parsed_path.query)
        search_query = query_params.get("q", [""])[0].strip().lower()

        # Load article manifest
        manifest_path = os.path.join(EVAL_DIR, "gbr", "articles", "manifest.json")
        try:
            with open(manifest_path, "r") as f:
                articles = json.load(f)
        except Exception as e:
            self.send_error_response(500, f"Failed to load articles: {str(e)}")
            return

        # Filter articles based on search query
        matching_articles = []
        if search_query:
            for article in articles:
                # Search in title (case-insensitive)
                title = article.get("title", "").lower()
                category = article.get("category", "").lower()

                # Check if query appears in title or category
                if search_query in title or search_query in category:
                    matching_articles.append(article)

        # Generate HTML for search results
        html = self.generate_search_results_html(search_query, matching_articles)

        # Send response
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", len(html))
        self.end_headers()
        self.wfile.write(html)

    def generate_search_results_html(self, search_query, articles):
        """Generate HTML for search results page"""
        # Escape HTML in search query
        escaped_query = html.escape(search_query) if search_query else ""

        # Generate results content
        if not articles:
            results_content = """
            <div class="no-results">
                <h3>No articles found</h3>
                <p>Try different keywords or browse our sections above.</p>
            </div>
            """
        else:
            results_items = []
            for article in articles:
                title = html.escape(article.get("title", "Untitled"))
                url = html.escape(article.get("url", "#"))
                category = html.escape(article.get("category", "general"))
                # Format category for display
                category_display = category.capitalize()
                if category == "home":
                    category_display = "Featured"
                elif category == "tech":
                    category_display = "Technology"

                item_html = f"""
                <div class="search-result-item">
                    <div class="result-category">{category_display}</div>
                    <h3 class="result-title"><a href="{url}">{title}</a></h3>
                    <div class="result-meta">Click to read full article</div>
                </div>
                """
                results_items.append(item_html)

            results_content = (
                f'<div class="results-grid">{"".join(results_items)}</div>'
            )

        # Format plural
        plural = "s" if len(articles) != 1 else ""

        # Build the complete HTML page
        html_content = f"""<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Search Results - Global Business Review</title>
            <link rel="stylesheet" href="/css/gbr.css">
            <style>
                .search-results {{
                    max-width: 1000px;
                    margin: 0 auto;
                    padding: 40px 20px;
                }}
                .search-header {{
                    margin-bottom: 30px;
                    border-bottom: 1px solid #ddd;
                    padding-bottom: 20px;
                }}
                .search-query {{
                    font-size: 24px;
                    font-weight: 700;
                    color: #333;
                    margin-bottom: 10px;
                }}
                .results-count {{
                    font-size: 16px;
                    color: #777;
                    font-family: 'Arial', sans-serif;
                }}
                .no-results {{
                    text-align: center;
                    padding: 40px;
                    background: #f9f9f9;
                    border-radius: 4px;
                }}
                .no-results h3 {{
                    font-size: 20px;
                    margin-bottom: 10px;
                    color: #333;
                }}
                .no-results p {{
                    color: #777;
                    line-height: 1.6;
                }}
                .results-grid {{
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
                    gap: 20px;
                    margin-top: 20px;
                }}
                .search-result-item {{
                    background: #fff;
                    border: 1px solid #ddd;
                    border-radius: 4px;
                    padding: 20px;
                    transition: box-shadow 0.2s;
                }}
                .search-result-item:hover {{
                    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                }}
                .result-title {{
                    font-size: 18px;
                    font-weight: 600;
                    margin-bottom: 10px;
                    line-height: 1.3;
                }}
                .result-title a {{
                    color: #000;
                    text-decoration: none;
                }}
                .result-title a:hover {{
                    color: #555;
                }}
                .result-meta {{
                    font-size: 13px;
                    color: #777;
                    margin-bottom: 10px;
                    font-family: 'Arial', sans-serif;
                }}
                .result-category {{
                    display: inline-block;
                    background: #f0f0f0;
                    color: #333;
                    padding: 2px 8px;
                    border-radius: 12px;
                    font-size: 12px;
                    margin-right: 8px;
                }}
                .back-to-home {{
                    display: inline-block;
                    margin-top: 30px;
                    color: #0066cc;
                    text-decoration: none;
                    font-weight: 600;
                    font-family: 'Arial', sans-serif;
                }}
                .back-to-home:hover {{
                    text-decoration: underline;
                }}
            </style>
        </head>
        <body>
            <header class="gbr-header">
                <div class="header-container">
                    <div class="logo">
                        <a href="/gbr/">
                            <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 40'%3E%3Crect fill='%23000' width='200' height='40'/%3E%3Ctext fill='white' font-family='Georgia, serif' font-size='24' x='10' y='28'%3EGlobal Business Review%3C/text%3E%3C/svg%3E" alt="GBR Logo" class="gbr-logo">
                        </a>
                    </div>
                    <nav class="main-nav">
                        <ul>
                            <li><a href="/gbr/">Home</a></li>
                            <li><a href="/gbr/world.html">World</a></li>
                            <li><a href="/gbr/business.html">Business</a></li>
                            <li><a href="/gbr/markets.html">Markets</a></li>
                            <li><a href="/gbr/tech.html">Tech</a></li>
                            <li><a href="/gbr/politics.html">Politics</a></li>
                            <li><a href="/gbr/opinion.html">Opinion</a></li>
                        </ul>
                    </nav>
                    <div class="header-actions">
                        <button class="search-btn" id="search-toggle">🔍</button>
                        <button class="subscribe-btn">Subscribe</button>
                        <button class="sign-in-btn">Sign In</button>
                    </div>
                </div>
                <div class="search-bar" id="search-bar" style="display:flex;">
                    <input type="text" placeholder="Search GBR..." id="search-input" value="{escaped_query}">
                    <button id="search-submit" type="button">Search</button>
                </div>
            </header>

            <main class="gbr-main">
                <div class="search-results">
                    <div class="search-header">
                        <h1 class="search-query">Search Results for "{escaped_query}"</h1>
                        <div class="results-count">{len(articles)} article{plural} found</div>
                    </div>
                    
                    {results_content}
                    
                    <a href="/gbr/" class="back-to-home">← Back to Home</a>
                </div>
            </main>

            <footer class="gbr-footer">
                <div class="footer-container">
                    <div class="footer-links">
                        <div class="footer-column">
                            <h4>Sections</h4>
                            <ul>
                                <li><a href="/gbr/world.html">World</a></li>
                                <li><a href="/gbr/business.html">Business</a></li>
                                <li><a href="/gbr/markets.html">Markets</a></li>
                                <li><a href="/gbr/tech.html">Technology</a></li>
                            </ul>
                        </div>
                        <div class="footer-column">
                            <h4>More</h4>
                            <ul>
                                <li><a href="/gbr/podcasts.html">Podcasts</a></li>
                                <li><a href="/gbr/videos.html">Videos</a></li>
                                <li><a href="/gbr/newsletters.html">Newsletters</a></li>
                            </ul>
                        </div>
                        <div class="footer-column">
                            <h4>Support</h4>
                            <ul>
                                <li><a href="/gbr/contact.html">Contact Us</a></li>
                                <li><a href="/gbr/subscribers.html">Subscribers</a></li>
                                <li><a href="/gbr/help.html">Help Center</a></li>
                            </ul>
                        </div>
                    </div>
                    <div class="footer-bottom">
                        <p>&copy; 2025 Global Business Review Inc. All Rights Reserved.</p>
                    </div>
                </div>
            </footer>

            <script src="/js/tracker.js"></script>
            <script src="/js/gbr.js"></script>
        </body>
        </html>"""

        return html_content.encode("utf-8")

    def send_json_response(self, data):
        """Send JSON response"""
        content = json.dumps(data, indent=2, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", len(content))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(content)

    def send_error_response(self, code, message):
        """Send error response"""
        content = json.dumps({"error": message}, indent=2).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(content))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(content)

    def do_OPTIONS(self):
        """Handle CORS preflight requests"""
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, format, *args):
        """Custom log format"""
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {args[0]}")


def print_startup_info(port):
    """Print startup information"""
    print("\n" + "=" * 60)
    print("Mock Websites Server for AI Agent Evaluation")
    print("=" * 60)
    print(f"\nServer started at: http://localhost:{port}")
    print(f"\nAvailable Sites:")
    print(f"  - GBR (Easy):   http://localhost:{port}/gbr/")
    print(f"  - TechForum (Medium): http://localhost:{port}/techforum/")
    print(
        f"  - CloudStack (Hard):  http://localhost:{port}/cloudstack/  (legacy: /aliyun/, /zhihu/)"
    )
    print(f"\nAPI Endpoints:")
    print(f"  - GET  http://localhost:{port}/api/events       - Get all tracked events")
    print(f"  - GET  http://localhost:{port}/api/events/clear - Clear all events")
    print(f"  - GET  http://localhost:{port}/api/sites        - List available sites")
    print(f"  - GET  http://localhost:{port}/api/help          - API help")
    print(f"  - POST http://localhost:{port}/api/track         - Submit tracking event")
    print(f"\nPress Ctrl+C to stop the server")
    print("=" * 60 + "\n")


def main():
    """Main entry point"""
    global PORT

    # Use fixed port 16605
    # PORT is already set to 16605 globally

    # Create server
    with socketserver.TCPServer(("", PORT), MockWebsiteHandler) as httpd:
        httpd.allow_reuse_address = True
        print_startup_info(PORT)

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")


if __name__ == "__main__":
    main()
