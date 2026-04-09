# Workflow: Filter Finviz by Market Cap over $10bln

## Step 1: Open the Finviz screener

Open `http://localhost:16605/finviz/` in the current tab.

## Step 2: Set Market Cap to "+Large (over $10bln)"
**Keywords:** fs_cap

Select the option `largeover` ("+Large (over $10bln)") from the Market Cap
dropdown under the Descriptive filter tab. This is a native `<select>`
dropdown, so use the `select` action (matched by the option's `value`
attribute, not its visible label).
