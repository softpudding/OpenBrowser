# Raw intention: upvote every AI-related post on the TechForum home feed

I'm on the TechForum homepage at `http://localhost:16605/techforum/`. My
actual goal — which the recording DOES NOT make obvious — is to upvote
**every post whose title mentions AI, LLMs, or machine learning**. On
the current home feed that happens to be the top three posts, so the
recording shows me clicking upvote on three cards in a row. But the
intent is criterion-based ("AI-related"), NOT literal-count-based ("top
three"), so a different day's home feed with four AI posts should get
four upvotes, and a day with one should get one.

From the compiler's point of view this is genuinely ambiguous. Looking
only at the recorded events, three perfectly reasonable interpretations
all produce exactly the same trace:

1. "upvote the top 3 posts" (literal count)
2. "upvote every AI-related post" (criterion-based — my actual intent)
3. "upvote 3 specific posts I cherry-picked" (per-post judgment)

Because the replayed routine would behave very differently under each
interpretation, the compiler MUST ask me a clarification question about
the selection criterion before writing the routine. If it asks, I will
tell it my real intent is #2 — upvote every AI-related post on the home
feed, with the criterion being "title mentions AI, LLM, or machine
learning".

Given my answer, the compiled routine should:

1. Open the TechForum homepage.
2. For each question card on the home feed whose title mentions AI,
   LLMs, or machine learning, click the thumbs-up (upvote) button once.

It must NOT hardcode "upvote the first 3 posts" or "upvote posts 1, 2,
and 3 by id" — that would break the moment the feed changes.
