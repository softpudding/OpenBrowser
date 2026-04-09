from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
from html.parser import HTMLParser
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
FINVIZ_HTML = REPO_ROOT / "eval/finviz/index.html"
FINVIZ_JS = REPO_ROOT / "eval/finviz/js/finviz.js"
FINVIZ_GENERATOR = REPO_ROOT / "eval/finviz/generate_stocks.py"
FINVIZ_QUOTE_HTML = REPO_ROOT / "eval/finviz/quote.html"
FINVIZ_QUOTE_JS = REPO_ROOT / "eval/finviz/js/quote.js"
FINVIZ_QUOTE_CSS = REPO_ROOT / "eval/finviz/css/quote.css"


class _FinvizHtmlParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.filter_selects: dict[str, list[str]] = {}
        self.order_options: list[str] = []
        self.performance_sort_fields: set[str] = set()
        self._current_filter: str | None = None
        self._current_select_id: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_map = dict(attrs)
        if tag == "select":
            self._current_select_id = attr_map.get("id")
            classes = set((attr_map.get("class") or "").split())
            if "screener-select" in classes:
                filter_name = attr_map.get("data-filter")
                if filter_name:
                    self._current_filter = filter_name
                    self.filter_selects.setdefault(filter_name, [])
                return
            if self._current_select_id == "signalSelect":
                self._current_filter = "signal"
                self.filter_selects.setdefault("signal", [])
                return
            if self._current_select_id == "orderSelect":
                self._current_filter = "__order__"
                return
            self._current_filter = None
            return

        if tag == "option" and self._current_filter:
            value = attr_map.get("value") or ""
            if not value:
                return
            if self._current_filter == "__order__":
                self.order_options.append(value)
            else:
                self.filter_selects[self._current_filter].append(value)
            return

        if tag == "button":
            sort_field = attr_map.get("data-sort-field")
            if sort_field:
                self.performance_sort_fields.add(sort_field)

    def handle_endtag(self, tag: str) -> None:
        if tag == "select":
            self._current_filter = None
            self._current_select_id = None


def _load_generator_module():
    spec = importlib.util.spec_from_file_location("finviz_generate_stocks", FINVIZ_GENERATOR)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _parse_finviz_html() -> _FinvizHtmlParser:
    parser = _FinvizHtmlParser()
    parser.feed(FINVIZ_HTML.read_text())
    return parser


def _run_js_filter_counts(filter_options: dict[str, list[str]]) -> dict[str, object]:
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is required to execute the Finviz frontend matcher")

    script = """
const fs = require('fs');
const vm = require('vm');

const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
const source = fs.readFileSync(payload.jsPath, 'utf8');

function makeElementStub() {
  return {
    addEventListener() {},
    querySelectorAll() { return []; },
    classList: { add() {}, remove() {}, toggle() {} },
    style: {},
    value: '',
    innerHTML: '',
    textContent: '',
    disabled: false,
    options: [],
  };
}

const document = {
  addEventListener() {},
  querySelectorAll() { return []; },
  getElementById() { return makeElementStub(); },
};

const context = {
  console,
  document,
  window: {
    document,
    location: { pathname: '/finviz/', href: 'http://localhost:16605/finviz/' },
  },
  setTimeout,
  clearTimeout,
};

vm.createContext(context);
vm.runInContext(`${source}\\nthis.__finviz__ = { STOCKS_DATA, matchesFilter };`, context);

const { STOCKS_DATA, matchesFilter } = context.__finviz__;
const counts = {};

for (const [filterName, options] of Object.entries(payload.filterOptions)) {
  for (const option of options) {
    const count = STOCKS_DATA.filter(stock => matchesFilter(stock, filterName, option)).length;
    counts[`${filterName}:${option}`] = count;
  }
}

const sampleTickers = STOCKS_DATA.slice(0, 5).map(stock => String(stock.ticker).toUpperCase());
const tickerMatches = STOCKS_DATA
  .filter(stock => matchesFilter(stock, 'tickers', sampleTickers))
  .map(stock => String(stock.ticker).toUpperCase())
  .sort();

console.log(JSON.stringify({
  total: STOCKS_DATA.length,
  counts,
  sampleTickers: sampleTickers.sort(),
  tickerMatches,
}));
"""

    completed = subprocess.run(
        [node, "-e", script],
        input=json.dumps({"jsPath": str(FINVIZ_JS), "filterOptions": filter_options}),
        capture_output=True,
        text=True,
        check=True,
        cwd=REPO_ROOT,
    )
    return json.loads(completed.stdout)


def test_generate_stocks_expands_and_uniquifies_ticker_universe() -> None:
    module = _load_generator_module()
    stocks = module.generate_stocks()

    assert len(stocks) >= 1200
    assert len({stock["ticker"] for stock in stocks}) == len(stocks)
    assert any(stock["country"] == "brazil" for stock in stocks)
    assert any(stock["isEtf"] for stock in stocks)
    assert any("perf1w" in stock for stock in stocks)
    assert any("themes" in stock for stock in stocks)


def test_every_finviz_filter_option_has_live_frontend_coverage() -> None:
    parser = _parse_finviz_html()
    result = _run_js_filter_counts(parser.filter_selects)
    total = result["total"]
    counts = result["counts"]

    assert total >= 1200

    failures = []
    for filter_name, options in parser.filter_selects.items():
        for option in options:
            count = counts[f"{filter_name}:{option}"]
            if count <= 0 or count >= total:
                failures.append(f"{filter_name}:{option} -> {count}/{total}")

    assert not failures, "Degenerate Finviz filter options: " + ", ".join(failures[:20])
    assert result["tickerMatches"] == result["sampleTickers"]


def test_performance_sort_controls_are_present_in_markup() -> None:
    parser = _parse_finviz_html()

    assert "perf1w" in parser.order_options
    assert "perf4w" in parser.order_options
    assert parser.performance_sort_fields == {"perf1w", "perf4w"}


def test_ticker_quote_page_assets_and_link_pattern_exist() -> None:
    assert FINVIZ_QUOTE_HTML.exists()
    assert FINVIZ_QUOTE_JS.exists()
    assert FINVIZ_QUOTE_CSS.exists()

    js_source = FINVIZ_JS.read_text()
    quote_html = FINVIZ_QUOTE_HTML.read_text()
    quote_js = FINVIZ_QUOTE_JS.read_text()

    assert '/finviz/quote.html?t=' in js_source
    assert '/finviz/js/quote.js' in quote_html
    assert '/finviz/css/quote.css' in quote_html
    assert 'quoteFilterFields' in quote_html
    assert 'renderFilterFields(stock);' in quote_js
