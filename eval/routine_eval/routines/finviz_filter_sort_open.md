# Workflow: Filter stocks on Finviz screener, sort by monthly performance, and open the top 3 quote pages

## Prerequisites
**Starting URL:** http://localhost:16605/finviz/

## Step 1: Set Market Cap to "+Small (over $300mln)"
**Keywords:** fs_cap

Select the option `smallover` ("+Small (over $300mln)") from the Market Cap dropdown.

## Step 2: Set Dividend Yield to "Over 3%"
**Keywords:** fs_fa_div

Select the option `o3` ("Over 3%") from the Dividend Yield dropdown.

## Step 3: Set Relative Volume to "Over 1"
**Keywords:** fs_sh_relvol

Select the option `o1` ("Over 1") from the Relative Volume dropdown.

## Step 4: Switch to Fundamental filters
**Keywords:** Fundamental

Click the "Fundamental" filter tab to show the fundamental filter options.

## Step 5: Set P/E Ratio to "Under 20"
**Keywords:** fs_fa_pe

Select the option `u20` ("Under 20") from the P/E Ratio dropdown.

## Step 6: Set P/B Ratio to "Under 2"
**Keywords:** fs_fa_pb

Select the option `u2` ("Under 2") from the P/B Ratio dropdown.

## Step 7: Switch to Performance view
**Keywords:** Performance

Click the "Performance" tab in the view tabs row to change the results table to show performance columns.

## Step 8: Sort by monthly performance ascending
**Keywords:** perf4w

Click the "Perf Month" column header in the results table to sort stocks by monthly performance in ascending order, putting the biggest monthly losers at the top.

## Step 9: Open the quote pages for the top 3 worst performers
Click the ticker link in the first row of the results table to open its quote page in a new tab. Then click the ticker link in the second row, and finally click the ticker link in the third row — each opening in a new tab.

**Reasoning:** The user was looking for stocks that dropped approximately 20% in the month. Sorting Perf Month ascending surfaces the worst performers first. The three rows the user clicked all had Perf Month values around -17% to -21%, so the instruction targets the top 3 rows (biggest monthly drops).
