# Raw intention: upvote the first AI post on TechForum

I'm reading the TechForum homepage at `http://localhost:16605/techforum/`. The
top question card on the feed is *"How do you evaluate the development trends
of AI in 2025?"* — that's the post I want to upvote, and it is also the only
post I touched during this recording.

What I want the routine to do, end-to-end:

1. Open the TechForum homepage.
2. Click the thumbs-up (upvote) button on the **first** question card exactly
   once.

That's the whole workflow. There is no ambiguity:

- I am not trying to filter, search, or sort anything beforehand — the first
  card is just whatever appears at the top of the home feed.
- I am not trying to upvote the comments below the post; only the post's own
  upvote button.
- The upvote action is a toggle, but I only want a single click — I do not
  want to unvote after voting.
- I do not care about the specific post id; "first post on the home feed"
  is the user-visible selector.

The compiler should therefore produce a two-step routine (navigate, then
upvote) without asking any clarifying questions. The upvote step must carry
a `**Keywords:**` line because the recorded `element.html` exposes a clean
developer-written `data-action="upvote"` attribute.
