---
'@skysa/pwa': patch
---

A brand's description reaches the page as written. It was escaped twice, once by the kit and once by Vite as it writes the tag, so a description with `&`, `<`, `>` or `"` showed its escapes in search results and share cards (`Notes &amp; to-dos`). The title was right, and an app has nothing to change.
