# Raw intention: filter Finviz by market cap over $10bln

I'm on the Finviz screener at `http://localhost:16605/finviz/`. The Market
Cap dropdown is a **native `<select>`** (not a custom popup) and I picked
the option labeled *"+Large (over $10bln)"*, which has the underlying
`option.value="largeover"`. I did not touch any other filter before or
after.

What I want the routine to do, end-to-end:

1. Open the Finviz screener homepage.
2. Set the Market Cap dropdown to the `largeover` option (visible label:
   "+Large (over $10bln)"), which filters the result table to stocks with
   market cap above $10bln.

That's the whole workflow. There is no ambiguity:

- The dropdown is a native HTML `<select>`, so the compiled routine must
  use the `select` action (matched by `value`, not visible label). A
  two-click "click dropdown then click option" routine is wrong here.
- I do not want to additionally click "Apply" or similar — the filter
  applies as soon as the dropdown value changes.
- I am not parameterizing the market-cap threshold; "+Large (over $10bln)"
  is a literal, fixed choice.
- I do not want to clear other filters first — I just want this one
  filter set.

The compiler should therefore produce a two-step routine (navigate, then
select) without asking any clarifying questions. The select step must
carry a `**Keywords:**` line because the `<select>` has a clean
developer-written `id="fs_cap"`.
