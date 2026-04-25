# Raw intention: record today's top trending GitHub repo in Yuque, with agent-investigation prompts

I'm on `https://github.com/trending`. My workflow is:

1. Open the **top 1 trending repository** by position — whichever
   repository is ranked first on the day the routine runs, not the
   specific repo I happened to click in the recording.
2. Switch to Yuque and create a new document in the **`AI专用`**
   knowledge base.
3. Set the document title to `Most trending project YYYY-MM-DD`,
   where `YYYY-MM-DD` is today's date on the day of replay (not the
   recording date).
4. In the document body, paste the repo URL and the repo's short
   description from the GitHub "About" sidebar.
5. After the URL and description, I typed the sentence
   `Write also: 1. A brief intro 2. What's special 3. Why's it trending`.
   That sentence is **instructions for the replay agent**, not static
   text I want left in the document. The replay agent should follow
   that instruction: visit the repo page, then write the three
   additional sections (a brief intro to the project, what's special
   about it, why it's trending today) into the Yuque document. The
   sentence itself should not appear verbatim in the final document.

From the compiler's point of view there is one genuinely ambiguous
choice. I only opened the top-1 result, so there is no count
ambiguity, but the compiler cannot tell from the trace whether I
meant "open the top-ranked repo on whatever day this runs" (position)
or "always open this specific repo" (identity). The answer is
position — but a good compiler should ask.

The date in the title is similarly templated to today's date at
replay time, not the date I happened to type during the recording.

The typed sentence is plainly visible in the trace, so the compiler
should not ask me what I typed. A good compiler should also be able
to infer that the sentence is an instruction (imperative phrasing,
plus content I could not know yet at recording time about a repo I
hadn't visited) without asking.
