# Raw intention: search for AI topics and upvote every post about agents

I'm on the TechForum homepage at `http://localhost:16605/techforum/`. My
workflow is:

1. Click the search bar and type "AI", then press Enter to navigate to
   the search results page.
2. On the search results, upvote every post whose topic is specifically
   about **AI agents** — not just any AI post. Posts about LLMs in
   general, AI trends, or other AI subtopics should NOT be upvoted
   unless they are specifically about agents.
3. Along the way I also clicked collect/favorite on some posts and
   clicked on comment icons and answer previews while browsing, but
   those are incidental — the core intent is the upvotes on agent-related
   posts.

From the compiler's point of view this is genuinely ambiguous. The
recording shows me searching "AI" and then upvoting 5 posts in the
results. Several equally reasonable interpretations fit the trace:

1. "Upvote the top 5 search results" (literal count)
2. "Upvote all search results" (upvote everything)
3. "Upvote posts matching a topical criterion" (my actual intent —
   specifically posts about AI agents)
4. "Upvote these 5 specific posts I cherry-picked"

Because the replayed routine would behave very differently under each
interpretation — and because the search results can change — the
compiler MUST ask a clarification question about the selection criterion
before writing the routine. If it asks, I will tell it my real intent is
#3: upvote every post in the AI search results whose topic is about
agents.

The collect/favorite clicks and comment-icon clicks are secondary
browsing actions. A good routine should either ask whether to include
them or omit them. The upvotes are the primary intent.
