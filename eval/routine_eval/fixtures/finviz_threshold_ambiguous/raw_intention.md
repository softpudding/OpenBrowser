# Raw intention: look at mid-cap stocks — the Market Cap touch was intentional

I'm on the Finviz screener at `http://localhost:16605/finviz/`. During
the recording I opened the Market Cap dropdown, picked *"Mid ($2bln to
$10bln)"* (`value="mid"`), immediately changed my mind about the
specific bucket, re-opened the dropdown, and set it back to *"Any"*
(`value=""`) — so the trace shows me touching the filter twice and
ending with it cleared.

My actual intention is: **I want to look at mid-cap stocks**. The
"Mid" bucket is fine — I re-cleared it only because I thought I
wanted a different variant and then got confused by the options. If
the compiler asks me which mid-cap bucket to use, I'll say **"mid"**
(the original pick). I do NOT want a routine that clears the filter
and then does nothing.

This is genuinely ambiguous from the trace alone. Three reasonable
interpretations all fit what the recording shows:

1. "User set the filter to Mid and then changed their mind; don't apply
   any filter at all." (The recording literally ends with Any selected.)
2. "User was exploring filter options; the final state is the
   intended state."
3. "User actually wanted Mid and the revert was an accident; the
   first pick is the real intent." (my actual intent)

Because each interpretation produces a very different replay, the
compiler MUST ask a clarification question about whether the Market Cap
filter was intentional and, if so, which value to use. Given my answer,
the compiled routine should:

1. Open the Finviz screener homepage.
2. Set the Market Cap dropdown to `mid` ("Mid ($2bln to $10bln)").

It must NOT silently pick one of the three interpretations without
asking.
