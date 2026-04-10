# Raw intention: find stocks that dropped 20% in the month

I'm on the Finviz screener at `http://localhost:16605/finviz/`. My
real goal is to find all stocks that dropped 20% in the past month.

## Filters I set (Descriptive tab)

1. **Market Cap** (`fs_cap`): set to `smallover` — "+Small (over $300mln)"
2. **Dividend Yield** (`fs_fa_div`): set to `o3` — "Over 3%"
3. **Relative Volume** (`fs_sh_relvol`): set to `o1` — "Over 1"

## Filters I set (Fundamental tab)

4. Click the **Fundamental** tab to reveal the fundamental filters.
5. **P/E** (`fs_fa_pe`): set to `u20` — "Under 20"
6. **P/B** (`fs_fa_pb`): set to `u2` — "Under 2"

## Viewing results

7. Switch to the **Performance** view by clicking the "Performance" tab
   in the results area.
8. Click the **Perf Month** column header to sort by monthly
   performance. The column header's `is-descending` class and the
   keyframe values (showing negative percentages at the top after
   the click) make the sort direction observable from the trace, so
   the compiler does not need to ask about it.
9. Click on three stock tickers to view their detail pages: **UISA**,
   **SHXD**, **NRGB** — these were just the top results after sorting;
   I want the routine to open whatever stocks match the criterion, not
   these specific tickers.

## What the routine should do

The compiled routine should reproduce the screening flow: set all 5
filters across both tabs, switch to Performance view, sort by Perf
Month, and click the matching results. The compiler should NOT ask
about the filter values — they are all clearly visible in the
recording's `change` events. The compiler SHOULD ask:

- Whether clicking 3 stocks means "top 3" or "these specific tickers"
  — the answer is whichever stocks match the criterion.
