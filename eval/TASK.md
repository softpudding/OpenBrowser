I want to design a seires of mocked pure-frontend websites to test browser-operating AI Agent's capability, under eval/ directory.
These websites should try their best to mock real-world website behaviours, including real element interaction, page navigation, internal hover/input/search behaviour.
These mocked websites are fundamentally "Tests" for AI agents. So there should be event tracking mechanism inside: track page's clicking, scrolling, input .. behavious.
We should design a series websites, with differnet levels (of how difficult ineraction is).

For now, design 3 websites:
1. globalbusinessreview.com (should be marked as easy). Main goal: to test AI Agent's page naviagtion, clicking, information gathering capability.
2. zhihu.com (should be marked as medium). Main goal: to test AI Agent's ability to interact with quora-like websites. Test if he can distiguish like, collect, comment buttons. Test if he can leave a comment to the correct position. Test if he can scoll.
3. aliyun.com. Specifically, das console. (should be marked as hard) You should notice das console has a lot of spams popups. Mock these behaviour in influence AI Agents. Should also notice how complex das console is.

For each of these, I request you to goto original website. Try your best to mock these websites so no one can tell if it's the original ones.

In the end, you should be able to start these websites on a local server. The local server should also be capable of returning all behaviors done on the mocked websites (so we can evaluate Agent's behaviour).
